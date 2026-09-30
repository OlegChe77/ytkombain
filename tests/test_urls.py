import pytest

from app.core.errors import AppError
from app.youtube.urls import parse_time, parse_youtube_url

VID = "jNQXAC9IVRw"
PL = "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI"


@pytest.mark.parametrize("raw", [
    f"https://www.youtube.com/watch?v={VID}",
    f"youtube.com/watch?v={VID}&feature=share",
    f"https://m.youtube.com/watch?v={VID}",
    f"https://music.youtube.com/watch?v={VID}",
    f"https://youtu.be/{VID}?si=abc",
    f"https://www.youtube.com/shorts/{VID}",
    f"https://www.youtube.com/live/{VID}",
    f"https://www.youtube.com/embed/{VID}",
    f"https://www.youtube-nocookie.com/embed/{VID}",
    VID,
])
def test_video_links(raw):
    ref = parse_youtube_url(raw)
    assert ref.kind == "video"
    assert ref.video_id == VID
    assert ref.video_url == f"https://www.youtube.com/watch?v={VID}"


def test_shorts_flag_and_time():
    assert parse_youtube_url(f"https://www.youtube.com/shorts/{VID}").is_short
    assert parse_youtube_url(f"https://youtu.be/{VID}?t=90").start == 90
    assert parse_youtube_url(f"https://www.youtube.com/watch?v={VID}&t=1h2m3s").start == 3723


def test_playlist_and_mixed():
    ref = parse_youtube_url(f"https://www.youtube.com/playlist?list={PL}")
    assert ref.kind == "playlist" and ref.playlist_id == PL
    mixed = f"https://www.youtube.com/watch?v={VID}&list={PL}"
    assert parse_youtube_url(mixed, allow={"playlist"}).kind == "playlist"
    assert parse_youtube_url(mixed, allow={"video"}).kind == "video"


@pytest.mark.parametrize("raw, path", [
    ("https://www.youtube.com/@YouTube", "@YouTube"),
    ("@YouTube", "@YouTube"),
    ("https://www.youtube.com/@YouTube/videos", "@YouTube"),
    ("https://www.youtube.com/channel/UCBR8-60-B28hp2BmDPdntcQ", "channel/UCBR8-60-B28hp2BmDPdntcQ"),
    ("https://www.youtube.com/c/Google", "c/Google"),
    ("https://www.youtube.com/user/Google", "user/Google"),
])
def test_channel_links(raw, path):
    ref = parse_youtube_url(raw)
    assert ref.kind == "channel" and ref.channel_path == path


@pytest.mark.parametrize("raw, code", [
    ("", "empty"),
    ("https://evil.com/watch?v=jNQXAC9IVRw", "not_youtube"),
    ("https://youtube.com.evil.com/watch?v=jNQXAC9IVRw", "not_youtube"),
    ("https://user:pass@youtube.com/watch?v=jNQXAC9IVRw", "not_youtube"),
    ("https://youtube.com:8080/watch?v=jNQXAC9IVRw", "not_youtube"),
    ("ftp://youtube.com/watch?v=jNQXAC9IVRw", "not_youtube"),
    ("https://www.youtube.com/watch?v=short", "invalid_url"),
    ("https://www.youtube.com/clip/UgkxAbc", "unsupported"),
    ("https://youtube.com/" + "a" * 3000, "invalid_url"),
    ("; rm -rf /", "not_youtube"),
])
def test_rejects_bad_links(raw, code):
    with pytest.raises(AppError) as err:
        parse_youtube_url(raw)
    assert err.value.code == code


def test_wrong_kind():
    with pytest.raises(AppError) as err:
        parse_youtube_url("https://www.youtube.com/@YouTube", allow={"video"})
    assert err.value.code == "wrong_kind"


@pytest.mark.parametrize("value, seconds", [("90", 90), ("90s", 90), ("1m30s", 90), ("1h", 3600), ("", None), ("abc", None)])
def test_parse_time(value, seconds):
    assert parse_time(value) == seconds
