"""Единая точка создания yt-dlp. Если YouTube что-то сломает, чинить нужно здесь и в модулях рядом."""
from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from typing import Any, Callable, Iterator

import yt_dlp

from app.config import settings

log = logging.getLogger("kombain.ytdlp")

# Ограничиваем число одновременных «лёгких» запросов к YouTube (информация, субтитры, каналы).
info_slots = threading.BoundedSemaphore(settings.info_concurrency)


class YdlLogger:
    """Передаёт служебные сообщения yt-dlp в колбэк (для прогресса) и гасит вывод в консоль."""

    def __init__(self, on_message: Callable[[str], None] | None = None):
        self.on_message = on_message
        self.warnings: list[str] = []

    def debug(self, msg: str) -> None:
        if self.on_message:
            self.on_message(msg)

    info = debug

    def warning(self, msg: str) -> None:
        self.warnings.append(msg)
        if self.on_message:
            self.on_message(msg)

    def error(self, msg: str) -> None:
        log.debug("yt-dlp error: %s", msg)


def base_options(logger: YdlLogger | None = None, **extra: Any) -> dict:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": False,
        "noprogress": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": 20,
        "retries": 3,
        "extractor_retries": 2,
        "cachedir": str(settings.temp_dir / "ytdlp-cache"),
        "logger": logger or YdlLogger(),
        "check_formats": False,
        "color": {"stdout": "no_color", "stderr": "no_color"},
    }
    if settings.js_runtimes:
        opts["js_runtimes"] = settings.js_runtimes
    if settings.ffmpeg_location:
        opts["ffmpeg_location"] = settings.ffmpeg_location
    if settings.cookies_file:
        opts["cookiefile"] = settings.cookies_file
    if settings.proxy:
        opts["proxy"] = settings.proxy
    # Параметры экстракторов из настроек (YTDLP_EXTRACTOR_ARGS) объединяем с параметрами конкретного запроса.
    merged = {name: dict(values) for name, values in settings.extractor_args.items()}
    for name, values in (extra.pop("extractor_args", None) or {}).items():
        merged.setdefault(name, {}).update(values)
    if merged:
        opts["extractor_args"] = merged
    opts.update(extra)
    return opts


@contextmanager
def ydl(logger: YdlLogger | None = None, **extra: Any) -> Iterator[yt_dlp.YoutubeDL]:
    with yt_dlp.YoutubeDL(base_options(logger, **extra)) as instance:
        yield instance


def extract(url: str, logger: YdlLogger | None = None, **extra: Any) -> dict:
    with ydl(logger, **extra) as y:
        info = y.extract_info(url, download=False)
        return y.sanitize_info(info)


def version() -> str:
    return yt_dlp.version.__version__
