"""HTTP API. Все ответы — JSON, ошибки в формате {"error": {"code", "message", "hint"}}."""
from __future__ import annotations

from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import Field
from starlette.background import BackgroundTask

from app.api.deps import UrlIn, blocking, tasks
from app.config import settings
from app.core.errors import AppError
from app.core.ratelimit import limit_api, limit_download, limit_heavy, limit_poll
from app.downloads import service as downloads
from app.editor import service as editor
from app.seo.catalog import search_index
from app.youtube import channel, comments, media, playlist, pot, subtitles, video, ytdlp
from app.youtube.urls import parse_youtube_url

router = APIRouter(prefix="/api")

NO_STORE = {"Cache-Control": "no-store"}


class CommentsIn(UrlIn):
    limit: int = Field(1000, ge=20)
    sort: Literal["top", "new"] = "top"
    replies: bool = False


class PlaylistIn(UrlIn):
    limit: int = Field(500, ge=1)
    tab: Literal["videos", "shorts", "streams"] = "videos"


class TranscriptIn(UrlIn):
    track: str = Field(..., max_length=80, pattern=r"^(manual|auto):[\w\-]{1,40}$")


class DownloadIn(UrlIn):
    option: str = Field(..., max_length=80, pattern=r"^[\w\-+]{1,80}$")


def _json(data: dict, cache: str = "no-store") -> JSONResponse:
    return JSONResponse(data, headers={"Cache-Control": cache})


@router.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "yt_dlp": ytdlp.version(),
        "ffmpeg": settings.ffmpeg_available,
        "js_runtime": ", ".join(settings.js_runtimes) or None,
        "cookies": ytdlp.cookies_enabled(),
        "pot_server": await pot.status(),
    }


@router.get("/catalog")
async def catalog(_: str = Depends(limit_api)) -> Response:
    return _json(search_index(), cache="public, max-age=3600")


@router.get("/preview")
async def preview(url: str = Query(..., max_length=2048), _: str = Depends(limit_api)) -> Response:
    ref = parse_youtube_url(url)
    return _json(await media.preview(ref), cache="private, max-age=600")


@router.post("/video/info")
async def video_info(body: UrlIn, _: str = Depends(limit_heavy)) -> Response:
    ref = parse_youtube_url(body.url, allow={"video"})
    info, _private = await blocking(video.get_video, ref)
    return _json(info)


@router.post("/transcript")
async def transcript(body: TranscriptIn, _: str = Depends(limit_heavy)) -> Response:
    ref = parse_youtube_url(body.url, allow={"video"})
    return _json(await blocking(subtitles.get_transcript, ref, body.track))


@router.post("/channel")
async def channel_info(body: UrlIn, _: str = Depends(limit_heavy)) -> Response:
    ref = parse_youtube_url(body.url, allow={"channel"})
    return _json(await blocking(channel.get_channel, ref))


@router.post("/comments")
async def start_comments(body: CommentsIn, ip: str = Depends(limit_heavy)) -> Response:
    ref = parse_youtube_url(body.url, allow={"video"})
    limit = min(body.limit, settings.max_comments)
    # Ответы загружаются отдельными запросами, поэтому на большие объёмы даём больше времени.
    timeout = settings.job_timeout_s + limit * (0.08 if body.replies else 0.03)
    job = tasks.submit("comments", ip, lambda j: comments.fetch_comments(j, ref, limit, body.sort, body.replies),
                       timeout=timeout, per_owner_limit=settings.max_jobs_per_ip)
    return _json(job.public(), cache="no-store")


@router.post("/playlist")
async def start_playlist(body: PlaylistIn, ip: str = Depends(limit_heavy)) -> Response:
    ref = parse_youtube_url(body.url, allow={"playlist", "channel"})
    limit = min(body.limit, settings.max_playlist_items)
    job = tasks.submit("playlist", ip, lambda j: playlist.fetch_list(j, ref, limit, body.tab),
                       timeout=settings.job_timeout_s, per_owner_limit=settings.max_jobs_per_ip)
    return _json(job.public())


@router.post("/download")
async def start_download(body: DownloadIn, ip: str = Depends(limit_download)) -> Response:
    ref = parse_youtube_url(body.url, allow={"video"})
    job = await blocking(downloads.start_download, ref, body.option, ip)
    return _json(job.public())


def _find_job(job_id: str):
    if not job_id.isalnum() or len(job_id) != 32:
        return None
    return tasks.get(job_id) or downloads.manager.get(job_id) or editor.render_manager.get(job_id)


@router.get("/jobs/{job_id}")
async def job_status(job_id: str, _: str = Depends(limit_poll)) -> Response:
    job = _find_job(job_id)
    if not job:
        raise AppError("Задача не найдена или устарела.", status=404, code="job_not_found",
                       hint="Запустите операцию заново.")
    return _json(job.public())


@router.delete("/jobs/{job_id}")
async def job_cancel(job_id: str, _: str = Depends(limit_api)) -> Response:
    job = _find_job(job_id)
    if job:
        job.cancel()
    return _json({"ok": True})


@router.get("/download/{job_id}/file")
async def download_file(job_id: str, _: str = Depends(limit_api)) -> Response:
    job = downloads.manager.get(job_id) if job_id.isalnum() else None
    if not job or job.status != "done":
        raise AppError("Файл не найден.", status=404, code="file_not_found", hint="Подготовьте файл заново.")
    path = job.meta.get("path")
    if not path or job.meta.get("delivered_at"):
        raise AppError("Файл уже скачан и удалён с сервера.", status=410, code="file_gone",
                       hint="Если нужно ещё раз — подготовьте файл заново.")
    return FileResponse(path, filename=job.meta["filename"], media_type=job.meta["media_type"],
                        headers=NO_STORE, background=BackgroundTask(downloads.mark_delivered, job))


@router.get("/image")
async def image_proxy(src: str = Query(..., max_length=1024), name: str = Query("image", max_length=160),
                      _: str = Depends(limit_api)) -> Response:
    """Отдаёт картинку YouTube как файл (атрибут download не работает для чужих доменов)."""
    url = media.validate_image_url(src)
    data, ctype = await media.fetch_image(url)
    ext = {"image/jpeg": "jpg", "image/webp": "webp", "image/png": "png", "image/gif": "gif"}.get(ctype, "jpg")
    filename = f"{media.safe_filename(name)}.{ext}"
    return Response(data, media_type=ctype, headers={
        "Content-Disposition": f"attachment; filename=\"{filename.encode('ascii', 'ignore').decode() or 'image.' + ext}\"; "
                               f"filename*=UTF-8''{quote(filename, safe='')}",
        "Cache-Control": "private, max-age=3600",
    })


@router.get("/thumbnail/{video_id}/{name}")
async def thumbnail(video_id: str, name: str, webp: bool = False, _: str = Depends(limit_api)) -> Response:
    url = media.thumbnail_url(video_id, name, webp)
    data, ctype = await media.fetch_image(url)
    ext = "webp" if webp else "jpg"
    filename = f"{video_id}-{name}.{ext}"
    return Response(data, media_type=ctype, headers={
        "Content-Disposition": f"attachment; filename=\"{filename}\"",
        "Cache-Control": "public, max-age=86400",
    })

