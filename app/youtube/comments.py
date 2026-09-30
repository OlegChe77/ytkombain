"""Загрузка комментариев через yt-dlp (без YouTube Data API)."""
from __future__ import annotations

import re

from app.core.cache import TTLCache
from app.core.jobs import Job
from app.youtube import ytdlp
from app.youtube.urls import YouTubeRef

_cache = TTLCache(maxsize=24, ttl=600)
_PROGRESS = re.compile(r"\((\d+)/~?(\d+)\)")
MAX_TEXT = 5000


def _normalize(c: dict) -> dict:
    parent = c.get("parent") or "root"
    return {
        "id": c.get("id"),
        "text": (c.get("text") or "")[:MAX_TEXT],
        "author": c.get("author") or "Без имени",
        "author_id": c.get("author_id"),
        "author_url": c.get("author_url"),
        "avatar": c.get("author_thumbnail"),
        "likes": c.get("like_count") or 0,
        "reply": parent != "root",
        "parent": None if parent == "root" else parent,
        "ts": c.get("timestamp"),
        "time_text": c.get("_time_text"),
        "pinned": bool(c.get("is_pinned")),
        "hearted": bool(c.get("is_favorited")),
        "by_uploader": bool(c.get("author_is_uploader")),
        "verified": bool(c.get("author_is_verified")),
    }


def fetch_comments(job: Job, ref: YouTubeRef, limit: int, sort: str, replies: bool) -> dict:
    key = (ref.video_id, limit, sort, replies)
    cached = _cache.get(key)
    if cached:
        job.update("Комментарии уже загружены недавно", current=len(cached["comments"]), total=len(cached["comments"]))
        return cached

    state = {"total": None}

    def on_message(msg: str) -> None:
        job.checkpoint()
        if "comment" not in msg.lower():
            return
        match = _PROGRESS.search(msg)
        if match:
            current, total = int(match.group(1)), int(match.group(2))
            state["total"] = total
            job.update("Загружаем комментарии…", current=min(current, limit), total=min(total, limit),
                       available=total)
        elif "Downloading comment section" in msg:
            job.update("Открываем раздел комментариев…")

    job.update("Получаем информацию о видео…")
    extractor_args = {"youtube": {
        "max_comments": [str(limit), "all", "all" if replies else "0", "30" if replies else "0"],
        "comment_sort": [sort],
    }}
    info = ytdlp.extract(ref.video_url, ytdlp.YdlLogger(on_message), getcomments=True, extractor_args=extractor_args)
    job.checkpoint()
    job.update("Готовим список…")
    raw = info.get("comments") or []
    comments = [_normalize(c) for c in raw[:limit]]
    # yt-dlp записывает в comment_count число загруженных; реальное число берём из его журнала.
    total = max(state["total"] or 0, info.get("comment_count") or 0) or None
    result = {
        "video": {
            "id": info.get("id"),
            "title": info.get("title"),
            "channel": info.get("channel") or info.get("uploader"),
            "thumbnail": f"https://i.ytimg.com/vi/{info.get('id')}/mqdefault.jpg",
            "comment_count": total,
            "url": f"https://www.youtube.com/watch?v={info.get('id')}",
        },
        "comments": comments,
        "limit": limit,
        "sort": sort,
        "replies": replies,
        "truncated": bool(total and len(comments) >= limit and total > limit),
    }
    job.update(current=len(comments), total=len(comments))
    _cache.set(key, result)
    return result
