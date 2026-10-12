// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import QRCode from "qrcode";
import { getWallets } from "@wallet-standard/app";
import { deriveReference, isIdentity, newNonce, normalizeIdentity, solanaPayUri } from "../lib/reference.js";

const $ = (id) => document.getElementById(id);
const PENDING_KEY = "psafe.pending.v1";
const CLAIMS_KEY = "psafe.x402claims.v1";
const IDENTITY_KEY = "psafe.identity.v1";
const POLL_MS = 5000;

let offer;
let me = "";
let selected;
let current;
let timer;
let toastTimer;
let member = false;
const wallets = new Map();
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function listStore(key) {
  return {
    read() {
      try {
        return JSON.parse(localStorage.getItem(key)) || [];
      } catch {
        return [];
      }
    },
    write(list) {
      try {
        localStorage.setItem(key, JSON.stringify(list));
      } catch {}
    },
  };
}
const pending = listStore(PENDING_KEY);
const claims = listStore(CLAIMS_KEY);

const asset = (mint) => offer.accepts.find((a) => a.mint === mint);
const label = (a) => `${a.amount} ${a.symbol}`;
const fmtTime = (ms) => new Date(ms).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

function mark(key, size) {
  const src = offer.brands?.[key];
  if (!src) return null;
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.width = size;
  img.height = size;
  img.className = "ps-mark";
  return img;
}

function say(el, text, tone = "") {
  el.textContent = text;
  el.dataset.tone = tone;
}

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.dataset.show = "true";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.dataset.show = "false"), 2400);
}

// ---------- screens and the Android back button ----------
// Every sheet opened pushes a history entry, so the hardware back button closes it.

function show(screen) {
  $("app").dataset.screen = screen;
  for (const s of ["signin", "club"]) $(`screen-${s}`).hidden = s !== screen;
}

const openSheets = [];
function openSheet(id) {
  const d = $(id);
  if (d.open) return;
  d.dataset.opener = document.activeElement?.id || "";
  d.showModal();
  openSheets.push(id);
  history.pushState({ sheet: id }, "");
}
function closeSheet(id, { fromHistory = false } = {}) {
  const d = $(id);
  if (!d.open) return;
  d.close();
  const i = openSheets.lastIndexOf(id);
  if (i >= 0) openSheets.splice(i, 1);
  if (!fromHistory && history.state?.sheet === id) {
    ignorePops++;
    history.back();
  }
  const opener = d.dataset.opener && $(d.dataset.opener);
  if (opener && !opener.closest("[hidden]")) opener.focus();
}
let ignorePops = 0;
addEventListener("popstate", () => {
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  const top = openSheets[openSheets.length - 1];
  if (top) closeSheet(top, { fromHistory: true });
});
function wireSheet(id, closeBtn) {
  const d = $(id);
  d.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeSheet(id);
  });
  d.addEventListener("click", (e) => {
    if (e.target === d) closeSheet(id);
  });
  if (closeBtn) $(closeBtn).addEventListener("click", () => closeSheet(id));
}

// ---------- sign in ----------

function setMe(addr) {
  me = addr;
  const name = addr.split("@")[0];
  $("me-initials").textContent = name.slice(0, 2).toUpperCase();
  $("me-label").textContent = `Account: ${addr}`;
  $("me-address").textContent = addr;
  $("sum-from").textContent = addr;
}

function signIn() {
  const field = $("identity");
  const addr = normalizeIdentity(field.value);
  if (!isIdentity(addr)) {
    say($("signin-status"), "Enter your PrivacySafe address, like you@privacysafe.me.", "error");
    field.setAttribute("aria-invalid", "true");
    field.focus();
    return;
  }
  field.removeAttribute("aria-invalid");
  say($("signin-status"), "");
  try {
    localStorage.setItem(IDENTITY_KEY, addr);
  } catch {}
  setMe(addr);
  enterClub();
}

function enterClub() {
  show("club");
  renderResume();
  $("club-title").focus({ preventScroll: true });
}

// ---------- club ----------

function renderCta() {
  $("cta-price").replaceChildren(...[mark(selected.symbol.toLowerCase(), 22), label(selected)].filter(Boolean));
}

function renderResume() {
  const list = pending.read().filter((p) => p.identity === me);
  const open = claims.read().filter((c) => c.identity === me);
  $("resume").hidden = member || (list.length === 0 && open.length === 0);
  if (!$("resume").hidden) {
    const p = list[list.length - 1];
    $("resume-text").textContent = p ? `Your ${label(asset(p.mint))} payment is waiting to be matched.` : "Your in-app payment is finishing.";
  }
}

function watchScroll() {
  const sc = $("club-scroll");
  const bar = document.querySelector(".topbar");
  const wide = matchMedia("(min-width: 1024px)");
  const set = () => (bar.dataset.solid = String(sc.scrollTop > 40 || member || wide.matches));
  wide.addEventListener("change", set);
  sc.addEventListener("scroll", set, { passive: true });
  set();
}

// ---------- checkout sheet ----------

function renderPicker() {
  const box = $("token-options");
  box.replaceChildren();
  for (const a of offer.accepts) {
    const lab = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "token";
    input.value = a.mint;
    input.checked = a === selected;
    const span = document.createElement("span");
    const m = mark(a.symbol.toLowerCase(), 20);
    if (m) span.append(m);
    span.append(a.symbol);
    lab.append(input, span);
    box.append(lab);
  }
  $("token-picker").hidden = offer.accepts.length < 2;
}

async function prepareCheckout() {
  const a = selected;
  const p = { offerId: offer.offerId, mint: a.mint, nonce: newNonce(), identity: me, created: Date.now() };
  const reference = await deriveReference(p);
  const uri = solanaPayUri({ payTo: offer.payTo, amount: a.amount, mint: a.mint, reference, label: offer.title, message: `Join ${offer.title}` });
  current = { ...p, uri };
  $("sum-amount").replaceChildren(...[mark(a.symbol.toLowerCase(), 20), label(a)].filter(Boolean));
  $("sum-net").replaceChildren(...[mark("solana", 18), "Solana"].filter(Boolean));
  $("co-open").href = uri;
  $("wait-open").href = uri;
  $("rails-note").textContent = offer.x402?.includes(a.mint) ? "Solana Pay or x402 · no custody" : "Solana Pay · no custody";
  const svg = await QRCode.toString(uri, { type: "svg", errorCorrectionLevel: "M", margin: 4, color: { dark: "#0E0D0C", light: "#FAF9F5" } });
  const img = document.createElement("img");
  img.alt = `QR code: pay ${label(a)} with Solana Pay`;
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  $("co-qr").replaceChildren(img);
  renderX402();
}

function setStep(step) {
  const order = ["sent", "final", "open"];
  const at = order.indexOf(step);
  for (const li of $("steps").children) {
    const i = order.indexOf(li.dataset.step);
    li.dataset.state = i < at ? "done" : i === at ? "active" : "";
  }
}

function showWait() {
  $("pay-choose").hidden = true;
  $("pay-wait").hidden = false;
  $("wait-close").hidden = false;
  $("ring").dataset.state = "";
  setStep("sent");
  $("wait-title").textContent = "Waiting for payment";
  $("wait-title").focus({ preventScroll: true });
}

function showChoose() {
  $("pay-choose").hidden = false;
  $("pay-wait").hidden = true;
}

async function openCheckout() {
  showChoose();
  renderPicker();
  $("qr").hidden = true;
  $("qr-toggle").setAttribute("aria-expanded", "false");
  await prepareCheckout();
  openSheet("pay");
  $("pay-title").focus({ preventScroll: true });
}

function rememberPending() {
  const { uri, ...p } = current;
  pending.write([...pending.read().filter((x) => x.nonce !== p.nonce), p]);
}

function startWaiting() {
  rememberPending();
  showWait();
  $("wait-open").hidden = false;
  say($("pay-status"), "Approve the payment in your wallet, then come back here.");
  schedule(POLL_MS);
}

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(check, ms);
}

const PROBLEMS = {
  wrong_amount: "A payment with this reference arrived, but not for the right amount.",
  wrong_asset: "A payment with this reference arrived in a different token.",
  wrong_destination_or_asset: "A payment with this reference went to a different account or in a different token.",
  already_claimed: "That transaction was already used for another membership.",
};

function fail(text) {
  $("ring").dataset.state = "error";
  $("wait-title").textContent = "Payment not accepted";
  say($("pay-status"), text, "error");
}

async function check() {
  if (!current) return;
  const viaClaim = Boolean(current.claim);
  let res;
  try {
    res = await fetch(viaClaim ? "/api/claim" : "/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(viaClaim ? { claim: current.claim } : { identity: current.identity, offerId: current.offerId, mint: current.mint, nonce: current.nonce }),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    say($("pay-status"), "Can't reach the server. Still waiting; this will retry.", "error");
    return schedule(POLL_MS * 2);
  }
  const body = await res.json().catch(() => ({}));
  if (body.state === "admitted") {
    pending.write(pending.read().filter((x) => x.nonce !== current.nonce));
    if (current.claim) claims.write(claims.read().filter((c) => c.claim !== current.claim));
    return success(body.expires, body.signature);
  }
  if (res.status === 400) {
    if (viaClaim) claims.write(claims.read().filter((c) => c.claim !== current.claim));
    return fail(body.reason === "already_claimed" ? "That payment was already used for another membership." : "This payment couldn't be matched to this club. Contact the host.");
  }
  if (res.status === 429) return schedule(2500);
  const problem = body.problems?.find((p) => PROBLEMS[p]);
  if (problem) return fail(`${PROBLEMS[problem]} No access was granted. Contact the host.`);
  if (body.reason === "rpc_unavailable") say($("pay-status"), "The Solana network can't be reached right now. Your payment stays pending.", "error");
  else if (body.reason === "not_settled") say($("pay-status"), "Settling your payment…");
  else if (viaClaim) say($("pay-status"), "Paid. Waiting for the payment to be final on Solana.");
  else say($("pay-status"), "Waiting for your payment to arrive and be final on Solana. You can close this; it's saved on this device.");
  schedule(POLL_MS);
}

async function success(expires, signature) {
  clearTimeout(timer);
  current = null;
  setStep("open");
  for (const li of $("steps").children) li.dataset.state = "done";
  $("ring").dataset.state = "done";
  $("wait-open").hidden = true;
  $("wait-close").hidden = true;
  $("wait-title").textContent = "You're in";
  say($("pay-status"), "Payment confirmed. Opening the episode.", "ok");
  await new Promise((r) => setTimeout(r, reduceMotion ? 300 : 1300));
  if ($("pay").open) closeSheet("pay");
  becomeMember(expires, signature, true);
}

// ---------- x402 in the app ----------

function discoverWallets() {
  const { get, on } = getWallets();
  const add = (list) => {
    for (const w of list) {
      if (w.features["standard:connect"] && w.features["solana:signTransaction"] && w.chains.some((c) => c.startsWith("solana:"))) wallets.set(w.name, w);
    }
    renderX402();
  };
  add(get());
  on("register", (...list) => add(list));
}

// Wallets this app knows how to show, in order of preference for the default button.
const KNOWN_WALLETS = [
  ["phantom", "Phantom"],
  ["metamask", "MetaMask"],
  ["solflare", "Solflare"],
  ["backpack", "Backpack"],
];
const walletKey = (name) => KNOWN_WALLETS.find(([k]) => name.toLowerCase().includes(k))?.[0] || name.toLowerCase();
let preferred = "";

function walletIcon(w, key, size) {
  const src = w && /^data:image\/(svg\+xml|png|webp|jpeg)[;,]/.test(w.icon || "") ? w.icon : offer.brands?.[key];
  if (!src) return null;
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.width = size;
  img.height = size;
  img.className = "ps-mark";
  return img;
}

function defaultWallet() {
  const list = [...wallets.values()];
  return (
    list.find((w) => walletKey(w.name) === preferred) ||
    KNOWN_WALLETS.map(([k]) => list.find((w) => walletKey(w.name) === k)).find(Boolean) ||
    list[0]
  );
}

function detectedLabel() {
  const span = document.createElement("span");
  span.className = "detected";
  span.textContent = "(detected)";
  return span;
}

function renderX402() {
  const box = $("co-x402");
  if (!offer?.x402?.includes(current?.mint) || wallets.size === 0) {
    box.hidden = true;
    return;
  }
  const w = defaultWallet();
  const split = document.createElement("div");
  split.className = "split";

  const main = document.createElement("button");
  main.type = "button";
  main.id = "x402-pay";
  main.className = "btn btn-ghost split-main";
  const label = document.createElement("span");
  label.className = "btn-label";
  label.append(`Pay with ${w.name} `, detectedLabel());
  main.append(...[walletIcon(w, walletKey(w.name), 22), label].filter(Boolean));

  // A long press opens the wallet chooser, like a context menu on a device.
  let pressTimer;
  let longPressed = false;
  main.addEventListener("pointerdown", () => {
    longPressed = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      longPressed = true;
      openWalletChooser();
    }, 550);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) main.addEventListener(ev, () => clearTimeout(pressTimer));
  main.addEventListener("contextmenu", (e) => e.preventDefault());
  main.addEventListener("click", (e) => {
    if (longPressed) {
      e.preventDefault();
      longPressed = false;
      return;
    }
    payInApp(w);
  });

  const more = document.createElement("button");
  more.type = "button";
  more.id = "x402-more";
  more.className = "btn btn-ghost split-more";
  more.setAttribute("aria-label", "Choose another wallet");
  more.setAttribute("aria-haspopup", "dialog");
  more.innerHTML = '<svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  more.addEventListener("click", openWalletChooser);

  split.append(main, more);
  const hint = document.createElement("p");
  hint.className = "fine center";
  hint.textContent = "Hold or use the arrow for other wallets.";
  box.replaceChildren(split, hint);
  box.hidden = false;
}

function openWalletChooser() {
  const ul = $("wallet-list");
  ul.replaceChildren();
  const detected = [...wallets.values()];
  const rows = [
    ...detected.map((w) => ({ w, key: walletKey(w.name), name: w.name })),
    ...KNOWN_WALLETS.filter(([k]) => !detected.some((w) => walletKey(w.name) === k)).map(([key, name]) => ({ w: null, key, name })),
  ];
  for (const r of rows) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "wallet-row";
    const icon = walletIcon(r.w, r.key, 32);
    const text = document.createElement("span");
    text.className = "wallet-row-text";
    const name = document.createElement("strong");
    name.textContent = r.name;
    const state = document.createElement("small");
    if (r.w) {
      name.append(" ", detectedLabel());
      state.textContent = r.key === walletKey(defaultWallet().name) ? "Default for this device" : "Installed on this device";
      b.addEventListener("click", () => {
        preferred = r.key;
        closeSheet("wallet-sheet");
        renderX402();
        payInApp(r.w);
      });
    } else {
      b.disabled = true;
      state.textContent = "Not detected";
    }
    text.append(name, state);
    b.append(...[icon, text].filter(Boolean));
    li.append(b);
    ul.append(li);
  }
  openSheet("wallet-sheet");
  $("wallet-title").focus({ preventScroll: true });
}

async function payInApp(wallet) {
  const p = current;
  showWait();
  $("wait-open").hidden = true;
  try {
    const { payX402 } = await import("./x402-pay.js");
    const claim = await payX402({ wallet, offer, asset: asset(p.mint), identity: p.identity, say: (t) => say($("pay-status"), t) });
    claims.write([...claims.read(), { claim, identity: p.identity, created: Date.now() }]);
    setStep("final");
    say($("pay-status"), "Paid. Waiting for the payment to be final on Solana.");
    current = { ...p, claim };
    schedule(1500);
  } catch (err) {
    const msg = String(err?.message || err);
    fail(/reject|declin|cancel/i.test(msg) ? "You declined in your wallet. Nothing was charged." : `Payment didn't go through: ${msg.slice(0, 160)}`);
  }
}

// ---------- member view ----------

function becomeMember(expires, signature, fresh) {
  member = true;
  const v = $("player");
  if (offer.poster) v.poster = "/media/poster";
  if (!v.querySelector("source")) {
    for (const m of offer.media) {
      const s = document.createElement("source");
      s.src = m.src;
      s.type = m.type;
      v.append(s);
    }
    v.load();
  }
  if (offer.captions && !v.querySelector("track")) {
    const t = document.createElement("track");
    t.kind = "captions";
    t.src = "/media/captions";
    t.srclang = "en";
    t.label = "English";
    t.default = true;
    v.append(t);
  }
  $("hero-art").hidden = true;
  $("hero-player").hidden = false;
  $("member-banner").hidden = false;
  $("share-grid").hidden = false;
  $("club-cta").hidden = true;
  $("resume").hidden = true;
  const access = $("access");
  access.hidden = false;
  access.textContent = `Access on this device until ${fmtTime(expires)}.`;
  if (signature) {
    const a = document.createElement("a");
    a.href = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}`;
    a.rel = "noreferrer noopener";
    a.target = "_blank";
    a.textContent = "View payment";
    access.append(" ", a);
  }
  document.querySelector(".topbar").dataset.solid = "true";
  $("club-scroll").scrollTop = 0;
  if (fresh) {
    $("member-banner").focus({ preventScroll: true });
    toast("Welcome to the club");
  }
}

const LINKS = {
  chat: {
    icon: "/img/app-chat.svg",
    title: "Share in PrivacySafe Chat",
    text: "Opens PrivacySafe Chat with this episode ready to send to a contact or group. Only club members can play it.",
    url: () => offer.links.chat,
    done: "Chat link copied",
  },
  storage: {
    icon: "/img/app-storage.svg",
    title: "Save to PrivacySafe Storage",
    text: "Saves a copy of this episode to your PrivacySafe Storage, end-to-end encrypted in your secure zone.",
    url: () => offer.links.storage,
    done: "Storage link copied",
  },
};

function openLink(kind) {
  const l = LINKS[kind];
  $("link-icon").src = l.icon;
  $("link-title").textContent = l.title;
  $("link-text").textContent = l.text;
  $("link-url").textContent = l.url();
  $("link-open").href = l.url();
  $("link-sheet").dataset.kind = kind;
  openSheet("link-sheet");
}

async function copyLink() {
  const l = LINKS[$("link-sheet").dataset.kind];
  try {
    await navigator.clipboard.writeText(l.url());
  } catch {
    const r = document.createRange();
    r.selectNodeContents($("link-url"));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    document.execCommand?.("copy");
  }
  closeSheet("link-sheet");
  toast(l.done);
}

// ---------- start ----------

async function init() {
  offer = await (await fetch("/api/offer", { cache: "no-store" })).json();
  selected = offer.accepts[0];
  if (offer.poster) {
    $("hero-art").style.setProperty("--poster", "url(/media/poster)");
    $("hero-art").classList.add("has-poster");
  }
  renderCta();
  discoverWallets();
  watchScroll();

  for (const [id, btn] of [["pay", null], ["wallet-sheet", "wallet-close"], ["link-sheet", "link-close"], ["me-sheet", "me-close"], ["about", "about-close"]]) wireSheet(id, btn);
  $("signin-go").addEventListener("click", signIn);
  $("identity").addEventListener("keydown", (e) => e.key === "Enter" && signIn());
  $("join").addEventListener("click", openCheckout);
  $("token-options").addEventListener("change", async (e) => {
    selected = asset(e.target.value);
    renderCta();
    await prepareCheckout();
  });
  $("co-open").addEventListener("click", () => setTimeout(startWaiting, 150));
  $("qr-toggle").addEventListener("click", () => {
    const open = $("qr").hidden;
    $("qr").hidden = !open;
    $("qr-toggle").setAttribute("aria-expanded", String(open));
    $("qr-toggle").textContent = open ? "Hide QR code" : "Pay from another device";
    if (open) startWaitingQuietly();
  });
  $("wait-close").addEventListener("click", () => {
    closeSheet("pay");
    renderResume();
  });
  $("resume-btn").addEventListener("click", resume);
  $("share-chat").addEventListener("click", () => openLink("chat"));
  $("save-storage").addEventListener("click", () => openLink("storage"));
  $("link-copy").addEventListener("click", copyLink);
  $("link-open").addEventListener("click", () => setTimeout(() => closeSheet("link-sheet"), 300));
  $("me-btn").addEventListener("click", () => openSheet("me-sheet"));
  $("me-change").addEventListener("click", () => {
    closeSheet("me-sheet");
    try {
      localStorage.removeItem(IDENTITY_KEY);
    } catch {}
    $("identity").value = "";
    show("signin");
    $("identity").focus();
  });
  $("about-open").addEventListener("click", () => openSheet("about"));

  const session = await (await fetch("/api/session", { cache: "no-store", credentials: "same-origin" })).json();
  let saved = "";
  try {
    saved = localStorage.getItem(IDENTITY_KEY) || "";
  } catch {}
  if (session.sender) saved = session.sender;
  await new Promise((r) => setTimeout(r, reduceMotion ? 0 : 650));

  if (saved && isIdentity(saved)) {
    setMe(saved);
    show("club");
    if (session.active) becomeMember(session.expires);
    else {
      renderResume();
      const open = claims.read().filter((c) => c.identity === me);
      if (open.length) {
        current = { identity: me, claim: open[open.length - 1].claim, offerId: offer.offerId, mint: offer.accepts[0].mint };
        schedule(0);
      }
    }
  } else {
    show("signin");
  }
}

// Polling also starts when someone shows the QR, since they may pay from another device.
function startWaitingQuietly() {
  rememberPending();
  schedule(POLL_MS);
}

async function resume() {
  const list = pending.read().filter((p) => p.identity === me);
  const open = claims.read().filter((c) => c.identity === me);
  showWait();
  if (open.length) {
    current = { identity: me, claim: open[open.length - 1].claim, offerId: offer.offerId, mint: offer.accepts[0].mint };
    $("wait-open").hidden = true;
  } else {
    const p = list[list.length - 1];
    const a = asset(p.mint);
    const reference = await deriveReference(p);
    current = { ...p, uri: solanaPayUri({ payTo: offer.payTo, amount: a.amount, mint: a.mint, reference, label: offer.title, message: `Join ${offer.title}` }) };
    $("wait-open").href = current.uri;
    $("wait-open").hidden = false;
  }
  openSheet("pay");
  $("wait-title").focus({ preventScroll: true });
  say($("pay-status"), "Checking for your payment…");
  schedule(0);
}

init().catch(() => {
  show("signin");
  say($("signin-status"), "Couldn't reach the server. Check your connection and reload.", "error");
});
