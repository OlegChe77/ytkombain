"""Сборка команды ffmpeg для клипа Shorts/Stories.

В команду попадают только числа, проверенные цвета и имена файлов, созданных сервером.
Текст титров рисуется в браузере и приходит готовыми PNG — пользовательские строки
в граф фильтров ffmpeg не попадают вообще.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

OUTPUT_SIZES = {"9:16": (1080, 1920), "1:1": (1080, 1080), "4:5": (1080, 1350), "16:9": (1920, 1080)}
FADE_S = 0.5
LAYER_FADE_S = 0.25
POP_S = 0.22
SLIDE_S = 0.35


@dataclass
class Overlay:
    file: str          # имя PNG в папке сессии
    x: int             # левый верхний угол в пикселях итогового кадра
    y: int
    width: int         # размер PNG
    height: int
    start: float       # секунды итогового клипа
    end: float
    anim: str = "none"  # none | fade | slide | pop


@dataclass
class ClipSpec:
    source_width: int
    source_height: int
    fps: float
    has_audio: bool
    start: float
    end: float
    format: str = "9:16"
    fit: str = "cover"            # cover — заполнить кадр, contain — вписать целиком
    background: str = "blur"      # blur | color
    bg_color: str = "#000000"
    zoom: float = 1.0
    pan_x: float = 0.5
    pan_y: float = 0.5
    speed: float = 1.0
    volume: float = 1.0
    music: str | None = None      # имя файла музыки в папке сессии
    music_volume: float = 0.8
    music_offset: float = 0.0
    music_fade: bool = True
    fade_in: bool = False
    fade_out: bool = False
    progress: str = "none"        # none | top | bottom
    progress_color: str = "#ffffff"
    overlays: list[Overlay] = field(default_factory=list)

    @property
    def size(self) -> tuple[int, int]:
        return OUTPUT_SIZES[self.format]

    @property
    def source_duration(self) -> float:
        return self.end - self.start

    @property
    def duration(self) -> float:
        """Длительность итогового клипа с учётом скорости."""
        return self.source_duration / self.speed


def _even(value: float) -> int:
    return max(2, int(round(value / 2)) * 2)


def _num(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".") or "0"


def _hex(color: str) -> str:
    return "0x" + color.lstrip("#").lower()


def placement(spec: ClipSpec) -> tuple[int, int, int, int]:
    """Размер и позиция видео в кадре: (ширина, высота, x, y). Та же формула — в превью браузера."""
    width, height = spec.size
    iw, ih = spec.source_width, spec.source_height
    base = max(width / iw, height / ih) if spec.fit == "cover" else min(width / iw, height / ih)
    scale = base * spec.zoom
    fw, fh = _even(iw * scale), _even(ih * scale)
    return fw, fh, round((width - fw) * spec.pan_x), round((height - fh) * spec.pan_y)


def build_command(ffmpeg: str, spec: ClipSpec, source: str, output: str, threads: int = 2) -> list[str]:
    width, height = spec.size
    duration = spec.duration
    fps = min(60.0, max(12.0, spec.fps or 30.0))
    fw, fh, x, y = placement(spec)

    args = [ffmpeg, "-hide_banner", "-nostdin", "-y", "-threads", str(threads),
            "-ss", _num(spec.start), "-t", _num(spec.source_duration), "-i", source]
    next_input = 1
    music_input = None
    if spec.music:
        args += ["-stream_loop", "-1", "-ss", _num(spec.music_offset), "-i", spec.music]
        music_input, next_input = next_input, next_input + 1
    overlay_inputs = []
    for overlay in spec.overlays:
        args += ["-loop", "1", "-framerate", _num(fps), "-t", _num(duration), "-i", overlay.file]
        overlay_inputs.append(next_input)
        next_input += 1

    graph: list[str] = []
    base = f"[0:v]setpts=(PTS-STARTPTS)/{_num(spec.speed)},fps={_num(fps)}"
    if spec.background == "blur":
        cover = max(width / spec.source_width, height / spec.source_height)
        cw, ch = _even(math.ceil(spec.source_width * cover)), _even(math.ceil(spec.source_height * cover))
        graph.append(f"{base},split=2[vs1][vs2]")
        graph.append(f"[vs1]scale={cw}:{ch},crop={width}:{height},gblur=sigma=30,eq=brightness=-0.06[bg]")
        graph.append(f"[vs2]scale={fw}:{fh}[fg]")
    else:
        graph.append(f"{base},scale={fw}:{fh}[fg]")
        graph.append(f"color=c={_hex(spec.bg_color)}:s={width}x{height}:r={_num(fps)}[bg]")
    graph.append(f"[bg][fg]overlay=x={x}:y={y}:shortest=1[v0]")
    current = "v0"

    for index, (overlay, input_index) in enumerate(zip(spec.overlays, overlay_inputs)):
        start, end = _num(overlay.start), _num(overlay.end)
        chain = [f"[{input_index}:v]format=rgba"]
        if overlay.anim != "none":
            chain.append(f"fade=t=in:st={start}:d={LAYER_FADE_S}:alpha=1")
            chain.append(f"fade=t=out:st={_num(max(overlay.start, overlay.end - LAYER_FADE_S))}:d={LAYER_FADE_S}:alpha=1")
        cx, cy = overlay.x + overlay.width / 2, overlay.y + overlay.height / 2
        if overlay.anim == "pop":
            chain.append(f"scale=w='max(2,trunc(iw*min(1,0.55+0.45*(t-{start})/{POP_S})/2)*2)':h=-2:eval=frame")
            pos_x, pos_y = f"'{_num(cx)}-overlay_w/2'", f"'{_num(cy)}-overlay_h/2'"
        elif overlay.anim == "slide":
            shift = _num(height * 0.06)
            pos_x = str(overlay.x)
            pos_y = f"'{overlay.y}+{shift}*pow(max(0,1-(t-{start})/{SLIDE_S}),2)'"
        else:
            pos_x, pos_y = str(overlay.x), str(overlay.y)
        graph.append(",".join(chain) + f"[o{index}]")
        target = f"v{index + 1}"
        graph.append(f"[{current}][o{index}]overlay=x={pos_x}:y={pos_y}:enable='between(t,{start},{end})'"
                     f":eof_action=pass[{target}]")
        current = target

    if spec.progress != "none":
        bar = max(6, round(height * 0.006))
        bar_y = 0 if spec.progress == "top" else height - bar
        graph.append(f"color=c={_hex(spec.progress_color)}:s={width}x{bar}:r={_num(fps)}[pb]")
        graph.append(f"[{current}][pb]overlay=x='-W+W*t/{_num(duration)}':y={bar_y}:shortest=1[vp]")
        current = "vp"

    tail = []
    if spec.fade_in:
        tail.append(f"fade=t=in:st=0:d={FADE_S}")
    if spec.fade_out:
        tail.append(f"fade=t=out:st={_num(max(0, duration - FADE_S))}:d={FADE_S}")
    tail.append("format=yuv420p")
    graph.append(f"[{current}]" + ",".join(tail) + "[vout]")

    audio_parts = []
    if spec.has_audio and spec.volume > 0:
        graph.append(f"[0:a]asetpts=PTS-STARTPTS,atempo={_num(spec.speed)},volume={_num(spec.volume)}[a0]")
        audio_parts.append("[a0]")
    if music_input is not None and spec.music_volume > 0:
        chain = f"[{music_input}:a]atrim=0:{_num(duration)},asetpts=PTS-STARTPTS,volume={_num(spec.music_volume)}"
        if spec.music_fade and duration > 3:
            chain += f",afade=t=out:st={_num(duration - 1.5)}:d=1.5"
        graph.append(chain + "[a1]")
        audio_parts.append("[a1]")
    audio_label = None
    if audio_parts:
        if len(audio_parts) == 2:
            graph.append("[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[amix]")
            source_label = "[amix]"
        else:
            source_label = audio_parts[0]
        fades = ["aresample=48000"]
        if spec.fade_in:
            fades.append(f"afade=t=in:st=0:d={FADE_S}")
        if spec.fade_out:
            fades.append(f"afade=t=out:st={_num(max(0, duration - FADE_S))}:d={FADE_S}")
        graph.append(source_label + ",".join(fades) + "[aout]")
        audio_label = "[aout]"

    args += ["-filter_complex", ";".join(graph), "-map", "[vout]"]
    if audio_label:
        args += ["-map", audio_label, "-c:a", "aac", "-b:a", "160k"]
    else:
        args += ["-an"]
    args += ["-t", _num(duration), "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart",
             "-progress", "pipe:1", "-nostats", output]
    return args
