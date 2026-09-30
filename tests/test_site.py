import json
import re

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.seo.catalog import CATEGORIES, TOOLS

PAGES = ["/", "/tools", "/faq", "/privacy"] + [f"/category/{c.slug}" for c in CATEGORIES] + [t.path for t in TOOLS]


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.mark.parametrize("path", PAGES)
def test_page_seo(client, path):
    r = client.get(path)
    assert r.status_code == 200
    html = r.text
    assert len(re.findall(r"<h1[\s>]", html)) == 1
    title = re.search(r"<title>(.*?)</title>", html, re.S).group(1)
    assert 20 <= len(title) <= 100
    description = re.search(r'<meta name="description" content="([^"]+)"', html).group(1)
    assert 70 <= len(description) <= 250
    assert f'<link rel="canonical" href="{settings.site_url}{path}"' in html
    assert 'property="og:image"' in html and 'name="twitter:card"' in html
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        assert json.loads(block)["@context"] == "https://schema.org"
    assert "content-security-policy" in r.headers


def test_titles_and_descriptions_are_unique(client):
    titles, descriptions = set(), set()
    for path in PAGES:
        html = client.get(path).text
        titles.add(re.search(r"<title>(.*?)</title>", html, re.S).group(1))
        descriptions.add(re.search(r'<meta name="description" content="([^"]+)"', html).group(1))
    assert len(titles) == len(PAGES)
    assert len(descriptions) == len(PAGES)


def test_internal_links_resolve(client):
    seen, broken = set(), []
    for path in PAGES:
        for href in re.findall(r'href="(/[^"#?]*)', client.get(path).text):
            if href in seen or href.startswith("/api/"):
                continue
            seen.add(href)
            if client.get(href).status_code != 200:
                broken.append(href)
    assert not broken


def test_not_found(client):
    r = client.get("/no-such-page")
    assert r.status_code == 404
    assert "noindex" in r.text


def test_sitemap_and_robots(client):
    sitemap = client.get("/sitemap.xml").text
    for path in PAGES:
        assert f"<loc>{settings.site_url}{path}</loc>" in sitemap
    assert "Disallow: /api/" in client.get("/robots.txt").text
    manifest = client.get("/manifest.webmanifest").json()
    assert manifest["icons"]


def test_api_validation(client):
    r = client.post("/api/video/info", json={"url": "https://evil.com/watch?v=jNQXAC9IVRw"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "not_youtube"
    r = client.post("/api/download", json={"url": "https://youtu.be/jNQXAC9IVRw", "option": "best; rm -rf /"})
    assert r.status_code == 422
    r = client.post("/api/transcript", json={"url": "https://youtu.be/jNQXAC9IVRw", "track": "../../etc"})
    assert r.status_code == 422
    r = client.get("/api/image", params={"src": "http://169.254.169.254/latest/meta-data"})
    assert r.status_code == 403
    r = client.get("/api/thumbnail/jNQXAC9IVRw/../../secret")
    assert r.status_code == 404
    r = client.get("/api/jobs/" + "a" * 32)
    assert r.status_code == 404
    r = client.get("/api/download/" + "b" * 32 + "/file")
    assert r.status_code == 404


def test_catalog_api(client):
    data = client.get("/api/catalog").json()
    assert len(data["tools"]) == len(TOOLS)
    assert all(t["url"].startswith("/youtube-") for t in data["tools"])
