#!/usr/bin/env bash
# Read-only configuration checks. These do not prove inference success.
set -euo pipefail
umask 077
: "${QITU_ADMIN_EMAIL:?Set QITU_ADMIN_EMAIL}"
: "${QITU_ADMIN_PASSWORD:?Set QITU_ADMIN_PASSWORD}"
base="${QITU_API_BASE:-http://127.0.0.1:4100/api/v1}"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
export QITU_ADMIN_EMAIL QITU_ADMIN_PASSWORD
python3 -c 'import json,os; print(json.dumps({"email":os.environ["QITU_ADMIN_EMAIL"],"password":os.environ["QITU_ADMIN_PASSWORD"]}))' > "$work/login.json"
curl --fail --silent --show-error -X POST "$base/auth/login" \
  -H 'Content-Type: application/json' --data-binary "@$work/login.json" \
  -c "$work/cookies" > "$work/login-response.json"
# Never print login responses, session tokens, provider secrets or student data.
echo '=== Provider catalog (configuration only) ==='
curl --fail --silent --show-error "$base/admin/model-providers" -b "$work/cookies" |
  jq '.data | {providers: [.providers[] | {id, enabled, modelCount: (.models | length)}]}'
echo '=== Governed usage bindings (configuration only) ==='
curl --fail --silent --show-error "$base/admin/model-usages" -b "$work/cookies" |
  jq '.data | {bindingCount: (.bindings | length), usageCount: (.usages | length)}'
echo '=== Runtime modality projection (not an inference receipt) ==='
curl --fail --silent --show-error "$base/models/runtime" -b "$work/cookies" | jq '.data'
echo '=== Settings registry ==='
curl --fail --silent --show-error "$base/admin/settings/registry" -b "$work/cookies" | jq '.data | length'
