#!/usr/bin/env python3
"""Render an authentic, narrated Talevi demo from captured screens and clips.

Requires Python 3.10+, Pillow, ffmpeg and ffprobe. This script never captures a
screen, connects to an application, or calls an AI provider.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT, FPS = 1920, 1080, 30
STAGE = (192, 88, 1536, 864)
BACKGROUND = "#0a0a12"
PANEL = "#11111d"
PINK = "#ff718e"
WHITE = "#fff8f4"
MUTED = "#a7a2b6"
REPO = Path(__file__).resolve().parents[1]


class RenderError(Exception):
    pass


def run(argv: list[str]) -> str:
    result = subprocess.run(argv, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RenderError(f"{Path(argv[0]).name} failed:\n{result.stderr[-6000:]}")
    return result.stdout


def probe(path: Path) -> dict:
    return json.loads(run([
        "ffprobe", "-v", "error", "-show_streams", "-show_format",
        "-of", "json", str(path),
    ]))


def seconds(value: object, label: str, allow_zero: bool = False) -> float:
    try:
        result = float(value)
    except (ValueError, TypeError) as error:
        raise RenderError(f"{label} must be a number of seconds") from error
    if not math.isfinite(result) or result < 0 or (not allow_zero and result == 0):
        raise RenderError(f"{label} must be {'non-negative' if allow_zero else 'positive'}")
    return result


def asset(value: str, base: Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = base / path
    path = path.resolve()
    if not path.is_file():
        raise RenderError(f"Asset not found: {path}")
    return path


def font_path(explicit: str | None) -> Path:
    if explicit:
        return asset(explicit, Path.cwd())
    candidates = [
        Path("/Library/Fonts/NotoSansKR-Regular.ttf"),
        Path("/Library/Fonts/NotoSansCJKkr-Regular.otf"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/System/Library/Fonts/AppleSDGothicNeo.ttc"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise RenderError("No Korean font found. Pass --font /path/to/NotoSansKR-Regular.ttf")


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def wrapped(text: str, face: ImageFont.FreeTypeFont, width: int) -> list[str]:
    """Wrap Korean and Latin text by measured glyph width, preserving newlines."""
    lines: list[str] = []
    for paragraph in text.split("\n"):
        line = ""
        for char in paragraph:
            if line and face.getlength(line + char) > width:
                lines.append(line.rstrip())
                line = char.lstrip()
            else:
                line += char
        lines.append(line.rstrip())
    return lines


def fitted(text: str, path: Path, size: int, width: int, max_lines: int,
           minimum: int) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    for current in range(size, minimum - 1, -1):
        face = font(path, current)
        lines = wrapped(text, face, width)
        if len(lines) <= max_lines:
            return face, lines
    raise RenderError(f"Text is too long for the layout; shorten it: {text[:100]}")


def frame_background(scene: dict, output: Path, face_path: Path, brand: str,
                     mark: Path | None, index: int, total: int) -> None:
    image = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND)
    draw = ImageDraw.Draw(image)
    # Real app pixels occupy the full stage; labels stay outside that rectangle.
    draw.rounded_rectangle((182, 78, 1738, 962), radius=18, fill="#191724")
    draw.rounded_rectangle((190, 86, 1730, 954), radius=10, fill=PANEL)
    if mark:
        icon = Image.open(mark).convert("RGBA")
        icon.thumbnail((38, 38), Image.Resampling.LANCZOS)
        image.paste(icon, (192, 24), icon)
        brand_x = 241
    else:
        draw.ellipse((194, 33, 210, 49), fill=PINK)
        brand_x = 224
    draw.text((brand_x, 24), brand, font=font(face_path, 31), fill=WHITE)
    title_face, title_lines = fitted(str(scene.get("title", "")), face_path, 27,
                                     1030, 1, 21)
    draw.text((390, 29), title_lines[0], font=title_face, fill="#e2dce9")
    count = f"{index:02d} / {total:02d}  ·  LOCAL DEMO"
    count_face = font(face_path, 19)
    draw.text((1728 - count_face.getlength(count), 34), count,
              font=count_face, fill=MUTED)
    draw.line((192, 974, 1728, 974), fill="#272334", width=1)
    image.save(output)


def card(scene: dict, output: Path, face_path: Path) -> None:
    image = Image.new("RGB", (STAGE[2], STAGE[3]), PANEL)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((94, 112, 154, 119), radius=3, fill=PINK)
    kicker = str(scene.get("kicker", "TALEVI / ENGINEERING DEMO"))
    draw.text((94, 153), kicker, font=font(face_path, 26), fill=PINK)
    title_face, title_lines = fitted(str(scene.get("title", "Talevi")), face_path,
                                     71, 1340, 2, 44)
    y = 225
    for line in title_lines:
        draw.text((91, y), line, font=title_face, fill=WHITE)
        y += title_face.size + 20
    body = scene.get("body", "")
    if isinstance(body, list):
        body = "\n\n".join(str(part) for part in body)
    if body:
        body_face, body_lines = fitted(str(body), face_path, 34, 1320, 7, 27)
        y += 36
        if y + len(body_lines) * (body_face.size + 15) > 800:
            raise RenderError(f"Card {scene['id']}: body overflows; shorten title/body")
        for line in body_lines:
            draw.text((94, y), line, font=body_face, fill="#c6bfd2")
            y += body_face.size + 15
    image.save(output)


def subtitle_image(text: str, output: Path, face_path: Path) -> None:
    image = Image.new("RGBA", (WIDTH, 106), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    face, lines = fitted(text, face_path, 33, 1650, 2, 27)
    line_height = face.size + 7
    y = (106 - line_height * len(lines)) // 2 - 2
    for line in lines:
        x = (WIDTH - face.getlength(line)) / 2
        draw.text((x, y), line, font=face, fill=WHITE)
        y += line_height
    image.save(output)


def normalize_scene(raw: dict, base: Path, index: int) -> dict:
    scene = dict(raw)
    scene["id"] = str(scene.get("id", f"scene-{index:02d}"))
    scene["shots"] = [dict(shot) for shot in scene.get("shots", [])]
    narration_duration = 0.0
    if scene.get("narration_audio"):
        scene["audio_path"] = asset(scene["narration_audio"], base)
        narration_duration = float(probe(scene["audio_path"])["format"]["duration"])
    for shot in scene["shots"]:
        shot["path"] = asset(shot["path"], base)
        info = probe(shot["path"])
        video = next((stream for stream in info["streams"]
                      if stream["codec_type"] == "video"), None)
        if not video:
            raise RenderError(f"No video or image stream: {shot['path']}")
        shot["size"] = (int(video["width"]), int(video["height"]))
        shot["still"] = shot["path"].suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
        shot["speed"] = seconds(shot.get("speed", 1), "shot.speed")
        if shot.get("duration") is not None:
            shot["duration"] = seconds(shot["duration"], "shot.duration")
        if shot.get("focus") is not None:
            rect = shot["focus"]
            if not isinstance(rect, list) or len(rect) != 4:
                raise RenderError("shot.focus must be [x, y, width, height]")
            x, y, w, h = [int(value) for value in rect]
            sw, sh = shot["size"]
            if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > sw or y + h > sh:
                raise RenderError(f"Focus rectangle exceeds {sw}x{sh}: {rect}")
            shot["focus"] = (x, y, w, h)
    subtitles = [dict(caption) for caption in scene.get("subtitles", [])]
    latest_subtitle = 0.0
    for caption in subtitles:
        caption["start"] = seconds(caption["start"], "subtitle.start", allow_zero=True)
        caption["end"] = seconds(caption["end"], "subtitle.end")
        if caption["end"] <= caption["start"] or caption["start"] < latest_subtitle - 1e-6:
            raise RenderError(f"{scene['id']}: subtitles must be ordered and non-overlapping")
        if not str(caption.get("text", "")).strip():
            raise RenderError(f"{scene['id']}: subtitle text is empty")
        latest_subtitle = caption["end"]
    scene["subtitles"] = subtitles
    fixed = sum(shot.get("duration", 0) for shot in scene["shots"])
    unset = [shot for shot in scene["shots"] if "duration" not in shot]
    derived = max(fixed + len(unset) * 4, narration_duration + 0.2, latest_subtitle, 1)
    duration = seconds(scene.get("duration", derived), "scene.duration")
    duration = math.ceil(duration * FPS - 1e-6) / FPS
    if narration_duration > duration + 0.02:
        raise RenderError(f"{scene['id']}: narration is {narration_duration:.2f}s, "
                          f"longer than scene {duration:.2f}s; extend duration")
    if latest_subtitle > duration + 0.02:
        raise RenderError(f"{scene['id']}: subtitle ends after the scene")
    if fixed > duration + 0.02 or (unset and fixed >= duration):
        raise RenderError(f"{scene['id']}: shot durations exceed scene duration")
    if unset:
        for shot in unset:
            shot["duration"] = (duration - fixed) / len(unset)
    elif scene["shots"]:
        scene["shots"][-1]["duration"] += duration - fixed
    # Quantize boundaries cumulatively to avoid drift when shots divide unevenly.
    elapsed = 0.0
    previous_frame = 0
    for shot in scene["shots"]:
        elapsed += shot["duration"]
        end_frame = round(elapsed * FPS)
        if end_frame <= previous_frame:
            raise RenderError(f"{scene['id']}: shot duration is shorter than one frame")
        shot["duration"] = (end_frame - previous_frame) / FPS
        previous_frame = end_frame
    scene["duration"] = duration
    return scene


def render_scene(scene: dict, folder: Path, face_path: Path, manifest: dict,
                 index: int, count: int, crf: int, preset: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    background = folder / "frame.png"
    frame_background(scene, background, face_path, str(manifest.get("brand", "talevi")),
                     manifest.get("mark_path"), index, count)
    shots = scene["shots"]
    if not shots:
        card_path = folder / "card.png"
        card(scene, card_path, face_path)
        shots = [{"path": card_path, "still": True, "speed": 1,
                  "duration": scene["duration"]}]
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
               "-filter_complex_threads", "1"]
    for shot in shots:
        if shot["still"]:
            command += ["-loop", "1", "-framerate", str(FPS)]
        command += ["-i", str(shot["path"])]
    bg_index = len(shots)
    command += ["-loop", "1", "-framerate", str(FPS), "-i", str(background)]
    for number, caption in enumerate(scene["subtitles"]):
        png = folder / f"subtitle-{number:03d}.png"
        subtitle_image(str(caption["text"]), png, face_path)
        command += ["-loop", "1", "-framerate", str(FPS), "-i", str(png)]
    audio_index = bg_index + 1 + len(scene["subtitles"])
    if scene.get("audio_path"):
        command += ["-i", str(scene["audio_path"])]
    else:
        command += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
    filters = []
    for number, shot in enumerate(shots):
        crop = ""
        if shot.get("focus"):
            x, y, w, h = shot["focus"]
            crop = f"crop={w}:{h}:{x}:{y},"
        filters.append(
            f"[{number}:v]{crop}setpts=(PTS-STARTPTS)/{shot['speed']},fps={FPS},"
            f"scale={STAGE[2]}:{STAGE[3]}:force_original_aspect_ratio=decrease,"
            f"pad={STAGE[2]}:{STAGE[3]}:(ow-iw)/2:(oh-ih)/2:color={PANEL},"
            f"setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration={shot['duration']},"
            f"trim=duration={shot['duration']},setpts=PTS-STARTPTS[s{number}]"
        )
    filters.append("".join(f"[s{number}]" for number in range(len(shots))) +
                   f"concat=n={len(shots)}:v=1:a=0[stage]")
    filters.append(f"[{bg_index}:v][stage]overlay={STAGE[0]}:{STAGE[1]}:shortest=1[v0]")
    for number, caption in enumerate(scene["subtitles"]):
        input_index = bg_index + 1 + number
        # Half-open intervals avoid drawing two adjacent subtitles on one frame.
        filters.append(f"[v{number}][{input_index}:v]overlay=0:974:"
                       f"enable='gte(t,{caption['start']})*lt(t,{caption['end']})':"
                       f"shortest=1[v{number + 1}]")
    transition = min(seconds(manifest.get("transition", 0.28), "transition",
                             allow_zero=True), scene["duration"] / 3)
    fade = (f"fade=t=in:st=0:d={transition},"
            f"fade=t=out:st={scene['duration'] - transition}:d={transition},") if transition else ""
    filters.append(f"[v{len(scene['subtitles'])}]{fade}format=yuv420p[video]")
    filters.append(f"[{audio_index}:a]aresample=48000,"
                   f"aformat=sample_fmts=fltp:channel_layouts=stereo,"
                   f"apad,atrim=duration={scene['duration']},asetpts=PTS-STARTPTS[audio]")
    output = folder / "scene.mp4"
    command += ["-filter_complex", ";".join(filters), "-map", "[video]", "-map", "[audio]",
                "-t", str(scene["duration"]), "-r", str(FPS), "-c:v", "libx264",
                "-preset", preset, "-crf", str(crf), "-threads", "2",
                "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
                "-movflags", "+faststart", str(output)]
    run(command)
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="UTF-8 JSON manifest")
    parser.add_argument("--output", required=True, type=Path, help="Destination .mp4")
    parser.add_argument("--work-dir", type=Path, help="Retain rendered scenes and caption PNGs")
    parser.add_argument("--font", help="Explicit Korean TTF/OTF/TTC font")
    parser.add_argument("--crf", type=int, help="H.264 quality, 20–23 recommended")
    parser.add_argument("--preset", default="medium", choices=["ultrafast", "veryfast", "fast", "medium", "slow"])
    parser.add_argument("--validate-only", action="store_true", help="Check assets, timings and fonts without encoding")
    args = parser.parse_args()
    try:
        for executable in ("ffmpeg", "ffprobe"):
            if not shutil.which(executable):
                raise RenderError(f"{executable} is missing; install ffmpeg first")
        manifest_path = args.manifest.expanduser().resolve()
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("fps", FPS) != FPS:
            raise RenderError("This renderer outputs 30 fps; set fps to 30 or omit it")
        raw_scenes = manifest.get("scenes", [])
        if not raw_scenes:
            raise RenderError("The manifest must contain at least one scene")
        face_path = font_path(args.font or manifest.get("font"))
        if manifest.get("brand_mark"):
            manifest["mark_path"] = asset(manifest["brand_mark"], manifest_path.parent)
        else:
            default_mark = REPO / "apps/web/public/brand/talevi-icon-180.png"
            manifest["mark_path"] = default_mark if default_mark.is_file() else None
        scenes = [normalize_scene(raw, manifest_path.parent, index)
                  for index, raw in enumerate(raw_scenes, 1)]
        crf = args.crf if args.crf is not None else int(manifest.get("crf", 22))
        if not 0 <= crf <= 51:
            raise RenderError("crf must be between 0 and 51")
        total = sum(scene["duration"] for scene in scenes)
        print(f"Validated {len(scenes)} scenes · {total:.2f}s · 1920×1080 / {FPS} fps")
        print(f"Korean font: {face_path}")
        if args.validate_only:
            return 0
        output = args.output.expanduser().resolve()
        if output.suffix.lower() != ".mp4":
            raise RenderError("--output must end in .mp4")
        output.parent.mkdir(parents=True, exist_ok=True)
        work = (args.work_dir or output.parent / f".{output.stem}-render").resolve()
        work.mkdir(parents=True, exist_ok=True)
        rendered = []
        for index, scene in enumerate(scenes, 1):
            print(f"[{index}/{len(scenes)}] {scene['id']} · {scene['duration']:.2f}s", flush=True)
            rendered.append(render_scene(scene, work / f"{index:03d}", face_path,
                                         manifest, index, len(scenes), crf, args.preset))
        # Generated relative paths avoid concat-demuxer quoting ambiguity.
        concat_file = work / "concat.txt"
        # Pin joins to video frame boundaries instead of AAC packet padding.
        concat_file.write_text("".join(
            f"file '{index:03d}/scene.mp4'\nduration {scene['duration']:.9f}\n"
            for index, scene in enumerate(scenes, 1)), encoding="utf-8")
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat",
             "-safe", "1", "-i", str(concat_file), "-map", "0:v", "-map", "0:a",
             "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
             "-af", "aresample=async=1:first_pts=0", "-t", str(total),
             "-movflags", "+faststart", str(output)])
        result = probe(output)
        actual = float(result["format"]["duration"])
        if abs(actual - total) > 0.2:
            raise RenderError(f"Unexpected output duration: {actual:.3f}s; expected {total:.3f}s")
        size_mb = output.stat().st_size / 1_000_000
        report = {"output": output.name, "duration_seconds": actual,
                  "size_mb": round(size_mb, 2), "width": WIDTH, "height": HEIGHT,
                  "fps": FPS, "video_codec": "h264", "audio_codec": "aac",
                  "crf": crf, "font": face_path.name, "scenes": len(scenes)}
        output.with_suffix(".render.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Created {output} ({actual:.2f}s, {size_mb:.1f} MB)")
        if size_mb > 100:
            print("Note: output exceeds 100 MB. Re-render with --crf 23 if needed.")
        return 0
    except (RenderError, OSError, ValueError, KeyError, TypeError) as error:
        print(f"Render error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
