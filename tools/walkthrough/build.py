#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Encode recorded frame folders into one 1080p walkthrough.
#   build.py OUT.mp4 WIDTH HEIGHT COVER.png DIR1 [DIR2 ...]
# Each DIR holds numbered JPEG frames at 30 fps from record-slides.mjs / record-app.mjs.
# Output: H.264 High profile, CRF 16, 30 fps, BT.709, fast-start, with COVER embedded as
# the thumbnail. Encoded parts are cached so an interrupted build resumes.

import os, subprocess, sys

def encode(src_dir, part, width, height):
    subprocess.run([
        "ffmpeg", "-loglevel", "error", "-framerate", "30", "-i", os.path.join(src_dir, "%06d.jpg"),
        "-vf", f"scale={width}:{height}:flags=lanczos,format=yuv420p",
        "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high", "-level", "4.2",
        "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
        "-g", "60", "-an", part + ".tmp.mp4", "-y"], check=True)
    os.replace(part + ".tmp.mp4", part)

def main():
    out, width, height, cover, *dirs = sys.argv[1:]
    cache = os.path.join(os.path.dirname(os.path.abspath(out)), f"parts-{width}x{height}")
    os.makedirs(cache, exist_ok=True)
    parts = []
    for n, d in enumerate(dirs):
        frames = len([f for f in os.listdir(d) if f.endswith(".jpg")])
        part = os.path.join(cache, f"{n:02d}-{os.path.basename(os.path.normpath(d))}-{frames}.mp4")
        if not os.path.exists(part):
            encode(d, part, width, height)
        parts.append(part)
        print(f"{d}: {frames} frames, {frames / 30:.1f}s")
    listing = os.path.join(cache, "list.txt")
    with open(listing, "w") as f:
        f.writelines(f"file '{p}'\n" for p in parts)
    joined = os.path.join(cache, "joined.mp4")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listing, "-c", "copy", joined, "-y"], check=True)
    thumb = os.path.join(cache, "cover.jpg")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-i", cover, "-vf", f"scale={width}:{height}:flags=lanczos", "-q:v", "1", thumb, "-y"], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-i", joined, "-i", thumb, "-map", "0", "-map", "1", "-c", "copy",
                    "-c:v:1", "mjpeg", "-disposition:v:1", "attached_pic", "-movflags", "+faststart", out, "-y"], check=True)
    print("wrote", out)

if __name__ == "__main__":
    main()
