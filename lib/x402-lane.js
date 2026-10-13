// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// x402 rail. Same offer, same wallet, same PaidAccess record as Solana Pay.
//
//   POST /api/unlock  { identity, offerId }   -> 402, then with payment: { claim }
//   POST /api/claim   { claim }               -> pending | admitted (+ access cookie)
//
// The claim is a random secret returned only to the payer, and only after settlement.
// The server binds it to the settled transaction itself, so a signature seen on chain
// can't be claimed by anyone else. Access waits for our own finalized check of the
// transaction, not just the facilitator's word.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { isIdentity, normalizeIdentity } from "./reference.js";
import { jsonStore } from "./store.js";

export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export async function mountX402(app, { env, root, offer, offers, payTo, rpc, rpcUrl, title, paid, grant }) {
  let facilitator;
  if (env.FACILITATOR_URL) {
    facilitator = new HTTPFacilitatorClient({ url: env.FACILITATOR_URL });
  } else {
    const { createFacilitatorConfig } = await import("@coinbase/x402");
    facilitator = new HTTPFacilitatorClient(createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET));
  }

  // CDP bills settlements past 1,000 a month. The cap keeps the rail at zero cost.
  const cap = Number(env.MONTHLY_SETTLE_CAP ?? 900);
  const counterFile = path.join(root, "data", "x402-settlements.json");
  const month = () => new Date().toISOString().slice(0, 7);
  const readCount = () => {
    try {
      const c = JSON.parse(fs.readFileSync(counterFile, "utf8"));
      return c.month === month() ? c.count : 0;
    } catch {
      return 0;
    }
  };
  const bump = () => fs.writeFileSync(counterFile, JSON.stringify({ month: month(), count: readCount() + 1 }));

  const claims = jsonStore(path.join(root, "data", "x402-claims.json"), {});

  const server = new x402ResourceServer(facilitator)
    .register(SOLANA_MAINNET, new ExactSvmScheme({ rpcUrl }))
    .onAfterSettle(async (ctx) => {
      bump();
      if (!ctx.result?.success || !ctx.result.transaction) return;
      let id;
      try {
        id = JSON.parse(Buffer.from(ctx.transportContext?.responseBody || "").toString("utf8")).claim;
      } catch {}
      const c = id && claims.get()[id];
      if (!c || c.signature) return;
      c.signature = ctx.result.transaction;
      c.settledAt = new Date().toISOString();
      claims.save();
    });

  const only = (env.X402_ASSETS || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  const accepts = offer.accepts.filter((a) => !only.length || only.includes(a.symbol)).map((a) => ({
    scheme: "exact",
    price: { amount: a.atomic, asset: a.mint, extra: {} },
    network: SOLANA_MAINNET,
    payTo,
    maxTimeoutSeconds: 120,
  }));

  const json = express.json({ limit: "1kb" });

  app.post("/api/unlock", json, (req, res, next) => {
    const { identity, offerId: id } = req.body || {};
    if (!isIdentity(identity) || !offers.get().offers?.[id]) {
      return res.status(400).json({ error: "Send { identity, offerId } from /api/offer" });
    }
    if (cap > 0 && readCount() >= cap) return res.status(503).json({ error: "monthly_limit" });
    next();
  });
  app.use(paymentMiddleware({ "POST /api/unlock": { accepts, description: title, mimeType: "application/json" } }, server));
  // Reached only after verification; the middleware holds this body until settlement succeeds.
  app.post("/api/unlock", (req, res) => {
    const claim = crypto.randomBytes(24).toString("base64url");
    claims.get()[claim] = { identity: normalizeIdentity(req.body.identity), offerId: req.body.offerId, created: new Date().toISOString() };
    claims.save();
    res.set("Cache-Control", "no-store").json({ claim });
  });

  app.post("/api/claim", json, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const c = claims.get()[req.body?.claim];
    if (!c) return res.status(400).json({ state: "rejected", reason: "unknown_claim" });
    if (!c.signature) return res.status(202).json({ state: "pending", reason: "not_settled" });
    try {
      // identity and signature come only from the server-side claim record, never from the request.
      const result = await paid.claimSignature({ identity: c.identity, offerId: c.offerId, signature: c.signature, notBefore: c.created });
      if (result.state === "rejected") return res.status(400).json(result);
      if (result.state !== "admitted") return res.status(202).json({ state: "pending", signature: c.signature });
      const expires = grant(req, res, result);
      return res.json({ state: "admitted", signature: result.signature, expires });
    } catch (err) {
      if (err.rpcUnavailable) return res.status(202).json({ state: "pending", reason: "rpc_unavailable" });
      throw err;
    }
  });

  // Two reads the browser needs to build a Solana x402 payment, relayed so the page never
  // contacts an RPC provider directly.
  const allowed = new Set(accepts.map((a) => a.price.asset));
  app.post("/api/solana-rpc", json, async (req, res) => {
    const { id, method, params } = req.body || {};
    const ok = method === "getLatestBlockhash" || (method === "getAccountInfo" && Array.isArray(params) && allowed.has(params[0]));
    if (!ok) return res.status(403).json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not allowed" } });
    try {
      res.json({ jsonrpc: "2.0", id, result: await rpc(method, params) });
    } catch {
      res.status(502).json({ jsonrpc: "2.0", id, error: { code: -32603, message: "RPC unreachable" } });
    }
  });

  return { assets: accepts.map((a) => a.price.asset), summary: accepts.map((a) => `${a.price.asset.slice(0, 4)} ${a.price.amount}`).join(", ") };
}
