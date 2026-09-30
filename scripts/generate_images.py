"""Генерирует иконки (favicon, PWA) и Open Graph-картинки для каждой страницы.

Запуск (нужен Pillow из requirements-dev.txt):
    python scripts/generate_images.py
Картинки уже лежат в app/static/img — перезапускать нужно только после изменения каталога.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.seo.catalog import CATEGORIES, TOOLS  # noqa: E402

IMG = ROOT / "app" / "static" / "img"
OG = IMG / "og"

BG = (27, 28, 33)
WELL = (21, 22, 25)
PANEL = (36, 37, 44)
LINE = (52, 54, 63)
TEXT = (238, 238, 240)
MUTED = (133, 137, 149)
COLORS = {
    "video": (116, 130, 255),
    "comments": (228, 111, 213),
    "images": (241, 200, 75),
    "links": (67, 201, 227),
    "playlists": (79, 207, 135),
}
ORDER = ["video", "comments", "images", "links", "playlists"]

FONT_CANDIDATES = {
    "bold": ["C:/Windows/Fonts/segoeuib.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/Library/Fonts/Arial Bold.ttf"],
    "regular": ["C:/Windows/Fonts/segoeui.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/Library/Fonts/Arial.ttf"],
}


def font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES[kind]:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    raise SystemExit("Не найден шрифт с кириллицей — укажите путь в FONT_CANDIDATES")


def draw_mark(draw: ImageDraw.ImageDraw, x: float, y: float, size: float) -> None:
    """Логотип: пять полос настроечной таблицы, вместе образующих кнопку «play»."""
    unit = size / 32
    bars = [(4, 5, 22), (9.3, 7.2, 17.6), (14.6, 9.4, 13.2), (19.9, 11.6, 8.8), (25.2, 13.8, 4.4)]
    for (bx, by, bh), key in zip(bars, ORDER):
        draw.rounded_rectangle(
            [x + bx * unit, y + by * unit, x + (bx + 3.6) * unit, y + (by + bh) * unit],
            radius=1.2 * unit, fill=COLORS[key],
        )


def app_icon(size: int, padding: float = 0.0, radius: float = 0.22) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius), fill=BG)
    inner = size * (1 - padding * 2)
    draw_mark(draw, size * padding, size * padding, inner)
    return img


def wrap(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont, width: int) -> list[str]:
    lines, current = [], ""
    for word in text.split():
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=fnt) <= width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def og_image(title: str, subtitle: str, accent: str | None, path: Path) -> None:
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), BG)
    draw = ImageDraw.Draw(img)

    # Правая часть — «монтажный стол» с дорожками категорий.
    tx, ty, tw = 700, 120, 440
    draw.rounded_rectangle([tx - 24, ty - 44, tx + tw + 24, ty + 5 * 62 + 20], radius=26, fill=WELL, outline=LINE, width=2)
    for i in range(0, 7):
        gx = tx + i * tw / 6
        draw.line([gx, ty - 20, gx, ty - 10], fill=LINE, width=2)
    lanes = [[0.0, 0.34, 0.62, 0.9], [0.08, 0.4, 0.66, 1.0], [0.04, 0.56, 1.0], [0.18, 0.46, 0.74, 1.0], [0.1, 1.0]]
    for row, key in enumerate(ORDER):
        y0 = ty + row * 62
        color = COLORS[key]
        dim = accent is not None and key != accent
        stops = lanes[row]
        for a, b in zip(stops, stops[1:]):
            x0, x1 = tx + a * tw + 3, tx + b * tw - 3
            fill = tuple(int(c * 0.28 + BG[i] * 0.72) for i, c in enumerate(color)) if dim else tuple(int(c * 0.45 + PANEL[i] * 0.55) for i, c in enumerate(color))
            draw.rounded_rectangle([x0, y0, x1, y0 + 46], radius=8, fill=fill)
            draw.rectangle([x0, y0, x0 + 5, y0 + 46], fill=tuple(int(c * (0.45 if dim else 1)) for c in color))
    head_x = tx + tw * 0.64
    draw.line([head_x, ty - 22, head_x, ty + 5 * 62 - 8], fill=COLORS["images"], width=4)
    draw.polygon([(head_x - 10, ty - 30), (head_x + 10, ty - 30), (head_x + 10, ty - 20), (head_x, ty - 10), (head_x - 10, ty - 20)], fill=COLORS["images"])

    # Левая часть — текст.
    draw_mark(draw, 64, 60, 64)
    draw.text((140, 70), "YouTube Комбайн", font=font("bold", 34), fill=TEXT)
    title_font = font("bold", 62 if len(title) < 28 else 52)
    y = 190
    for line in wrap(draw, title, title_font, 580)[:3]:
        draw.text((64, y), line, font=title_font, fill=TEXT)
        y += int(title_font.size * 1.12)
    sub_font = font("regular", 30)
    y += 18
    for line in wrap(draw, subtitle, sub_font, 580)[:3]:
        draw.text((64, y), line, font=sub_font, fill=MUTED)
        y += 40

    seg = w / 5
    for i, key in enumerate(ORDER):
        draw.rectangle([i * seg, h - 10, (i + 1) * seg, h], fill=COLORS[key])
    img.save(path, optimize=True)


def main() -> None:
    OG.mkdir(parents=True, exist_ok=True)
    app_icon(512).save(IMG / "icon-512.png", optimize=True)
    app_icon(192).save(IMG / "icon-192.png", optimize=True)
    maskable = Image.new("RGBA", (512, 512), BG + (255,))
    draw_mark(ImageDraw.Draw(maskable), 512 * 0.22, 512 * 0.22, 512 * 0.56)
    maskable.save(IMG / "icon-maskable-512.png", optimize=True)
    apple = Image.new("RGB", (180, 180), BG)
    draw_mark(ImageDraw.Draw(apple), 180 * 0.12, 180 * 0.12, 180 * 0.76)
    apple.save(IMG / "apple-touch-icon.png", optimize=True)
    app_icon(256).save(ROOT / "app" / "static" / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    og_image("Все инструменты для YouTube в одном месте",
             "Скачать видео и звук, субтитры, розыгрыши, превью и плейлисты — бесплатно", None, OG / "default.png")
    for cat in CATEGORIES:
        og_image(cat.name, cat.description, cat.slug, OG / f"category-{cat.slug}.png")
    for tool in TOOLS:
        og_image(tool.h1, tool.blurb, tool.category, OG / f"{tool.slug}.png")
    print(f"Готово: {len(TOOLS) + len(CATEGORIES) + 1} OG-картинок и иконки")


if __name__ == "__main__":
    main()
