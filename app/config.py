"""Настройки приложения. Всё задаётся переменными окружения (см. .env.example)."""
from __future__ import annotations

import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _load_dotenv(path: Path) -> None:
    """Минимальный разбор .env без внешних зависимостей. Уже заданные переменные не перезаписываются."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(BASE_DIR.parent / ".env")


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def _detect_ffmpeg() -> str | None:
    custom = os.getenv("FFMPEG_PATH")
    if custom:
        return custom
    system = shutil.which("ffmpeg")
    if system:
        return system
    try:  # статическая сборка ffmpeg из пакета imageio-ffmpeg
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def _detect_js_runtimes() -> dict[str, dict]:
    """yt-dlp нужен JS-движок для полноценной работы с YouTube. Ищем deno, node или bun."""
    configured = os.getenv("YTDLP_JS_RUNTIMES", "").strip()
    runtimes: dict[str, dict] = {}
    if configured:
        for item in configured.split(","):
            name, _, path = item.strip().partition(":")
            if name:
                runtimes[name] = {"path": path} if path else {}
        return runtimes
    for name in ("deno", "node", "bun"):
        path = shutil.which(name)
        if path:
            runtimes[name] = {"path": path}
    return runtimes


@dataclass(frozen=True)
class Settings:
    site_url: str
    site_name: str
    environment: str
    trust_proxy: bool
    temp_dir: Path
    ffmpeg_location: str | None
    js_runtimes: dict
    cookies_file: str | None
    proxy: str | None

    max_filesize_mb: int
    max_download_duration_min: int
    download_timeout_s: int
    info_timeout_s: int
    job_timeout_s: int
    file_ttl_s: int
    min_free_disk_mb: int

    max_comments: int
    max_playlist_items: int
    job_workers: int
    download_workers: int
    max_queued_jobs: int
    info_concurrency: int

    editor_max_source_min: int
    editor_max_clip_s: int
    editor_session_ttl_s: int
    editor_render_timeout_s: int
    editor_max_audio_mb: int
    editor_render_workers: int
    editor_max_sessions: int

    yandex_metrika_id: int
    yandex_verification: str
    google_verification: str
    hits_counter: bool

    rate_api_per_min: int
    rate_heavy_per_min: int
    rate_download_per_hour: int
    max_jobs_per_ip: int

    @property
    def site_host(self) -> str:
        return self.site_url.split("://", 1)[-1].split("/", 1)[0]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def max_filesize_bytes(self) -> int:
        return self.max_filesize_mb * 1024 * 1024

    @property
    def ffmpeg_available(self) -> bool:
        return bool(self.ffmpeg_location)


def load_settings() -> Settings:
    temp_root = Path(os.getenv("TEMP_DIR") or Path(tempfile.gettempdir()) / "yt-kombain")
    return Settings(
        site_url=os.getenv("SITE_URL", "http://localhost:8000").rstrip("/"),
        site_name="YouTube Комбайн",
        environment=os.getenv("APP_ENV", "development").lower(),
        trust_proxy=_bool("TRUST_PROXY", False),
        temp_dir=temp_root,
        ffmpeg_location=_detect_ffmpeg(),
        js_runtimes=_detect_js_runtimes(),
        cookies_file=os.getenv("YTDLP_COOKIES_FILE") or None,
        proxy=os.getenv("YTDLP_PROXY") or None,
        max_filesize_mb=_int("MAX_FILESIZE_MB", 1024),
        max_download_duration_min=_int("MAX_DOWNLOAD_DURATION_MIN", 240),
        download_timeout_s=_int("DOWNLOAD_TIMEOUT_S", 900),
        info_timeout_s=_int("INFO_TIMEOUT_S", 45),
        job_timeout_s=_int("JOB_TIMEOUT_S", 240),
        file_ttl_s=_int("FILE_TTL_S", 900),
        min_free_disk_mb=_int("MIN_FREE_DISK_MB", 1024),
        max_comments=_int("MAX_COMMENTS", 5000),
        max_playlist_items=_int("MAX_PLAYLIST_ITEMS", 3000),
        job_workers=_int("JOB_WORKERS", 4),
        download_workers=_int("DOWNLOAD_WORKERS", 2),
        max_queued_jobs=_int("MAX_QUEUED_JOBS", 24),
        info_concurrency=_int("INFO_CONCURRENCY", 6),
        editor_max_source_min=_int("EDITOR_MAX_SOURCE_MIN", 30),
        editor_max_clip_s=_int("EDITOR_MAX_CLIP_S", 180),
        editor_session_ttl_s=_int("EDITOR_SESSION_TTL_S", 3600),
        editor_render_timeout_s=_int("EDITOR_RENDER_TIMEOUT_S", 600),
        editor_max_audio_mb=_int("EDITOR_MAX_AUDIO_MB", 25),
        editor_render_workers=_int("EDITOR_RENDER_WORKERS", 1),
        editor_max_sessions=_int("EDITOR_MAX_SESSIONS", 20),
        yandex_metrika_id=_int("YANDEX_METRIKA_ID", 0),
        yandex_verification=os.getenv("YANDEX_VERIFICATION", "").strip(),
        google_verification=os.getenv("GOOGLE_VERIFICATION", "").strip(),
        hits_counter=_bool("HITS_COUNTER", False),
        rate_api_per_min=_int("RATE_API_PER_MIN", 90),
        rate_heavy_per_min=_int("RATE_HEAVY_PER_MIN", 15),
        rate_download_per_hour=_int("RATE_DOWNLOAD_PER_HOUR", 20),
        max_jobs_per_ip=_int("MAX_JOBS_PER_IP", 2),
    )


settings = load_settings()
