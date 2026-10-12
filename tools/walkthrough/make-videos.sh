#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Rebuilds both 1080p walkthroughs into build/walkthrough/:
#   secret-agent-club-device-walkthrough.mp4   1080x1920, 30 fps
#   secret-agent-club-desktop-walkthrough.mp4  1920x1080, 30 fps
# Frame-stepped recording is slow on purpose (every frame is rendered and captured at full
# resolution); allow several minutes per video.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=build/walkthrough
mkdir -p "$OUT"
node tools/walkthrough/record-slides.mjs
node tools/walkthrough/record-slides.mjs stills
MOCK_FINALIZE_MS=1500 tools/walkthrough/serve-demo.sh bash -c 'node tools/walkthrough/record-app.mjs device && node tools/walkthrough/record-app.mjs desktop'
EXP=design/slides/export
for f in device desktop; do
  if [ "$f" = device ]; then W=1080 H=1920; else W=1920 H=1080; fi
  python3 tools/walkthrough/build.py "$OUT/secret-agent-club-$f-walkthrough.mp4" $W $H "$EXP/$f-s0.png" \
    "$OUT/slides/$f-s0" "$OUT/slides/$f-s1" "$OUT/$f-1" "$OUT/slides/$f-s2" "$OUT/$f-2"
done
