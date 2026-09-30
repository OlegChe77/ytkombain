"""Разбор и строгая валидация ссылок YouTube.

В yt-dlp никогда не передаётся строка пользователя: из неё извлекаются идентификаторы,
а ссылка собирается заново из проверенных частей.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, quote, urlsplit

from app.core.errors import AppError

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
PLAYLIST_ID = re.compile(r"^[A-Za-z0-9_-]{12,64}$")
CHANNEL_ID = re.compile(r"^UC[A-Za-z0-9_-]{22}$")
HANDLE = re.compile(r"^@[\w.\-·]{3,100}$", re.UNICODE)
LEGACY_NAME = re.compile(r"^[\w.\-]{1,100}$", re.UNICODE)
TIME_PART = re.compile(r"(\d+)([hms])")

HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
    "youtu.be", "www.youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com",
}
CHANNEL_TABS = {"videos", "shorts", "streams"}
MAX_URL_LENGTH = 2048


@dataclass(frozen=True)
class YouTubeRef:
    kind: str  # video | playlist | channel
    video_id: str | None = None
    playlist_id: str | None = None
    channel_path: str | None = None  # "channel/UC…", "@handle", "c/name", "user/name"
    start: int | None = None
    is_short: bool = False

    @property
    def video_url(self) -> str:
        return f"https://www.youtube.com/watch?v={self.video_id}"

    @property
    def playlist_url(self) -> str:
        return f"https://www.youtube.com/playlist?list={self.playlist_id}"

    def channel_url(self, tab: str | None = None) -> str:
        base = f"https://www.youtube.com/{quote(self.channel_path, safe='/@')}"
        return f"{base}/{tab}" if tab else base


def parse_time(value: str | None) -> int | None:
    if not value:
        return None
    value = value.strip().lower()
    if value.endswith("s") and value[:-1].isdigit():
        value = value[:-1]
    if value.isdigit():
        return int(value)
    parts = TIME_PART.findall(value)
    if not parts:
        return None
    mult = {"h": 3600, "m": 60, "s": 1}
    return sum(int(n) * mult[u] for n, u in parts)


def parse_youtube_url(raw: str, *, allow: set[str] | None = None) -> YouTubeRef:
    """Разбирает ссылку. allow — допустимые виды ссылок для конкретного инструмента."""
    ref = _parse(raw)
    if allow and ref.kind not in allow:
        # Ссылка на видео внутри плейлиста подходит и видео-, и плейлист-инструментам.
        if "video" in allow and ref.video_id:
            return YouTubeRef("video", video_id=ref.video_id, start=ref.start, is_short=ref.is_short)
        if "playlist" in allow and ref.playlist_id:
            return YouTubeRef("playlist", playlist_id=ref.playlist_id)
        expected = {"video": "видео", "playlist": "плейлист", "channel": "канал"}
        names = " или ".join(expected[k] for k in ("video", "playlist", "channel") if k in allow)
        raise AppError(f"Этому инструменту нужна ссылка на {names}.", code="wrong_kind")
    return ref


def _parse(raw: str) -> YouTubeRef:
    if not isinstance(raw, str):
        raise AppError("Вставьте ссылку на YouTube.", code="empty")
    raw = raw.strip()
    if not raw:
        raise AppError("Вставьте ссылку на YouTube.", code="empty")
    if len(raw) > MAX_URL_LENGTH:
        raise AppError("Ссылка слишком длинная.", code="invalid_url")
    if VIDEO_ID.match(raw):
        return YouTubeRef("video", video_id=raw)
    if raw.startswith("@") and HANDLE.match(raw):
        return YouTubeRef("channel", channel_path=raw)
    if "://" not in raw:
        raw = "https://" + raw
    try:
        parts = urlsplit(raw)
    except ValueError:
        raise AppError("Это не похоже на ссылку.", code="invalid_url") from None
    host = (parts.hostname or "").lower()
    if parts.scheme not in {"http", "https"} or host not in HOSTS or parts.username or parts.password:
        raise AppError("Нужна ссылка с youtube.com или youtu.be.", code="not_youtube")
    try:
        if parts.port not in (None, 80, 443):
            raise AppError("Нужна ссылка с youtube.com или youtu.be.", code="not_youtube")
    except ValueError:
        raise AppError("Это не похоже на ссылку.", code="invalid_url") from None

    query = parse_qs(parts.query)
    q = lambda key: (query.get(key) or [None])[0]  # noqa: E731
    segments = [s for s in parts.path.split("/") if s]
    start = parse_time(q("t") or q("start") or q("time_continue"))
    list_id = q("list")
    list_id = list_id if list_id and PLAYLIST_ID.match(list_id) else None

    if host.endswith("youtu.be"):
        if segments and VIDEO_ID.match(segments[0]):
            return YouTubeRef("video", video_id=segments[0], playlist_id=list_id, start=start)
        raise AppError("В короткой ссылке не нашлось ID видео.", code="invalid_url")

    head = segments[0].lower() if segments else ""
    if head == "watch" or (not segments and q("v")):
        vid = q("v")
        if vid and VIDEO_ID.match(vid):
            return YouTubeRef("video", video_id=vid, playlist_id=list_id, start=start)
        if list_id:
            return YouTubeRef("playlist", playlist_id=list_id)
        raise AppError("В ссылке нет ID видео.", code="invalid_url")
    if head in {"shorts", "live", "embed", "v", "e"} and len(segments) > 1:
        if head == "embed" and segments[1] == "videoseries" and list_id:
            return YouTubeRef("playlist", playlist_id=list_id)
        if VIDEO_ID.match(segments[1]):
            return YouTubeRef("video", video_id=segments[1], playlist_id=list_id, start=start,
                              is_short=head == "shorts")
        raise AppError("В ссылке нет корректного ID видео.", code="invalid_url")
    if head == "playlist":
        if list_id:
            return YouTubeRef("playlist", playlist_id=list_id)
        raise AppError("В ссылке на плейлист нет его ID.", code="invalid_url")
    if head == "channel" and len(segments) > 1 and CHANNEL_ID.match(segments[1]):
        return YouTubeRef("channel", channel_path=f"channel/{segments[1]}")
    if segments and segments[0].startswith("@") and HANDLE.match(segments[0]):
        return YouTubeRef("channel", channel_path=segments[0])
    if head in {"c", "user"} and len(segments) > 1 and LEGACY_NAME.match(segments[1]):
        return YouTubeRef("channel", channel_path=f"{head}/{segments[1]}")
    if head == "clip":
        raise AppError("Ссылки на клипы не поддерживаются.", code="unsupported",
                       hint="Откройте клип на YouTube и скопируйте ссылку на исходное видео.")
    raise AppError("Не удалось распознать ссылку YouTube.", code="invalid_url",
                   hint="Подойдёт ссылка на видео, Shorts, плейлист или канал.")
