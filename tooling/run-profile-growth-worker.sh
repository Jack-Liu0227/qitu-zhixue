#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
set -a
source .runtime/qitu/model-secret.env
source tooling/qitu-ports.env
set +a
exec /usr/sbin/runuser -u postgres -- /usr/bin/env \
  NODE_PATH="$PWD/node_modules/.pnpm/node_modules" \
  NODE_OPTIONS=--max-old-space-size=512 \
  QITU_PROJECT_ROOT="$PWD" \
  /usr/bin/node --enable-source-maps services/workers/dist/projection-index.js
