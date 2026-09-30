"""Статика: CSS собирается в один файл с хешем в имени, остальным файлам добавляется ?v=хеш.

Хеши зависят от времени изменения файлов, поэтому правки видны сразу, без перезапуска сервера.
"""
from __future__ import annotations

import hashlib
import re
from functools import lru_cache
from pathlib import Path

from app.config import BASE_DIR

STATIC_DIR = BASE_DIR / "static"
CSS_DIR = STATIC_DIR / "css"


def _minify_css(css: str) -> str:
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"\s+", " ", css)
    css = re.sub(r"\s*([{};,>])\s*", r"\1", css)
    css = re.sub(r";}", "}", css)
    return css.strip()


@lru_cache(maxsize=4)
def _build_css(signature: tuple) -> tuple[str, str]:
    parts = [Path(path).read_text(encoding="utf-8") for path, _ in signature]
    css = _minify_css("\n".join(parts))
    return hashlib.sha256(css.encode()).hexdigest()[:12], css


def css_bundle() -> tuple[str, str]:
    """(hash, css). Файлы склеиваются в порядке имён: 01-tokens.css, 02-base.css…"""
    signature = tuple((str(p), p.stat().st_mtime_ns) for p in sorted(CSS_DIR.glob("*.css")))
    return _build_css(signature)


def css_url() -> str:
    return f"/assets/app.{css_bundle()[0]}.css"


@lru_cache(maxsize=512)
def _hash_file(path: str, mtime: int) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()[:10]


def static_url(path: str) -> str:
    path = path.lstrip("/")
    file = STATIC_DIR / path
    try:
        version = _hash_file(str(file), file.stat().st_mtime_ns)
    except OSError:
        version = "0"
    return f"/static/{path}?v={version}"
