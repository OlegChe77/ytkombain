"""Фоновые задачи с прогрессом: загрузка комментариев, плейлистов, скачивание файлов.

Клиент получает id задачи и опрашивает /api/jobs/{id}. Задачи живут в памяти процесса,
поэтому приложение запускается одним воркером (см. README).
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable

from app.core.errors import AppError, JobCancelled, JobTimeout, friendly_error

log = logging.getLogger("kombain.jobs")

ACTIVE = {"queued", "running"}


@dataclass
class Job:
    kind: str
    owner: str
    timeout: float
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: str = "queued"
    stage: str = "В очереди…"
    progress: dict = field(default_factory=dict)
    result: Any = None
    error: dict | None = None
    created: float = field(default_factory=time.monotonic)
    started: float | None = None
    finished: float | None = None
    meta: dict = field(default_factory=dict)
    on_cleanup: Callable[["Job"], None] | None = None
    _cancel: threading.Event = field(default_factory=threading.Event)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def update(self, stage: str | None = None, **progress: Any) -> None:
        with self._lock:
            if stage is not None:
                self.stage = stage
            if progress:
                self.progress.update(progress)

    def checkpoint(self) -> None:
        """Вызывается из хуков yt-dlp: прерывает работу при отмене или превышении времени."""
        if self._cancel.is_set():
            raise JobCancelled()
        if self.started and time.monotonic() - self.started > self.timeout:
            raise JobTimeout()

    def cancel(self) -> None:
        self._cancel.set()

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    def public(self, include_result: bool = True) -> dict:
        with self._lock:
            data = {
                "id": self.id,
                "kind": self.kind,
                "status": self.status,
                "stage": self.stage,
                "progress": dict(self.progress),
            }
            if self.status == "done" and include_result:
                data["result"] = self.result
            if self.error:
                data["error"] = self.error
            return data


class JobManager:
    def __init__(self, name: str, workers: int, max_queued: int, ttl: float = 900):
        self.name = name
        self.max_queued = max_queued
        self.ttl = ttl
        self._executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix=f"job-{name}")
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def active_for(self, owner: str) -> int:
        with self._lock:
            return sum(1 for j in self._jobs.values() if j.owner == owner and j.status in ACTIVE)

    def _active_total(self) -> int:
        with self._lock:
            return sum(1 for j in self._jobs.values() if j.status in ACTIVE)

    def submit(self, kind: str, owner: str, fn: Callable[[Job], Any], *, timeout: float,
               per_owner_limit: int, meta: dict | None = None,
               on_cleanup: Callable[[Job], None] | None = None) -> Job:
        if self.active_for(owner) >= per_owner_limit:
            raise AppError("У вас уже выполняется задача такого типа.", status=429, code="busy",
                           hint="Дождитесь её завершения или отмените её.")
        if self._active_total() >= self.max_queued:
            raise AppError("Сервер сейчас загружен.", status=503, code="overloaded",
                           hint="Попробуйте через минуту.")
        job = Job(kind=kind, owner=owner, timeout=timeout, meta=meta or {}, on_cleanup=on_cleanup)
        with self._lock:
            self._jobs[job.id] = job
        self._executor.submit(self._run, job, fn)
        return job

    def _run(self, job: Job, fn: Callable[[Job], Any]) -> None:
        if job.cancelled:
            job.status, job.finished = "cancelled", time.monotonic()
            return
        job.status, job.started = "running", time.monotonic()
        try:
            result = fn(job)
            with job._lock:
                job.result = result
                job.status = "done"
                job.stage = "Готово"
        except Exception as exc:  # noqa: BLE001 — любая ошибка должна дойти до клиента понятным текстом
            err = friendly_error(exc)
            if err.code == "upstream":
                log.warning("job %s (%s) failed: %s", job.id, job.kind, exc)
            with job._lock:
                job.status = "cancelled" if err.code == "cancelled" else "error"
                job.error = err.to_dict()
                job.stage = err.message
        finally:
            job.finished = time.monotonic()

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def all(self) -> list[Job]:
        with self._lock:
            return list(self._jobs.values())

    def cancel(self, job_id: str) -> bool:
        job = self.get(job_id)
        if not job:
            return False
        job.cancel()
        return True

    def cleanup(self) -> None:
        now = time.monotonic()
        expired: list[Job] = []
        with self._lock:
            for job_id, job in list(self._jobs.items()):
                if job.status not in ACTIVE and job.finished and now - job.finished > self.ttl:
                    expired.append(self._jobs.pop(job_id))
        for job in expired:
            if job.on_cleanup:
                try:
                    job.on_cleanup(job)
                except Exception:  # noqa: BLE001
                    log.exception("cleanup failed for job %s", job.id)

    def shutdown(self) -> None:
        with self._lock:
            jobs = list(self._jobs.values())
        for job in jobs:
            job.cancel()
        self._executor.shutdown(wait=False, cancel_futures=True)
        for job in jobs:
            if job.on_cleanup:
                try:
                    job.on_cleanup(job)
                except Exception:  # noqa: BLE001
                    pass
