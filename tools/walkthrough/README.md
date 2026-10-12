# Walkthrough and test tools

None of this runs in production.

| File | What |
|---|---|
| `stepper.mjs` | Frame-stepped recorder. Time in the page is frozen and advanced exactly 1/30 s per frame (timers, animations, transitions and video playback), and every frame is captured at full resolution, so the result is a steady 30 fps at 1080p however slow the machine is. |
| `mock-solana.mjs` | Stand-in Solana RPC (with a 429 and a 500 endpoint to exercise failover) and a stand-in x402 facilitator that checks real signatures. |
| `serve-demo.sh COMMAND` | Starts the stand-in network and the app with test settings, runs `COMMAND`, stops both. |
| `record-slides.mjs` | Records `design/slides/slides.html` at 1080×1920 and 1920×1080; `stills` exports the lossless PNG stills. |
| `record-app.mjs device\|desktop [1\|2]` | Records the app flows: clip 1 is Solana Pay in USDC with Chat and Storage, clip 2 is x402 in AUDD with Phantom. |
| `build.py` | Encodes the frame folders to H.264 High profile, CRF 16, 30 fps, BT.709, joins them, and embeds the title slide as the thumbnail. Encoded parts are cached. |
| `make-videos.sh` | All of the above; writes both walkthroughs to `build/walkthrough/`. |
| `add-music.sh` | Adds the soundtracks and builds the combined walkthrough (see below). |

The music is added afterwards with `add-music.sh`, which also builds the combined video:

```
tools/walkthrough/add-music.sh build/walkthrough/secret-agent-club-desktop-walkthrough.mp4 \
  build/walkthrough/secret-agent-club-device-walkthrough.mp4 design/walkthrough-videos/
```

Desktop gets "Happy Adventure (Loop)" (looped to length) and device "Honey Bear", both by Tiny Worlds (CC0), at 65% volume with a 2 s fade in and 4 s fade out; the picture is copied, not re-encoded. The combined video is the device walkthrough centred on black at 1920×1080, fading to black over its last 3 s, then the desktop walkthrough fading in over 1.5 s, re-encoded at CRF 16.

Tests live in `tests/` and run with `npm test`: reference derivation, API abuse cases, the accessibility audit (45 states at five sizes) and the end-to-end flows at device and desktop size.
