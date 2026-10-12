// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Records the app flows frame by frame, for the walkthrough videos.
//   node record-app.mjs device    1080x1920 (405x720 CSS pixels at 2.667x)
//   node record-app.mjs desktop   1920x1080
//   add 1 or 2 to record just that clip
// Clip 1: Solana Pay in USDC, then Share in PrivacySafe Chat and Storage.
// Clip 2: x402 in the app, AUDD: hold the wallet button to see Phantom and MetaMask, pay with Phantom.
// Needs tools/walkthrough/serve-demo.sh running (the stand-in Solana network and the app).

import fs from "node:fs";
import { chromium } from "playwright";
import * as kit from "@solana/kit";
import { createRecorderPage, Stepper } from "./stepper.mjs";

const fmt = process.argv[2] || "device";
const only = process.argv[3]; // "1" or "2" records just that clip
const desktop = fmt === "desktop";
const SIZE = desktop ? { width: 1920, height: 1080, scale: 1 } : { width: 405, height: 720, scale: 1080 / 405, mobile: true };
const APP = "http://localhost:3000/app/";
const chain = (p, b) => fetch("http://127.0.0.1:4021" + p, { method: "POST", body: JSON.stringify(b || {}) }).then((r) => r.json());
const brandIcon = (f) => "data:image/svg+xml;base64," + fs.readFileSync(new URL(`../../public/img/brands/${f}.svg`, import.meta.url)).toString("base64");

// A pointer for desktop, a touch dot for devices.
function pointer(desktop) {
  const add = () => {
    const c = document.createElement("div");
    c.innerHTML = desktop
      ? '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.6L16 20l-3 1.4-3.5-7.6L4 18z" fill="#FAF9F5" stroke="#0E0D0C" stroke-width="1.4" stroke-linejoin="round"/></svg>'
      : "";
    Object.assign(c.style, desktop
      ? { position: "fixed", left: "-60px", top: "-60px", width: "26px", height: "26px", zIndex: 2147483647, pointerEvents: "none" }
      : { position: "fixed", left: "-60px", top: "-60px", width: "34px", height: "34px", marginLeft: "-17px", marginTop: "-17px", borderRadius: "50%", background: "rgba(255,255,255,.28)", border: "2px solid rgba(255,255,255,.8)", zIndex: 2147483647, pointerEvents: "none", opacity: "0" });
    document.documentElement.append(c);
    addEventListener("mousemove", (e) => { c.style.left = (desktop ? e.clientX - 4 : e.clientX) + "px"; c.style.top = (desktop ? e.clientY - 2 : e.clientY) + "px"; c.style.opacity = "1"; }, true);
    addEventListener("mousedown", () => (c.style.transform = "scale(.8)"), true);
    addEventListener("mouseup", () => (c.style.transform = ""), true);
  };
  if (document.body) add(); else addEventListener("DOMContentLoaded", add);
}

async function walletScript(page) {
  const signer = await kit.generateKeyPairSigner();
  await page.exposeFunction("__solSign", async (arr) => {
    const tx = kit.getTransactionDecoder().decode(new Uint8Array(arr));
    const [s] = await signer.signTransactions([tx]);
    return Array.from(kit.getTransactionEncoder().encode({ ...tx, signatures: { ...tx.signatures, ...s } }));
  });
  // Two wallets on the device, so the chooser has something to show: Phantom and MetaMask.
  await page.addInitScript(({ addr, wallets }) => {
    for (const [name, icon] of wallets) {
      const account = { address: addr, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction"] };
      const wallet = {
        version: "1.0.0", name, icon, chains: ["solana:mainnet"], accounts: [],
        features: {
          "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signTransaction": {
            version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
            signTransaction: async (...ins) => {
              await new Promise((r) => setTimeout(r, 1300));
              return Promise.all(ins.map(async (i) => ({ signedTransaction: new Uint8Array(await window.__solSign(Array.from(i.transaction))) })));
            },
          },
        },
      };
      const cb = ({ register }) => register(wallet);
      addEventListener("wallet-standard:app-ready", (e) => cb(e.detail));
      try { dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: cb })); } catch {}
    }
  }, { addr: signer.address, wallets: [["Phantom", brandIcon("phantom")], ["MetaMask", brandIcon("metamask")]] });
}

async function open(b, dir, { wallet = false } = {}) {
  const { ctx, page } = await createRecorderPage(b, SIZE);
  await page.addInitScript(pointer, desktop);
  if (wallet) await walletScript(page);
  await page.goto(APP);
  await page.evaluate(() => document.fonts.ready);
  const s = new Stepper(page, dir);
  await s.start();
  return { ctx, page, s };
}

const visible = (sel) => !!document.querySelector(sel) && !document.querySelector(sel).closest("[hidden]");

const b = await chromium.launch({ args: ["--no-proxy-server"] });

// Clip 1: Solana Pay, USDC, then Chat and Storage.
if (!only || only === "1") {
  const { ctx, page, s } = await open(b, `build/walkthrough/${fmt}-1`);
  await s.until(visible, "#screen-signin:not([hidden])");
  await s.hold(900);
  await s.click("#identity", { after: 200 });
  await s.type("ciatoken@privacysafe.gg");
  await s.click("#signin-go");
  await s.until(visible, "#screen-club:not([hidden])");
  await s.hold(1500);
  if (!desktop) {
    await s.scroll("#club-scroll", 280, 900);
    await s.hold(700);
    await s.scroll("#club-scroll", 0, 700);
  }
  await s.click("#join");
  await s.until(() => document.getElementById("pay").open);
  await s.hold(1100);
  await s.click("#token-options label:nth-of-type(2)", { after: 700 });
  await s.click("#token-options label:nth-of-type(1)", { after: 500 });
  if (desktop) {
    await s.click("#qr-toggle", { after: 1600 });
  } else {
    await page.evaluate(() => document.getElementById("co-open").addEventListener("click", (e) => e.preventDefault(), { once: true }));
    await s.click("#co-open", { after: 600 });
  }
  const uri = await page.getAttribute("#co-open", "href");
  await chain("/mock/pay", { uri, finalized: false });
  await s.hold(4200);
  await chain("/mock/finalize");
  await s.until(visible, "#hero-player:not([hidden])", 30000);
  await s.hold(600);
  await page.evaluate(() => document.getElementById("player").play());
  await s.moveTo("#player", 700);
  await s.hold(4600);
  await s.click("#share-chat", { after: 2300 });
  await s.click("#link-close", { after: 600 });
  await s.click("#save-storage", { after: 2000 });
  await s.click("#link-copy", { after: 1800 });
  console.log(`${fmt}-1: ${s.frames} frames`);
  await ctx.close();
}

// Clip 2: x402 in the app, AUDD with Phantom.
if (!only || only === "2") {
  const { ctx, page, s } = await open(b, `build/walkthrough/${fmt}-2`, { wallet: true });
  await s.until(visible, "#screen-signin:not([hidden])");
  await s.hold(700);
  await s.click("#identity", { after: 200 });
  await s.type("listener@privacysafe.me", 45);
  await s.click("#signin-go");
  await s.until(visible, "#screen-club:not([hidden])");
  await s.hold(1100);
  await s.click("#join");
  await s.until(() => document.getElementById("pay").open);
  await s.hold(800);
  await s.click("#token-options label:nth-of-type(2)");
  await s.until(visible, "#x402-pay");
  await s.hold(1100);
  // Hold the wallet button to see every wallet on the device, then pay with Phantom.
  await s.longPress("#x402-pay", { after: 200 });
  await s.until(() => document.getElementById("wallet-sheet").open);
  await s.hold(2200);
  await s.click("#wallet-list li:nth-child(1) button", { after: 300 });
  await s.until(visible, "#hero-player:not([hidden])", 40000);
  await s.hold(600);
  await page.evaluate(() => document.getElementById("player").play());
  await s.hold(3400);
  console.log(`${fmt}-2: ${s.frames} frames`);
  await ctx.close();
}
await b.close();
