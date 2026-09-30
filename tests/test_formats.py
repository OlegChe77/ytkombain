from app.config import settings
from app.youtube.media import safe_filename
from app.youtube.video import build_download_options


def fmt(fid, **kw):
    base = {"format_id": fid, "protocol": "https", "ext": "mp4", "vcodec": "none", "acodec": "none"}
    base.update(kw)
    return base


INFO = {
    "duration": 100,
    "formats": [
        fmt("140", ext="m4a", acodec="mp4a.40.2", abr=129, filesize=1_600_000),
        fmt("251", ext="webm", acodec="opus", abr=140, filesize=1_700_000),
        fmt("140-drc", ext="m4a", acodec="mp4a.40.2", abr=129),
        fmt("137", vcodec="avc1.640028", height=1080, width=1920, fps=30, tbr=4000, filesize=40_000_000),
        fmt("248", ext="webm", vcodec="vp9", height=1080, width=1920, fps=30, tbr=2500, filesize=25_000_000),
        fmt("313", ext="webm", vcodec="vp9", height=2160, width=3840, fps=30, tbr=16000, filesize=160_000_000),
        fmt("96", protocol="m3u8_native", vcodec="avc1", acodec="mp4a", height=1080),
    ],
}


def test_video_options_prefer_h264_and_pair_audio():
    public, private = build_download_options(INFO)
    ids = [o["id"] for o in public["video"]]
    if settings.ffmpeg_available:
        assert ids[0] == "313+140"          # 4K доступно только в VP9
        assert "137+140" in ids             # для 1080p выбран совместимый H.264
        assert "248+140" not in ids
        assert private["137+140"]["merge"] == "mp4"
        assert public["video"][1]["size"] == 41_600_000
    assert all("96" not in i for i in ids)  # HLS-потоки не предлагаются


def test_audio_options():
    public, private = build_download_options(INFO)
    ids = [o["id"] for o in public["audio"]]
    assert "140" in ids and "251" in ids and "140-drc" not in ids
    if settings.ffmpeg_available:
        assert "mp3-192" in ids and private["mp3-192"]["mp3"] == 192


def test_safe_filename():
    assert safe_filename('a/b\\c:*?"<>|  d') == "abc d"
    assert safe_filename("...") == "image"
    assert len(safe_filename("я" * 500)) == 120
