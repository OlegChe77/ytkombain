"""Списки видео: плейлисты и вкладки каналов (видео, Shorts, трансляции)."""
from __future__ import annotations

import re

from app.core.cache import TTLCache
from app.core.errors import AppError
from app.core.jobs import Job
from app.youtube import ytdlp
from app.youtube.urls import VIDEO_ID, YouTubeRef

_cache = TTLCache(maxsize=40, ttl=600)
_PAGE = re.compile(r"page (\d+)", re.I)
UNAVAILABLE_TITLES = {"[private video]", "[deleted video]", "[unavailable video]"}


def _item(index: int, entry: dict) -> dict | None:
    vid = entry.get("id")
    if not vid or not VIDEO_ID.match(str(vid)):
        return None
    title = entry.get("title") or ""
    return {
        "index": index,
        "id": vid,
        "title": title,
        "url": f"https://www.youtube.com/watch?v={vid}",
        "duration": entry.get("duration"),
        "channel": entry.get("channel") or entry.get("uploader"),
        "views": entry.get("view_count"),
        "thumbnail": f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg",
        "unavailable": title.lower() in UNAVAILABLE_TITLES,
    }


def fetch_list(job: Job, ref: YouTubeRef, limit: int, tab: str) -> dict:
    url = ref.playlist_url if ref.kind == "playlist" else ref.channel_url(tab)
    key = (url, limit)
    cached = _cache.get(key)
    if cached:
        job.update("Список уже загружен недавно", current=len(cached["items"]), total=len(cached["items"]))
        return cached

    def on_message(msg: str) -> None:
        job.checkpoint()
        match = _PAGE.search(msg)
        if match:
            page = int(match.group(1))
            job.update(f"Загружаем список: страница {page}…", current=min(page * 100, limit), total=limit)

    job.update("Открываем список…")
    info = ytdlp.extract(url, ytdlp.YdlLogger(on_message), extract_flat="in_playlist",
                         playlistend=limit, noplaylist=False, lazy_playlist=False)
    job.checkpoint()
    entries = info.get("entries") or []
    if entries and all(e.get("_type") == "playlist" or "/playlist" in str(e.get("url", "")) for e in entries[:3]):
        raise AppError("По ссылке открылся список вкладок, а не видео.", code="wrong_kind",
                       hint="Выберите вкладку «Видео», «Shorts» или «Трансляции».")
    items = [item for i, e in enumerate(entries, 1) if (item := _item(i, e))]
    total_duration = sum(i["duration"] or 0 for i in items)
    result = {
        "kind": ref.kind,
        "tab": tab if ref.kind == "channel" else None,
        "id": info.get("id"),
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader"),
        "channel_url": info.get("channel_url") or info.get("uploader_url"),
        "url": url,
        "count": info.get("playlist_count") or len(items),
        "items": items,
        "total_duration": total_duration,
        "unknown_durations": sum(1 for i in items if not i["duration"]),
        "unavailable": sum(1 for i in items if i["unavailable"]),
        "truncated": len(entries) >= limit and (info.get("playlist_count") or 0) > limit,
    }
    job.update(current=len(items), total=len(items))
    _cache.set(key, result)
    return result
