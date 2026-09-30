"""Скриншоты для README: docs/screenshots/*.png (или .jpg, если PNG слишком тяжёлый).

Нужен запущенный сайт и Playwright (браузеры не скачиваются — используется системный Microsoft Edge):

    .venv\\Scripts\\pip install -r requirements-dev.txt
    .venv\\Scripts\\python scripts/screenshots.py                  # все кадры
    .venv\\Scripts\\python scripts/screenshots.py downloader home-dark   # только выбранные

Переменные окружения:
    BASE_URL        адрес сайта, по умолчанию http://localhost:8000
    BROWSER_CHANNEL канал браузера Playwright, по умолчанию msedge (можно chrome)
    HEADLESS        0 — показать окно браузера при отладке

Данные берутся с живого YouTube, поэтому кадры с комментариями и редактором
зависят от скорости сети и доступности YouTube с вашего IP.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable

from PIL import Image
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page, sync_playwright
from playwright.sync_api import TimeoutError as PlaywrightTimeout

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "screenshots"

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000").rstrip("/")
CHANNEL = os.environ.get("BROWSER_CHANNEL", "msedge")
HEADLESS = os.environ.get("HEADLESS", "1") != "0"

MAX_PNG_BYTES = 700 * 1024
JPEG_QUALITY = 85

VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
VIDEO_SHORT = "https://youtu.be/dQw4w9WgXcQ"
VIDEO_COMMENTS = "https://www.youtube.com/watch?v=jNQXAC9IVRw"  # «Me at the zoo»: короткое, много комментариев

DESKTOP = {"viewport": {"width": 1440, "height": 900}, "device_scale_factor": 1}
MOBILE = {
    "viewport": {"width": 390, "height": 844},
    "device_scale_factor": 2,
    "is_mobile": True,
    "has_touch": True,
}


class ShotError(RuntimeError):
    """Понятная ошибка съёмки конкретного кадра."""


# ---------------------------------------------------------------- helpers


def url(path: str, video: str | None = None) -> str:
    if video is None:
        return BASE_URL + path
    return f"{BASE_URL}{path}?{urllib.parse.urlencode({'url': video})}"


def wait_for(page: Page, selector: str, timeout_s: float, what: str) -> None:
    try:
        page.wait_for_selector(selector, state="visible", timeout=timeout_s * 1000)
    except PlaywrightTimeout:
        hint = read_error(page)
        raise ShotError(f"за {timeout_s:.0f} с не дождались {what} ({selector})" + (f"; на странице: {hint}" if hint else "")) from None


def read_error(page: Page) -> str:
    """Текст ошибки, которую показал сайт (если есть), — чтобы было понятно, почему не дождались."""
    try:
        text = page.evaluate(
            """() => {
                const el = [...document.querySelectorAll('.result, .field-hint, .error, [role=alert]')]
                  .find(e => !e.hidden && e.offsetParent !== null && e.textContent.trim());
                return el ? el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 200) : '';
            }"""
        )
        return text or ""
    except PlaywrightError:
        return ""


def settle(page: Page, seconds: float = 0.6) -> None:
    """Даём дорисоваться анимациям и шрифтам."""
    try:
        page.evaluate("document.fonts ? document.fonts.ready.then(() => true) : true")
    except PlaywrightError:
        pass
    time.sleep(seconds)


def wait_video_frame(page: Page, timeout_s: float = 20) -> None:
    """Ждём первый кадр превью редактора; без него кадр всё равно снимаем."""
    try:
        page.wait_for_function(
            "() => { const v = document.querySelector('#frame-video'); return v && v.readyState >= 2; }",
            timeout=timeout_s * 1000,
        )
    except PlaywrightTimeout:
        print("    ! превью видео не успело загрузиться, снимаю как есть")


def anonymize_comments(page: Page) -> None:
    """Скрывает реальных комментаторов для публичных скриншотов: ники → «@участник_N», аватары → буква-заглушка.

    Тексты комментариев остаются как есть.
    """
    page.evaluate(
        """() => {
            document.querySelectorAll('.comment-author').forEach((el, i) => {
                el.textContent = `@участник_${i + 1}`;
                el.removeAttribute('href');
            });
            document.querySelectorAll('.reel-item span:not(.comment-avatar)').forEach((el, i) => {
                el.textContent = `@участник_${i + 1}`;
            });
            document.querySelectorAll('.comment-avatar img, .reel-item img').forEach((img) => {
                const box = img.closest('.comment-avatar');
                img.remove();
                if (box && !box.textContent.trim()) box.textContent = 'У';
            });
        }"""
    )


def clip_from(page: Page, selector: str, height: int, pad_top: int = 16) -> dict:
    """Область страницы от верха элемента на заданную высоту (в координатах документа)."""
    box = page.evaluate(
        """(sel) => {
            const r = document.querySelector(sel).getBoundingClientRect();
            return { y: r.top + window.scrollY, docH: document.documentElement.scrollHeight,
                     w: document.documentElement.clientWidth };
        }""",
        selector,
    )
    y = max(0, box["y"] - pad_top)
    return {"x": 0, "y": y, "width": box["w"], "height": min(height, box["docH"] - y)}


# ---------------------------------------------------------------- shots


def shot_home_dark(page: Page) -> Callable:
    page.goto(url("/", VIDEO), wait_until="networkidle")
    time.sleep(3)  # распознавание ссылки и подсветка подходящих инструментов
    return lambda path: page.screenshot(path=path)


def shot_home_light(page: Page) -> Callable:
    page.goto(url("/"), wait_until="networkidle")
    settle(page)
    return lambda path: page.screenshot(path=path)


def shot_downloader(page: Page) -> Callable:
    page.goto(url("/youtube-downloader", VIDEO_SHORT), wait_until="domcontentloaded")
    wait_for(page, ".format-row", 90, "списка форматов")
    settle(page, 1)
    clip = clip_from(page, ".tool", 900, pad_top=0)
    return lambda path: page.screenshot(path=path, clip=clip, full_page=True)


def shot_comment_picker(page: Page) -> Callable:
    page.goto(url("/youtube-comment-picker", VIDEO_COMMENTS), wait_until="domcontentloaded")
    page.select_option("#cm-form select[name=limit]", "200")
    page.click("#cm-form button[type=submit]")
    wait_for(page, "#picker", 120, "загрузки комментариев")
    page.fill("#winners", "3")
    page.click("#draw")
    wait_for(page, ".winner", 30, "победителей")
    time.sleep(4)  # барабан докручивается, появляются все победители
    anonymize_comments(page)
    page.locator(".picker").scroll_into_view_if_needed()
    settle(page)
    return lambda path: page.locator(".picker").screenshot(path=path)


def open_editor(page: Page) -> None:
    page.goto(url("/youtube-shorts-maker", VIDEO_COMMENTS), wait_until="domcontentloaded")
    page.click("#ed-form button[type=submit]")
    wait_for(page, "#editor", 90, "открытия редактора (сервер скачивает исходник)")
    wait_video_frame(page)
    page.click("#t-text")
    page.locator(".preset").first.click()
    page.locator(".emoji-btn").first.click()
    page.click("#t-frame")
    page.click('[data-fit="contain"]')
    # На 0:00 титры ещё в анимации появления (прозрачные) — переходим на 3-ю секунду клипа.
    page.evaluate(
        """() => new Promise((resolve) => {
            const v = document.querySelector('#frame-video');
            v.addEventListener('seeked', () => resolve(true), { once: true });
            v.currentTime = 3;
            setTimeout(() => resolve(false), 5000);
        })"""
    )
    page.locator("#editor").scroll_into_view_if_needed()
    settle(page, 1.5)


def shot_shorts_editor(page: Page) -> Callable:
    open_editor(page)
    return lambda path: page.locator("#editor").screenshot(path=path)


def shot_video_info(page: Page) -> Callable:
    page.goto(url("/youtube-video-info", VIDEO), wait_until="domcontentloaded")
    wait_for(page, ".facts", 90, "данных о видео")
    settle(page, 1.5)  # подгружаются превью и графики
    clip = clip_from(page, ".tool", 900, pad_top=0)
    return lambda path: page.screenshot(path=path, clip=clip, full_page=True)


def shot_mobile_home(page: Page) -> Callable:
    page.goto(url("/", VIDEO), wait_until="networkidle")
    time.sleep(3)
    return lambda path: page.screenshot(path=path)


def shot_mobile_editor(page: Page) -> Callable:
    open_editor(page)
    page.evaluate("document.querySelector('#editor').scrollIntoView({block: 'start'})")
    settle(page)
    return lambda path: page.screenshot(path=path)


# имя файла → (функция, параметры контекста, тема)
SHOTS: dict[str, tuple[Callable[[Page], Callable], dict, str]] = {
    "home-dark": (shot_home_dark, DESKTOP, "dark"),
    "home-light": (shot_home_light, DESKTOP, "light"),
    "downloader": (shot_downloader, DESKTOP, "dark"),
    "comment-picker": (shot_comment_picker, DESKTOP, "dark"),
    "shorts-editor": (shot_shorts_editor, DESKTOP, "dark"),
    "video-info": (shot_video_info, DESKTOP, "light"),
    "mobile-home": (shot_mobile_home, MOBILE, "light"),
    "mobile-editor": (shot_mobile_editor, MOBILE, "dark"),
}


# ---------------------------------------------------------------- output


def save(name: str, take: Callable[[str], object]) -> Path:
    """Снимает PNG; если он тяжелее MAX_PNG_BYTES — пережимает в JPG. Старый файл другого формата удаляется."""
    png, jpg = OUT / f"{name}.png", OUT / f"{name}.jpg"
    take(str(png))
    with Image.open(png) as im:
        im.load()
        im.save(png, optimize=True)  # без потерь, просто плотнее
    if png.stat().st_size <= MAX_PNG_BYTES:
        jpg.unlink(missing_ok=True)
        return png
    with Image.open(png) as im:
        im.convert("RGB").save(jpg, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
    png.unlink()
    return jpg


def check_server() -> None:
    try:
        with urllib.request.urlopen(BASE_URL + "/api/health", timeout=10) as resp:
            health = json.load(resp)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        sys.exit(f"Сайт {BASE_URL} недоступен ({exc}). Запустите uvicorn или задайте BASE_URL.")
    missing = [k for k in ("ffmpeg", "js_runtime") if not health.get(k)]
    if missing:
        print(f"! /api/health: нет {', '.join(missing)} — часть кадров может не получиться")


def main(argv: list[str]) -> int:
    names = argv or list(SHOTS)
    unknown = [n for n in names if n not in SHOTS]
    if unknown:
        sys.exit(f"Неизвестные кадры: {', '.join(unknown)}. Доступны: {', '.join(SHOTS)}")

    check_server()
    OUT.mkdir(parents=True, exist_ok=True)
    failed: list[str] = []

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel=CHANNEL, headless=HEADLESS)
        except PlaywrightError as exc:
            sys.exit(f"Не удалось запустить браузер «{CHANNEL}»: {exc.message.splitlines()[0]}. "
                     "Установите Microsoft Edge или задайте BROWSER_CHANNEL=chrome.")
        for name in names:
            func, device, theme = SHOTS[name]
            context = browser.new_context(**device, color_scheme=theme, locale="ru-RU")
            context.add_init_script(f"try {{ localStorage.setItem('kombain-theme', '{theme}'); }} catch (e) {{}}")
            page = context.new_page()
            page.set_default_timeout(30_000)
            started = time.monotonic()
            print(f"- {name} ...", flush=True)
            try:
                path = save(name, func(page))
                w, h = Image.open(path).size
                print(f"    ok: {path.relative_to(ROOT)} {w}x{h}, {path.stat().st_size // 1024} КБ, "
                      f"{time.monotonic() - started:.0f} с")
            except (ShotError, PlaywrightError) as exc:
                message = exc.message.splitlines()[0] if isinstance(exc, PlaywrightError) else str(exc)
                print(f"    ОШИБКА {name}: {message}")
                failed.append(name)
            finally:
                context.close()
        browser.close()

    if failed:
        print(f"Не получилось: {', '.join(failed)}. Повторите: python scripts/screenshots.py {' '.join(failed)}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
