// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared by the server and the browser bundle. The Chat app must produce identical bytes.
//
// canonicalEncode(fields): uint32 BE field count, then per field uint32 BE byte length + UTF-8 bytes.
// reference = base58(SHA-256(canonicalEncode(["3nweb-paid-chat-v1", identity, offerId, mint, nonce])))

export const DOMAIN = "3nweb-paid-chat-v1";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const utf8 = new TextEncoder();

export function base58(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

export function canonicalEncode(fields) {
  const parts = fields.map((f) => utf8.encode(String(f)));
  const out = new Uint8Array(4 + parts.reduce((n, p) => n + 4 + p.length, 0));
  const view = new DataView(out.buffer);
  view.setUint32(0, parts.length);
  let at = 4;
  for (const p of parts) {
    view.setUint32(at, p.length);
    out.set(p, at + 4);
    at += 4 + p.length;
  }
  return out;
}

export const normalizeIdentity = (s) => String(s).trim().toLowerCase();

export const isIdentity = (s) => /^[a-z0-9][a-z0-9._-]{0,63}@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(normalizeIdentity(s));

export const isNonce = (s) => typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

export function newNonce() {
  return base58(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

export async function deriveReference({ identity, offerId, mint, nonce }) {
  const bytes = canonicalEncode([DOMAIN, normalizeIdentity(identity), offerId, mint, nonce]);
  return base58(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)));
}

export function toAtomic(amount, decimals) {
  const [whole, frac = ""] = String(amount).split(".");
  if (frac.length > decimals) throw new Error(`Amount ${amount} has more than ${decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

export function uriAmount(amount) {
  return String(amount).includes(".") ? String(amount).replace(/0+$/, "").replace(/\.$/, "") : String(amount);
}

export function solanaPayUri({ payTo, amount, mint, reference, label, message }) {
  const q = new URLSearchParams({ amount: uriAmount(amount), "spl-token": mint, reference });
  if (label) q.set("label", label);
  if (message) q.set("message", message);
  return `solana:${payTo}?${q.toString().replace(/\+/g, "%20")}`;
}
