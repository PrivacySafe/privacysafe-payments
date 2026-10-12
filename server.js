// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createRpc } from "./lib/rpc.js";
import { jsonStore } from "./lib/store.js";
import { associatedTokenAccount, createPaidAccess, loadOffer, readMint } from "./lib/paid-access.js";
import { toAtomic } from "./lib/reference.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

const MINTS = {
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  AUDD: "AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw",
};
const RPC_DEFAULT = [
  "https://solana.api.onfinality.io/public",
  "https://api.mainnet.solana.com",
  "https://api.mainnet-beta.solana.com",
];

const cfg = {
  port: Number(env.PORT || 3000),
  // Behind a reverse proxy, set BIND_ADDRESS=127.0.0.1 so the app is reachable only through it.
  bindAddress: env.BIND_ADDRESS || "",
  payTo: env.PAY_TO || "",
  host: env.HOST_IDENTITY || "johnkiriakou@privacysafe.me",
  title: env.OFFER_TITLE || "Secret Agent Club",
  target: env.OFFER_TARGET || "secret-agent-club",
  prices: { USDC: env.PRICE_USDC || "1.00", AUDD: env.PRICE_AUDD || "1.40" },
  assets: (env.ASSETS || "USDC,AUDD").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
  rpcUrls: (env.SOLANA_RPC_URLS || RPC_DEFAULT.join(",")).split(",").map((s) => s.trim()).filter(Boolean),
  accessHours: Number(env.ACCESS_HOURS || 6),
  // Offered in this order; the browser plays the first it can decode.
  videoFiles: (env.VIDEO_FILES || "media/video.webm,media/video.mp4")
    .split(",")
    .map((f) => path.resolve(root, f.trim()))
    .filter((f) => f && fs.existsSync(f)),
  posterFile: path.resolve(root, env.POSTER_FILE || "media/poster.jpg"),
  captionsFile: path.resolve(root, env.CAPTIONS_FILE || "media/captions.vtt"),
  trustProxy: env.TRUST_PROXY || "",
  sourceUrl: env.SOURCE_URL || "https://github.com/PrivacySafe/privacysafe-payments",
  // Placeholders until the PrivacySafe app defines its w3n:// share and save targets.
  storageUrl: env.STORAGE_URL || "w3n://johnkiriakou@privacysafe.me/storage/Secret%20Agent%20Club/early-episode.mp4",
  chatUrl: env.CHAT_URL || "w3n://johnkiriakou@privacysafe.me/chat/secret-agent-club?share=early-episode",
  secret: env.SESSION_SECRET || "",
};

const isAddress = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
if (!isAddress(cfg.payTo)) throw new Error("PAY_TO must be the receiving Solana wallet address");
for (const a of cfg.assets) {
  if (!MINTS[a]) throw new Error(`ASSETS: unknown asset ${a}. Use USDC, AUDD or both.`);
  if (!/^\d+(\.\d{1,6})?$/.test(cfg.prices[a])) throw new Error(`PRICE_${a} must be a plain number like 1.00`);
}
if (!cfg.videoFiles.length) throw new Error("No video found. Put the episode at media/video.webm and/or media/video.mp4, or set VIDEO_FILES.");
const VIDEO_TYPES = { ".webm": "video/webm", ".mp4": "video/mp4", ".m4v": "video/mp4", ".ogv": "video/ogg" };
const videos = cfg.videoFiles.map((file, i) => ({ file, src: `/media/video/${i}`, type: VIDEO_TYPES[path.extname(file).toLowerCase()] || "video/mp4" }));
if (cfg.secret.length < 32) {
  cfg.secret = crypto.randomBytes(32).toString("hex");
  console.warn("SESSION_SECRET not set; using a random one. Viewers lose access when the server restarts.");
}

const rpc = createRpc(cfg.rpcUrls);

// Gate 1: read both mints from chain. A wrong mint fails here instead of at payment time.
const accepts = [];
for (const symbol of cfg.assets) {
  const mint = MINTS[symbol];
  const { tokenProgram, decimals } = await readMint(rpc, mint);
  accepts.push({
    symbol,
    mint,
    decimals,
    amount: cfg.prices[symbol],
    atomic: toAtomic(cfg.prices[symbol], decimals).toString(),
    destination: await associatedTokenAccount(cfg.payTo, mint, tokenProgram),
  });
}

const offers = jsonStore(path.join(root, "data", "offers.json"), {});
const offerId = loadOffer(offers, { type: "group", target: cfg.target, payTo: cfg.payTo, accepts });
const offer = offers.get().offers[offerId].terms;

const b64u = (b) => Buffer.from(b).toString("base64url");
const sign = (s) => crypto.createHmac("sha256", cfg.secret).update(s).digest("base64url");

function issueToken(sub = "") {
  const body = b64u(JSON.stringify({ exp: Date.now() + cfg.accessHours * 3600e3, sub, n: b64u(crypto.randomBytes(9)) }));
  return `${body}.${sign(body)}`;
}

function readToken(token) {
  if (typeof token !== "string") return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return claims.exp > Date.now() ? claims : null;
  } catch {
    return null;
  }
}

function cookieToken(req) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === "ps_access") return decodeURIComponent(v.join("="));
  }
  return null;
}

function setAccess(req, res, token) {
  const claims = readToken(token);
  res.cookie("ps_access", token, { httpOnly: true, secure: req.secure, sameSite: "strict", path: "/", maxAge: claims.exp - Date.now() });
  return claims;
}

// In the Chat app, fulfilment is updateGroupMembers(). Here it is a viewing pass for this browser.
const paid = createPaidAccess({
  rpc,
  offers,
  records: jsonStore(path.join(root, "data", "paid-access.json"), {}),
  fulfil: async () => {},
});
const stuck = paid.resumable();
if (stuck.length) console.log(`${stuck.length} verified payment(s) waiting for their payer to come back; they will be admitted on the next check.`);

const app = express();
app.disable("x-powered-by");
if (cfg.trustProxy) app.set("trust proxy", cfg.trustProxy);

app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' https://privacysafe.click; style-src 'self'; img-src 'self' data:; font-src 'self'; media-src 'self'; " +
      "connect-src 'self' https://privacysafe.click; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
  if (req.secure) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

app.use(express.static(path.join(root, "public"), { index: "index.html", maxAge: "1h" }));

const brandDir = path.join(root, "public", "img", "brands");
const brands = () =>
  Object.fromEntries(
    ["usdc", "audd", "solana", "phantom", "metamask", "solflare", "seedvault", "backpack"].flatMap((k) => {
      const f = ["svg", "png", "webp"].map((x) => `${k}.${x}`).find((n) => fs.existsSync(path.join(brandDir, n)));
      return f ? [[k, `/img/brands/${f}`]] : [];
    }),
  );

app.get("/api/offer", (req, res) => {
  res.set("Cache-Control", "no-store").json({
    offerId,
    title: cfg.title,
    host: cfg.host,
    payTo: cfg.payTo,
    accepts: offer.accepts.map(({ symbol, mint, decimals, amount, atomic }) => ({ symbol, mint, decimals, amount, atomic })),
    accessHours: cfg.accessHours,
    poster: fs.existsSync(cfg.posterFile),
    captions: fs.existsSync(cfg.captionsFile),
    links: { storage: cfg.storageUrl, chat: cfg.chatUrl },
    media: videos.map(({ src, type }) => ({ src, type })),
    brands: brands(),
    x402,
  });
});

app.get("/api/session", (req, res) => {
  const claims = readToken(cookieToken(req));
  res.set("Cache-Control", "no-store").json(claims ? { active: true, expires: claims.exp, sender: claims.sub } : { active: false });
});

app.post("/api/session", (req, res) => {
  const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!readToken(token)) return res.status(401).json({ error: "invalid_token" });
  const claims = setAccess(req, res, token);
  res.set("Cache-Control", "no-store").json({ active: true, expires: claims.exp });
});

// Each check costs RPC calls, so one check per payment every two seconds. Keyed by IP
// and payment rather than IP alone: at an event, many people share one public IP, and
// a per-IP limit would starve everyone's payment checks but one. A per-IP ceiling
// still caps the total (60 checks per two seconds, about 150 people polling at once);
// nginx limits the request rate in front of this as well.
const lastCheck = new Map();
const ipWindow = new Map();
setInterval(() => (lastCheck.clear(), ipWindow.clear()), 60_000).unref();

app.post("/api/verify", express.json({ limit: "1kb" }), async (req, res) => {
  res.set("Cache-Control", "no-store");
  const now = Date.now();
  const key = `${req.ip}|${String(req.body?.nonce ?? "").slice(0, 64)}`;
  if (now - (lastCheck.get(key) || 0) < 2000) return res.status(429).json({ state: "pending", reason: "slow_down" });
  const win = ipWindow.get(req.ip);
  if (win && now - win.start < 2000) {
    if (++win.n > 60) return res.status(429).json({ state: "pending", reason: "slow_down" });
  } else ipWindow.set(req.ip, { start: now, n: 1 });
  lastCheck.set(key, now);

  const { identity, offerId: id, mint, nonce } = req.body || {};
  try {
    const result = await paid.verify({ identity, offerId: id, mint, nonce });
    if (result.state === "rejected") return res.status(400).json(result);
    if (result.state !== "admitted") return res.status(202).json({ state: result.state, problems: result.problems });
    const claims = setAccess(req, res, issueToken(result.sender));
    res.json({ state: "admitted", signature: result.signature, expires: claims.exp });
  } catch (err) {
    if (err.rpcUnavailable) return res.status(202).json({ state: "pending", reason: "rpc_unavailable" });
    console.error(err);
    res.status(500).json({ state: "pending", reason: "server_error" });
  }
});

let x402 = null;
if (env.X402 === "on") {
  const { mountX402 } = await import("./lib/x402-lane.js");
  const rail = await mountX402(app, {
    env,
    root,
    offer,
    offers,
    payTo: cfg.payTo,
    rpc,
    rpcUrl: cfg.rpcUrls[0],
    title: cfg.title,
    paid,
    grant: (req, res, result) => setAccess(req, res, issueToken(result.sender)).exp,
  });
  x402 = rail.assets;
  console.log(`x402 rail on: ${rail.summary}`);
}

// AGPL-3.0 section 13: everyone using this service over the network can get its source.
app.get("/source", (req, res) => res.redirect(302, cfg.sourceUrl));

app.get("/media/poster", (req, res) => {
  if (!fs.existsSync(cfg.posterFile)) return res.sendStatus(404);
  res.sendFile(cfg.posterFile, { maxAge: "1h" });
});

app.get("/media/captions", (req, res) => {
  if (!readToken(cookieToken(req))) return res.sendStatus(403);
  if (!fs.existsSync(cfg.captionsFile)) return res.sendStatus(404);
  res.set("Cache-Control", "private, no-store");
  res.type("text/vtt").sendFile(cfg.captionsFile);
});

app.get("/media/video/:i", (req, res) => {
  if (!readToken(cookieToken(req))) return res.sendStatus(403);
  const v = videos[Number(req.params.i)];
  if (!v) return res.sendStatus(404);
  res.set("Cache-Control", "private, no-store");
  res.set("Content-Disposition", "inline");
  res.type(v.type).sendFile(v.file, { acceptRanges: true, cacheControl: false, lastModified: false });
});

app.use((req, res) => res.sendStatus(404));

const onListen = () => {
  console.log(`Listening on ${cfg.bindAddress || ""}:${cfg.port}  offer ${offerId}  pay to ${cfg.payTo}`);
  for (const a of offer.accepts) console.log(`  ${a.amount} ${a.symbol}  mint ${a.mint}  ${a.decimals} decimals  receiving account ${a.destination}`);
};
if (cfg.bindAddress) app.listen(cfg.port, cfg.bindAddress, onListen);
else app.listen(cfg.port, onListen);
