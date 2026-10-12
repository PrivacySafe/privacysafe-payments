<p align="center">
  <a href="https://privacysafe.app"><img src="privacysafe_logo.svg" width="300" alt="PrivacySafe" /></a>
</p>

# Secret Agent Club: paid access proof of concept

A web proof of concept for the PrivacySafe Chat paid-access plan. A listener pays John Kiriakou directly with Solana Pay or x402, in USDC or AUDD, and the members' episode plays in the page. It is the web stand-in for slides 8 to 11 of the deck: club card, payment card, confirmed membership with the exclusive episode.

The payment layer here is the one the plan specifies: offer, nonce, derived reference, Solana Pay URI, finalized lookup by reference, mint / amount / destination checks, and a `verified → claiming → admitted` record. Only the fulfilment differs: Chat calls `updateGroupMembers()`; this page issues a viewing pass. `lib/reference.js` and `lib/paid-access.js` are written to be lifted into `chat/src-deno/services/paid-chat/`.

Mainnet only, as the plan decides. Every test moves real money.

## Run it

Node 20 or later.

```
npm ci
npm run build
cp .env.example .env    # set PAY_TO and SESSION_SECRET (openssl rand -hex 32)
# media/ ships with a sample: media/video.webm (VP9/Opus), media/video.mp4 (H.264/AAC) and media/poster.jpg
npm start
```

At startup the server reads both mints from chain (owner program and decimals) and derives the receiving token account for each. It refuses to start if a mint can't be read. It prints both receiving accounts: they must exist before the first payment (see Placeholders).

Put it behind HTTPS and set `TRUST_PROXY=1` so the access cookie is marked Secure.

## Front page

`/` is the proof-of-concept front page (`public/index.html`, `public/css/poc.css`):

- a header with section links, PrivacySafe Social (Mastodon), X and LinkedIn, Share and Try it, folding into a menu on narrower screens;
- what this is, with links to the shipping PrivacySafe apps (Solana dApp Store, Google Play, Android APK, desktop);
- both walkthrough videos, playable and downloadable, with a written description of what happens in them;
- **Try It** (the app, at `/app/`), **Demo Android APK** (psafe.ly/payapk), **Colosseum Hackathon** (psafe.ly/superteam), **Source Code** (`/source`) and **Share** (`public/js/page.js`: the device's share sheet where there is one, otherwise X, Telegram, email, and copy-and-open for Instagram and TikTok);
- the pitch deck (psafe.ly/deck) and the promotional flyer PDF, each with a thumbnail that opens full size in the lightbox;
- the team, mission and development team from ivycyber.com, with the shared lightbox (`public/js/lightbox.js`);
- the PrivacySafe ecosystem card from privacysafe.app, and the PrivacySafe and Bits On Tape footer panels.

Its only third-party request is the metrics script from privacysafe.click. `tests/front.mjs` audits it with axe (WCAG 2.2 AA) at five widths, checks reflow and text spacing, the lightbox's keyboard handling and every local link.

The walkthrough soundtracks are by [Tiny Worlds](https://nullrights.com/artist/TinyWorlds), dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/): "Happy Adventure (Loop)" under the desktop walkthrough and "Honey Bear" under the device walkthrough, at 65% volume with fades. `design/walkthrough-videos/secret-agent-club-walkthrough-combined.mp4` joins the two (device first, a 3-second fade to black, then desktop), each part with its own track. `tools/walkthrough/add-music.sh` rebuilds all three from the silent-music originals.

## Deploying at payments.privacysafe.app

`deploy/payments.privacysafe.app.sh` installs and runs everything on the existing PrivacySafe web server (Debian or Ubuntu, nginx). **payment.privacysafe.app**, the common mistyping, serves exactly the same site; the page's canonical link points search engines at payments.privacysafe.app.

```
# DNS first: A (and AAAA, if the server has IPv6) records for both hostnames
sudo PAY_TO=<receiving Solana wallet> deploy/payments.privacysafe.app.sh
```

- Runs the app under systemd as the **privacysafe-payment** user (created if it doesn't exist; `SVC_USER=` to use another) on 127.0.0.1:3077 only.
- Uses the Let's Encrypt certificates already on the server: it reads every `/etc/letsencrypt/live/*/` certificate and matches the hostnames it names, whether one certificate covers both or each has its own. A missing one is requested by webroot; if that fails, that hostname is redirected to payments.privacysafe.app instead.
- Adds **one new nginx file** (nothing existing is edited), backs up `/etc/nginx` first, reloads only after `nginx -t` passes, and re-checks the existing sites afterwards, removing the new file again if any of them changed.
- Reports problems that don't stop the site from working as warnings, listed at the end, instead of stopping. It stops only where carrying on could break nginx or leave the site down, and says what to do.
- The nginx file is kept tight: `/api/` takes GET and POST only, media and everything else GET only (HEAD wherever GET is), dotfiles never reach the app, request bodies are capped at 16 KB, header and body timeouts are short, and `X-Forwarded-For` is the connecting address only. Per-IP rate and connection limits are sized for a crowd on one event Wi-Fi address (tested with 60 phones opening the app and polling for payments at once, with nothing refused) while a single client flooding the site is throttled. The app's own payment-check throttle is per payment, not per IP, for the same reason.
- If the site's nginx file already exists under another name (for example `payments_privacysafe_app.conf`), the script keeps using that file instead of writing a second copy.
- `--print-nginx` prints the nginx file without changing anything. Re-running is safe.
- `BASE=https://payments.privacysafe.app RESOLVE=<server IP> node tests/flows.mjs 390 844 check` runs the full payment flow in a browser through nginx.

## Content Security Policy

Every page (front page, app, `/weblabels.html`) carries the policy twice, and browsers enforce both, so a source has to be allowed in each:

- **Response header**, sent by `server.js` for everything it serves, including `frame-ancestors 'none'` (which only works as a header):
  `default-src 'self'; script-src 'self' https://privacysafe.click; style-src 'self'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self' https://privacysafe.click; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'`
  plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, a `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin` and, over HTTPS, HSTS.
- **Meta tag** in each page: the same sources plus `upgrade-insecure-requests`. The front page allows `img-src 'self'`; the app and the licence page also allow `data:` images, because the app's QR codes, its CSS icons and the wallet icons a wallet supplies are `data:` URIs.

The only external origin is privacysafe.click, which serves the metrics script (`<script defer data-domain="payments.privacysafe.app" src="https://privacysafe.click/js/script.js">`) and receives its events. Nothing is inline. `tests/csp.mjs` loads each page under its real policy, signs in and opens the payment sheet, and fails if anything is blocked; `tests/flows.mjs` does the same across both payment flows.

## Search, AI crawlers and sharing

- `public/index.html` opens with the PrivacySafe ASCII art, licence and contact header, and carries the description, canonical URL, Open Graph and X card (`/img/social-preview.jpg`, 1200×630), a machine-readable summary for crawlers and retrieval agents, and JSON-LD for Ivy Cyber, PrivacySafe Foundation, the site, the web app and both walkthrough videos.
- `/robots.txt` welcomes search engines and the main AI crawlers by name and keeps them out of `/api/` and the members-only `/media/`. `/llms.txt` is a plain-language summary of the project for language models. `/sitemap.xml` lists the front page with its image and both videos.
- The app page (`/app/`) has its own canonical link and sharing card and is `noindex, follow`, since it is an app shell rather than a page to search.
- The social preview's source is `design/social/social-preview.html`.

## The app

The app lives at `/app/`. A tech demo built as a device app for the PrivacySafe Android wrapper, and responsive up to desktop. On a device it is full screen with bottom sheets; on a tablet it is one centred column; on a desktop (1024px and wider) the player sits on the left with the club details and the join button on the right, and sheets open as centred dialogs.

1. **Splash**, then **sign-in:** enter a PrivacySafe address once. It's remembered on the device and shown as initials in the top bar; tap them to switch address.
2. **Club:** a full-bleed locked episode, John's profile, what members get, and a pinned "Join for 1.00 USDC" button.
3. **Checkout sheet** (slides up):
   - USDC / AUDD switch, then amount, from, to and network.
   - "Open wallet app" (a `solana:` link).
   - "Pay with Phantom (detected)" (x402) when the device has a Solana wallet: the first detected of Phantom, MetaMask, Solflare and Backpack. Hold the button, or tap its arrow, to open a wallet chooser listing every wallet with "(detected)" or "Not detected"; picking one pays with it and makes it the default.
   - "Pay from another device" for the QR code.
4. **Waiting**, in the same sheet: a progress ring and three steps (approve in your wallet, finalize on Solana, episode unlocked). On success the ring turns into a check and the sheet closes.
5. **Member view:** the episode player at the top, "You're a member", and two tiles:
   - **Share in PrivacySafe Chat** (`CHAT_URL`)
   - **Save to PrivacySafe Storage** (`STORAGE_URL`)

   Each opens a sheet with the `w3n://` link, "Open in PrivacySafe" and "Copy link". Both links are placeholders until the PrivacySafe app defines its share and save targets.

The (i) button in the top bar opens "How payments work", with the source code link. Inside the app there is no demo wording; note for presenters that the members count on the club screen (3,410) is illustrative and the Chat and Storage links are placeholders.

### Android wrapper

- Enable JavaScript, DOM storage and cookies in the WebView.
- In `shouldOverrideUrlLoading`, hand `solana:` and `w3n:` URLs to `Intent.ACTION_VIEW`, so the wallet app and the PrivacySafe app open.
- Point the wrapper at `/app/`. `manifest.webmanifest` starts there and sets portrait orientation, the theme colour and the icons.
- Every sheet adds a history entry, so the Android back button closes the open sheet instead of leaving the page.
- Safe-area insets are respected at the top and bottom, so the page can draw edge to edge.



Only public addresses go in the config. Never put a private key or recovery phrase anywhere in this project.

1. Pick the receiving wallet (John's, or a test wallet you control).
2. `npm run check-address -- <wallet address>` prints the USDC and AUDD token accounts payments will land in. No network needed.
3. Look both up on explorer.solana.com. If either doesn't exist, send that wallet a small amount of that token once.
4. Set `PAY_TO` in `.env` and start the server. It reads both mints from mainnet and prints the receiving accounts it will check; they must match step 2.
5. Pay 1.00 USDC from a wallet on a device, then 1.40 AUDD, and watch both unlock. Keep the test payer's balance small.

## The flow

1. The listener enters their PrivacySafe address and picks USDC (default) or AUDD.
2. The page draws a 32-byte random `nonce` and derives
   `reference = base58(SHA-256(canonicalEncode(["3nweb-paid-chat-v1", identity, offerId, mint, nonce])))`.
   `canonicalEncode` is: uint32 big-endian field count, then for each field a uint32 big-endian byte length and its UTF-8 bytes. Identity is trimmed and lowercased first.
3. It shows a Solana Pay QR (and an "Open in wallet app" link on devices) for
   `solana:<payTo>?amount=…&spl-token=<mint>&reference=<reference>&label=…&message=…`.
4. The pending payment `{ offerId, mint, nonce, identity }` is saved in the browser. It never expires; the listener can remove it.
5. The page posts `{ identity, offerId, mint, nonce }` to `/api/verify` every five seconds. Never the reference.
6. The server recomputes the reference, calls `getSignaturesForAddress(reference)` at finalized commitment, and checks each transaction: not failed, reference present, the configured amount of the chosen mint landed in the host's token account for that mint. Then it stores the `PaidAccess` record as `verified` before fulfilling, moves it to `claiming`, issues the pass, and marks it `admitted`.

A transaction that has already admitted one reference can't admit another, so one payment carrying two listeners' references only lets one in.

### Offers

An offer is one immutable set of terms: target, receiving wallet, accepted mints, amounts. The server stores offers in `data/offers.json`. Changing any term (say `PRICE_USDC`) creates a new `offerId` on the next start and retires the old one, which stays on file so payments already in flight still verify against their original terms.

### RPC failover

`SOLANA_RPC_URLS` in order: OnFinality, `api.mainnet.solana.com`, `api.mainnet-beta.solana.com`. Each call fails over on network error, timeout, HTTP 429, HTTP 5xx, or a response that isn't a JSON-RPC result. If all three fail the payment stays pending; RPC trouble never grants access.

### Two rails, one record

Solana Pay and x402 both sell the same offer to the same wallet and end in the same `PaidAccess` record. Turn x402 on with `X402=on`.

| | Solana Pay | x402 |
|---|---|---|
| How | Scan a QR or tap a link; any Solana wallet | "Pay with Phantom" in the page (any Wallet Standard wallet), or an AI agent over HTTP |
| Network fee | Payer needs a little SOL | Facilitator pays it; no SOL needed |
| Third party | None. The server reads the chain directly | Coinbase's facilitator relays the transaction (no custody; it screens transactions) |
| Proof the payment is this listener's | Reference derived from identity, offer, token and a secret nonce | A random claim returned only to the payer, bound on the server to the settled transaction |
| Verified by | Finalized lookup by reference | Finalized lookup by signature, same token / amount / account checks |
| Fits PrivacySafe Chat | Yes, as the plan specifies | For agents and the web; Chat can add it later on the same verifier |

The x402 flow:

1. `POST /api/unlock` with `{ identity, offerId }` returns 402 with the USDC and AUDD prices on Solana mainnet.
2. The wallet signs; the page resends with the payment. The facilitator settles.
3. The server's after-settlement hook records which transaction settled for which claim. The claim is then released to the payer, and only to them.
4. The page polls `POST /api/claim { claim }`. The server fetches that transaction at finalized commitment itself, checks token, amount and receiving account, writes `PaidAccess` (`rail: "x402"`), and grants access.

Because the server binds the transaction to the claim, someone who sees the transaction on chain can't claim it, and a transaction used on one rail can't be claimed on the other. Agents follow the same two calls. The rail stays inside Coinbase's free tier by stopping at `MONTHLY_SETTLE_CAP` (default 900 a month). Browser code for x402 loads only when someone clicks a wallet button, so Solana Pay visitors download about 14 KB.

## What this proves, and what it doesn't

| Plan item | Here |
|---|---|
| Reference derivation binding identity, offer, mint and nonce | Built and tested |
| Solana Pay URI and QR, USDC then AUDD | Built; QR decodes to the URI at desktop and device sizes. Gate 2 (Phantom honouring `reference`) needs a real device |
| Finalized lookup by reference, mint / amount / destination checks | Built and tested |
| `PaidAccess` written before fulfilment, `verified → claiming → admitted` | Built and tested |
| Pending payments never expire | Built: kept in the browser until the listener removes them |
| Offer immutability, retired offers still verify | Built and tested |
| Three-endpoint RPC failover, pending when all fail | Built and tested |
| Gate 1: Deno outbound `fetch` from the background component | Not covered. This runs in Node |
| Gate 3: custom `chat-payment` ASMail `msgType` | Not covered. The page posts over HTTPS instead |
| Authenticated sender | Not covered. The page trusts the address the listener types; in Chat, ASMail authenticates it. The nonce never goes on chain, so someone watching the chain still can't claim another listener's payment |
| Two-device admin race, `alreadyChatMember` resend | Chat-only; not applicable to a viewing pass |

## Tested

Headless Chromium at 1440px and 390px against a stub Solana RPC:

- USDC payment: QR and link carry the right URI, payment lands, membership confirmed, episode plays, access survives reload.
- AUDD payment at 1.40: stays pending while the transaction is only confirmed, admitted once finalized.
- Wrong amount, and AUDD reference paid in USDC: both fail closed with a message saying no access was granted.
- Pending payment survives a reload and can be resumed.
- Another identity reusing a listener's nonce: stays pending. Same listener replaying: admitted again, no second record.
- One transaction carrying two listeners' references: first admitted, second refused as already claimed.
- Unknown offer, unaccepted mint, malformed address: rejected. Checks faster than one per two seconds per client: refused.
- Price change: new `offerId`, old one retired, an in-flight payment on the old offer still admitted.
- Primary RPC returning 429 and first fallback returning 500: the second fallback answers. All endpoints down: pending.
- x402 rail, desktop with USDC and device with AUDD: a test Wallet Standard wallet signs, the stub facilitator checks the signature and settles, the page waits for finality, access is granted and survives reload. A guessed claim is rejected.
- With x402 on, every Solana Pay test above still passes.
- No request leaves the origin; no script errors.

Not yet run against Solana mainnet or a real wallet.

## Brand marks and photo

Everything original in this repository is AGPL-3.0-or-later: code, documentation, page content and PrivacySafe artwork. John's photo is the exception: it's cropped from the PrivacySafe press-kit portrait (`assets/people/john-kiriakou.png`, CC BY-SA 4.0), and ShareAlike keeps the crop CC BY-SA 4.0.

Phantom, Solflare, Backpack, USDC and Solana marks are from @web3icons/core (MIT), in `public/img/brands/`. AUDD and Seed Vault Wallet use placeholder badges until their own marks are dropped in under the same file names.

## Placeholders and open items

| Item | Status | What to do |
|---|---|---|
| AUDD mint `AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw` | Matches CoinGecko and two token lists; not yet read from AUDD's own page. | Confirm at audd.digital before the first payment. A wrong mint on mainnet loses money. |
| AUDD acquisition | Unknown. | Day one: request a live swap quote against that exact mint. |
| AUDD and Seed Vault marks | Placeholder badges. | Replace `public/img/brands/audd.svg` and `seedvault.svg` with their own marks. |
| Receiving token accounts | `npm run check-address` prints them offline; the server prints them again at startup. | Send the receiving wallet a small amount of USDC and of AUDD so both accounts exist. Payments to a missing account fail in the wallet. |
| Prices | 1.00 USDC and 1.40 AUDD, as in the plan. | Reconcile with the deck (see below). |
| Gate 2 | Untested with real wallets. | One USDC and one AUDD payment from Phantom on a device, then Solflare and Seed Vault Wallet. |
| Desktop wallets | Covered by x402 when it's on; otherwise scan with a device. | Get CDP API keys for the x402 rail. |
| x402 with real wallets | Untested against Phantom and Coinbase's facilitator. | One USDC and one AUDD browser payment. Coinbase's docs don't name AUDD; if it's refused, set `X402_ASSETS=USDC` so AUDD stays Solana Pay only. |
| Android wrapper | `solana:` links must leave the WebView. | In `shouldOverrideUrlLoading`, send `solana:` URLs to `Intent.ACTION_VIEW` so the wallet app opens. |
| Who the listener is | Typed, not authenticated. | Fine for the web demo; Chat gets it from ASMail. |

## Deck reconciliation

Slides 8 to 11 and this proof of concept disagree in three places; the plan flags the same:

- Slides say "x402 · Solana · … · no custody". With `X402=on` that's accurate; the payment card says "Solana Pay or x402 · Solana · … · no custody".
- Slides 10 and 11 quote 250 AUDD / 225 USDC; the plan and this page use 1.40 AUDD / 1.00 USDC for the demo.
- Slide 10's button reads "Join Fan Club" on John's card; this page says "Join the club". Slide 10 also names the podcast, which the interview notes say not to do.

## Dependencies

Pinned exact versions, each at least two weeks old, and every package in `package-lock.json` is too. `npm audit`: 0 vulnerabilities.

`npm run build` bundles the browser scripts and regenerates `NOTICE`, `public/weblabels.html` (GNU LibreJS labels) and `public/js/THIRD-PARTY-LICENSES.txt` from what was actually bundled. Commit all three with the scripts.

## Accessibility

Target: WCAG 2.2 AA. Checked in headless Chromium at 390px, 320px, 820px, 1440px and 1920px across 45 states (sign-in, sign-in error, club, account, about, checkout and storage sheets, waiting, member view): axe-core 4.13 (WCAG 2.0 to 2.2 A/AA plus best practices) reports 0 violations. Also checked: pixel-sampled contrast for text over the hero art, keyboard order and focus return from sheets, 24px minimum targets, and WCAG text-spacing overrides at 320px. Animations are switched off for reduced motion. Captions are served from `media/captions.vtt` when present; the episode needs one before it is published.

## 🤝 Contributing

Contributions are welcome. Please fork, remix, and submit focused pull requests.

Never send sensitive information about yourself or other users through ordinary direct messages or unencrypted email.

* **Report Abuse:** <abuse@privacysafe.net> - use the published GPG key when sensitive information is involved.

### Project documents

- **Values:** [`VALUES.md`](VALUES.md)
- **Contributor information:** [`CONTRIBUTORS.md`](CONTRIBUTORS.md)
- **Contribution terms:** [`CONTRIBUTING.md`](CONTRIBUTING.md)
- **Code of Conduct:** [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
- **Contributor Guidelines:** [`CONTRIBUTOR_GUIDELINES.md`](CONTRIBUTOR_GUIDELINES.md)
- **AI Contribution Policy:** [`AI_POLICY.md`](AI_POLICY.md)
- **Security and vulnerability reporting:** [`SECURITY.md`](SECURITY.md)
- **Funding:** [`.github/FUNDING.yml`](.github/FUNDING.yml)

## 🏛️ PrivacySafe Foundation

[PrivacySafe Foundation](https://privacysafe.foundation) is a 501(c)(3) nonprofit public charity supporting Free/Libre and Open Source Software (FLOSS), cybersecurity education, decentralized technology, documentation, standards work, and public-interest privacy and security research.

### Support the Foundation

* [Donate directly to the Foundation](https://privacysafe.foundation)
* [Open Collective](https://opencollective.com/privacysafe)
* [Ko-fi](https://ko-fi.com/R6R1194HN7)
* [Liberapay](https://liberapay.com/PrivacySafe/donate)

The Foundation website provides options for card donations, PayPal/Venmo, cryptocurrency, checks, and other forms of support. Donations are often tax-deductible in the USA. Federal EIN: 41-5237617.

## ⚖️ License

Copyright © 2026 [Ivy Cyber LLC](https://ivycyber.com).

Unless otherwise noted, original software in this repository is licensed under the [GNU Affero General Public License version 3 or later](LICENSE) (`AGPL-3.0-or-later`). Anyone using a running copy over a network can get its source from the page's "Source Code" link (`/source`, set with `SOURCE_URL`).

PrivacySafe® and 3NWeb® are registered trademarks. PrivacySafe Foundation™ and Ivy Cyber™ are pending trademarks. Other product, service, technology, and organization names, logos, and marks may also be protected by applicable trademark and unfair competition law. Free software licenses do not grant trademark rights.

Third-party components retain their original copyrights and licenses. See [`NOTICE`](NOTICE), `LICENSES`, [`REUSE.toml`](REUSE.toml), and file-level SPDX identifiers.
