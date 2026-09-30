"""API редактора Shorts/Stories."""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from app.api.deps import UrlIn, blocking
from app.config import settings
from app.core.errors import AppError
from app.core.ratelimit import limit_api, limit_download, limit_heavy
from app.downloads import service as downloads
from app.editor import service as editor
from app.youtube.urls import parse_youtube_url

router = APIRouter(prefix="/api/editor")
HEX = r"^#[0-9a-fA-F]{6}$"


class OverlayIn(BaseModel):
    png: str = Field(..., max_length=4_500_000)
    x: int = Field(..., ge=-4000, le=8000)
    y: int = Field(..., ge=-4000, le=8000)
    start: float = Field(0, ge=0, le=3600)
    end: float | None = Field(None, ge=0, le=3600)
    anim: Literal["none", "fade", "slide", "pop"] = "none"


class RenderIn(BaseModel):
    start: float = Field(..., ge=0, le=86400)
    end: float = Field(..., gt=0, le=86400)
    format: Literal["9:16", "1:1", "4:5", "16:9"] = "9:16"
    fit: Literal["cover", "contain"] = "cover"
    background: Literal["blur", "color"] = "blur"
    bg_color: str = Field("#000000", pattern=HEX)
    zoom: float = Field(1.0, ge=0.3, le=4)
    pan_x: float = Field(0.5, ge=0, le=1)
    pan_y: float = Field(0.5, ge=0, le=1)
    speed: Literal[0.5, 0.75, 1.0, 1.25, 1.5, 2.0] = 1.0
    volume: float = Field(1.0, ge=0, le=2)
    use_music: bool = False
    music_volume: float = Field(0.8, ge=0, le=2)
    music_offset: float = Field(0, ge=0, le=36000)
    music_fade: bool = True
    fade_in: bool = False
    fade_out: bool = False
    progress: Literal["none", "top", "bottom"] = "none"
    progress_color: str = Field("#ffffff", pattern=HEX)
    overlays: list[OverlayIn] = Field(default_factory=list, max_length=editor.MAX_OVERLAYS)


def _json(data: dict) -> JSONResponse:
    return JSONResponse(data, headers={"Cache-Control": "no-store"})


@router.post("/source")
async def open_source(body: UrlIn, ip: str = Depends(limit_download)) -> Response:
    ref = parse_youtube_url(body.url, allow={"video"})
    job = await blocking(editor.start_source, ref, ip)
    return _json(job.public())


@router.get("/{session_id}/source")
async def source_file(session_id: str) -> Response:
    session = editor.sessions.get(session_id)
    if not session.source or not session.source.exists():
        raise AppError("Видео ещё не готово.", status=404, code="no_source")
    return FileResponse(session.source, media_type="video/mp4", headers={"Cache-Control": "private, max-age=3600"})


@router.post("/{session_id}/audio")
async def upload_audio(session_id: str, request: Request, _: str = Depends(limit_heavy)) -> Response:
    session = editor.sessions.get(session_id)
    limit = settings.editor_max_audio_mb * 1024 * 1024
    temp = session.dir / f"upload-{uuid.uuid4().hex[:8]}.part"
    size = 0
    try:
        with open(temp, "wb") as file:
            async for chunk in request.stream():
                size += len(chunk)
                if size > limit:
                    raise AppError(f"Файл больше {settings.editor_max_audio_mb} МБ.", status=413, code="too_large")
                file.write(chunk)
    except BaseException:
        temp.unlink(missing_ok=True)
        raise
    if not size:
        temp.unlink(missing_ok=True)
        raise AppError("Файл пустой.", code="empty")
    result = await blocking(editor.save_music, session, request.headers.get("content-type", ""), temp)
    return _json(result)


@router.delete("/{session_id}/audio")
async def delete_audio(session_id: str, _: str = Depends(limit_api)) -> Response:
    editor.remove_music(editor.sessions.get(session_id))
    return _json({"ok": True})


@router.post("/{session_id}/render")
async def render(session_id: str, body: RenderIn, ip: str = Depends(limit_heavy)) -> Response:
    session = editor.sessions.get(session_id)
    params = body.model_dump(exclude={"overlays"})
    overlays = [o.model_dump() for o in body.overlays]
    job = await blocking(editor.start_render, session, params, overlays, ip)
    return _json(job.public())


@router.get("/render/{job_id}/file")
async def render_file(job_id: str, _: str = Depends(limit_api)) -> Response:
    job = editor.render_manager.get(job_id) if job_id.isalnum() else None
    if not job or job.status != "done":
        raise AppError("Файл не найден.", status=404, code="file_not_found", hint="Соберите клип заново.")
    if not job.meta.get("path") or job.meta.get("delivered_at"):
        raise AppError("Файл уже скачан и удалён с сервера.", status=410, code="file_gone",
                       hint="Нажмите «Создать видео» ещё раз.")
    return FileResponse(job.meta["path"], filename=job.meta["filename"], media_type="video/mp4",
                        headers={"Cache-Control": "no-store"},
                        background=BackgroundTask(downloads.mark_delivered, job))
