#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Puts the soundtracks under the finished walkthroughs and builds the combined video.
#   tools/walkthrough/add-music.sh DESKTOP.mp4 DEVICE.mp4 OUT_DIR
#
# Desktop: "Happy Adventure (Loop)" by Tiny Worlds, looped to length.
# Device:  "Honey Bear" by Tiny Worlds.
# Both at 65% volume, 2 s fade in, 4 s fade out. The picture is copied, not re-encoded.
#
# Combined: the device walkthrough (centred on black at 1920x1080) fading to black over
# its last 3 s, then the desktop walkthrough fading in over 1.5 s. Each part keeps its
# own track, faded out at the end of the part. H.264 High, CRF 16, BT.709, 30 fps.
set -euo pipefail
desktop_in="${1:?desktop walkthrough}"; device_in="${2:?device walkthrough}"; out="${3:?output folder}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
happy="$here/design/source-media/tinyworlds-happy-adventure-loop.mp3"
honey="$here/design/source-media/tinyworlds-honey-bear.mp3"
mkdir -p "$out"
dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
minus() { python3 -c "print(round($1-$2,3))"; }

remux() { # in music out [input options for the music]
  local d; d="$(dur "$1")"
  ffmpeg -hide_banner -v error -y -i "$1" ${4:-} -i "$2" -filter_complex \
    "[1:a]aresample=48000,atrim=0:$d,asetpts=N/SR/TB,volume=0.65,afade=t=in:st=0:d=2,afade=t=out:st=$(minus "$d" 4):d=4[a]" \
    -map 0:v:0 -map 0:v:1 -map "[a]" -c:v copy -c:a aac -b:a 256k -ar 48000 \
    -disposition:v:1 attached_pic -movflags +faststart -t "$d" "$3"
}
remux "$desktop_in" "$happy" "$out/secret-agent-club-desktop-walkthrough.mp4" "-stream_loop 2"
remux "$device_in" "$honey" "$out/secret-agent-club-device-walkthrough.mp4"

dd="$(dur "$device_in")"; dk="$(dur "$desktop_in")"
ffmpeg -hide_banner -v error -y -i "$device_in" -i "$desktop_in" -i "$honey" -stream_loop 2 -i "$happy" -filter_complex "
[0:v:0]scale=-2:1080:flags=lanczos,pad=1920:1080:(ow-iw)/2:0:black,setsar=1,fps=30,format=yuv420p,fade=t=out:st=$(minus "$dd" 3):d=3[v1];
[1:v:0]setsar=1,fps=30,format=yuv420p,fade=t=in:st=0:d=1.5[v2];
[2:a]aresample=48000,atrim=0:$dd,asetpts=N/SR/TB,volume=0.65,afade=t=in:st=0:d=2,afade=t=out:st=$(minus "$dd" 3):d=3[a1];
[3:a]aresample=48000,atrim=0:$dk,asetpts=N/SR/TB,volume=0.65,afade=t=in:st=0:d=2,afade=t=out:st=$(minus "$dk" 4):d=4[a2];
[v1][a1][v2][a2]concat=n=2:v=1:a=1[v][a]" -map "[v]" -map "[a]" \
  -c:v libx264 -profile:v high -preset slow -crf 16 -pix_fmt yuv420p \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -c:a aac -b:a 256k -ar 48000 -movflags +faststart "$out/combined-noart.mp4"
ffmpeg -hide_banner -v error -y -i "$out/combined-noart.mp4" -i "$desktop_in" -map 0:v -map 0:a -map 1:v:1 -c copy \
  -disposition:v:1 attached_pic -movflags +faststart "$out/secret-agent-club-walkthrough-combined.mp4"
rm "$out/combined-noart.mp4"
echo "Written to $out"
