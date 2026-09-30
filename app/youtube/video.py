"""Информация о видео и список доступных вариантов скачивания."""
from __future__ import annotations

from datetime import datetime, timezone

from app.config import settings
from app.core.cache import TTLCache
from app.core.errors import AppError
from app.youtube import ytdlp
from app.youtube.urls import YouTubeRef

_cache = TTLCache(maxsize=300, ttl=900)

CODEC_NAMES = (("avc1", "H.264"), ("vp09", "VP9"), ("vp9", "VP9"), ("av01", "AV1"), ("hev1", "HEVC"), ("hvc1", "HEVC"))
CODEC_RANK = {"H.264": 3, "VP9": 2, "AV1": 1, "HEVC": 0}


def _codec(vcodec: str | None) -> str:
    vcodec = (vcodec or "").lower()
    for prefix, name in CODEC_NAMES:
        if vcodec.startswith(prefix):
            return name
    return vcodec.split(".")[0].upper() or "—"


def _size(f: dict) -> int | None:
    value = f.get("filesize") or f.get("filesize_approx")
    return int(value) if value else None


def _is_direct(f: dict) -> bool:
    return f.get("protocol") in {"https", "http"} and not f.get("has_drm") and "-drc" not in str(f.get("format_id"))


def _audio_score(f: dict) -> tuple:
    note = (f.get("format_note") or "").lower()
    return (
        "original" in note or "default" in note,
        f.get("language_preference") or 0,
        f.get("abr") or f.get("tbr") or 0,
    )


def build_download_options(info: dict) -> tuple[dict, dict]:
    """Возвращает (публичные варианты, приватная карта id → параметры yt-dlp)."""
    formats = [f for f in info.get("formats") or [] if _is_direct(f)]
    audio = [f for f in formats if f.get("vcodec") == "none" and f.get("acodec") not in (None, "none")]
    video = [f for f in formats if f.get("vcodec") not in (None, "none") and f.get("acodec") in (None, "none")]
    muxed = [f for f in formats if f.get("vcodec") not in (None, "none") and f.get("acodec") not in (None, "none")]
    duration = info.get("duration") or 0
    ffmpeg = settings.ffmpeg_available

    best_m4a = max((f for f in audio if f.get("ext") == "m4a"), key=_audio_score, default=None)
    best_any_audio = max(audio, key=_audio_score, default=None)
    pair_audio = best_m4a or best_any_audio

    public = {"video": [], "audio": [], "video_only": []}
    private: dict[str, dict] = {}

    def add(section: str, option: dict, params: dict) -> None:
        public[section].append(option)
        private[option["id"]] = {**params, "kind": section, "label": option["label"], "ext": option["ext"]}

    # Видео со звуком: лучшая дорожка на каждую пару «высота + fps», совместимые кодеки в приоритете.
    groups: dict[tuple, dict] = {}
    for f in video:
        height = f.get("height")
        if not height:
            continue
        fps = round(f.get("fps") or 30)
        hdr = (f.get("dynamic_range") or "SDR") != "SDR"
        key = (height, fps, hdr)
        codec = _codec(f.get("vcodec"))
        score = (CODEC_RANK.get(codec, -1), f.get("tbr") or 0)
        current = groups.get(key)
        if not current or score > current["score"]:
            groups[key] = {"format": f, "codec": codec, "score": score}

    if ffmpeg and pair_audio:
        for (height, fps, hdr), item in sorted(groups.items(), key=lambda kv: (-kv[0][0], -kv[0][1], kv[0][2])):
            f = item["format"]
            v_size, a_size = _size(f), _size(pair_audio)
            fid = f"{f['format_id']}+{pair_audio['format_id']}"
            add("video", {
                "id": fid,
                "label": f"{height}p",
                "height": height, "width": f.get("width"), "fps": fps,
                "codec": item["codec"], "hdr": hdr, "ext": "mp4",
                "size": (v_size + a_size) if v_size and a_size else None,
            }, {
                "format": f"{fid}/bv*[height={height}]+ba/b[height<={height}]",
                "merge": "mp4",
                "file_label": f"{height}p",
            })
    for f in sorted(muxed, key=lambda x: -(x.get("height") or 0)):
        fid = str(f["format_id"])
        if fid in private:
            continue
        add("video", {
            "id": fid, "label": f"{f.get('height') or '?'}p",
            "height": f.get("height"), "width": f.get("width"), "fps": round(f.get("fps") or 0) or None,
            "codec": _codec(f.get("vcodec")), "hdr": False, "ext": f.get("ext") or "mp4", "size": _size(f),
        }, {"format": fid, "file_label": f"{f.get('height') or ''}p"})

    # Только звук.
    if ffmpeg and best_any_audio:
        for kbps in (192, 128):
            add("audio", {
                "id": f"mp3-{kbps}", "label": f"MP3 · {kbps} кбит/с", "ext": "mp3", "codec": "MP3",
                "bitrate": kbps, "size": int(duration * kbps * 1000 / 8) if duration else None,
            }, {"format": "ba/b", "mp3": kbps, "file_label": f"{kbps}kbps"})
    seen_ext = set()
    for f in sorted(audio, key=_audio_score, reverse=True):
        ext = f.get("ext")
        if ext in seen_ext or ext not in {"m4a", "webm"}:
            continue
        seen_ext.add(ext)
        abr = round(f.get("abr") or f.get("tbr") or 0)
        name = "M4A (AAC)" if ext == "m4a" else "WebM (Opus)"
        add("audio", {
            "id": str(f["format_id"]), "label": f"{name} · {abr} кбит/с" if abr else name,
            "ext": ext, "codec": "AAC" if ext == "m4a" else "Opus", "bitrate": abr or None, "size": _size(f),
        }, {"format": f"{f['format_id']}/ba[ext={ext}]/ba", "file_label": "audio"})

    # Только видеодорожка без звука.
    for (height, fps, hdr), item in sorted(groups.items(), key=lambda kv: (-kv[0][0], -kv[0][1])):
        f = item["format"]
        fid = str(f["format_id"])
        if fid in private:
            continue
        add("video_only", {
            "id": fid, "label": f"{height}p", "height": height, "width": f.get("width"), "fps": fps,
            "codec": item["codec"], "hdr": hdr, "ext": f.get("ext") or "mp4", "size": _size(f),
        }, {"format": f"{fid}/bv*[height={height}]", "file_label": f"{height}p no audio"})
    return public, private


def _captions(info: dict) -> list[dict]:
    tracks: list[dict] = []
    manual = info.get("subtitles") or {}
    auto = info.get("automatic_captions") or {}
    original_lang = info.get("language")
    for lang, entries in manual.items():
        if lang == "live_chat" or not entries:
            continue
        tracks.append({"key": f"manual:{lang}", "lang": lang, "name": entries[0].get("name") or lang, "kind": "manual"})
    for lang, entries in auto.items():
        if not entries:
            continue
        name = entries[0].get("name") or lang
        is_orig = lang.endswith("-orig") or (lang == original_lang and f"{lang}-orig" not in auto)
        tracks.append({"key": f"auto:{lang}", "lang": lang.removesuffix("-orig"), "name": name,
                       "kind": "auto" if is_orig else "translated"})
    order = {"manual": 0, "auto": 1, "translated": 2}
    tracks.sort(key=lambda t: (order[t["kind"]], t["name"].lower()))
    return tracks


def _heatmap(info: dict, points: int = 80) -> list[dict]:
    data = info.get("heatmap") or []
    if not data:
        return []
    step = max(1, len(data) // points)
    return [{"t": round(d["start_time"], 1), "v": round(d["value"], 3)} for d in data[::step]]


def _date(info: dict) -> str | None:
    ts = info.get("timestamp") or info.get("release_timestamp")
    if ts:
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    raw = info.get("upload_date")
    if raw and len(raw) == 8:
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"
    return None


def normalize(info: dict, public_options: dict) -> dict:
    vid = info["id"]
    width, height = info.get("width"), info.get("height")
    return {
        "id": vid,
        "title": info.get("title"),
        "description": info.get("description") or "",
        "url": f"https://www.youtube.com/watch?v={vid}",
        "short_url": f"https://youtu.be/{vid}",
        "embed_url": f"https://www.youtube.com/embed/{vid}",
        "channel": info.get("channel") or info.get("uploader"),
        "channel_id": info.get("channel_id"),
        "channel_url": info.get("channel_url") or info.get("uploader_url"),
        "channel_handle": info.get("uploader_id") if str(info.get("uploader_id") or "").startswith("@") else None,
        "channel_followers": info.get("channel_follower_count"),
        "channel_verified": bool(info.get("channel_is_verified")),
        "published": _date(info),
        "duration": info.get("duration"),
        "views": info.get("view_count"),
        "likes": info.get("like_count"),
        "comments": info.get("comment_count"),
        "tags": info.get("tags") or [],
        "categories": info.get("categories") or [],
        "chapters": [{"start": round(c.get("start_time") or 0), "end": round(c.get("end_time") or 0),
                      "title": c.get("title")} for c in info.get("chapters") or []],
        "language": info.get("language"),
        "age_limit": info.get("age_limit") or 0,
        "availability": info.get("availability"),
        "live_status": info.get("live_status"),
        "is_live": bool(info.get("is_live")),
        "embeddable": info.get("playable_in_embed"),
        "width": width,
        "height": height,
        "fps": info.get("fps"),
        "is_vertical": bool(width and height and height > width),
        "max_height": max((o.get("height") or 0 for o in public_options["video"] + public_options["video_only"]), default=None),
        "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
        "captions": _captions(info),
        "heatmap": _heatmap(info),
        "downloads": public_options,
        "ffmpeg": settings.ffmpeg_available,
    }


def get_video(ref: YouTubeRef) -> tuple[dict, dict]:
    """(нормализованная информация, приватная карта вариантов скачивания). Результат кэшируется."""
    cached = _cache.get(ref.video_id)
    if cached:
        return cached
    if not ytdlp.info_slots.acquire(timeout=settings.info_timeout_s):
        raise AppError("Сервер сейчас загружен.", status=503, code="overloaded", hint="Попробуйте через минуту.")
    try:
        raw = ytdlp.extract(ref.video_url)
    finally:
        ytdlp.info_slots.release()
    if raw.get("_type") == "playlist":
        raise AppError("По ссылке открылся плейлист, а не видео.", code="wrong_kind")
    public_opts, private_opts = build_download_options(raw)
    result = (normalize(raw, public_opts), {"options": private_opts, "raw_captions": {
        "manual": raw.get("subtitles") or {}, "auto": raw.get("automatic_captions") or {},
    }})
    _cache.set(ref.video_id, result)
    return result


def forget(video_id: str) -> None:
    _cache.set(video_id, None, ttl=0.001)


def prune_cache() -> None:
    _cache.prune()
