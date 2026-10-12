// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Loaded only when someone pays in the browser. Builds an x402 payment with a Wallet Standard
// Solana wallet and returns the claim the server releases after settlement.

import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { address as solAddress, getTransactionDecoder, getTransactionEncoder } from "@solana/kit";

const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

function signerFor(wallet, account) {
  const feature = wallet.features["solana:signTransaction"];
  const encode = getTransactionEncoder();
  const decode = getTransactionDecoder();
  const me = solAddress(account.address);
  return {
    address: me,
    async modifyAndSignTransactions(txs) {
      const outputs = await feature.signTransaction(
        ...txs.map((tx) => ({ account, chain: "solana:mainnet", transaction: new Uint8Array(encode.encode(tx)) })),
      );
      return outputs.map(({ signedTransaction }, i) => {
        const signed = decode.decode(signedTransaction);
        if (!signed.signatures[me]) throw new Error("The wallet returned an unsigned transaction.");
        return Object.freeze({ ...signed, lifetimeConstraint: txs[i].lifetimeConstraint });
      });
    },
  };
}

export async function payX402({ wallet, offer, asset, identity, say }) {
  say("Connecting to your wallet…");
  const { accounts } = await wallet.features["standard:connect"].connect();
  const account = accounts.find((a) => a.chains?.includes("solana:mainnet")) || accounts[0];
  if (!account) throw new Error("No Solana account in this wallet.");

  const client = new x402Client((_v, reqs) => {
    const match = reqs.find((r) => r.asset === asset.mint);
    if (!match) throw new Error(`${asset.symbol} isn't offered over x402 right now.`);
    return match;
  })
    .setSpendControls({ allowedAssets: offer.accepts.map((a) => ({ network: MAINNET, asset: a.mint, maxAmountPerPayment: a.atomic })) })
    .register(MAINNET, new ExactSvmScheme(signerFor(wallet, account), { rpcUrl: `${location.origin}/api/solana-rpc` }));
  const http = new x402HTTPClient(client);

  const body = JSON.stringify({ identity, offerId: offer.offerId });
  const post = (headers = {}) =>
    fetch("/api/unlock", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", ...headers },
      body,
      credentials: "same-origin",
      cache: "no-store",
    });

  say("Getting the price…");
  const first = await post();
  if (first.status === 503) throw new Error("Browser payments are paused until next month. Use the QR code instead.");
  if (first.status !== 402) throw new Error(`Unexpected response ${first.status}`);
  const required = http.getPaymentRequiredResponse((h) => first.headers.get(h), await first.json().catch(() => ({})));

  say(`Approve ${asset.amount} ${asset.symbol} in your wallet.`);
  const payload = await http.createPaymentPayload(required);

  say("Settling payment…");
  const paid = await post(http.encodePaymentSignatureHeader(payload));
  if (!paid.ok) {
    const b = await paid.json().catch(() => ({}));
    throw new Error(b.error || b.errorReason || `Settlement failed (${paid.status})`);
  }
  return (await paid.json()).claim;
}
