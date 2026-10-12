// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// API abuse cases: reused nonce, replay, one payment with two references, bad input, rate limit. Needs serve-demo.sh.

import * as R from "../lib/reference.js";
const chain = (p, b) => fetch("http://127.0.0.1:4021" + p, { method: "POST", body: JSON.stringify(b || {}) }).then((r) => r.json());
const offer = await (await fetch("http://localhost:3000/api/offer")).json();
const usdc = offer.accepts[0];
let ip = 0;
const verify = async (b) => { await new Promise((r) => setTimeout(r, 2100)); const r = await fetch("http://localhost:3000/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return [r.status, await r.json(), r.headers.get("set-cookie") ? "cookie" : "no-cookie"]; };
const uriFor = async (p) => R.solanaPayUri({ payTo: offer.payTo, amount: usdc.amount, mint: usdc.mint, reference: await R.deriveReference(p) });

const alice = { identity: "alice@privacysafe.me", offerId: offer.offerId, mint: usdc.mint, nonce: R.newNonce() };
await chain("/mock/pay", { uri: await uriFor(alice) });
console.log("A alice claims:", JSON.stringify(await verify(alice)));
console.log("B mallory reuses alice's nonce under her own identity:", JSON.stringify(await verify({ ...alice, identity: "mallory@privacysafe.me" })));
console.log("C alice replays (same request):", JSON.stringify(await verify(alice)));
const bob = { identity: "bob@privacysafe.me", offerId: offer.offerId, mint: usdc.mint, nonce: R.newNonce() };
const carol = { identity: "carol@privacysafe.me", offerId: offer.offerId, mint: usdc.mint, nonce: R.newNonce() };
await chain("/mock/pay", { uri: await uriFor(bob), extraReference: await R.deriveReference(carol) });
console.log("D one payment, two references: bob:", JSON.stringify(await verify(bob)));
console.log("  carol on same tx:", await verify(carol));
console.log("E unknown offer:", JSON.stringify(await verify({ ...alice, offerId: "nope" })));
console.log("F unaccepted mint:", JSON.stringify(await verify({ ...alice, mint: "So11111111111111111111111111111111111111112" })));
console.log("G bad identity:", JSON.stringify(await verify({ ...alice, identity: "not-an-address" })));
const r = await Promise.all([1, 2].map(() => fetch("http://localhost:3000/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(alice) }).then((x) => x.status)));
console.log("H two checks at once:", r);
// Two different payments from one IP (people sharing event wifi) are both checked.
const shared = await Promise.all([1, 2].map((i) => fetch("http://localhost:3000/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identity: `guest${i}@privacysafe.me`, offerId: offer.offerId, mint: usdc.mint, nonce: R.newNonce() }) }).then((x) => x.status)));
console.log("I two payments, one IP, at once:", shared, shared.includes(429) ? "THROTTLED" : "both checked");
