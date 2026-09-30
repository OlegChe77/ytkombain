"""Получение субтитров: скачиваем дорожку в формате json3 и превращаем в список фраз."""
from __future__ import annotations

import json
import re

from app.core.cache import TTLCache
from app.core.errors import AppError
from app.youtube import ytdlp
from app.youtube.urls import YouTubeRef
from app.youtube.video import get_video

_cache = TTLCache(maxsize=200, ttl=1800)
MAX_TRACK_BYTES = 8 * 1024 * 1024
_SPACES = re.compile(r"[ \t ]+")


def _pick_url(entries: list[dict]) -> tuple[str, str]:
    by_ext = {e.get("ext"): e.get("url") for e in entries if e.get("url")}
    for ext in ("json3", "vtt"):
        if by_ext.get(ext):
            return ext, by_ext[ext]
    raise AppError("Для этой дорожки нет подходящего формата субтитров.", status=404, code="no_format")


def _parse_json3(data: bytes) -> list[dict]:
    payload = json.loads(data.decode("utf-8"))
    segments = []
    for event in payload.get("events") or []:
        segs = event.get("segs")
        if not segs:
            continue
        text = "".join(s.get("utf8", "") for s in segs)
        text = _SPACES.sub(" ", text.replace("\n", " ")).strip()
        if not text:
            continue
        start = (event.get("tStartMs") or 0) / 1000
        dur = (event.get("dDurationMs") or 0) / 1000
        segments.append({"start": round(start, 3), "end": round(start + dur, 3), "text": text})
    # У автоматических субтитров фразы перекрываются: обрезаем конец по началу следующей.
    for current, nxt in zip(segments, segments[1:]):
        if current["end"] > nxt["start"]:
            current["end"] = nxt["start"]
    return segments


_VTT_TIME = re.compile(r"(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})")
_TAGS = re.compile(r"<[^>]+>")


def _parse_vtt(data: bytes) -> list[dict]:
    def secs(h, m, s, ms):
        return int(h or 0) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000

    segments, current = [], None
    for line in data.decode("utf-8", "replace").splitlines():
        match = _VTT_TIME.search(line)
        if match:
            g = match.groups()
            current = {"start": secs(*g[:4]), "end": secs(*g[4:]), "text": ""}
            segments.append(current)
        elif current is not None and line.strip():
            text = _TAGS.sub("", line).strip()
            current["text"] = f"{current['text']} {text}".strip()
        else:
            current = None
    result, last = [], None
    for seg in segments:
        if seg["text"] and seg["text"] != last:
            result.append(seg)
            last = seg["text"]
    return result


def get_transcript(ref: YouTubeRef, key: str) -> dict:
    cache_key = (ref.video_id, key)
    cached = _cache.get(cache_key)
    if cached:
        return cached
    info, private = get_video(ref)
    track = next((t for t in info["captions"] if t["key"] == key), None)
    if not track:
        raise AppError("У видео нет такой дорожки субтитров.", status=404, code="no_track")
    kind, _, lang = key.partition(":")
    source = private["raw_captions"]["manual" if kind == "manual" else "auto"]
    ext, url = _pick_url(source.get(lang) or [])
    if not ytdlp.info_slots.acquire(timeout=30):
        raise AppError("Сервер сейчас загружен.", status=503, code="overloaded", hint="Попробуйте через минуту.")
    try:
        with ytdlp.ydl() as y:
            response = y.urlopen(url)
            data = response.read(MAX_TRACK_BYTES + 1)
    finally:
        ytdlp.info_slots.release()
    if len(data) > MAX_TRACK_BYTES:
        raise AppError("Субтитры слишком большие для обработки.", status=413, code="too_large")
    segments = _parse_json3(data) if ext == "json3" else _parse_vtt(data)
    if not segments:
        raise AppError("Дорожка субтитров пустая.", status=404, code="empty_track")
    result = {
        "video": {"id": info["id"], "title": info["title"], "channel": info["channel"], "duration": info["duration"]},
        "track": track,
        "segments": segments,
    }
    _cache.set(cache_key, result)
    return result
