// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// axe-core WCAG 2.2 AA audit of every screen and sheet at five sizes. Needs serve-demo.sh.

import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { chromium } from "playwright";
const AXE = fs.readFileSync(fileURLToPath(import.meta.resolve("axe-core/axe.min.js")), "utf8");
const chain = (p, b) => fetch("http://127.0.0.1:4021" + p, { method: "POST", body: JSON.stringify(b || {}) }).then((r) => r.json());
const b = await chromium.launch({ args: ["--no-proxy-server"] });
let bad = 0;
async function audit(p, label) {
  await p.addScriptTag({ content: AXE });
  const r = await p.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } })).violations.map((v) => `${v.id}(${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`));
  if (r.length) { bad++; console.log(`${label}: ${r.join("; ")}`); }
}
for (const [w, h] of [[390, 844], [320, 640], [820, 1180], [1440, 900], [1920, 1080]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, bypassCSP: true }); const p = await ctx.newPage();
  await p.goto("http://localhost:3000/app/"); await p.waitForSelector("#screen-signin:not([hidden])"); await audit(p, `${w} signin`);
  await p.click("#signin-go"); await audit(p, `${w} signin error`);
  await p.fill("#identity", "a11y@privacysafe.me"); await p.click("#signin-go"); await p.waitForSelector("#screen-club:not([hidden])"); await p.waitForTimeout(450); await audit(p, `${w} club`);
  await p.click("#me-btn"); await p.waitForTimeout(450); await audit(p, `${w} account sheet`); await p.keyboard.press("Escape");
  await p.click("#about-open"); await p.waitForTimeout(450); await audit(p, `${w} about sheet`); await p.keyboard.press("Escape");
  await p.click("#join"); await p.waitForSelector("#pay[open]"); await p.click("#qr-toggle"); await p.waitForTimeout(450); await audit(p, `${w} checkout sheet`);
  await p.evaluate(() => document.getElementById("co-open").addEventListener("click", (e) => e.preventDefault(), { once: true }));
  const uri = await p.getAttribute("#co-open", "href"); await p.click("#co-open"); await p.waitForTimeout(400); await audit(p, `${w} waiting`);
  await chain("/mock/pay", { uri }); await p.waitForSelector("#hero-player:not([hidden])", { timeout: 25000 }); await p.waitForTimeout(300); await audit(p, `${w} member`);
  await p.click("#save-storage"); await p.waitForSelector("#link-sheet[open]"); await p.waitForTimeout(450); await audit(p, `${w} storage sheet`);
  await ctx.close();
}
console.log(bad ? `${bad} states with violations` : "0 violations in all 45 states");
await b.close();
