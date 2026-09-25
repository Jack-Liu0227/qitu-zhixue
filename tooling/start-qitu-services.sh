#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${QITU_ENV_FILE:-$ROOT/tooling/qitu-ports.env}"
RUNTIME_DIR="${QITU_RUNTIME_DIR:-$ROOT/.runtime/qitu}"
mkdir -p "$RUNTIME_DIR/logs" "$RUNTIME_DIR/pids"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

QITU_BIND_HOST="${QITU_BIND_HOST:-127.0.0.1}"
QITU_AUTH_PORT="${QITU_AUTH_PORT:-3100}"
QITU_STUDENT_PORT="${QITU_STUDENT_PORT:-3101}"
QITU_PARENT_PORT="${QITU_PARENT_PORT:-3102}"
QITU_TEACHER_PORT="${QITU_TEACHER_PORT:-3103}"
QITU_ADMIN_PORT="${QITU_ADMIN_PORT:-3104}"
QITU_API_PORT="${QITU_API_PORT:-4100}"

start_one() {
  local name="$1" port="$2" filter="$3" mode="$4"
  local pid_file="$RUNTIME_DIR/pids/$name.pid"
  local log_file="$RUNTIME_DIR/logs/$name.log"

  if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    echo "$name already running (pid $(cat "$pid_file"))"
    return
  fi
  rm -f "$pid_file"

  local root_q
  printf -v root_q '%q' "$ROOT"
  local command
  if [[ "$mode" == "next" ]]; then
    command="cd $root_q && exec env HOST=$QITU_BIND_HOST PORT=$port pnpm --filter $filter exec next dev --hostname $QITU_BIND_HOST --port $port"
  else
    command="cd $root_q && exec env HOST=$QITU_BIND_HOST PORT=$port pnpm --filter $filter dev"
  fi

  setsid bash -c "$command" >"$log_file" 2>&1 &
  echo $! >"$pid_file"
  echo "started $name on 127.0.0.1:$port (pid $!)"
}

stop_one() {
  local name="$1"
  local pid_file="$RUNTIME_DIR/pids/$name.pid"
  [[ -f "$pid_file" ]] || return 0
  local pid
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" 2>/dev/null; then
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    for _ in {1..20}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
  fi
  rm -f "$pid_file"
  echo "stopped $name"
}

status_one() {
  local name="$1"
  local pid_file="$RUNTIME_DIR/pids/$name.pid"
  if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    echo "$name: running (pid $(cat "$pid_file"))"
  else
    echo "$name: stopped"
  fi
}

start_all() {
  start_one api "$QITU_API_PORT" '@qitu/api' api
  start_one auth "$QITU_AUTH_PORT" '@qitu/auth-portal' next
  start_one student "$QITU_STUDENT_PORT" '@qitu/student-center' next
  start_one parent "$QITU_PARENT_PORT" '@qitu/parent-companion' next
  start_one teacher "$QITU_TEACHER_PORT" '@qitu/teacher-workspace' next
  start_one admin "$QITU_ADMIN_PORT" '@qitu/admin-console' next
}

stop_all() {
  stop_one admin
  stop_one teacher
  stop_one parent
  stop_one student
  stop_one auth
  stop_one api
}

case "${1:-status}" in
  start) start_all ;;
  stop) stop_all ;;
  restart) stop_all; start_all ;;
  status)
    status_one api; status_one auth; status_one student; status_one parent; status_one teacher; status_one admin
    ;;
  *) echo "usage: $0 {start|stop|restart|status}" >&2; exit 2 ;;
esac
