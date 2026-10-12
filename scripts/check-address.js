// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Offline check of a receiving wallet: validates the address and prints the token accounts
// that payments will land in. No network. Usage: npm run check-address -- <wallet address>

import { isAddress } from "@solana/kit";
import { TOKEN_PROGRAMS, associatedTokenAccount } from "../lib/paid-access.js";

const wallet = process.argv[2] || process.env.PAY_TO;
if (!wallet || !isAddress(wallet)) {
  console.error("Not a Solana address:", wallet || "(none)");
  process.exit(1);
}

const MINTS = { USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", AUDD: "AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw" };

console.log(`Receiving wallet ${wallet}\n`);
for (const [symbol, mint] of Object.entries(MINTS)) {
  console.log(`${symbol} (${mint})`);
  for (const [name, program] of Object.entries(TOKEN_PROGRAMS)) {
    console.log(`  if the mint uses ${name.padEnd(10)} ${await associatedTokenAccount(wallet, mint, program)}`);
  }
}
console.log("\nThe server reads each mint's program at startup and prints the one that applies.");
console.log("Look that account up on explorer.solana.com: it must exist before the first payment.");
