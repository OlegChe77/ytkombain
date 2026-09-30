"""Ограничение частоты запросов по IP (скользящее окно, хранится в памяти)."""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from app.config import settings
from app.core.errors import AppError


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, bucket: str, limit: int, window: float) -> None:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[(bucket, key)]
            while hits and hits[0] <= now - window:
                hits.popleft()
            if len(hits) >= limit:
                retry = int(hits[0] + window - now) + 1
                raise AppError(
                    "Слишком много запросов подряд.",
                    status=429,
                    code="rate_limited",
                    hint=f"Подождите {retry} с. и попробуйте снова.",
                )
            hits.append(now)

    def prune(self, max_window: float = 3600) -> None:
        now = time.monotonic()
        with self._lock:
            for key in [k for k, v in self._hits.items() if not v or v[-1] <= now - max_window]:
                self._hits.pop(key, None)


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    if settings.trust_proxy:
        # CF-Connecting-IP/True-Client-IP ставит пограничный прокси (Render, Cloudflare), X-Real-IP — nginx.
        for header in ("cf-connecting-ip", "true-client-ip", "x-real-ip"):
            value = request.headers.get(header)
            if value:
                return value.strip()
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def limit_api(request: Request) -> str:
    ip = client_ip(request)
    limiter.hit(ip, "api", settings.rate_api_per_min, 60)
    return ip


def limit_poll(request: Request) -> str:
    """Опрос статуса задач: частые, но дешёвые запросы — отдельный, более щедрый лимит."""
    ip = client_ip(request)
    limiter.hit(ip, "poll", settings.rate_api_per_min * 4, 60)
    return ip


def limit_heavy(request: Request) -> str:
    ip = limit_api(request)
    limiter.hit(ip, "heavy", settings.rate_heavy_per_min, 60)
    return ip


def limit_download(request: Request) -> str:
    ip = limit_heavy(request)
    limiter.hit(ip, "download", settings.rate_download_per_hour, 3600)
    return ip
