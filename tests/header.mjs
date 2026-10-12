// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Front page header: what shows at each width, keyboard order, the menu and both Share
// controls (open, Escape, outside click), with an axe audit of each open state.
// Needs serve-demo.sh. Screenshots go to build/shots.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const AXE = fs.readFileSync(fileURLToPath(import.meta.resolve("axe-core/axe.min.js")), "utf8");
fs.mkdirSync("build/shots", { recursive: true });
const b = await chromium.launch({ args: ["--no-proxy-server"] });
const vis = (p) => p.evaluate(() => {
  const on = (sel) => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== "none" && !e.closest("[hidden]") && r.width > 0; };
  return { links: on(".navlinks"), social: on(".top-social"), share: on(".share-top"), try: on(".top-try"), menu: on("details.menu") };
});
const axe = async (p) => { await p.addScriptTag({ content: AXE }); return p.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } })).violations.map((v) => `${v.id}(${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`)); };
let bad = 0;
for (const [w, h] of [[320, 640], [390, 844], [600, 900], [820, 1180], [1100, 800], [1440, 900]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, bypassCSP: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto("http://localhost:3000/");
  const v = await vis(p);
  const fits = await p.evaluate(() => { const n = document.querySelector(".nav").getBoundingClientRect(); return [...document.querySelectorAll(".nav > *")].every((e) => { const r = e.getBoundingClientRect(); return r.width === 0 || (r.right <= n.right + 1 && r.top < n.top + 80); }); });
  const barH = Math.round(await p.evaluate(() => document.querySelector(".topbar").getBoundingClientRect().height));
  await p.locator(".topbar").screenshot({ path: `build/shots/header-${w}.png` });
  let menuInfo = "";
  if (v.menu) {
    await p.focus(".menu-toggle"); await p.keyboard.press("Enter"); await p.waitForTimeout(150);
    menuInfo = await p.evaluate(() => [...document.querySelectorAll(".menu-panel a")].filter((a) => a.offsetParent).map((a) => a.textContent.replace("(opens in a new tab)", "").trim()).join(", "));
    await p.screenshot({ path: `build/shots/header-${w}-menu.png` });
    const va = await axe(p); if (va.length) { bad++; console.log(w, "menu axe:", va); }
    await p.keyboard.press("Escape"); await p.waitForTimeout(100);
    const closed = await p.evaluate(() => [!document.querySelector("details.menu").open, document.activeElement.className]);
    menuInfo += ` | Escape closes: ${closed[0]}, focus: ${closed[1]}`;
  }
  await p.click(".share-top .share-toggle"); await p.waitForTimeout(150);
  const shareOpen = await p.isVisible("#share-menu-top");
  const inView = await p.evaluate(() => { const r = document.getElementById("share-menu-top").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
  await p.screenshot({ path: `build/shots/header-${w}-share.png` });
  const vs = await axe(p); if (vs.length) { bad++; console.log(w, "share axe:", vs); }
  await p.mouse.click(5, h - 5); await p.waitForTimeout(100);
  const outsideClosed = !(await p.isVisible("#share-menu-top"));
  console.log(`${w}: ${JSON.stringify(v)} fits=${fits} bar=${barH}px | share open=${shareOpen} inViewport=${inView} outsideClickCloses=${outsideClosed}${menuInfo ? " | menu: " + menuInfo : ""}`);
  await ctx.close();
}
// keyboard order at desktop
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("http://localhost:3000/");
const order = [];
for (let i = 0; i < 11; i++) { await p.keyboard.press("Tab"); order.push(await p.evaluate(() => { const e = document.activeElement; return (e.getAttribute("aria-label") || e.textContent).replace("(opens in a new tab)", "").trim().replace(/\s+/g, " ").slice(0, 34); })); }
console.log("tab order:", order.join(" > "));
await b.close();
console.log(bad ? `${bad} open states with violations` : "header: 0 violations in open states");
