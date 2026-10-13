// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// lib/paid-access.js against a stub RPC: concurrent checks fulfil once, x402 claims are time-bound,
// and one signature can't be claimed twice. No server or network needed.

import assert from "node:assert/strict";
import * as R from "../lib/reference.js";
import { createPaidAccess } from "../lib/paid-access.js";

const mem = (data) => ({ get: () => data, save() {} });
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEST = "8hRPgQ1jUjJ5uWnTPJuh5d8y6E3d4R6wDUSBqfnLyLGc";
const asset = { symbol: "USDC", mint: MINT, decimals: 6, amount: "1.00", atomic: "1000000", destination: DEST };
const created = new Date(Date.now() - 3600e3).toISOString();
const offers = mem({ offers: { O1: { terms: { accepts: [asset] }, created } } });
const sigOf = (i) => String(i).padStart(4, "A") + "1".repeat(84);

const txs = new Map();
const byRef = new Map();
function addTx(sig, { refs = [], blockTime = Math.floor(Date.now() / 1000) } = {}) {
  txs.set(sig, {
    slot: 1, blockTime,
    transaction: { message: { accountKeys: ["Payer1111111111111111111111111111111", DEST, ...refs] } },
    meta: { err: null, preTokenBalances: [{ accountIndex: 1, mint: MINT, uiTokenAmount: { amount: "0" } }], postTokenBalances: [{ accountIndex: 1, mint: MINT, uiTokenAmount: { amount: "1000000" } }] },
  });
  for (const r of refs) byRef.set(r, [...(byRef.get(r) || []), sig]);
}
const tick = () => new Promise((r) => setTimeout(r, 5));
const rpc = async (method, params) => {
  await tick();
  if (method === "getTransaction") return txs.get(params[0]) || null;
  if (method === "getSignaturesForAddress") return (byRef.get(params[0]) || []).map((signature) => ({ signature, err: null }));
  throw new Error(method);
};

let fulfils = 0;
const paid = createPaidAccess({ rpc, offers, records: mem({}), fulfil: async () => { fulfils++; await tick(); } });

// Solana Pay: ten concurrent checks of one payment fulfil it once.
const alice = { identity: "alice@privacysafe.me", offerId: "O1", mint: MINT, nonce: R.newNonce() };
addTx(sigOf(1), { refs: [await R.deriveReference(alice)] });
const results = await Promise.all(Array.from({ length: 10 }, () => paid.verify(alice)));
assert.ok(results.every((r) => r.state === "admitted"), "all concurrent checks admitted");
assert.equal(fulfils, 1, "fulfilled exactly once");
console.log("ok  solana-pay: 10 concurrent checks, 1 fulfil");

// x402: ten concurrent claims of one settlement fulfil it once.
fulfils = 0;
addTx(sigOf(2));
const claim = { identity: "bob@privacysafe.me", offerId: "O1", signature: sigOf(2), notBefore: new Date().toISOString() };
const xr = await Promise.all(Array.from({ length: 10 }, () => paid.claimSignature(claim)));
assert.ok(xr.every((r) => r.state === "admitted"));
assert.equal(fulfils, 1);
console.log("ok  x402: 10 concurrent claims, 1 fulfil");

// x402: someone else can't take a signature that's already bound.
assert.deepEqual(await paid.claimSignature({ ...claim, identity: "mallory@privacysafe.me" }), { state: "rejected", reason: "already_claimed" });
console.log("ok  x402: bound signature refused to another identity");

// x402: a transfer finalized before the claim existed is refused (historical replay).
addTx(sigOf(3), { blockTime: Math.floor(Date.now() / 1000) - 86400 * 30 });
assert.equal((await paid.claimSignature({ ...claim, identity: "carol@privacysafe.me", signature: sigOf(3) })).reason, "stale_transaction");
console.log("ok  x402: month-old transfer refused");

// x402: no time bound at all is refused.
const noOffer = createPaidAccess({ rpc, offers: mem({ offers: { O2: { terms: { accepts: [asset] } } } }), records: mem({}), fulfil: async () => {} });
assert.equal((await noOffer.claimSignature({ ...claim, offerId: "O2", notBefore: undefined })).reason, "no_time_bound");
console.log("ok  x402: claim without a time bound refused");

// Cross-rail: a Solana Pay payment can't also be claimed on x402, even when both race.
const dave = { identity: "dave@privacysafe.me", offerId: "O1", mint: MINT, nonce: R.newNonce() };
addTx(sigOf(4), { refs: [await R.deriveReference(dave)] });
const [sp, x] = await Promise.all([paid.verify(dave), paid.claimSignature({ ...claim, identity: "erin@privacysafe.me", signature: sigOf(4) })]);
const wins = [sp.state, x.state].filter((s) => s === "admitted").length;
assert.equal(wins, 1, `exactly one rail admitted (got ${sp.state}, ${x.state})`);
console.log(`ok  cross-rail race: one winner (solana-pay ${sp.state}, x402 ${x.state})`);
