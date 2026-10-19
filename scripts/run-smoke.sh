#!/bin/bash
set -e
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --local --persist-to .wrangler/smoke-state --ip 127.0.0.1 --port 4188 --inspector-port 0 > .sites-runtime/smoke.log 2>&1 &
worker_pid=$!
trap 'kill $worker_pid 2>/dev/null || true; wait $worker_pid 2>/dev/null || true' EXIT
node scripts/smoke-hosted.mjs
