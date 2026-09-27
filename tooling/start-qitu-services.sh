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

port_for() {
  case "$1" in
    api) echo "$QITU_API_PORT" ;;
    auth) echo "$QITU_AUTH_PORT" ;;
    student) echo "$QITU_STUDENT_PORT" ;;
    parent) echo "$QITU_PARENT_PORT" ;;
    teacher) echo "$QITU_TEACHER_PORT" ;;
    admin) echo "$QITU_ADMIN_PORT" ;;
  esac
}

probe_path_for() {
  # 除 auth 外的四个前端都开了 basePath，直接探 `/` 会得到 404，
  # 必须探各自壳层里真实存在的一个路径。
  case "$1" in
    api) echo "/api/v1/health" ;;
    auth) echo "/" ;;
    student) echo "/student/today" ;;
    parent) echo "/parent" ;;
    teacher) echo "/teacher/dashboard" ;;
    admin) echo "/admin" ;;
  esac
}

status_one() {
  # 进程存活 ≠ 服务可用：services/api 跑在 `nest start --watch` 下，编译失败时
  # 进程仍然活着但端口根本没监听；Next dev 也可能启动到一半就崩掉。
  # 之前只看 pid 的写法会把这种状态报成 “running”，已经误导过一次排查，
  # 所以这里必须实际发一个请求来判定。
  local name="$1"
  local port
  port="$(port_for "$name")"
  local pid_file="$RUNTIME_DIR/pids/$name.pid"
  local pid=""

  if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    pid="$(cat "$pid_file")"
  fi

  local code
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' \
    "http://$QITU_BIND_HOST:$port$(probe_path_for "$name")" 2>/dev/null || true)"
  code="${code:-000}"

  # 2xx/3xx 都算可用（部分应用在 basePath 外会用跳转处理 `/`）。
  if [[ "$code" =~ ^[23] ]]; then
    echo "$name: ok (pid ${pid:-?}, :$port -> $code)"
    return 0
  fi

  if [[ -n "$pid" ]]; then
    echo "$name: NOT SERVING (pid $pid 存活但 :$port -> $code)，看 $RUNTIME_DIR/logs/$name.log"
  else
    echo "$name: stopped (:$port -> $code)"
  fi
  return 1
}

ensure_shared_packages() {
  # services/api runs `nest start --watch`, which compiles only services/api/src
  # (tsconfig rootDir=src). It therefore cannot transpile workspace packages at
  # runtime, so any package that exports *runtime values* must be built to dist
  # first. Type-only packages (e.g. @qitu/contracts) are erased and need no build.
  echo "building @qitu/database (runtime dependency of api)..."
  (cd "$ROOT" && pnpm --filter @qitu/database build)
}

require_database_env_for_api() {
  # 启动 services/api 前的数据模式预检。
  # 只判断 DATABASE_URL 是否存在，绝不读取/打印其值；连接串由调用方通过环境继承
  # （start_one 里的 `env ...` 只覆盖列出的变量，其余环境原样传递）。
  #
  # 规则与 services/api 的 DatabaseModule 一致：
  # - QITU_DATA_MODE 未设置 / live → 必须有 DATABASE_URL，否则退出；
  # - demo / test 且非 production → 允许无 DATABASE_URL（内存引擎），但给出警告；
  # - production + demo/test，或非法模式 → 退出。
  local mode="${QITU_DATA_MODE:-live}"
  local node_env="${NODE_ENV:-}"

  if [[ -n "${DATABASE_URL:-}" ]]; then
    return 0
  fi

  case "$mode" in
    demo|test)
      if [[ "$node_env" == "production" ]]; then
        echo "错误：production 环境禁止 QITU_DATA_MODE=$mode（内存引擎不得进生产）。" >&2
        echo "Error: QITU_DATA_MODE=$mode is not allowed in production." >&2
        exit 1
      fi
      echo "警告：QITU_DATA_MODE=$mode 且未设置 DATABASE_URL，将启用内存 Directory 引擎（仅限本地/测试）。" >&2
      echo "Warning: QITU_DATA_MODE=$mode without DATABASE_URL — using the in-memory Directory engine (local/test only)." >&2
      ;;
    live|'')
      echo "错误：启动 services/api 需要 DATABASE_URL（仅检查是否存在，不打印其值）。" >&2
      echo "Error: DATABASE_URL is required to start services/api (existence is checked; the value is never printed)." >&2
      echo "提示：仅本地演示可显式 export QITU_DATA_MODE=demo 后重试（不适用于 production）。" >&2
      echo "Hint: for local demos only, export QITU_DATA_MODE=demo and retry (never in production)." >&2
      exit 1
      ;;
    *)
      echo "错误：非法 QITU_DATA_MODE=\"$mode\"；允许 live | demo | test。" >&2
      echo "Error: invalid QITU_DATA_MODE; expected live | demo | test." >&2
      exit 1
      ;;
  esac
}

start_all() {
  ensure_shared_packages
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
  start)
    # 先做预检再启动，缺失环境变量时不会留下半启动状态。
    require_database_env_for_api
    start_all
    ;;
  stop) stop_all ;;
  restart)
    # 预检放在 stop 之前：缺 DATABASE_URL 时直接退出，不会先把服务停掉。
    require_database_env_for_api
    stop_all
    start_all
    ;;
  status)
    status_failed=0
    for svc in api auth student parent teacher admin; do
      status_one "$svc" || status_failed=1
    done
    exit "$status_failed"
    ;;
  *) echo "usage: $0 {start|stop|restart|status}" >&2; exit 2 ;;
esac
