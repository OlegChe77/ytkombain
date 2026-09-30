"""Данные канала: ID, аватар и шапка в исходном размере."""
from __future__ import annotations

from app.config import settings
from app.core.cache import TTLCache
from app.core.errors import AppError
from app.youtube import ytdlp
from app.youtube.urls import YouTubeRef

_cache = TTLCache(maxsize=200, ttl=1800)


def _thumb(thumbnails: list[dict], wanted: str) -> str | None:
    for t in thumbnails:
        if t.get("id") == wanted and t.get("url"):
            return t["url"]
    return None


def _extract(url: str) -> dict:
    return ytdlp.extract(url, extract_flat="in_playlist", playlistend=1, noplaylist=False)


def get_channel(ref: YouTubeRef) -> dict:
    cached = _cache.get(ref.channel_path)
    if cached:
        return cached
    if not ytdlp.info_slots.acquire(timeout=settings.info_timeout_s):
        raise AppError("Сервер сейчас загружен.", status=503, code="overloaded", hint="Попробуйте через минуту.")
    try:
        try:
            info = _extract(ref.channel_url("videos"))
        except Exception:  # у канала может не быть вкладки «Видео»
            info = _extract(ref.channel_url())
    finally:
        ytdlp.info_slots.release()
    thumbs = info.get("thumbnails") or []
    channel_id = info.get("channel_id")
    if not channel_id:
        raise AppError("Канал не найден.", status=404, code="not_found")
    handle = info.get("uploader_id") if str(info.get("uploader_id") or "").startswith("@") else None
    avatar = _thumb(thumbs, "avatar_uncropped")
    banner = _thumb(thumbs, "banner_uncropped")
    result = {
        "id": channel_id,
        "title": info.get("channel") or info.get("uploader") or info.get("title"),
        "handle": handle,
        "url": f"https://www.youtube.com/channel/{channel_id}",
        "handle_url": f"https://www.youtube.com/{handle}" if handle else None,
        "followers": info.get("channel_follower_count"),
        "verified": bool(info.get("channel_is_verified")),
        "description": info.get("description") or "",
        "tags": info.get("tags") or [],
        "avatar": avatar,
        "banner": banner,
        "rss": f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}",
        "subscribe_url": f"https://www.youtube.com/channel/{channel_id}?sub_confirmation=1",
    }
    _cache.set(ref.channel_path, result)
    return result
