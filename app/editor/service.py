"""Редактор Shorts/Stories: сессии, исходное видео, музыка пользователя и рендер через ffmpeg."""
from __future__ import annotations

import base64
import binascii
import logging
import re
import shutil
import struct
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from app.config import settings
from app.core.errors import AppError
from app.core.jobs import Job, JobManager
from app.downloads import service as downloads
from app.editor.render import OUTPUT_SIZES, ClipSpec, Overlay, build_command
from app.youtube import ytdlp
from app.youtube.media import safe_filename
from app.youtube.urls import YouTubeRef
from app.youtube.video import get_video

log = logging.getLogger("kombain.editor")

EDITOR_ROOT = settings.temp_dir / "editor"
SESSION_ID = re.compile(r"^[a-f0-9]{32}$")
SOURCE_FORMAT = ("bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/b[height<=720][ext=mp4]"
                 "/bv*[height<=720]+ba/b[height<=720]/b")
SOURCE_MAX_BYTES = 700 * 1024 * 1024
MAX_OVERLAYS = 60
MAX_OVERLAY_BYTES = 3 * 1024 * 1024
AUDIO_TYPES = {
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac",
    "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/ogg": "ogg", "audio/webm": "webm",
    "audio/flac": "flac", "audio/x-flac": "flac", "application/octet-stream": "bin",
}
_DURATION = re.compile(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)")

render_manager = JobManager("render", workers=settings.editor_render_workers, max_queued=6,
                            ttl=settings.file_ttl_s)


@dataclass
class Session:
    id: str
    owner: str
    dir: Path
    touched: float = field(default_factory=time.monotonic)
    video: dict | None = None
    source: Path | None = None
    music: Path | None = None
    music_duration: float | None = None
    busy: bool = False


class Sessions:
    def __init__(self) -> None:
        self._items: dict[str, Session] = {}
        self._lock = threading.Lock()

    def create(self, owner: str) -> Session:
        with self._lock:
            own = [s for s in self._items.values() if s.owner == owner]
            if len(own) >= 2:  # у одного IP держим не больше двух исходников — старый освобождаем
                oldest = min(own, key=lambda s: s.touched)
                self._drop(oldest)
            if len(self._items) >= settings.editor_max_sessions:
                raise AppError("Редактор сейчас загружен.", status=503, code="overloaded",
                               hint="Попробуйте через несколько минут.")
            session = Session(id=uuid.uuid4().hex, owner=owner, dir=EDITOR_ROOT / uuid.uuid4().hex)
            session.dir.mkdir(parents=True, exist_ok=True)
            self._items[session.id] = session
            return session

    def get(self, session_id: str) -> Session:
        with self._lock:
            session = self._items.get(session_id) if SESSION_ID.match(session_id or "") else None
            if not session:
                raise AppError("Сессия редактора истекла.", status=404, code="session_expired",
                               hint="Загрузите видео в редактор заново.")
            session.touched = time.monotonic()
            return session

    def _drop(self, session: Session) -> None:
        self._items.pop(session.id, None)
        shutil.rmtree(session.dir, ignore_errors=True)

    def sweep(self) -> None:
        now = time.monotonic()
        with self._lock:
            for session in list(self._items.values()):
                if not session.busy and now - session.touched > settings.editor_session_ttl_s:
                    self._drop(session)
            known = {s.dir.name for s in self._items.values()}
        if EDITOR_ROOT.exists():
            for folder in EDITOR_ROOT.iterdir():
                if folder.is_dir() and folder.name not in known:
                    try:
                        if time.time() - folder.stat().st_mtime > 300:
                            shutil.rmtree(folder, ignore_errors=True)
                    except OSError:
                        continue

    def clear(self) -> None:
        with self._lock:
            for session in list(self._items.values()):
                self._drop(session)


sessions = Sessions()


# ---------- Исходное видео ----------

def start_source(ref: YouTubeRef, owner: str) -> Job:
    if not settings.ffmpeg_available:
        raise AppError("На сервере нет ffmpeg — редактор недоступен.", status=503, code="no_ffmpeg")
    info, _private = get_video(ref)
    if info["is_live"] or info["live_status"] in {"is_live", "is_upcoming", "post_live"}:
        raise AppError("Прямые трансляции нельзя открыть в редакторе.", status=409, code="live",
                       hint="Дождитесь, пока запись эфира появится на канале.")
    duration = info.get("duration") or 0
    if duration > settings.editor_max_source_min * 60:
        raise AppError(f"В редактор можно загрузить видео до {settings.editor_max_source_min} минут.",
                       status=413, code="too_long", hint="Выберите ролик покороче.")
    session = sessions.create(owner)
    session.busy = True
    return downloads.manager.submit(
        "editor-source", owner, lambda job: _download_source(job, session, ref, info),
        timeout=settings.download_timeout_s, per_owner_limit=1, meta={"session": session.id},
    )


def _download_source(job: Job, session: Session, ref: YouTubeRef, info: dict) -> dict:
    try:
        state = {"part": 1}

        def on_progress(d: dict) -> None:
            job.checkpoint()
            if d.get("status") == "downloading":
                done = d.get("downloaded_bytes") or 0
                total = d.get("total_bytes") or d.get("total_bytes_estimate")
                if done > SOURCE_MAX_BYTES:
                    raise AppError("Видео слишком большое для редактора.", status=413, code="too_large")
                is_audio = (d.get("info_dict") or {}).get("vcodec") == "none"
                job.update(("Скачиваем звук" if is_audio else "Скачиваем видео") + f" · часть {min(state['part'], 2)} из 2…",
                           percent=round(done / total * 100, 1) if total else None, downloaded=done, total=total,
                           speed=d.get("speed"), eta=d.get("eta"))
            elif d.get("status") == "finished":
                state["part"] += 1

        def on_postprocess(d: dict) -> None:
            job.checkpoint()
            if d.get("status") == "started":
                job.update("Готовим видео для редактора…", percent=None, speed=None, eta=None)

        job.update("Подключаемся к YouTube…")
        with ytdlp.ydl(ytdlp.YdlLogger(lambda _m: job.checkpoint()), skip_download=False, format=SOURCE_FORMAT,
                       merge_output_format="mp4", outtmpl=str(session.dir / "source.%(ext)s"),
                       progress_hooks=[on_progress], postprocessor_hooks=[on_postprocess],
                       max_filesize=SOURCE_MAX_BYTES, overwrites=True, http_chunk_size=10 * 1024 * 1024) as y:
            result = y.extract_info(ref.video_url, download=True)
        path = next((Path(d["filepath"]) for d in result.get("requested_downloads") or [] if d.get("filepath")), None)
        if not path or not path.is_file() or path.resolve().parent != session.dir.resolve():
            raise AppError("Не удалось подготовить видео для редактора.", status=500, code="no_file")
        formats = result.get("requested_formats") or [result]
        has_audio = any((f.get("acodec") or "none") != "none" for f in formats)
        session.source = path
        session.video = {
            "id": info["id"], "title": info["title"], "channel": info["channel"],
            "duration": result.get("duration") or info["duration"],
            "width": result.get("width") or 1280, "height": result.get("height") or 720,
            "fps": result.get("fps") or 30, "has_audio": has_audio,
        }
        return {"session": session.id, "video": session.video, "source": f"/api/editor/{session.id}/source",
                "limits": {"max_clip": settings.editor_max_clip_s, "max_audio_mb": settings.editor_max_audio_mb}}
    finally:
        session.busy = False


# ---------- Музыка пользователя ----------

def _probe_audio(path: Path) -> float:
    try:
        proc = subprocess.run([settings.ffmpeg_location, "-hide_banner", "-nostdin", "-i", str(path),
                               "-t", "1", "-vn", "-f", "null", "-"], capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        raise AppError("Файл не удалось проверить.", status=422, code="bad_audio") from None
    match = _DURATION.search(proc.stderr)
    if proc.returncode != 0 or "Audio:" not in proc.stderr or not match:
        raise AppError("Это не похоже на аудиофайл.", status=422, code="bad_audio",
                       hint="Подойдут MP3, M4A, WAV, OGG или FLAC.")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def save_music(session: Session, content_type: str, data_path: Path) -> dict:
    ext = AUDIO_TYPES.get(content_type.split(";")[0].strip().lower())
    if not ext:
        data_path.unlink(missing_ok=True)
        raise AppError("Этот формат звука не поддерживается.", status=415, code="bad_audio",
                       hint="Подойдут MP3, M4A, WAV, OGG или FLAC.")
    try:
        duration = _probe_audio(data_path)
    except AppError:
        data_path.unlink(missing_ok=True)
        raise
    if session.music and session.music.exists():
        session.music.unlink(missing_ok=True)
    target = session.dir / f"music.{ext}"
    data_path.replace(target)
    session.music, session.music_duration = target, duration
    return {"duration": duration}


def remove_music(session: Session) -> None:
    if session.music:
        session.music.unlink(missing_ok=True)
    session.music = session.music_duration = None


# ---------- Рендер ----------

def _png_size(data: bytes) -> tuple[int, int]:
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise AppError("Слой титров повреждён.", status=422, code="bad_overlay")
    return struct.unpack(">II", data[16:24])


def _decode_png(value: str) -> bytes:
    if value.startswith("data:image/png;base64,"):
        value = value.split(",", 1)[1]
    try:
        data = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        raise AppError("Слой титров повреждён.", status=422, code="bad_overlay") from None
    if len(data) > MAX_OVERLAY_BYTES:
        raise AppError("Слой титров слишком большой.", status=413, code="too_large")
    return data


def start_render(session: Session, params: dict, overlays: list[dict], owner: str) -> Job:
    video = session.video
    if not video or not session.source or not session.source.exists():
        raise AppError("Видео для редактора ещё не загружено.", status=409, code="no_source")
    start, end = params["start"], min(params["end"], video["duration"])
    if end - start < 0.5:
        raise AppError("Отрезок слишком короткий — нужно хотя бы полсекунды.", code="too_short")
    duration = (end - start) / params["speed"]
    if duration > settings.editor_max_clip_s + 0.05:
        raise AppError(f"Клип получается длиннее {settings.editor_max_clip_s} секунд.", code="too_long",
                       hint="Сократите отрезок или увеличьте скорость.")
    if params["use_music"] and not session.music:
        raise AppError("Музыка не загружена.", code="no_music", hint="Загрузите трек заново.")
    if len(overlays) > MAX_OVERLAYS:
        raise AppError(f"Слишком много титров — максимум {MAX_OVERLAYS}.", code="too_many")

    width, height = OUTPUT_SIZES[params["format"]]
    render_id = uuid.uuid4().hex[:8]
    prepared: list[Overlay] = []
    for index, item in enumerate(overlays):
        data = _decode_png(item["png"])
        ow, oh = _png_size(data)
        if not (0 < ow <= width * 2 and 0 < oh <= height * 2):
            raise AppError("Слой титров больше кадра.", status=422, code="bad_overlay")
        o_start = max(0.0, item["start"])
        o_end = min(duration, item["end"] if item["end"] is not None else duration)
        if o_end - o_start < 0.05:
            continue
        name = f"{render_id}-layer{index}.png"
        (session.dir / name).write_bytes(data)
        prepared.append(Overlay(name, item["x"], item["y"], ow, oh, o_start, o_end, item["anim"]))

    spec = ClipSpec(
        source_width=video["width"], source_height=video["height"], fps=video["fps"], has_audio=video["has_audio"],
        start=start, end=end, format=params["format"], fit=params["fit"], background=params["background"],
        bg_color=params["bg_color"], zoom=params["zoom"], pan_x=params["pan_x"], pan_y=params["pan_y"],
        speed=params["speed"], volume=params["volume"],
        music=session.music.name if params["use_music"] and session.music else None,
        music_volume=params["music_volume"], music_offset=params["music_offset"], music_fade=params["music_fade"],
        fade_in=params["fade_in"], fade_out=params["fade_out"], progress=params["progress"],
        progress_color=params["progress_color"], overlays=prepared,
    )
    output = f"{render_id}-clip.mp4"
    command = build_command(settings.ffmpeg_location, spec, session.source.name, output)
    title = safe_filename(video["title"], default=video["id"])
    label = {"9:16": "Shorts", "1:1": "square", "4:5": "4x5", "16:9": "16x9"}[params["format"]]
    session.busy = True
    return render_manager.submit(
        "render", owner, lambda job: _run_ffmpeg(job, session, command, output, spec.duration, f"{title} [{label}].mp4"),
        timeout=settings.editor_render_timeout_s, per_owner_limit=1, meta={"session": session.id},
        on_cleanup=lambda job: Path(job.meta["path"]).unlink(missing_ok=True) if job.meta.get("path") else None,
    )


def _run_ffmpeg(job: Job, session: Session, command: list[str], output: str, duration: float, filename: str) -> dict:
    log_path = session.dir / f"{output}.log"
    try:
        job.update("Собираем клип…", percent=0)
        with open(log_path, "w", encoding="utf-8", errors="replace") as log_file:
            process = subprocess.Popen(command, cwd=session.dir, stdout=subprocess.PIPE, stderr=log_file,
                                       stdin=subprocess.DEVNULL, text=True)
            try:
                for line in process.stdout:
                    job.checkpoint()
                    if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
                        value = line.split("=", 1)[1].strip()
                        if value.isdigit():
                            done = int(value) / 1_000_000
                            job.update("Собираем клип…", percent=round(min(99.0, done / duration * 100), 1))
                process.wait(timeout=30)
            except BaseException:
                process.kill()
                process.wait(timeout=10)
                raise
        path = session.dir / output
        if process.returncode != 0 or not path.is_file():
            tail = log_path.read_text(encoding="utf-8", errors="replace")[-1500:]
            log.warning("ffmpeg failed (%s): %s", process.returncode, tail)
            raise AppError("Не получилось собрать клип.", status=500, code="render_failed",
                           hint="Попробуйте другие настройки или загрузите видео заново.")
        job.meta.update(path=str(path), filename=filename, media_type="video/mp4")
        size = path.stat().st_size
        return {"filename": filename, "size": size, "duration": round(duration, 2),
                "url": f"/api/editor/render/{job.id}/file"}
    finally:
        session.busy = False
        for stale in session.dir.glob(f"{output.split('-')[0]}-layer*.png"):
            stale.unlink(missing_ok=True)
        log_path.unlink(missing_ok=True)


def sweep() -> None:
    render_manager.cleanup()
    now = time.monotonic()
    for job in render_manager.all():
        delivered = job.meta.get("delivered_at")
        if delivered and now - delivered > downloads.DELIVERED_GRACE_S and job.meta.get("path"):
            Path(job.meta.pop("path")).unlink(missing_ok=True)
    sessions.sweep()
