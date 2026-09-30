"""Скачивание видео и аудио через yt-dlp во временную папку с последующей отдачей и удалением."""
from __future__ import annotations

import logging
import shutil
import time
from pathlib import Path

from app.config import settings
from app.core.errors import AppError
from app.core.jobs import Job, JobManager
from app.youtube import ytdlp
from app.youtube.media import safe_filename
from app.youtube.urls import YouTubeRef
from app.youtube.video import get_video

log = logging.getLogger("kombain.downloads")

DOWNLOAD_ROOT = settings.temp_dir / "downloads"
DELIVERED_GRACE_S = 30
MEDIA_TYPES = {"mp4": "video/mp4", "webm": "video/webm", "m4a": "audio/mp4", "mp3": "audio/mpeg", "mkv": "video/x-matroska"}
PP_STAGES = {
    "Merger": "Склеиваем видео и звук…",
    "FFmpegMerger": "Склеиваем видео и звук…",
    "ExtractAudio": "Конвертируем в MP3…",
    "FFmpegExtractAudio": "Конвертируем в MP3…",
    "FixupM4a": "Проверяем файл…",
    "FFmpegFixupM4a": "Проверяем файл…",
    "MoveFiles": "Подготавливаем файл…",
}

manager = JobManager("downloads", workers=settings.download_workers,
                     max_queued=max(settings.download_workers * 3, 4), ttl=settings.file_ttl_s)


def _remove_dir(job: Job) -> None:
    path = job.meta.get("dir")
    if path:
        shutil.rmtree(path, ignore_errors=True)


def start_download(ref: YouTubeRef, option_id: str, owner: str) -> Job:
    info, private = get_video(ref)
    option = private["options"].get(option_id)
    if not option:
        raise AppError("Этот вариант скачивания не найден.", status=404, code="unknown_option",
                       hint="Обновите список форматов и выберите вариант заново.")
    if info["is_live"] or info["live_status"] in {"is_live", "is_upcoming", "post_live"}:
        raise AppError("Прямые трансляции скачать нельзя.", status=409, code="live",
                       hint="Дождитесь, пока запись эфира появится на канале.")
    duration = info.get("duration") or 0
    if duration > settings.max_download_duration_min * 60:
        raise AppError(f"Видео длиннее {settings.max_download_duration_min} минут — это ограничение сервера.",
                       status=413, code="too_long")
    public = next((o for group in info["downloads"].values() for o in group if o["id"] == option_id), {})
    estimated = public.get("size") or 0
    if estimated > settings.max_filesize_bytes:
        raise AppError(f"Файл займёт больше {settings.max_filesize_mb} МБ.", status=413, code="too_large",
                       hint="Выберите качество пониже или только звук.")
    DOWNLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    free_mb = shutil.disk_usage(DOWNLOAD_ROOT).free // (1024 * 1024)
    if free_mb - estimated // (1024 * 1024) < settings.min_free_disk_mb:
        raise AppError("На сервере сейчас мало места для временных файлов.", status=507, code="no_space",
                       hint="Попробуйте через несколько минут.")

    return manager.submit(
        "download", owner, lambda job: _run(job, ref, info, option),
        timeout=settings.download_timeout_s, per_owner_limit=1,
        meta={"video_id": ref.video_id}, on_cleanup=_remove_dir,
    )


def _run(job: Job, ref: YouTubeRef, info: dict, option: dict) -> dict:
    job_dir = DOWNLOAD_ROOT / job.id
    job_dir.mkdir(parents=True, exist_ok=True)
    job.meta["dir"] = str(job_dir)
    parts = 2 if "+" in option["format"].split("/")[0] else 1
    state = {"part": 1}
    logger = ytdlp.YdlLogger(lambda _msg: job.checkpoint())

    def on_progress(d: dict) -> None:
        job.checkpoint()
        if d.get("status") == "downloading":
            done = d.get("downloaded_bytes") or 0
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if done > settings.max_filesize_bytes:
                raise AppError(f"Файл превысил {settings.max_filesize_mb} МБ.", status=413, code="too_large")
            is_audio = (d.get("info_dict") or {}).get("vcodec") == "none"
            stage = "Скачиваем звук" if is_audio else "Скачиваем видео"
            if parts > 1:
                stage += f" · дорожка {min(state['part'], parts)} из {parts}"
            job.update(stage + "…", downloaded=done, total=total, speed=d.get("speed"), eta=d.get("eta"),
                       percent=round(done / total * 100, 1) if total else None)
        elif d.get("status") == "finished":
            state["part"] += 1

    def on_postprocess(d: dict) -> None:
        job.checkpoint()
        if d.get("status") == "started":
            stage = PP_STAGES.get(d.get("postprocessor") or "", "Обрабатываем файл…")
            job.update(stage, percent=None, speed=None, eta=None)

    opts = {
        "skip_download": False,
        "format": option["format"],
        "outtmpl": str(job_dir / "%(id)s.%(ext)s"),
        "progress_hooks": [on_progress],
        "postprocessor_hooks": [on_postprocess],
        "max_filesize": settings.max_filesize_bytes,
        "overwrites": True,
        "windowsfilenames": True,
        "http_chunk_size": 10 * 1024 * 1024,
        "concurrent_fragment_downloads": 2,
    }
    if option.get("merge"):
        opts["merge_output_format"] = option["merge"]
    if option.get("mp3"):
        opts["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3",
                                   "preferredquality": str(option["mp3"])}]
    job.update("Подключаемся к YouTube…")
    with ytdlp.ydl(logger, **opts) as y:
        result = y.extract_info(ref.video_url, download=True)
    job.checkpoint()

    path = _find_output(job_dir, result)
    if not path:
        if any("max-filesize" in w for w in logger.warnings):
            raise AppError(f"Файл больше {settings.max_filesize_mb} МБ.", status=413, code="too_large",
                           hint="Выберите качество пониже или только звук.")
        raise AppError("Файл не удалось подготовить.", status=500, code="no_file", hint="Попробуйте другой формат.")
    size = path.stat().st_size
    if size > settings.max_filesize_bytes:
        raise AppError(f"Файл больше {settings.max_filesize_mb} МБ.", status=413, code="too_large")
    ext = path.suffix.lstrip(".").lower()
    title = safe_filename(info.get("title") or ref.video_id, default=ref.video_id)
    label = safe_filename(option.get("file_label", ""), default="")
    job.meta["path"] = str(path)
    job.meta["filename"] = f"{title} [{label}].{ext}" if label else f"{title}.{ext}"
    job.meta["media_type"] = MEDIA_TYPES.get(ext, "application/octet-stream")
    return {"filename": job.meta["filename"], "size": size, "url": f"/api/download/{job.id}/file"}


def _find_output(job_dir: Path, result: dict) -> Path | None:
    candidates: list[Path] = []
    for item in result.get("requested_downloads") or []:
        if item.get("filepath"):
            candidates.append(Path(item["filepath"]))
    candidates += sorted(p for p in job_dir.iterdir() if p.is_file() and not p.name.endswith((".part", ".ytdl")))
    root = job_dir.resolve()
    for path in candidates:
        resolved = path.resolve()
        if resolved.is_file() and resolved.parent == root:
            return resolved
    return None


def mark_delivered(job: Job) -> None:
    job.meta["delivered_at"] = time.monotonic()


def sweep() -> None:
    """Удаляет отданные файлы и забытые папки (например, после перезапуска сервера)."""
    manager.cleanup()
    now = time.monotonic()
    for job in manager.all():
        if job.meta.get("delivered_at") and now - job.meta["delivered_at"] > DELIVERED_GRACE_S:
            _remove_dir(job)
            job.meta.pop("path", None)
    if not DOWNLOAD_ROOT.exists():
        return
    max_age = settings.file_ttl_s + settings.download_timeout_s
    wall = time.time()
    for folder in DOWNLOAD_ROOT.iterdir():
        try:
            if folder.is_dir() and wall - folder.stat().st_mtime > max_age and not manager.get(folder.name):
                shutil.rmtree(folder, ignore_errors=True)
        except OSError:
            continue
