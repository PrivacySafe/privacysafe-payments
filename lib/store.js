// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";

export function jsonStore(file, initial) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let data = initial;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  return {
    get: () => data,
    save() {
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    },
  };
}
