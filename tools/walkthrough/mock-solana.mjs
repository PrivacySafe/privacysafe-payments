// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stand-in Solana RPC and x402 facilitator for recording and tests. Never use in production.

import http from "node:http";
import * as kit from "@solana/kit";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MINTS = { EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6, AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw: 6 };
const txs = new Map(); // signature -> tx
const byKey = new Map(); // address -> [{signature, finalized}]
let n = 0;
const T22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const prog = (mint) => (process.env.MOCK_AUDD_2022 && mint.startsWith("AUDD") ? T22 : TOKEN);
const ata = async (owner, mint) => (await kit.getProgramDerivedAddress({ programAddress: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", seeds: [kit.getAddressEncoder().encode(owner), kit.getAddressEncoder().encode(prog(mint)), kit.getAddressEncoder().encode(mint)] }))[0];
const sig = () => kit.getBase58Decoder().decode(new Uint8Array(64).fill(++n % 250 + 1));

async function pay({ uri, amount, mint, extraReference, finalized = true, payer = "Payer11111111111111111111111111111111111111" }) {
  const u = new URL(uri.replace(/^solana:/, "solana://"));
  const payTo = u.host || uri.slice(7, uri.indexOf("?"));
  const q = new URLSearchParams(uri.slice(uri.indexOf("?") + 1));
  const m = mint || q.get("spl-token");
  const amt = amount ?? q.get("amount");
  const [w, f = ""] = amt.split("."); const atomic = BigInt(w) * 1000000n + BigInt(f.padEnd(6, "0"));
  const dest = await ata(payTo, m);
  const refs = [q.get("reference"), ...(extraReference ? [extraReference] : [])];
  const keys = [payer, await ata(payer, m), dest, m, TOKEN, ...refs];
  const s = sig();
  const tx = { slot: 1000 + n, blockTime: Math.floor(Date.now() / 1000), transaction: { message: { accountKeys: keys.map((k) => ({ pubkey: k })) } },
    meta: { err: null, preTokenBalances: [{ accountIndex: 2, mint: m, uiTokenAmount: { amount: "5000000" } }], postTokenBalances: [{ accountIndex: 2, mint: m, uiTokenAmount: { amount: String(5000000n + atomic) } }] } };
  txs.set(s, { tx, finalized });
  for (const r of refs) byKey.set(r, [...(byKey.get(r) || []), s]);
  return { signature: s };
}

const feeKp = await kit.generateKeyPairSigner();
const SOL_MAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
async function fac(url, j) {
  if (url.endsWith("/supported")) return { kinds: [{ x402Version: 2, scheme: "exact", network: SOL_MAIN, extra: { feePayer: feeKp.address } }], extensions: [], signers: { "solana:*": [feeKp.address] } };
  const p = j.paymentPayload, r = j.paymentRequirements;
  const tx = kit.getTransactionDecoder().decode(kit.getBase64Encoder().encode(p.payload.transaction));
  const msg = kit.getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  const keys = msg.staticAccounts.map(String);
  const dest = await ata(r.payTo, r.asset);
  let payer = "", ok = keys[0] === feeKp.address && keys.includes(dest);
  for (const [a, sg] of Object.entries(tx.signatures)) { if (a === feeKp.address) continue; payer = a; ok = ok && !!sg && await kit.verifySignature(await kit.getPublicKeyFromAddress(a), sg, tx.messageBytes); }
  console.log("FAC", url, r.asset.slice(0, 4), r.amount, "ok", ok);
  if (url.endsWith("/verify")) return ok ? { isValid: true, payer } : { isValid: false, invalidReason: "invalid", payer };
  if (!ok) return { success: false, errorReason: "invalid", transaction: "", network: r.network };
  const s = sig(); const at = keys.indexOf(dest);
  txs.set(s, { finalized: false, tx: { slot: 2000 + n, transaction: { message: { accountKeys: keys.map((k) => ({ pubkey: k })) } }, meta: { err: null, preTokenBalances: [{ accountIndex: at, mint: r.asset, uiTokenAmount: { amount: "0" } }], postTokenBalances: [{ accountIndex: at, mint: r.asset, uiTokenAmount: { amount: r.amount } }] } } });
  setTimeout(() => { txs.get(s).finalized = true; }, Number(process.env.MOCK_FINALIZE_MS || 3000));
  return { success: true, transaction: s, network: r.network, payer };
}

http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const send = (o, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (req.url === "/r429") return send({}, 429);
  if (req.url === "/r500") return send({}, 500);
  if (req.url.startsWith("/fac/")) return send(await fac(req.url, body ? JSON.parse(body) : {}));
  if (req.url === "/mock/pay") return send(await pay(JSON.parse(body)));
  if (req.url === "/mock/finalize") { for (const v of txs.values()) v.finalized = true; return send({ ok: true }); }
  const j = JSON.parse(body);
  console.log("RPC", req.url, j.method, JSON.stringify(j.params).slice(0, 80));
  const ok = (result) => send({ jsonrpc: "2.0", id: j.id, result });
  if (j.method === "getLatestBlockhash") return ok({ context: { slot: 1 }, value: { blockhash: kit.getBase58Decoder().decode(new Uint8Array(32).fill(7)), lastValidBlockHeight: 1000 } });
  if (j.method === "getAccountInfo" && j.params[1]?.encoding === "base64") {
    const d = MINTS[j.params[0]];
    const buf = Buffer.alloc(82); buf[44] = d ?? 0; buf[45] = 1;
    return ok({ context: { slot: 1 }, value: d === undefined ? null : { data: [buf.toString("base64"), "base64"], executable: false, lamports: 1461600, owner: prog(j.params[0]), rentEpoch: 0, space: 82 } });
  }
  if (j.method === "getAccountInfo") {
    const d = MINTS[j.params[0]];
    return ok({ context: { slot: 1 }, value: d === undefined ? null : { owner: prog(j.params[0]), data: { parsed: { info: { decimals: d } }, program: "spl-token" } } });
  }
  if (j.method === "getSignaturesForAddress") {
    const fin = j.params[1]?.commitment === "finalized";
    return ok((byKey.get(j.params[0]) || []).filter((s) => !fin || txs.get(s).finalized).map((s) => ({ signature: s, err: null, slot: 1 })));
  }
  if (j.method === "getTransaction") {
    const t = txs.get(j.params[0]);
    return ok(t && (t.finalized || j.params[1]?.commitment !== "finalized") ? t.tx : null);
  }
  send({ jsonrpc: "2.0", id: j.id, error: { code: -32601, message: "nope" } });
}).listen(4021, () => console.log("mock chain :4021"));
