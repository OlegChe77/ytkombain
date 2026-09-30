"""Общие модели запросов и помощники для API."""
from __future__ import annotations

import asyncio
from typing import Any, Callable

from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.core.errors import AppError, friendly_error
from app.core.jobs import JobManager

tasks = JobManager("tasks", workers=settings.job_workers, max_queued=settings.max_queued_jobs, ttl=600)


class UrlIn(BaseModel):
    url: str = Field(..., max_length=2048)


async def blocking(fn: Callable[..., Any], *args: Any, timeout: float | None = None) -> Any:
    """Выполняет блокирующий вызов yt-dlp в пуле потоков с общим таймаутом."""
    try:
        return await asyncio.wait_for(run_in_threadpool(fn, *args), timeout or settings.info_timeout_s)
    except asyncio.TimeoutError:
        raise AppError("YouTube слишком долго не отвечает.", status=504, code="timeout",
                       hint="Попробуйте ещё раз чуть позже.") from None
    except AppError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise friendly_error(exc) from exc
