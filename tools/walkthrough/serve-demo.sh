#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Ivy Cyber LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Runs the app against the stand-in Solana network and facilitator, for recording and tests.
# Usage: tools/walkthrough/serve-demo.sh COMMAND...   (starts both, runs COMMAND, stops both)
set -euo pipefail
cd "$(dirname "$0")/../.."
rm -rf data && mkdir -p build
MOCK_FINALIZE_MS="${MOCK_FINALIZE_MS:-2500}" node tools/walkthrough/mock-solana.mjs > build/mock-solana.log 2>&1 &
MOCK=$!
trap 'kill $MOCK ${APP:-} 2>/dev/null || true' EXIT
for _ in $(seq 50); do curl -s -o /dev/null 127.0.0.1:4021/fac/supported && break; sleep .1; done
PAY_TO=9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM \
SOLANA_RPC_URLS=http://127.0.0.1:4021/r429,http://127.0.0.1:4021/r500,http://127.0.0.1:4021/rpc \
SESSION_SECRET=demo-only-secret-0123456789abcdef0123456789 \
X402=on FACILITATOR_URL=http://127.0.0.1:4021/fac \
node server.js > build/server.log 2>&1 &
APP=$!
for _ in $(seq 80); do curl -s -o /dev/null localhost:3000/api/offer && break; sleep .1; done
"$@"
