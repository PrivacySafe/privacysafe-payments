// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Frame-stepped recording at a steady 30 fps and full device-pixel resolution.
//
// A real-time recorder on a slow machine drops frames and is capped at CSS-pixel size.
// Instead, time inside the page is frozen and advanced one frame at a time:
//   - timers, Date, performance.now and requestAnimationFrame run on Playwright's clock;
//   - every CSS animation and transition is paused and set to the frame's time;
//   - a playing <video> is held paused and seeked to the frame's time;
// and each frame is saved as a high-quality JPEG. Network calls to the app still run in
// real time between frames. Pages must be created with createRecorderPage().

import fs from "node:fs";
import path from "node:path";

const T0 = new Date("2026-10-11T10:00:00Z");

function controlScript() {
  const vt = { now: 0, anims: new WeakMap() };
  window.__vt = vt;
  const realPause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.play = function () {
    if (!this.__vplaying) {
      this.__vplaying = true;
      this.__vbase = this.currentTime;
      this.__vstart = vt.now;
      this.dispatchEvent(new Event("play"));
      this.dispatchEvent(new Event("playing"));
    }
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {
    this.__vplaying = false;
    realPause.call(this);
    this.dispatchEvent(new Event("pause"));
  };
  window.__vtSync = async (now) => {
    vt.now = now;
    for (const a of document.getAnimations()) {
      let start = vt.anims.get(a);
      if (start === undefined) {
        start = now - (a.currentTime || 0);
        vt.anims.set(a, start);
      }
      a.pause();
      a.currentTime = Math.max(0, now - start);
    }
    const seeks = [];
    for (const v of document.querySelectorAll("video")) {
      if (!v.__vplaying || !(v.duration > 0)) continue;
      const t = Math.min(v.__vbase + (now - v.__vstart) / 1000, v.duration - 0.01);
      if (Math.abs(v.currentTime - t) < 0.0005) continue;
      // Page timers are frozen, so only the seek event is awaited here; the recorder
      // puts a real-time limit around the whole sync.
      seeks.push(new Promise((resolve) => {
        v.addEventListener("seeked", () => resolve(), { once: true });
        v.currentTime = t;
      }));
    }
    await Promise.all(seeks);
  };
}

// The page renders at CSS size; each frame is captured re-rasterized at `scale`, which is
// as sharp as a native high-density render and several times faster to capture.
export async function createRecorderPage(browser, { width, height, scale = 1, mobile = false, ...extra } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, colorScheme: "dark", ...extra });
  const page = await ctx.newPage();
  page.__capture = { width, height, scale };
  await page.clock.install({ time: T0 });
  await page.addInitScript(controlScript);
  return { ctx, page };
}

export class Stepper {
  constructor(page, dir, { fps = 30, quality = 92 } = {}) {
    this.page = page;
    this.dir = dir;
    this.fps = fps;
    this.quality = quality;
    this.step = 1000 / fps;
    this.now = 0;
    this.n = 0;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  async start() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    await this.page.clock.pauseAt(new Date(T0.getTime() + 5 * 60_000));
  }
  async frame() {
    await this.page.clock.runFor(this.step);
    this.now += this.step;
    await Promise.race([
      this.page.evaluate((n) => window.__vtSync?.(n), this.now),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    const { width, height, scale } = this.page.__capture;
    const { data } = await this.cdp.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: this.quality,
      clip: { x: 0, y: 0, width, height, scale },
    });
    fs.writeFileSync(path.join(this.dir, `${String(this.n++).padStart(6, "0")}.jpg`), Buffer.from(data, "base64"));
  }
  async hold(ms) {
    for (let i = 0, k = Math.round(ms / this.step); i < k; i++) await this.frame();
  }
  async until(fn, arg, maxMs = 30000) {
    for (let t = 0; t < maxMs; t += this.step) {
      if (await this.page.evaluate(fn, arg)) return;
      await this.frame();
    }
    throw new Error("until: timed out");
  }
  async moveTo(sel, ms = 600) {
    const box = await this.page.locator(sel).first().boundingBox();
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const from = this.mouse || { x: to.x, y: to.y + 120 };
    const k = Math.max(1, Math.round(ms / this.step));
    for (let i = 1; i <= k; i++) {
      const e = 0.5 - Math.cos((Math.PI * i) / k) / 2;
      this.mouse = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      await this.page.mouse.move(this.mouse.x, this.mouse.y);
      await this.frame();
    }
  }
  async click(sel, { move = 600, after = 300 } = {}) {
    await this.moveTo(sel, move);
    await this.hold(120);
    await this.page.mouse.down();
    await this.frame();
    await this.frame();
    await this.page.mouse.up();
    await this.hold(after);
  }
  async longPress(sel, { move = 600, hold = 800, after = 300 } = {}) {
    await this.moveTo(sel, move);
    await this.hold(120);
    await this.page.mouse.down();
    await this.hold(hold);
    await this.page.mouse.up();
    await this.hold(after);
  }
  async type(text, perChar = 55) {
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      await this.hold(perChar);
    }
  }
  async scroll(sel, top, ms = 700) {
    const startTop = await this.page.$eval(sel, (e) => e.scrollTop);
    const k = Math.max(1, Math.round(ms / this.step));
    for (let i = 1; i <= k; i++) {
      const e = 0.5 - Math.cos((Math.PI * i) / k) / 2;
      await this.page.$eval(sel, (el, y) => (el.scrollTop = y), startTop + (top - startTop) * e);
      await this.frame();
    }
  }
  get frames() {
    return this.n;
  }
}
