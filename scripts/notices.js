// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Runs after the browser build. Reads esbuild's metafile and writes:
//   NOTICE                 project notice plus every third-party package shipped in public/js
//   public/weblabels.html  GNU LibreJS web labels for each served script
// Regenerate with `npm run build`; do not edit either output by hand.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const meta = JSON.parse(fs.readFileSync(path.join(root, "build", "meta.json"), "utf8"));

const LICENSE_URLS = {
  "AGPL-3.0-or-later": ["https://www.gnu.org/licenses/agpl-3.0.html", "GNU-AGPL-3.0-or-later"],
  MIT: ["http://www.jclark.com/xml/copying.txt", "Expat"],
  "Apache-2.0": ["http://www.apache.org/licenses/LICENSE-2.0", "Apache-2.0"],
};

function packageInfo(name) {
  const dir = path.join(root, "node_modules", name);
  const pj = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const licFile = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  const text = licFile ? fs.readFileSync(path.join(dir, licFile), "utf8") : "";
  const copyright = (text.match(/^.*copyright\s+(\(c\)|©)?\s*\d{4}.*(\n[ \t]+\S.*)*/im) || [])[0]?.replace(/\s*\n\s*/g, " ").trim();
  const repo = typeof pj.repository === "string" ? pj.repository : pj.repository?.url || "";
  const noticeFile = fs.readdirSync(dir).find((f) => /^notice/i.test(f));
  return {
    name,
    version: pj.version,
    license: pj.license,
    copyright:
      copyright ||
      `No copyright notice in the published package${pj.author ? `; author: ${typeof pj.author === "string" ? pj.author : pj.author.name}` : ""}`,
    repo: repo.replace(/^git\+/, "").replace(/\.git$/, ""),
    notice: noticeFile ? fs.readFileSync(path.join(dir, noticeFile), "utf8").trim() : "",
    text: text.trim(),
  };
}

const scripts = [];
const packages = new Map();
for (const [out, o] of Object.entries(meta.outputs)) {
  if (!out.endsWith(".js")) continue;
  const licenses = new Set(["AGPL-3.0-or-later"]);
  for (const input of Object.keys(o.inputs)) {
    const m = input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    if (!m) continue;
    if (!packages.has(m[1])) packages.set(m[1], packageInfo(m[1]));
    licenses.add(packages.get(m[1]).license);
  }
  scripts.push({ file: "/" + path.relative(path.join(root, "public"), path.join(root, out)), licenses: [...licenses] });
}

// The front page's lightbox is plain first-party code, served as written.
scripts.push({ file: "/js/lightbox.js", licenses: ["AGPL-3.0-or-later"] });
scripts.push({ file: "/js/page.js", licenses: ["AGPL-3.0-or-later"] });
// Metrics, loaded by every page from privacysafe.click (a Plausible Analytics
// instance; its tracker script is MIT-licensed).
scripts.push({ file: "https://privacysafe.click/js/script.js", licenses: ["MIT"], source: "https://github.com/plausible/analytics/tree/master/tracker" });

for (const p of packages.values()) {
  if (!LICENSE_URLS[p.license]) throw new Error(`${p.name}: license ${p.license} has no entry; review it before shipping`);
}

const list = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
const notice = `Secret Agent Club paid access proof of concept
NOTICE

Copyright (C) 2026 Ivy Cyber LLC
https://ivycyber.com

Unless a file or component carries a different notice, copyright is held by
Ivy Cyber LLC.

Software: GNU Affero General Public License version 3 or later (AGPL-3.0-or-later)
Documentation: GNU Affero General Public License version 3 or later (AGPL-3.0-or-later)

See LICENSE and LICENSES for applicable license terms. Third-party components
retain their original copyright notices and licenses. REUSE.toml records the
license of every file that cannot carry its own SPDX header.

Third-party material
--------------------

Stack Sans Text (public/fonts/StackSansText.woff2)
  Copyright 2025 The Stack Sans Project Authors
  https://github.com/DylanYoungKoto/Stack-Sans
  SIL Open Font License 1.1 (public/fonts/OFL.txt, LICENSES/OFL-1.1.txt)

Phantom, MetaMask, Solflare, Backpack, USDC and Solana marks (public/img/brands/)
  From @web3icons/core 4.0.58, https://github.com/0xa3k5/web3icons
  Copyright (c) 2024 0xa3k5
  MIT License (LICENSES/MIT.txt)
  The marks themselves remain trademarks of their respective owners.

Contributor Covenant 3.0 (CODE_OF_CONDUCT.md, adapted)
  Organization for Ethical Source
  https://www.contributor-covenant.org/version/3/0/code_of_conduct/
  CC BY-SA 4.0 (LICENSES/CC-BY-SA-4.0.txt)

Material under other licenses
-----------------------------

Walkthrough music (public/videos/, design/walkthrough-videos/,
design/source-media/tinyworlds-*.mp3)
  "Happy Adventure (Loop)" (desktop walkthrough) and "Honey Bear" (device
  walkthrough) by Tiny Worlds (https://nullrights.com/artist/TinyWorlds),
  dedicated to the public domain under CC0 1.0 Universal
  (https://creativecommons.org/publicdomain/zero/1.0/, LICENSES/CC0-1.0.txt).
  Mixed under the walkthroughs at 65% volume with a fade in and out; the
  combined walkthrough uses both, one per part.

Photograph of John Kiriakou on The Joe Rogan Experience
(public/img/poc/kiriakou-rogan.jpg)
  A still from a third-party broadcast, used as on ivycyber.com. It is not
  covered by this repository's license; see LICENSES/LicenseRef-ThirdPartyStill.txt.

Portrait of John Kiriakou (public/img/john-kiriakou.webp)
  Cropped from assets/people/john-kiriakou.png in the PrivacySafe press kit,
  published by Ivy Cyber LLC under CC BY-SA 4.0. ShareAlike keeps this crop
  under the same license (LICENSES/CC-BY-SA-4.0.txt).

Sample episode (media/video.webm, media/video.mp4, media/poster.jpg) is an Ivy
Cyber LLC recording with John Kiriakou, used here as the demo's members-only
episode.

PrivacySafe artwork, app icons, favicons and logos (public/img/,
privacysafe_logo.svg) are Ivy Cyber LLC originals under AGPL-3.0-or-later, like
the rest of this repository.
PrivacySafe(R) is a registered trademark; see TRADEMARKS.md.

JavaScript shipped to browsers (public/js/)
-------------------------------------------

The scripts in public/js are built from client/ and lib/ (AGPL-3.0-or-later)
with the packages below. Per-script licensing for GNU LibreJS is published at
/weblabels.html. License texts: LICENSES/MIT.txt, LICENSES/Apache-2.0.txt.

${list
  .map((p) => `${p.name} ${p.version}\n  ${p.copyright}\n  ${p.license}${p.repo ? `\n  ${p.repo}` : ""}${p.notice ? `\n\n  Upstream NOTICE:\n  ${p.notice.replace(/\n/g, "\n  ")}` : ""}`)
  .join("\n\n")}
`;
fs.writeFileSync(path.join(root, "NOTICE"), notice);

// Full license texts travel with the served scripts, as MIT and Apache-2.0 require.
const generic = {
  MIT: fs.readFileSync(path.join(root, "LICENSES", "MIT.txt"), "utf8").trim(),
  "Apache-2.0": fs.readFileSync(path.join(root, "LICENSES", "Apache-2.0.txt"), "utf8").trim(),
};
fs.writeFileSync(
  path.join(root, "public", "js", "THIRD-PARTY-LICENSES.txt"),
  `Third-party software in these scripts. Generated from package metadata at build time.\n\n` +
    list
      .map((p) => `${"=".repeat(78)}\n${p.name} ${p.version} (${p.license})\n${p.repo}\n${p.copyright}\n${"=".repeat(78)}\n\n${p.text || generic[p.license]}${p.notice ? `\n\nNOTICE:\n${p.notice}` : ""}\n`)
      .join("\n"),
);

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const rows = scripts
  .map(
    (s) => `<tr>
<td><a href="${esc(s.file)}">${esc(path.basename(s.file))}</a></td>
<td>${s.licenses.map((l) => `<a href="${LICENSE_URLS[l][0]}">${LICENSE_URLS[l][1]}</a>`).join("<br/>")}</td>
<td><a href="${esc(s.source || "/source")}">Source</a></td>
</tr>`,
  )
  .join("\n");
fs.writeFileSync(
  path.join(root, "public", "weblabels.html"),
  `<!DOCTYPE html>
<!--
SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1" name="viewport"/>
<meta content="dark" name="color-scheme"/>

<!--
  Content Security Policy. Nothing on this site is inline: no style attributes,
  no inline scripts, no event handler attributes. The only external origin is
  privacysafe.click, which serves the metrics script and receives its events.

  frame-ancestors, report-to and sandbox are ignored in a meta tag. Send those
  as real response headers; the header set is in README.md.
-->
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://privacysafe.click; connect-src 'self' https://privacysafe.click; img-src 'self' data:; media-src 'self'; style-src 'self'; font-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; upgrade-insecure-requests"/>
<meta content="strict-origin-when-cross-origin" name="referrer"/>
<title>JavaScript license information | PrivacySafe</title>

<!-- PrivacySafe.click Metrics -->
<script defer data-domain="payments.privacysafe.app" src="https://privacysafe.click/js/script.js"></script>

<link href="/css/app.css" rel="stylesheet"/>
</head>
<body>
<main class="doc" id="top">
<h1>JavaScript license information</h1>
<p>Every script this page runs, its licenses, and where to get the source. Third-party license texts: <a href="/js/THIRD-PARTY-LICENSES.txt">THIRD-PARTY-LICENSES.txt</a>. Full notices are in the <a href="/source">source repository</a>'s <code>NOTICE</code> file.</p>
<div aria-label="Scripts and licenses" class="table-scroll" role="region" tabindex="0">
<table id="jslicense-labels1">
<thead><tr><th scope="col">Script</th><th scope="col">Licenses</th><th scope="col">Source</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
<p><a href="/">Back to the Secret Agent Club</a></p>
</main>
</body>
</html>
`,
);
console.log(`NOTICE: ${list.length} bundled packages; weblabels: ${scripts.length} scripts`);
