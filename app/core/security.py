"""Заголовки безопасности и сжатие ответов."""
from __future__ import annotations

import base64
import hashlib
import json
import re

from starlette.middleware.gzip import GZipMiddleware

from app.config import settings
from starlette.types import ASGIApp, Receive, Scope, Send

# Единственный inline-скрипт: выставляет тему до отрисовки, чтобы не было вспышки.
THEME_BOOT_SCRIPT = (
    "(function(){try{var t=localStorage.getItem('kombain-theme');"
    "if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}"
    "document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}})();"
)
THEME_BOOT_HASH = "sha256-" + base64.b64encode(hashlib.sha256(THEME_BOOT_SCRIPT.encode()).digest()).decode()

IMAGE_HOSTS = "https://i.ytimg.com https://yt3.ggpht.com https://yt3.googleusercontent.com"
# Яндекс Метрика ходит на mc.yandex.<домен страны>; список — из документации Метрики.
METRIKA_TLDS = ["ru", "az", "by", "co.il", "com", "com.am", "com.ge", "com.tr", "ee", "fr", "kg", "kz",
                "lt", "lv", "md", "tj", "tm", "uz"]


def _build_csp() -> str:
    metrika = " ".join(f"https://mc.yandex.{tld}" for tld in METRIKA_TLDS) if settings.yandex_metrika_id else ""
    metrika_ws = " ".join(f"wss://mc.yandex.{tld}" for tld in METRIKA_TLDS) if settings.yandex_metrika_id else ""
    hits = "https://hits.sh" if settings.hits_counter else ""
    parts = [
        "default-src 'self'",
        f"script-src 'self' '{THEME_BOOT_HASH}' {metrika}",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        # https://seotoolkitru.onrender.com — значок SEO-оценки в подвале
        f"img-src 'self' data: blob: {IMAGE_HOSTS} https://seotoolkitru.onrender.com {metrika} {hits}",
        f"frame-src https://www.youtube-nocookie.com https://www.youtube.com {metrika}",
        f"connect-src 'self' {metrika} {metrika_ws}",
        "media-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "manifest-src 'self'",
    ]
    return "; ".join(" ".join(p.split()) for p in parts)


CSP = _build_csp()

HEADERS = [
    (b"content-security-policy", CSP.encode()),
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"x-frame-options", b"DENY"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=(), payment=(), usb=()"),
    (b"cross-origin-opener-policy", b"same-origin"),
]


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        is_api = scope["path"].startswith("/api/")

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                existing = {k.lower() for k, _ in message.get("headers", [])}
                headers = list(message.get("headers", []))
                headers.extend((k, v) for k, v in HEADERS if k not in existing)
                if settings.is_production:
                    headers.append((b"strict-transport-security", b"max-age=31536000"))
                if is_api:
                    headers.append((b"x-robots-tag", b"noindex, nofollow"))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_wrapper)


class SelectiveGZipMiddleware:
    """Сжимает HTML/JSON/CSS/JS, но не трогает скачиваемые файлы и картинки."""

    SKIP_PREFIXES = ("/api/download/", "/api/image", "/static/img/")

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=800)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and not scope["path"].startswith(self.SKIP_PREFIXES):
            await self.gzip(scope, receive, send)
        else:
            await self.app(scope, receive, send)


class HeadMiddleware:
    """Отвечает на HEAD так же, как на GET, но без тела (нужно мониторингам и проверкам ссылок)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # API не трогаем: HEAD к файлу скачивания не должен запускать его отдачу и удаление.
        if scope["type"] != "http" or scope["method"] != "HEAD" or scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return
        scope = dict(scope, method="GET")

        async def send_wrapper(message):
            if message["type"] == "http.response.body":
                message = {"type": "http.response.body", "body": b"", "more_body": message.get("more_body", False)}
            await send(message)

        await self.app(scope, receive, send_wrapper)


class BodyLimitMiddleware:
    """Ограничивает размер тела запроса: API принимает короткий JSON, крупнее — только музыка и титры редактора."""

    DEFAULT = 64 * 1024
    RULES = [
        (re.compile(r"^/api/editor/[a-f0-9]{32}/audio$"), lambda: settings.editor_max_audio_mb * 1024 * 1024),
        (re.compile(r"^/api/editor/[a-f0-9]{32}/render$"), lambda: 24 * 1024 * 1024),
    ]

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    def _limit(self, path: str) -> int:
        for pattern, limit in self.RULES:
            if pattern.match(path):
                return limit()
        return self.DEFAULT

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] in {"GET", "HEAD", "OPTIONS"}:
            await self.app(scope, receive, send)
            return
        limit = self._limit(scope["path"])
        declared = dict(scope["headers"]).get(b"content-length")
        if declared and declared.isdigit() and int(declared) > limit:
            await self._reject(send)
            return
        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _TooLarge()
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _TooLarge:
            await self._reject(send)

    @staticmethod
    async def _reject(send: Send) -> None:
        body = json.dumps({"error": {"code": "too_large", "message": "Слишком большой запрос."}}, ensure_ascii=False).encode()
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})


class _TooLarge(Exception):
    pass
