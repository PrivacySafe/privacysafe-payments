// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Front page: axe WCAG 2.2 AA audit, overflow, text spacing, lightbox keyboard handling,
// and links to the app, source, deck and downloads. Needs serve-demo.sh. Screenshots go to build/shots.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const AXE = fs.readFileSync(fileURLToPath(import.meta.resolve("axe-core/axe.min.js")), "utf8");
fs.mkdirSync("build/shots", { recursive: true });
const b = await chromium.launch({ args: ["--no-proxy-server"] });
let bad = 0;
for (const [w, h] of [[320, 640], [390, 844], [820, 1180], [1440, 900], [1920, 1080]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, bypassCSP: true, deviceScaleFactor: w < 800 ? 2 : 1 });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("request", (r) => { if (!r.url().startsWith("http://localhost:3000") && !r.url().startsWith("https://privacysafe.click/")) errs.push("EXT " + r.url()); });
  await p.goto("http://localhost:3000/");
  await p.waitForLoadState("networkidle");
  await p.evaluate(async () => { for (const i of document.images) { i.loading = "eager"; await i.decode().catch(() => {}); } });
  await p.addScriptTag({ content: AXE });
  const v = await p.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } })).violations.map((x) => `${x.id}(${x.nodes.length}): ${x.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`));
  if (v.length) bad++;
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  await p.screenshot({ path: `build/shots/front-${w}.png`, fullPage: true });
  await p.addStyleTag({ content: "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }" });
  await p.waitForTimeout(200);
  const spacing = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const small = await p.evaluate(() => [...document.querySelectorAll("a, button, summary, video")].filter((e) => e.offsetParent && !e.closest(".fine, .lead, p")).map((e) => { const r = e.getBoundingClientRect(); return [e.textContent.trim().slice(0, 20) || e.getAttribute("aria-label") || e.tagName, Math.round(r.width), Math.round(r.height)]; }).filter(([, a, c]) => a > 0 && (a < 24 || c < 24)));
  console.log(w, "axe:", v.length ? v.join("; ") : 0, "| overflowX", overflow, "| with text spacing", spacing, "| small targets", JSON.stringify(small), "| errors", JSON.stringify(errs));
  await ctx.close();
}
// Lightbox and links.
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("http://localhost:3000/");
await p.focus(".photo-inset"); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
console.log("lightbox:", await p.evaluate(() => [document.querySelector(".lightbox")?.hidden === false, document.activeElement.className]));
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
console.log("after Escape focus:", await p.evaluate(() => document.activeElement.className));
const links = await p.$$eval("a[href^='/']", (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
for (const l of links) { const r = await fetch("http://localhost:3000" + l, { method: "HEAD", redirect: "manual" }); console.log("link", l, r.status); }
const vids = await p.$$eval("video source", (s) => s.map((x) => x.getAttribute("src")));
for (const v of vids) { const r = await fetch("http://localhost:3000" + v, { headers: { Range: "bytes=0-99" } }); console.log("video", v, r.status, r.headers.get("content-type"), r.headers.get("content-range")); }
await b.close();
console.log(bad ? `${bad} sizes with violations` : "front page: 0 violations at all sizes");
