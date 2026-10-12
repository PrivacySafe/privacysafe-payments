// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// End-to-end flows: node tests/flows.mjs WIDTH HEIGHT TAG [x402]. Needs serve-demo.sh. Screenshots go to build/shots.

import fs from "node:fs";
import { chromium } from "playwright";
import * as kit from "@solana/kit";
const chain = (p, b) => fetch("http://127.0.0.1:4021" + p, { method: "POST", body: JSON.stringify(b || {}) }).then((r) => r.json());
fs.mkdirSync("build/shots", { recursive: true });
const [W, H, tag, mode] = [+process.argv[2], +process.argv[3], process.argv[4], process.argv[5] || "solpay"];
// BASE lets the same flows run through a reverse proxy, e.g. BASE=https://payments.privacysafe.app
// with RESOLVE=127.0.0.1 to point that hostname at this machine.
const BASE = process.env.BASE || "http://localhost:3000";
const resolveArgs = process.env.RESOLVE ? [`--host-resolver-rules=MAP ${new URL(BASE).hostname} ${process.env.RESOLVE}`] : [];
const b = await chromium.launch({ args: ["--no-proxy-server", ...resolveArgs] });
const mobile = W < 640;
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, ignoreHTTPSErrors: !!process.env.RESOLVE });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/verify") && !(r.status() === 402 && r.url().endsWith("/api/unlock"))) errs.push(r.status() + " " + r.url()); }); p.on("request", (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith("data:") && !r.url().startsWith("https://privacysafe.click/")) errs.push("EXT " + r.url()); });
// Content Security Policy: any blocked resource is an error (the page runs under its real policy here).
await ctx.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
if (mode === "x402") {
  const signer = await kit.generateKeyPairSigner();
  await p.exposeFunction("__solSign", async (arr) => { const tx = kit.getTransactionDecoder().decode(new Uint8Array(arr)); const [s] = await signer.signTransactions([tx]); return Array.from(kit.getTransactionEncoder().encode({ ...tx, signatures: { ...tx.signatures, ...s } })); });
  const icon = "data:image/svg+xml;base64," + fs.readFileSync(new URL("../public/img/brands/phantom.svg", import.meta.url)).toString("base64");
  await p.addInitScript(({ addr, icon }) => { const account = { address: addr, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction"] }; const wallet = { version: "1.0.0", name: "Phantom", icon, chains: ["solana:mainnet"], accounts: [], features: { "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) }, "standard:events": { version: "1.0.0", on: () => () => {} }, "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: async (...ins) => { await new Promise((r) => setTimeout(r, 600)); return Promise.all(ins.map(async (i) => ({ signedTransaction: new Uint8Array(await window.__solSign(Array.from(i.transaction))) }))); } } } }; const cb = ({ register }) => register(wallet); addEventListener("wallet-standard:app-ready", (e) => cb(e.detail)); try { dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: cb })); } catch {} }, { addr: signer.address, icon });
}
const shot = (n) => p.screenshot({ path: `build/shots/${tag}-${n}.png` });
await p.goto(BASE + "/app/"); await p.waitForTimeout(250); await shot("0-splash");
await p.waitForSelector("#screen-signin:not([hidden])"); await p.waitForTimeout(400); await shot("1-signin");
await p.click("#signin-go"); console.log("empty signin:", await p.textContent("#signin-status"));
await p.fill("#identity", mode === "x402" ? "listener@privacysafe.me" : "ciatoken@privacysafe.gg"); await p.click("#signin-go");
await p.waitForSelector("#screen-club:not([hidden])"); await p.waitForTimeout(500); await shot("2-club");
await p.evaluate(() => document.getElementById("club-scroll").scrollTo(0, 400)); await p.waitForTimeout(400); await shot("3-club-scrolled");
await p.evaluate(() => document.getElementById("club-scroll").scrollTo(0, 0));
await p.click("#join"); await p.waitForSelector("#pay[open]"); await p.waitForTimeout(500);
if (mode === "x402") { await p.click("#token-options label:nth-of-type(2)"); await p.waitForTimeout(300); }
await shot("4-checkout");
await p.goBack(); await p.waitForTimeout(300); console.log("hardware back closes sheet:", !(await p.evaluate(() => document.getElementById("pay").open)));
await p.click("#join"); await p.waitForSelector("#pay[open]"); await p.waitForTimeout(300);
if (mode === "x402") { await p.click("#token-options label:nth-of-type(2)"); await p.waitForSelector("#co-x402:not([hidden]) button"); await p.click("#co-x402 button"); await p.waitForTimeout(900); await shot("5-waiting"); }
else {
  await p.evaluate(() => document.getElementById("co-open").addEventListener("click", (e) => e.preventDefault(), { once: true }));
  const uri = await p.getAttribute("#co-open", "href"); await p.click("#co-open"); await p.waitForTimeout(500);
  await chain("/mock/pay", { uri, finalized: false }); await p.waitForTimeout(5800); await shot("5-waiting");
  await chain("/mock/finalize");
}
await p.waitForFunction(() => document.getElementById("ring").dataset.state === "done", null, { timeout: 30000 }); await p.waitForTimeout(700); await shot("6-done");
await p.waitForSelector("#hero-player:not([hidden])", { timeout: 10000 }); await p.waitForTimeout(500);
await p.evaluate(() => { const v = document.getElementById("player"); v.muted = true; v.currentTime = 4; }); await p.waitForTimeout(700);
console.log("member focus:", await p.evaluate(() => document.activeElement.id)); await shot("7-member");
await p.click("#share-chat"); await p.waitForSelector("#link-sheet[open]"); await p.waitForTimeout(450); await shot("8-chat");
console.log("chat url:", await p.textContent("#link-url"));
await p.goBack(); await p.waitForTimeout(300);
await p.click("#save-storage"); await p.waitForSelector("#link-sheet[open]"); await p.waitForTimeout(450); await shot("9-storage");
await p.click("#link-copy"); await p.waitForTimeout(300); console.log("toast:", await p.textContent("#toast"));
await p.click("#about-open"); await p.waitForTimeout(450); await shot("10-about"); await p.keyboard.press("Escape");
await p.reload(); await p.waitForSelector("#hero-player:not([hidden])", { timeout: 8000 }); console.log("reload: still member");
const csp = await p.evaluate(() => window.__csp || []); if (csp.length) errs.push(...csp.map((c) => "CSP " + c));
console.log("errors:", errs, "overflowX:", await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
await b.close();
