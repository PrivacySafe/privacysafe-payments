// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every page under its real Content Security Policy (meta tag and response header):
// nothing the page uses may be blocked, and the metrics script must be allowed.
// Needs serve-demo.sh.
import { chromium } from "playwright";

const b = await chromium.launch({ args: ["--no-proxy-server"] });
let bad = 0;
for (const [path, w, h] of [["/", 1440, 900], ["/", 390, 844], ["/app/", 390, 844], ["/app/", 1440, 900], ["/weblabels.html", 1280, 800]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const metrics = []; p.on("request", (r) => { if (r.url().startsWith("https://privacysafe.click/")) metrics.push(r.url()); });
  const res = await p.goto("http://localhost:3000" + path, { waitUntil: "networkidle" }).catch(() => null);
  if (path === "/app/") {
    // Sign in and open the payment sheet: QR code (data: image), token icons, wallet chooser.
    await p.fill("#identity", "alice@privacysafe.me"); await p.click("#signin-go");
    await p.waitForSelector("#join", { state: "visible", timeout: 8000 }).catch(() => {});
    await p.click("#join").catch(() => {}); await p.waitForTimeout(800);
  }
  const policies = await p.evaluate(() => [...document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')].length);
  const header = res ? res.headers()["content-security-policy"] || "" : "";
  const csp = await p.evaluate(() => window.__csp);
  const images = await p.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute("src")).map((i) => i.getAttribute("src").slice(0, 60)));
  const ok = !csp.length && !errs.length && !images.length && policies === 1 && header.includes("https://privacysafe.click") && metrics.length > 0;
  if (!ok) bad++;
  console.log(`${path} ${w}: meta policy ${policies} | header allows metrics ${header.includes("https://privacysafe.click")} | metrics script requested ${metrics.length > 0} | blocked ${JSON.stringify(csp)} | broken images ${JSON.stringify(images)} | errors ${JSON.stringify(errs)}`);
  await ctx.close();
}
await b.close();
console.log(bad ? `${bad} pages with policy problems` : "csp: nothing blocked on any page; metrics allowed");
