// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { base58, deriveReference, isIdentity, isNonce, normalizeIdentity, toAtomic } from "./reference.js";
import { jsonStore } from "./store.js";

export const TOKEN_PROGRAMS = { "SPL Token": TOKEN_PROGRAM_ADDRESS, "Token-2022": TOKEN_2022_PROGRAM_ADDRESS };

export async function associatedTokenAccount(owner, mint, tokenProgram) {
  const enc = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    seeds: [enc.encode(owner), enc.encode(tokenProgram), enc.encode(mint)],
  });
  return ata;
}

// Gate 1 test call: read each mint's owner program and decimals from chain.
export async function readMint(rpc, mint) {
  const info = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "finalized" }]);
  const owner = info?.value?.owner;
  const decimals = info?.value?.data?.parsed?.info?.decimals;
  if (!Object.values(TOKEN_PROGRAMS).includes(owner) || !Number.isInteger(decimals)) {
    throw new Error(`${mint} is not a token mint on this network`);
  }
  return { tokenProgram: owner, decimals };
}

// An offer is one immutable set of terms. Changing any term mints a new offerId; old offers
// stay on file so payments already in flight can still be verified.
export function loadOffer(store, terms) {
  const db = store.get();
  db.offers ||= {};
  const key = JSON.stringify(terms);
  const current = db.active && db.offers[db.active];
  if (current && JSON.stringify(current.terms) === key) return db.active;
  if (current) current.retired = new Date().toISOString();
  const offerId = base58(crypto.randomBytes(16));
  db.offers[offerId] = { terms, created: new Date().toISOString() };
  db.active = offerId;
  store.save();
  return offerId;
}

const getTx = (rpc, signature) =>
  rpc("getTransaction", [signature, { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);

// Checks one finalized transaction against one accepted asset. Returns null on success or a problem code.
function checkTransfer(tx, { reference, destAta, mint, atomic }) {
  if (!tx || tx.meta?.err) return "failed_transaction";
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  keys.push(...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || []));
  if (reference && !keys.includes(reference)) return "no_reference";
  const at = keys.indexOf(destAta);
  if (at < 0) return "wrong_destination_or_asset";
  const pre = tx.meta.preTokenBalances?.find((b) => b.accountIndex === at && b.mint === mint);
  const post = tx.meta.postTokenBalances?.find((b) => b.accountIndex === at && b.mint === mint);
  if (!post) return "wrong_asset";
  const received = BigInt(post.uiTokenAmount.amount) - BigInt(pre?.uiTokenAmount?.amount ?? "0");
  return received === atomic ? null : "wrong_amount";
}

const spec = (asset, reference) => ({
  reference,
  destAta: asset.destination,
  mint: asset.mint,
  atomic: toAtomic(asset.amount, asset.decimals),
});

async function findPayment(rpc, { asset, reference, claimed }) {
  const sigs = await rpc("getSignaturesForAddress", [reference, { commitment: "finalized", limit: 25 }]);
  if (!Array.isArray(sigs)) throw Object.assign(new Error("invalid getSignaturesForAddress result"), { rpcUnavailable: true });
  const problems = [];
  for (const s of sigs) {
    if (s.err) continue;
    if (claimed(s.signature)) {
      problems.push("already_claimed");
      continue;
    }
    const tx = await getTx(rpc, s.signature);
    if (!tx) continue;
    const problem = checkTransfer(tx, spec(asset, reference));
    if (problem === "no_reference" || problem === "failed_transaction") continue;
    if (problem) {
      problems.push(problem);
      continue;
    }
    return { signature: s.signature, slot: tx.slot };
  }
  return { signature: null, problems };
}

// Allowance for clock difference between this server and the chain's block times.
const CLOCK_SLACK_SECONDS = 600;

export function createPaidAccess({ rpc, offers, records, fulfil }) {
  const db = records.get();
  db.byReference ||= {};
  db.bySignature ||= {};

  // One verify or claim at a time per payment key. Every await (RPC calls, fulfil) yields the
  // event loop, so without this two concurrent requests for the same payment could both find
  // no record, or both see state "verified", and both run fulfil(). Callers queue behind the
  // one in flight and then re-read the record it left behind.
  const locks = new Map();
  function withLock(key, fn) {
    const prev = locks.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(key, tail);
    tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
    return run;
  }

  // True if this signature is already bound to a different payment key. Called with no await
  // between it and save(), so the check and the write can't be split by another request.
  const takenByOther = (signature, key) => Boolean(db.bySignature[signature] && db.bySignature[signature] !== key);

  function save(rec) {
    db.byReference[rec.reference] = rec;
    if (rec.signature) db.bySignature[rec.signature] = rec.reference;
    records.save();
  }

  async function verify({ identity, offerId, mint, nonce }) {
    if (!isIdentity(identity)) return { state: "rejected", reason: "bad_identity" };
    if (!isNonce(nonce)) return { state: "rejected", reason: "bad_nonce" };
    const offer = offers.get().offers?.[offerId];
    if (!offer) return { state: "rejected", reason: "unknown_offer" };
    const asset = offer.terms.accepts.find((a) => a.mint === mint);
    if (!asset) return { state: "rejected", reason: "asset_not_accepted" };

    const sender = normalizeIdentity(identity);
    const reference = await deriveReference({ identity: sender, offerId, mint, nonce });

    return withLock(reference, async () => {
      let rec = db.byReference[reference];
      if (!rec) {
        const found = await findPayment(rpc, { asset, reference, claimed: (sig) => takenByOther(sig, reference) });
        if (!found.signature) return { state: "pending", reference, problems: found.problems };
        // Re-check after the RPC round trips: another rail may have bound this signature meanwhile.
        if (takenByOther(found.signature, reference)) return { state: "pending", reference, problems: ["already_claimed"] };
        rec = { offerId, sender, mint, reference, signature: found.signature, slot: found.slot, rail: "solana-pay", state: "verified", at: new Date().toISOString() };
        save(rec);
      }
      return admit(rec);
    });
  }

  // Only call while holding the lock for rec.reference.
  async function admit(rec) {
    if (rec.state === "verified" || rec.state === "claiming") {
      rec.state = "claiming";
      save(rec);
      await fulfil(rec);
      rec.state = "admitted";
      rec.admittedAt = new Date().toISOString();
      save(rec);
    }
    return { state: rec.state, reference: rec.reference, signature: rec.signature, sender: rec.sender, rail: rec.rail };
  }

  // x402 rail: the facilitator settled a transaction; check it on chain ourselves before admitting.
  //
  // x402 transactions carry no Solana Pay reference, so nothing on chain ties one to a payer.
  // The caller MUST take identity and signature from its own server-side binding (the claim
  // created when the facilitator settled this payer's request, see x402-lane.js), never from
  // a request body: a signature is public once it lands, and the transfer check alone can't
  // tell whose it was. notBefore is when that binding was made; a transaction finalized
  // earlier can't be the settlement for it, so older transfers to the same account are refused.
  async function claimSignature({ identity, offerId, signature, notBefore }) {
    if (!isIdentity(identity)) return { state: "rejected", reason: "bad_identity" };
    if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) return { state: "rejected", reason: "bad_signature" };
    const offer = offers.get().offers?.[offerId];
    if (!offer) return { state: "rejected", reason: "unknown_offer" };
    const since = Math.max(Date.parse(offer.created) || 0, Date.parse(notBefore) || 0);
    if (!since) return { state: "rejected", reason: "no_time_bound" };
    const key = `x402:${signature}`;
    const sender = normalizeIdentity(identity);

    return withLock(key, async () => {
      if (takenByOther(signature, key)) return { state: "rejected", reason: "already_claimed" };
      let rec = db.byReference[key];
      if (rec && rec.sender !== sender) return { state: "rejected", reason: "already_claimed" };
      if (!rec) {
        const tx = await getTx(rpc, signature);
        if (!tx) return { state: "pending" };
        if (!Number.isFinite(tx.blockTime)) return { state: "pending", reason: "no_block_time" };
        if (tx.blockTime < Math.floor(since / 1000) - CLOCK_SLACK_SECONDS) return { state: "rejected", reason: "stale_transaction" };
        const matched = offer.terms.accepts.find((a) => checkTransfer(tx, spec(a)) === null);
        if (!matched) return { state: "rejected", reason: checkTransfer(tx, spec(offer.terms.accepts[0])) || "no_match" };
        // Re-check after the RPC round trip, with no await between this and save().
        if (takenByOther(signature, key)) return { state: "rejected", reason: "already_claimed" };
        rec = { offerId, sender, mint: matched.mint, reference: key, signature, slot: tx.slot, blockTime: tx.blockTime, rail: "x402", state: "verified", at: new Date().toISOString() };
        save(rec);
      }
      return admit(rec);
    });
  }

  const resumable = () => Object.values(db.byReference).filter((r) => r.state === "verified" || r.state === "claiming");

  return { verify, claimSignature, resumable };
}
