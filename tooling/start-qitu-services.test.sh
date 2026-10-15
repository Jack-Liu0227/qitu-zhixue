#!/usr/bin/env bash
set -euo pipefail

# Exercise the real deployment entry point without starting or stopping services.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
mkdir -p "$TMP/tooling" "$TMP/bin"
cp "$ROOT/tooling/start-qitu-services.sh" "$TMP/tooling/"
export TEST_CALLS="$TMP/calls"
cat > "$TMP/bin/id" <<'EOF'
#!/usr/bin/env bash
echo 1000
EOF
cat > "$TMP/bin/pnpm" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_CALLS"
exit "${TEST_BUILD_EXIT:-0}"
EOF
cat > "$TMP/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "UNEXPECTED systemctl $*" >> "$TEST_CALLS"
exit 1
EOF
chmod +x "$TMP/bin/"*
export PATH="$TMP/bin:$PATH"
export QITU_ENV_FILE="$TMP/absent.env"
export QITU_SECRET_ENV_FILE="$TMP/absent-secret.env"
export QITU_RUNTIME_DIR="$TMP/runtime"
export QITU_FRONTEND_MODE=dev
export DATABASE_URL='postgresql://unused/test'

run_case() {
  local expected="$1" build_exit="$2" actual=0
  shift 2
  : > "$TEST_CALLS"
  TEST_BUILD_EXIT="$build_exit" bash "$TMP/tooling/start-qitu-services.sh" "$@" > "$TMP/output" 2>&1 || actual=$?
  if [[ "$actual" != "$expected" ]]; then
    cat "$TMP/output"
    echo "FAIL: $* returned $actual, expected $expected" >&2
    exit 1
  fi
  local calls
  calls="$(cat "$TEST_CALLS")"
  if [[ "$calls" != '-r --workspace-concurrency=1 --filter @qitu/api... --filter @qitu/workers... build' ]]; then
    echo "FAIL: unexpected commands for $*: $calls" >&2
    exit 1
  fi
  echo "PASS: $* (build exit $build_exit, command exit $actual)"
}

run_case 0 0 build api
run_case 0 0 build workers
run_case 1 7 build api
run_case 1 7 start api
run_case 1 7 start workers
run_case 1 7 start all
run_case 1 7 restart api
run_case 1 7 restart workers
run_case 1 7 restart all
