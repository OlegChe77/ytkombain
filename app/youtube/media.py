"""Быстрое превью ссылки (oEmbed) и безопасное проксирование картинок YouTube для скачивания."""
from __future__ import annotations

import re
from urllib.parse import urlencode, urlsplit

import httpx

from app.config import settings
from app.core.cache import TTLCache
from app.core.errors import AppError
from app.youtube.urls import VIDEO_ID, YouTubeRef

_preview_cache = TTLCache(maxsize=1000, ttl=3600)
_client: httpx.AsyncClient | None = None

IMAGE_HOSTS = {"i.ytimg.com", "yt3.ggpht.com", "yt3.googleusercontent.com"}
THUMB_NAMES = {"maxresdefault", "sddefault", "hqdefault", "mqdefault", "default", "hq720",
               "0", "1", "2", "3", "hq1", "hq2", "hq3", "mq1", "mq2", "mq3", "sd1", "sd2", "sd3",
               "maxres1", "maxres2", "maxres3"}
MAX_IMAGE_BYTES = 15 * 1024 * 1024
_SAFE_NAME = re.compile(r"[^\w\-. ]+", re.UNICODE)


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=5.0),
            follow_redirects=False,
            headers={"User-Agent": "Mozilla/5.0 (compatible; YouTubeKombain/1.0)"},
            proxy=settings.proxy,
        )
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def preview(ref: YouTubeRef) -> dict:
    """Название и автор через публичный oEmbed — за доли секунды и без ключей API."""
    if ref.kind == "channel":
        return {"kind": "channel", "title": None, "author": None, "thumbnail": None}
    target = ref.video_url if ref.kind == "video" else ref.playlist_url
    cached = _preview_cache.get(target)
    if cached:
        return cached
    thumb = f"https://i.ytimg.com/vi/{ref.video_id}/mqdefault.jpg" if ref.video_id else None
    data = {"kind": ref.kind, "title": None, "author": None, "author_url": None, "thumbnail": thumb}
    try:
        response = await client().get("https://www.youtube.com/oembed?" + urlencode({"url": target, "format": "json"}))
    except httpx.HTTPError:
        return data  # превью — необязательная часть, ошибки сети не мешают работе
    if response.status_code in (401, 403, 404):
        data["unavailable"] = True
    elif response.status_code == 200:
        payload = response.json()
        data.update(title=payload.get("title"), author=payload.get("author_name"),
                    author_url=payload.get("author_url"),
                    thumbnail=thumb or payload.get("thumbnail_url"))
    _preview_cache.set(target, data)
    return data


def validate_image_url(src: str) -> str:
    try:
        parts = urlsplit(src)
    except ValueError:
        raise AppError("Некорректный адрес картинки.", code="invalid_url") from None
    if parts.scheme != "https" or parts.hostname not in IMAGE_HOSTS or parts.port or parts.username:
        raise AppError("Можно скачивать только картинки YouTube.", code="forbidden_host", status=403)
    return src


def thumbnail_url(video_id: str, name: str, webp: bool = False) -> str:
    if not VIDEO_ID.match(video_id) or name not in THUMB_NAMES:
        raise AppError("Такого варианта превью нет.", status=404, code="not_found")
    return f"https://i.ytimg.com/{'vi_webp' if webp else 'vi'}/{video_id}/{name}.{'webp' if webp else 'jpg'}"


def safe_filename(name: str, default: str = "image") -> str:
    name = re.sub(r"\s+", " ", _SAFE_NAME.sub("", name or "")).strip(" .")[:120]
    return name or default


async def fetch_image(src: str) -> tuple[bytes, str]:
    try:
        async with client().stream("GET", src) as response:
            if response.status_code != 200:
                raise AppError("Картинка недоступна на YouTube.", status=404, code="not_found")
            ctype = response.headers.get("content-type", "")
            if not ctype.startswith("image/"):
                raise AppError("По ссылке не картинка.", status=415, code="not_image")
            chunks, size = [], 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > MAX_IMAGE_BYTES:
                    raise AppError("Картинка слишком большая.", status=413, code="too_large")
                chunks.append(chunk)
            return b"".join(chunks), ctype.split(";")[0]
    except httpx.HTTPError:
        raise AppError("Не удалось получить картинку с YouTube.", status=502, code="upstream") from None
