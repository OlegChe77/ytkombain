import base64
import struct
import zlib

import pytest
from fastapi.testclient import TestClient

from app.editor.render import ClipSpec, Overlay, build_command, placement
from app.main import app


def spec(**kw):
    base = dict(source_width=1280, source_height=720, fps=30, has_audio=True, start=10, end=40)
    base.update(kw)
    return ClipSpec(**base)


def graph(cmd):
    return cmd[cmd.index("-filter_complex") + 1]


def test_placement_cover_and_contain():
    fw, fh, x, y = placement(spec(fit="cover"))
    assert (fw, fh) == (3414, 1920) and y == 0 and x == (1080 - 3414) // 2
    fw, fh, x, y = placement(spec(fit="contain"))
    assert fw == 1080 and fh == 608 and x == 0 and y == (1920 - 608) // 2
    fw, fh, x, y = placement(spec(fit="cover", pan_x=0))
    assert x == 0


def test_command_basic_video_and_audio():
    cmd = build_command("ffmpeg", spec(speed=1.5), "source.mp4", "out.mp4")
    assert cmd[cmd.index("-ss") + 1] == "10" and cmd[cmd.index("-t") + 1] == "30"
    g = graph(cmd)
    assert "setpts=(PTS-STARTPTS)/1.5" in g and "atempo=1.5" in g and "gblur" in g
    assert cmd[-1] == "out.mp4" and "-an" not in cmd
    assert cmd[cmd.index("-t", cmd.index("-filter_complex")) + 1] == "20"


def test_command_mute_music_overlays_progress():
    overlays = [Overlay("a.png", 100, 200, 500, 120, 0, 3, "pop"), Overlay("b.png", 10, 20, 50, 50, 1, 5, "slide")]
    cmd = build_command("ffmpeg", spec(volume=0, music="music.mp3", background="color", bg_color="#12AB34",
                                       progress="top", progress_color="#ff0000", fade_in=True, overlays=overlays),
                        "source.mp4", "out.mp4")
    g = graph(cmd)
    assert "[0:a]" not in g and "[1:a]" in g                    # звук видео выключен, играет музыка
    assert cmd[cmd.index("music.mp3") - 5] == "-stream_loop"       # короткий трек повторяется
    assert "color=c=0x12ab34" in g and "color=c=0xff0000" in g
    assert "eval=frame" in g and "overlay_w/2" in g and "pow(max(0" in g
    assert "enable='between(t,0,3)'" in g and "fade=t=in:st=0:d=0.5" in g


def test_command_without_any_audio():
    cmd = build_command("ffmpeg", spec(volume=0, has_audio=False), "source.mp4", "out.mp4")
    assert "-an" in cmd


def _png(width=4, height=3):
    raw = b"".join(b"\x00" + b"\x00\x00\x00\x00" * width for _ in range(height))
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + \
        chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def test_png_helpers():
    from app.editor.service import _decode_png, _png_size
    data = _png(7, 5)
    assert _png_size(_decode_png("data:image/png;base64," + base64.b64encode(data).decode())) == (7, 5)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_editor_api_validation(client):
    sid = "a" * 32
    assert client.get(f"/api/editor/{sid}/source").status_code == 404
    r = client.post(f"/api/editor/{sid}/render", json={"start": 0, "end": 5})
    assert r.status_code == 404 and r.json()["error"]["code"] == "session_expired"
    r = client.post(f"/api/editor/{sid}/render", json={"start": 0, "end": 5, "bg_color": "red;drawtext"})
    assert r.status_code == 422
    r = client.post(f"/api/editor/{sid}/render", json={"start": 0, "end": 5, "speed": 3})
    assert r.status_code == 422
    r = client.post("/api/editor/source", json={"url": "https://www.youtube.com/@YouTube"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "wrong_kind"


def test_body_limits(client):
    r = client.post("/api/video/info", content=b"x" * 70_000, headers={"Content-Type": "application/json"})
    assert r.status_code == 413
    r = client.post(f"/api/editor/{'b' * 32}/audio", content=b"\x00" * 1000, headers={"Content-Type": "audio/wav"})
    assert r.status_code == 404  # размер в норме — дальше проверяется сессия
