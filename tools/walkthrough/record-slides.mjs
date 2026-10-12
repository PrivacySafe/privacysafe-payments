// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Records design/slides/slides.html frame by frame at 1080x1920 (device) and 1920x1080
// (desktop), and exports full-resolution stills to design/slides/export.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createRecorderPage, Stepper } from "./stepper.mjs";

const SRC = new URL("../../design/slides/slides.html", import.meta.url).href;
const OUT = fileURLToPath(new URL("../../design/slides/export", import.meta.url));
// "stills" exports lossless PNG stills only; "device" or "desktop" records one size.
const only = process.argv[2];
const stills = only === "stills";
const SIZES = [
  ["device", 405, 720, 1080 / 405],
  ["desktop", 1920, 1080, 1],
];
const b = await chromium.launch({ args: ["--allow-file-access-from-files"] });
for (const [fmt, w, h, scale] of SIZES) {
  if (only && !stills && only !== fmt) continue;
  for (const [id, ms] of [["s0", 3400], ["s1", 3200], ["s2", 3200]]) {
    const { ctx, page } = await createRecorderPage(b, { width: w, height: h, scale });
    await page.goto(`${SRC}?hold#${id}`);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    });
    if (stills) {
      await page.evaluate(() => document.body.classList.remove("hold"));
      await page.clock.runFor(4000);
      await page.waitForTimeout(3500);
      const cdp = await ctx.newCDPSession(page);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: w, height: h, scale } });
      fs.writeFileSync(`${OUT}/${fmt}-${id}.png`, Buffer.from(data, "base64"));
      console.log(`${fmt}-${id}.png`);
    } else {
      const s = new Stepper(page, `build/walkthrough/slides/${fmt}-${id}`);
      await s.start();
      await page.evaluate(() => document.body.classList.remove("hold"));
      await s.hold(ms);
      console.log(`${fmt}-${id}: ${s.frames} frames`);
    }
    await ctx.close();
  }
}
await b.close();
