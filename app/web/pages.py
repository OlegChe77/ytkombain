"""HTML-страницы, sitemap.xml, robots.txt и манифест."""
from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timezone
from xml.sax.saxutils import escape

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from fastapi.templating import Jinja2Templates

from app.config import BASE_DIR, settings
from app.core.assets import css_bundle, css_url, static_url
from app.core.security import THEME_BOOT_SCRIPT
from app.seo import meta as seo
from app.seo.catalog import (CATEGORIES, CATEGORY_MAP, GENERAL_FAQ, TOOL_MAP, TOOLS, UPDATED, Tool,
                             related_tools, tools_in)

router = APIRouter()
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
templates.env.globals.update(
    static=static_url,
    css_url=css_url,
    settings=settings,
    categories=CATEGORIES,
    category_map=CATEGORY_MAP,
    tools=TOOLS,
    tool_map=TOOL_MAP,
    tools_in=tools_in,
    theme_boot=THEME_BOOT_SCRIPT,
    year=date.today().year,
)

HTML_CACHE = {"Cache-Control": "no-cache"}


def render(request: Request, template: str, page: seo.PageMeta, status: int = 200, **context) -> Response:
    response = templates.TemplateResponse(request, template, {"meta": page, **context}, status_code=status)
    if status == 200:
        # ETag по содержимому: повторный визит и робот получают 304 без тела.
        etag = '"' + hashlib.sha256(response.body).hexdigest()[:20] + '"'
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers={**HTML_CACHE, "ETag": etag})
        response.headers.update(HTML_CACHE)
        response.headers["ETag"] = etag
    return response


@router.get("/", response_class=HTMLResponse)
async def home(request: Request):
    page = seo.PageMeta(
        title="YouTube Комбайн — бесплатные инструменты для YouTube в одном месте",
        description="Скачать видео и звук, получить субтитры, провести розыгрыш в комментариях, забрать превью "
                    "и выгрузить плейлист. Вставьте ссылку — Комбайн подскажет, что с ней можно сделать.",
        path="/",
        brand_suffix=False,
        jsonld=[seo.organization_ld(), seo.website_ld(), seo.item_list_ld(list(TOOLS))],
    )
    return render(request, "pages/home.html", page, faq=GENERAL_FAQ[:5])


@router.get("/tools", response_class=HTMLResponse)
async def all_tools(request: Request):
    crumbs = [("Главная", "/"), ("Все инструменты", "/tools")]
    page = seo.PageMeta(
        title="Все инструменты для YouTube: видео, комментарии, ссылки, плейлисты",
        description=f"{len(TOOLS)} бесплатных инструментов для работы с YouTube: скачивание, субтитры, розыгрыши, "
                    "превью, таймкоды, встраивание и выгрузка плейлистов. Поиск по названию и задаче.",
        path="/tools",
        breadcrumbs=crumbs,
        jsonld=[seo.breadcrumb_ld(crumbs), seo.item_list_ld(list(TOOLS))],
    )
    return render(request, "pages/tools.html", page)


@router.get("/category/{slug}", response_class=HTMLResponse)
async def category(request: Request, slug: str):
    cat = CATEGORY_MAP.get(slug)
    if not cat:
        return not_found_page(request)
    items = tools_in(slug)
    return render(request, "pages/category.html", seo.category_meta(cat, items), category=cat, items=items)


@router.get("/faq", response_class=HTMLResponse)
async def faq(request: Request):
    crumbs = [("Главная", "/"), ("Вопросы и ответы", "/faq")]
    page = seo.PageMeta(
        title="Вопросы и ответы о YouTube Комбайне — FAQ",
        brand_suffix=False,
        description="Как работает Комбайн, что он хранит, какие ссылки понимает и почему некоторые видео нельзя обработать. "
                    "Ответы на частые вопросы по каждому инструменту.",
        path="/faq",
        breadcrumbs=crumbs,
        jsonld=[seo.breadcrumb_ld(crumbs), seo.faq_ld(GENERAL_FAQ)],
    )
    return render(request, "pages/faq.html", page, faq=GENERAL_FAQ)


@router.get("/privacy", response_class=HTMLResponse)
async def privacy(request: Request):
    crumbs = [("Главная", "/"), ("Конфиденциальность и правила", "/privacy")]
    page = seo.PageMeta(
        title="Конфиденциальность и правила использования",
        description="Какие данные обрабатывает YouTube Комбайн, как долго хранятся временные файлы и что важно знать о правах на контент.",
        path="/privacy",
        breadcrumbs=crumbs,
        jsonld=[seo.breadcrumb_ld(crumbs)],
    )
    return render(request, "pages/privacy.html", page)


def _tool_view(tool: Tool):
    async def view(request: Request):
        category_obj = CATEGORY_MAP[tool.category]
        return render(request, f"tools/{tool.template}.html", seo.tool_meta(tool),
                      tool=tool, category=category_obj, related=related_tools(tool))
    view.__name__ = f"tool_{tool.slug.replace('-', '_')}"
    return view


for _tool in TOOLS:
    router.add_api_route(_tool.path, _tool_view(_tool), methods=["GET"], response_class=HTMLResponse)


def not_found_page(request: Request) -> HTMLResponse:
    page = seo.PageMeta(title="Страница не найдена", description="Такой страницы нет.", path=request.url.path,
                        noindex=True)
    return render(request, "pages/error.html", page, status=404, code=404,
                  heading="Такой страницы нет",
                  text="Возможно, ссылка устарела или в адресе опечатка. Все инструменты — на главной и в каталоге.")


def error_page(request: Request, status: int = 500) -> HTMLResponse:
    page = seo.PageMeta(title="Ошибка сервера", description="Внутренняя ошибка.", path=request.url.path, noindex=True)
    return render(request, "pages/error.html", page, status=status, code=status,
                  heading="Что-то сломалось на нашей стороне",
                  text="Мы уже знаем об ошибке из журнала сервера. Обновите страницу через минуту.")


@router.get("/assets/app.{digest}.css")
async def css(digest: str):
    current, body = css_bundle()
    # Страница из старого кэша может запросить прошлую версию — отдаём актуальную, но без долгого кэширования.
    cache = "public, max-age=31536000, immutable" if digest == current else "no-cache"
    return Response(body, media_type="text/css", headers={"Cache-Control": cache})


@router.get("/robots.txt", response_class=PlainTextResponse)
async def robots():
    body = "\n".join([
        "User-agent: *",
        "Allow: /",
        "Disallow: /api/",
        "",
        "User-agent: Yandex",
        "Allow: /",
        "Disallow: /api/",
        "Clean-param: url&source&t /",
        "Clean-param: utm_source&utm_medium&utm_campaign&utm_content&utm_term&yclid&from /",
        "",
        f"Sitemap: {settings.site_url}/sitemap.xml",
        "",
    ])
    return PlainTextResponse(body, headers={"Cache-Control": "public, max-age=86400"})


def _lastmod(*names: str) -> str:
    """Дата последнего изменения страницы: её шаблоны, базовый шаблон и каталог с текстами."""
    files = [BASE_DIR / "seo" / "catalog.py", BASE_DIR / "templates" / "base.html"]
    files += [BASE_DIR / "templates" / name for name in names]
    stamp = max((f.stat().st_mtime for f in files if f.exists()), default=0)
    return datetime.fromtimestamp(stamp, tz=timezone.utc).date().isoformat() if stamp else UPDATED


@router.get("/sitemap.xml")
async def sitemap():
    urls = [("/", "1.0", _lastmod("pages/home.html")), ("/tools", "0.8", _lastmod("pages/tools.html"))]
    urls += [(f"/category/{c.slug}", "0.7", _lastmod("pages/category.html")) for c in CATEGORIES]
    urls += [(t.path, "0.9", _lastmod("tools/_layout.html", f"tools/{t.template}.html")) for t in TOOLS]
    urls += [("/faq", "0.5", _lastmod("pages/faq.html")), ("/privacy", "0.3", _lastmod("pages/privacy.html"))]
    items = "".join(
        f"<url><loc>{escape(seo.absolute(path))}</loc><lastmod>{mod}</lastmod><priority>{prio}</priority></url>"
        for path, prio, mod in urls
    )
    xml = f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{items}</urlset>'
    return Response(xml, media_type="application/xml", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/manifest.webmanifest")
async def manifest():
    data = {
        "name": settings.site_name,
        "short_name": "Комбайн",
        "description": "Бесплатные инструменты для YouTube в одном месте",
        "lang": "ru",
        "start_url": "/?source=pwa",
        "scope": "/",
        "display": "standalone",
        "background_color": "#1b1c21",
        "theme_color": "#1b1c21",
        "icons": [
            {"src": "/static/img/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/static/img/icon-512.png", "sizes": "512x512", "type": "image/png"},
            {"src": "/static/img/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }
    return Response(json.dumps(data, ensure_ascii=False), media_type="application/manifest+json",
                    headers={"Cache-Control": "public, max-age=86400"})
