"""Мета-теги, хлебные крошки и структурированные данные (JSON-LD) для страниц."""
from __future__ import annotations

from dataclasses import dataclass, field

from app.config import settings
from app.seo.catalog import CATEGORY_MAP, Category, Tool

BRAND = settings.site_name


def absolute(path: str) -> str:
    return settings.site_url + path


@dataclass
class PageMeta:
    title: str
    description: str
    path: str
    og_image: str = "/static/img/og/default.png"
    og_type: str = "website"
    breadcrumbs: list[tuple[str, str]] = field(default_factory=list)
    jsonld: list[dict] = field(default_factory=list)
    noindex: bool = False
    brand_suffix: bool = True

    @property
    def full_title(self) -> str:
        # Бренд добавляем, только если заголовок не вылезет за ~65 символов, которые показывает выдача.
        suffixed = f"{self.title} | {BRAND}"
        return suffixed if self.brand_suffix and len(suffixed) <= 65 else self.title

    @property
    def canonical(self) -> str:
        return absolute(self.path)

    @property
    def og_image_url(self) -> str:
        return absolute(self.og_image)


def breadcrumb_ld(crumbs: list[tuple[str, str]]) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i, "name": name, "item": absolute(path)}
            for i, (name, path) in enumerate(crumbs, 1)
        ],
    }


def faq_ld(faq: tuple[tuple[str, str], ...]) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq
        ],
    }


ORG_ID = "/#org"


def organization_ld() -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "Organization",
        "@id": absolute(ORG_ID),
        "name": BRAND,
        "url": absolute("/"),
        "logo": absolute("/static/img/icon-512.png"),
    }


def website_ld() -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": BRAND,
        "alternateName": "Комбайн",
        "url": absolute("/"),
        "inLanguage": "ru",
        "publisher": {"@id": absolute(ORG_ID)},
        "description": "Бесплатные инструменты для YouTube: скачивание видео и звука, субтитры, розыгрыши в комментариях, превью, плейлисты.",
    }


def tool_ld(tool: Tool) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        "name": tool.h1,
        "url": absolute(tool.path),
        "description": tool.description,
        "applicationCategory": "MultimediaApplication" if tool.category == "video" else "UtilitiesApplication",
        "image": absolute(f"/static/img/og/{tool.slug}.png"),
        "publisher": {"@id": absolute(ORG_ID)},
        "operatingSystem": "Any",
        "browserRequirements": "Требуется JavaScript",
        "inLanguage": "ru",
        "isAccessibleForFree": True,
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "RUB"},
        "isPartOf": {"@type": "WebSite", "name": BRAND, "url": absolute("/")},
    }


def item_list_ld(tools: list[Tool]) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "itemListElement": [
            {"@type": "ListItem", "position": i, "name": t.h1, "url": absolute(t.path)} for i, t in enumerate(tools, 1)
        ],
    }


def tool_meta(tool: Tool) -> PageMeta:
    category = CATEGORY_MAP[tool.category]
    crumbs = [("Главная", "/"), (category.name, f"/category/{category.slug}"), (tool.name, tool.path)]
    return PageMeta(
        title=tool.title,
        description=tool.description,
        path=tool.path,
        og_image=f"/static/img/og/{tool.slug}.png",
        breadcrumbs=crumbs,
        jsonld=[tool_ld(tool), breadcrumb_ld(crumbs), faq_ld(tool.faq)],
    )


def category_meta(category: Category, tools: list[Tool]) -> PageMeta:
    crumbs = [("Главная", "/"), (category.name, f"/category/{category.slug}")]
    return PageMeta(
        title=category.title,
        description=category.description,
        path=f"/category/{category.slug}",
        og_image=f"/static/img/og/category-{category.slug}.png",
        breadcrumbs=crumbs,
        jsonld=[breadcrumb_ld(crumbs), item_list_ld(tools)] + ([faq_ld(category.faq)] if getattr(category, "faq", None) else []),
    )
