// SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Tries each endpoint in order. Fails over on network error, timeout, HTTP 429, HTTP 5xx,
// or a response that isn't a JSON-RPC result. If every endpoint fails, the caller gets an
// error with rpcUnavailable set, and payments stay pending.
export function createRpc(urls, { timeoutMs = 8000 } = {}) {
  return async function call(method, params) {
    let last;
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 429 || res.status >= 500) {
          last = new Error(`${new URL(url).host} HTTP ${res.status}`);
          continue;
        }
        const body = await res.json().catch(() => null);
        if (!body || body.jsonrpc !== "2.0" || !("result" in body)) {
          last = new Error(`${new URL(url).host} invalid response${body?.error ? `: ${body.error.message}` : ""}`);
          continue;
        }
        return body.result;
      } catch (err) {
        last = err;
      }
    }
    throw Object.assign(new Error(`All RPC endpoints failed: ${last?.message || "unknown"}`), { rpcUnavailable: true });
  };
}
