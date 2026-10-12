// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reference derivation, base58 and Solana Pay URI checks. No server needed.

import * as R from "../lib/reference.js";
import * as kit from "@solana/kit";
for (let i = 0; i < 2000; i++) {
  const b = crypto.getRandomValues(new Uint8Array(i % 3 ? 32 : 33)); if (i % 7 === 0) b[0] = 0, b[1] = 0;
  if (R.base58(b) !== kit.getBase58Decoder().decode(b)) { console.log("MISMATCH", b); process.exit(1); }
}
const a = await R.deriveReference({ identity: " CiaToken@PrivacySafe.gg ", offerId: "o1", mint: "m", nonce: "n" });
const b = await R.deriveReference({ identity: "ciatoken@privacysafe.gg", offerId: "o1", mint: "m", nonce: "n" });
const c = await R.deriveReference({ identity: "ciatoken@privacysafe.gg", offerId: "o1", mint: "m2", nonce: "n" });
console.log("base58 ok; normalize equal:", a === b, "mint changes ref:", a !== c, "ref len", kit.getBase58Encoder().encode(a).length);
console.log(R.solanaPayUri({ payTo: "9WzD", amount: "1.40", mint: "AUDD", reference: a, label: "Secret Agent Club", message: "Join Secret Agent Club" }));
console.log(R.toAtomic("1.40", 6), R.uriAmount("1.00"), R.uriAmount("10"), R.isIdentity("ciatoken@privacysafe.gg"), R.isIdentity("x@y"));
