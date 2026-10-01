"""Точка входа: uvicorn app.main:app"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.deps import tasks
from app.api.editor import router as editor_router
from app.api.routes import router as api_router
from app.config import settings
from app.core.assets import STATIC_DIR
from app.core.errors import AppError
from app.core.ratelimit import limiter
from app.core.security import BodyLimitMiddleware, HeadMiddleware, SecurityHeadersMiddleware, SelectiveGZipMiddleware
from app.downloads import service as downloads
from app.editor import service as editor
from app.web import pages
from app.youtube import media, pot, video

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("kombain")


async def janitor() -> None:
    """Каждые 20 секунд чистит устаревшие задачи, временные файлы и счётчики лимитов."""
    while True:
        await asyncio.sleep(20)
        try:
            tasks.cleanup()
            downloads.sweep()
            editor.sweep()
            limiter.prune()
            video.prune_cache()
        except Exception:  # noqa: BLE001
            log.exception("janitor failed")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.temp_dir.mkdir(parents=True, exist_ok=True)
    downloads.sweep()
    editor.sweep()
    if not settings.ffmpeg_available:
        log.warning("ffmpeg не найден: доступны только готовые форматы без склейки и без MP3")
    if not settings.js_runtimes:
        log.warning("JS-движок (deno/node/bun) не найден: часть форматов YouTube может быть недоступна")
    pot.start()
    task = asyncio.create_task(janitor())
    yield
    await pot.stop()
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
    tasks.shutdown()
    downloads.manager.shutdown()
    editor.render_manager.shutdown()
    editor.sessions.clear()
    await media.close_client()


class TrailingSlashMiddleware:
    """/tools/ → /tools постоянным редиректом 301: у каждой страницы один адрес."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if scope["type"] == "http" and len(path) > 1 and path.endswith("/") and not path.startswith(("/api/", "/static/")):
            query = scope.get("query_string", b"").decode("latin-1")
            location = path.rstrip("/") + (f"?{query}" if query else "")
            await RedirectResponse(location, status_code=301)(scope, receive, send)
            return
        await self.app(scope, receive, send)


class CachedStatic(StaticFiles):
    """Файлы с ?v=хеш кэшируются надолго. Остальные (например, модули, импортируемые из скриптов)
    браузер перепроверяет по ETag при каждой загрузке — так после обновления не смешаются версии."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code in (200, 304):
            versioned = b"v=" in scope.get("query_string", b"")
            response.headers["Cache-Control"] = (
                "public, max-age=31536000, immutable" if versioned else "no-cache"
            )
        return response


app = FastAPI(
    title="YouTube Комбайн",
    lifespan=lifespan,
    redirect_slashes=False,
    docs_url=None if settings.is_production else "/api/docs",
    redoc_url=None,
    openapi_url=None if settings.is_production else "/api/openapi.json",
)
app.add_middleware(TrailingSlashMiddleware)
app.add_middleware(SelectiveGZipMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(HeadMiddleware)
app.add_middleware(BodyLimitMiddleware)
app.mount("/static", CachedStatic(directory=str(STATIC_DIR)), name="static")
app.include_router(api_router)
app.include_router(editor_router)
app.include_router(pages.router)


def _is_api(request: Request) -> bool:
    return request.url.path.startswith("/api/")


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    if not _is_api(request) and exc.status == 404:
        return pages.not_found_page(request)
    headers = {"Cache-Control": "no-store"}
    if exc.status == 429:
        headers["Retry-After"] = "30"
    return JSONResponse({"error": exc.to_dict()}, status_code=exc.status, headers=headers)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    fields = {".".join(str(p) for p in e.get("loc", [])[1:]) for e in exc.errors()}
    message = "Ссылка слишком длинная." if "url" in fields else "Некорректные параметры запроса."
    return JSONResponse({"error": {"code": "validation", "message": message}}, status_code=422)


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exc: StarletteHTTPException):
    if _is_api(request):
        message = {404: "Метод не найден.", 405: "Метод не поддерживается."}.get(exc.status_code, "Ошибка запроса.")
        return JSONResponse({"error": {"code": "http", "message": message}}, status_code=exc.status_code)
    if exc.status_code == 404:
        return pages.not_found_page(request)
    return pages.error_page(request, exc.status_code)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s", request.url.path)
    if _is_api(request):
        return JSONResponse({"error": {"code": "internal", "message": "Внутренняя ошибка сервера.",
                                       "hint": "Попробуйте ещё раз через минуту."}}, status_code=500)
    return pages.error_page(request)


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse(STATIC_DIR / "favicon.ico", headers={"Cache-Control": "public, max-age=604800"})
