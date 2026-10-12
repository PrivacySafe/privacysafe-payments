// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// In-app wallet button: "(detected)" labels, long press and arrow open the chooser,
// paying with a second wallet. Needs tools/walkthrough/serve-demo.sh running.

import fs from "node:fs";
import { chromium } from "playwright";
import * as kit from "@solana/kit";

const icon = (f) => "data:image/svg+xml;base64," + fs.readFileSync(new URL(`../public/img/brands/${f}.svg`, import.meta.url)).toString("base64");
fs.mkdirSync("build/shots", { recursive: true });

async function page(b, names, w = 405, h = 720) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 640, hasTouch: w < 640 });
  const p = await ctx.newPage();
  const signer = await kit.generateKeyPairSigner();
  await p.exposeFunction("__solSign", async (arr) => {
    const tx = kit.getTransactionDecoder().decode(new Uint8Array(arr));
    const [s] = await signer.signTransactions([tx]);
    return Array.from(kit.getTransactionEncoder().encode({ ...tx, signatures: { ...tx.signatures, ...s } }));
  });
  await p.addInitScript(({ addr, list }) => {
    for (const { name, icon } of list) {
      const account = { address: addr, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction"] };
      const wallet = { version: "1.0.0", name, icon, chains: ["solana:mainnet"], accounts: [], features: {
        "standard:connect": { version: "1.0.0", connect: async () => { window.__usedWallet = name; return { accounts: [account] }; } },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: async (...ins) => Promise.all(ins.map(async (i) => ({ signedTransaction: new Uint8Array(await window.__solSign(Array.from(i.transaction))) }))) } } };
      const cb = ({ register }) => register(wallet);
      addEventListener("wallet-standard:app-ready", (e) => cb(e.detail));
      try { dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: cb })); } catch {}
    }
  }, { addr: signer.address, list: names.map((n) => ({ name: n, icon: icon(n.toLowerCase()) })) });
  await p.goto("http://localhost:3000/app/");
  await p.waitForSelector("#screen-signin:not([hidden])");
  await p.fill("#identity", `w${Date.now() % 100000}@privacysafe.me`);
  await p.click("#signin-go");
  await p.waitForSelector("#screen-club:not([hidden])");
  await p.click("#join");
  await p.waitForSelector("#pay[open]");
  await p.click("#token-options label:nth-of-type(2)");
  await p.waitForTimeout(400);
  return { ctx, p };
}

const b = await chromium.launch({ args: ["--no-proxy-server"] });

{ // No wallet: no in-app button.
  const { ctx, p } = await page(b, []);
  console.log("no wallet, x402 shown:", await p.isVisible("#co-x402"));
  await ctx.close();
}
{ // Phantom and MetaMask: default Phantom, long press opens chooser, pay with MetaMask.
  const { ctx, p } = await page(b, ["MetaMask", "Phantom"]);
  console.log("button:", (await p.textContent("#x402-pay")).trim());
  await p.screenshot({ path: "build/shots/wallets-1-button.png" });
  const box = await p.locator("#x402-pay").boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down(); await p.waitForTimeout(800); await p.mouse.up();
  await p.waitForSelector("#wallet-sheet[open]");
  await p.waitForTimeout(400);
  console.log("chooser rows:", await p.$$eval("#wallet-list .wallet-row", (r) => r.map((x) => x.innerText.replace(/\s+/g, " ").trim())));
  console.log("long press did not pay:", !(await p.evaluate(() => window.__usedWallet)));
  await p.screenshot({ path: "build/shots/wallets-2-chooser.png" });
  await p.goBack(); await p.waitForTimeout(300);
  console.log("back closes chooser:", !(await p.evaluate(() => document.getElementById("wallet-sheet").open)), "| pay sheet still open:", await p.evaluate(() => document.getElementById("pay").open));
  await p.click("#x402-more"); await p.waitForSelector("#wallet-sheet[open]");
  await p.click("#wallet-list li:nth-child(1) .wallet-row");
  await p.waitForSelector("#hero-player:not([hidden])", { timeout: 30000 });
  console.log("paid with:", await p.evaluate(() => window.__usedWallet));
  await ctx.close();
}
{ // Only MetaMask: the button names it.
  const { ctx, p } = await page(b, ["MetaMask"], 1440, 900);
  console.log("metamask only, button:", (await p.textContent("#x402-pay")).trim());
  await p.screenshot({ path: "build/shots/wallets-3-desktop.png" });
  await ctx.close();
}
await b.close();
