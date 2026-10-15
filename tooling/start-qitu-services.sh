#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${QITU_ENV_FILE:-$ROOT/tooling/qitu-ports.env}"
RUNTIME_DIR="${QITU_RUNTIME_DIR:-$ROOT/.runtime/qitu}"
mkdir -p "$RUNTIME_DIR/logs" "$RUNTIME_DIR/pids"

# 本机生成的模型密钥加密主密钥只放运行时目录；不进入 Git、日志或响应。
SECRET_ENV_FILE="${QITU_SECRET_ENV_FILE:-$RUNTIME_DIR/model-secret.env}"
if [[ -f "$SECRET_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SECRET_ENV_FILE"
  set +a
fi

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

QITU_BIND_HOST="${QITU_BIND_HOST:-127.0.0.1}"
QITU_AUTH_PORT="${QITU_AUTH_PORT:-3100}"
QITU_STUDENT_PORT="${QITU_STUDENT_PORT:-3101}"
QITU_PARENT_PORT="${QITU_PARENT_PORT:-3102}"
QITU_TEACHER_PORT="${QITU_TEACHER_PORT:-3103}"
QITU_ADMIN_PORT="${QITU_ADMIN_PORT:-3104}"
QITU_API_PORT="${QITU_API_PORT:-4100}"

# 前端跑 dev 还是生产构建。`next dev` 每个常驻 ≈450 MB（webpack 缓存 + 增量编译），
# `next start` 同一应用只需 ≈190 MB；study-remote 共 7.6 GB，四个 dev server 光监听进程
# 就占 1.8 GB，是 OOM 的主要压力源。本地开发保持 dev，服务器在 tooling/qitu-ports.env
# 里写 QITU_FRONTEND_MODE=production。
QITU_FRONTEND_MODE="${QITU_FRONTEND_MODE:-dev}"
# 可选：给常驻 node 进程堆上限（MB），防止单个服务无限增长把整机拖到 OOM。默认不设。
QITU_NODE_MAX_OLD_SPACE_MB="${QITU_NODE_MAX_OLD_SPACE_MB:-}"
# 本轮启动里构建失败的应用 / 包（运行期变量，不进配置）。
BROKEN_FRONTENDS=""
BROKEN_PACKAGES=""
START_FAILED=""
RUNTIME_BUILD_READY=0

app_dir_for() {
  case "$1" in
    auth) echo apps/auth-portal ;;
    student) echo apps/student-center ;;
    parent) echo apps/parent-companion ;;
    teacher) echo apps/teacher-workspace ;;
    admin) echo apps/admin-console ;;
  esac
}

service_filter() {
  case "$1" in
    api) echo '@qitu/api' ;;
    auth) echo '@qitu/auth-portal' ;;
    student) echo '@qitu/student-center' ;;
    parent) echo '@qitu/parent-companion' ;;
    teacher) echo '@qitu/teacher-workspace' ;;
    admin) echo '@qitu/admin-console' ;;
    workers) echo '@qitu/workers' ;;
  esac
}

pid_matches_service() {
  local name="$1" pid="$2"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || return 1
  # 新格式：pid 文件记的是 setsid 会话首进程（一个 bash 包装层），命令行里看不到
  # `pnpm --filter …`，所以先按 QITU_SVC 标记判定归属；标记缺失时退回旧的命令行匹配，
  # 保证升级脚本后仍能识别升级之前启动的进程。
  # `{ …; } 2>/dev/null` 是必需的：进程在扫描中途退出时，重定向失败信息由 bash 自己打印，
  # 不分组包起来就会满屏刷 `/proc/xxx/environ: No such process`。
  local envs
  envs="$({ tr '\0' '\n' <"/proc/$pid/environ"; } 2>/dev/null)" || true
  case $'\n'"$envs"$'\n' in
    *$'\n'"QITU_SVC=$name"$'\n'*) return 0 ;;
  esac
  ps -p "$pid" -o args= 2>/dev/null | grep -F -- "pnpm --filter $(service_filter "$name")" >/dev/null
}

systemd_managed() {
  # `is-active` 会漏掉 enabled 但正在 crash-loop / failed 的单元。那次故障里
  # qitu-auth.service 处于 failed，脚本以为没人管，就在 :3100 上又起了一个
  # `next dev`，systemd 随后重启自己的单元 —— 端口撞车，auth 反复重启，
  # Nginx 对 `/`、`/login` 全线 502。归属判断必须看 enabled 状态。
  local unit="qitu-$1.service"
  systemctl is-active --quiet "$unit" 2>/dev/null && return 0
  systemctl is-enabled --quiet "$unit" 2>/dev/null
}

marker_pids() {
  # 列出带 QITU_SVC=<name> 环境标记的进程；标记由 `export` 设置，会被 fork/exec 继承，
  # 因此 pnpm → next → next-server、nest → sh -c → node dist/main 整棵树都能找到。
  local name="$1" pid envs
  for pid in /proc/[0-9]*; do
    [[ -r "$pid/environ" ]] || continue
    envs="$({ tr '\0' '\n' <"$pid/environ"; } 2>/dev/null)" || continue
    case $'\n'"$envs"$'\n' in
      *$'\n'"QITU_SVC=$name"$'\n'*) echo "${pid#/proc/}" ;;
    esac
  done
  return 0
}

service_session_leader() {
  # 返回该服务的会话首进程（setsid 后的那个），它同时也是进程组组长，
  # 可以安全地用 `kill -- -pid` 回收整棵树。
  local name="$1" pid pgid
  for pid in $(marker_pids "$name"); do
    pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
    if [[ -n "$pgid" && "$pgid" == "$pid" ]]; then
      echo "$pid"
      return 0
    fi
  done
  return 1
}

kill_service_tree() {
  local name="$1" pid pgid groups="" g alive
  for pid in $(marker_pids "$name"); do
    pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
    [[ -n "$pgid" && "$pgid" != "0" ]] || continue
    case " $groups " in *" $pgid "*) ;; *) groups="$groups $pgid" ;; esac
  done
  [[ -n "$groups" ]] || return 0
  for g in $groups; do
    kill -TERM -- "-$g" 2>/dev/null || true
  done
  for _ in {1..20}; do
    alive=0
    for g in $groups; do
      kill -0 -- "-$g" 2>/dev/null && alive=1
    done
    [[ $alive -eq 0 ]] && break
    sleep 0.25
  done
  for g in $groups; do
    kill -KILL -- "-$g" 2>/dev/null || true
  done
  return 0
}

pids_on_port() {
  local port="$1"
  fuser -n tcp "$port" 2>/dev/null | tr -s ' \t' '\n' | grep -E '^[0-9]+$' || true
  return 0
}

clear_port() {
  # 端口占用者可能是旧版脚本起的、没有标记的遗留进程；按端口清理是唯一的兼容做法。
  local port="$1"
  [[ -n "$port" ]] || return 0
  fuser -k -n tcp "$port" 2>/dev/null || true
  return 0
}

orphan_watcher_pids() {
  # 历史泄漏回收用：被 init 收养（PPID=1）的 `nest start --watch` 守护进程。
  # 排除当前真正在服务 API 端口的那个进程组，别把活着的 :$QITU_API_PORT 一起杀掉。
  local live_pgid="" lp pid pgid
  for lp in $(pids_on_port "$QITU_API_PORT"); do
    live_pgid="$(ps -o pgid= -p "$lp" 2>/dev/null | tr -d ' ')"
    [[ -n "$live_pgid" ]] && break
  done
  for pid in $(ps -eo pid=,ppid=,args= | awk '$2 == 1 && /nest\.js start --watch/ { print $1 }'); do
    pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
    [[ -n "$pgid" ]] || continue
    [[ -n "$live_pgid" && "$pgid" == "$live_pgid" ]] && continue
    echo "$pid"
  done
  return 0
}

reap_orphan_watchers() {
  # 旧版把 `$!` 写进 pid 文件，但交互式调用时 setsid 会 fork：记下的是转瞬即逝的父进程，
  # 真正活着的新会话没人能杀。study-remote 上因此堆了 12 个 `nest --watch`（≈3.9 GB），
  # 内存+swap 打满后 OOM killer 逐个杀掉 Next 进程，Nginx 全线 502。
  local pids pid count=0
  pids="$(orphan_watcher_pids)"
  [[ -n "$pids" ]] || { echo "no leaked watcher processes"; return 0; }
  for pid in $pids; do
    kill -TERM -- "-$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    count=$((count + 1))
  done
  sleep 2
  for pid in $(orphan_watcher_pids); do
    kill -KILL -- "-$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  done
  echo "reaped $count leaked watcher process(es)"
  return 0
}

start_one() {
  local name="$1" port="$2" filter="$3" mode="$4"
  local pid_file="$RUNTIME_DIR/pids/$name.pid"
  local log_file="$RUNTIME_DIR/logs/$name.log"

  if systemd_managed "$name"; then
    # 交还所有权：旧版脚本自己在 :3104 上起的 `next dev` 不归 systemd 管，
    # 单元里的 next-server 抢不到端口就会 crash-loop 到 StartLimitBurst 进 failed，
    # 而 status 因为遗留进程还在监听而报 ok —— 「看着正常、实际在崩」就是这种状态。
    echo "$name is managed by systemd (qitu-$name.service); restarting via systemctl..."
    local unit="qitu-$name.service"
    if [[ "$mode" == "next" && "$QITU_FRONTEND_MODE" == "production" ]] && ! frontend_build_usable "$name"; then
      # 先检查再停：否则会把一个还能对外服务的单元停成真正的 502。
      echo "$name: 生产模式下没有可用构建，$unit 会 crash-loop；先执行 '$0 build'" >&2
      return 1
    fi
    systemctl stop "$unit" 2>/dev/null || true
    kill_service_tree "$name"
    clear_port "$port"
    rm -f "$pid_file"
    systemctl reset-failed "$unit" 2>/dev/null || true
    if ! systemctl start "$unit"; then
      echo "$name: systemctl start failed; check 'journalctl -u $unit'" >&2
      return 1
    fi
    return 0
  fi

  if [[ -f "$pid_file" ]]; then
    local existing_pid
    existing_pid="$(cat "$pid_file")"
    if pid_matches_service "$name" "$existing_pid"; then
      echo "$name already running (pid $existing_pid)"
      return
    fi
    echo "$name has a stale PID file; removing it"
    rm -f "$pid_file"
  fi

  # pid 文件丢了不代表进程没了（例如上一次运行被 OOM 打断）；按标记再确认一次，
  # 避免同一个端口上起两份服务互相抢监听。
  local leader
  leader="$(service_session_leader "$name" || true)"
  if [[ -n "$leader" ]]; then
    echo "$name already running (pid $leader, recovered via QITU_SVC marker)"
    echo "$leader" >"$pid_file"
    return
  fi

  local root_q
  printf -v root_q '%q' "$ROOT"
  local node_opts=""
  if [[ -n "$QITU_NODE_MAX_OLD_SPACE_MB" ]]; then
    # env 只接受 VAR=value 形式的赋值，因此必须带 NODE_OPTIONS= 前缀。
    node_opts="NODE_OPTIONS=--max-old-space-size=$QITU_NODE_MAX_OLD_SPACE_MB "
  fi
  local command
  if [[ "$mode" == "next" ]]; then
    local next_bin="next dev"
    if [[ "$QITU_FRONTEND_MODE" == "production" ]]; then
      if frontend_build_usable "$name"; then
        next_bin="next start"
      else
        # 构建缺失或刚才构建失败：退回 next dev 让端口有人应答，
        # 一个坏掉的应用不该把另外四个一起带走。
        echo "$name: 无可用生产构建，退回 next dev（修好后跑 '$0 build'）" >&2
      fi
    fi
    command="cd $root_q && exec env ${node_opts}HOST=$QITU_BIND_HOST PORT=$port pnpm --filter $filter exec $next_bin --hostname $QITU_BIND_HOST --port $port"
  elif [[ "$mode" == "worker" ]]; then
    command="cd $root_q && exec env ${node_opts}pnpm --filter $filter dev"
  else
    command="cd $root_q && exec env ${node_opts}HOST=$QITU_BIND_HOST PORT=$port pnpm --filter $filter dev"
  fi
  # 先 export 标记：子进程 exec 后命令行会丢掉服务名（nest.js start --watch），
  # 但 /proc/<pid>/environ 仍带着标记，stop 时才能把整棵进程树找回来。
  command="export QITU_SVC=\"$name\"; $command"

  local spawn=(setsid bash -c "$command")
  if [[ ("$name" == api || "$name" == workers) && "$(id -u)" == 0 && "$(id -un 2>/dev/null)" != postgres ]]; then
    runuser -u postgres -- "${spawn[@]}" >"$log_file" 2>&1 &
  else
    "${spawn[@]}" >"$log_file" 2>&1 &
  fi
  local launch_pid=$!
  local owner_pid=""
  for _ in {1..40}; do
    owner_pid="$(service_session_leader "$name" || true)"
    [[ -n "$owner_pid" ]] && break
    sleep 0.25
  done
  [[ -n "$owner_pid" ]] || owner_pid="$launch_pid"
  echo "$owner_pid" >"$pid_file"
  if [[ -n "$port" ]]; then
    echo "started $name on 127.0.0.1:$port (pid $owner_pid)"
  else
    echo "started $name (pid $owner_pid)"
  fi
}

stop_one() {
  local name="$1"
  local port
  port="$(port_for "$name")"
  if systemd_managed "$name"; then
    echo "$name is managed by systemd (qitu-$name.service); stopping via systemctl..."
    systemctl stop "qitu-$name.service"
    # systemd 停完不等于端口干净：遗留的同端口进程要一起清，否则下次 start 报端口占用。
    kill_service_tree "$name"
    clear_port "$port"
    rm -f "$RUNTIME_DIR/pids/$name.pid"
    return
  fi
  local pid_file="$RUNTIME_DIR/pids/$name.pid"
  local pid
  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file")"
    if pid_matches_service "$name" "$pid"; then
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
      for _ in {1..20}; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.25
      done
    else
      echo "$name has a stale PID file; removing it"
    fi
    rm -f "$pid_file"
    echo "stopped $name"
  fi
  # pid 文件只是入口；守护进程（nest --watch、tsx watch）会再收养一批子进程，
  # 必须按标记把整棵树清干净，否则重启一次就漏一组进程。
  kill_service_tree "$name"
  clear_port "$port"
  if [[ "$name" == workers ]]; then
    pkill -f "tsx.*watch src/index.ts" 2>/dev/null || true
  fi
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
    api) echo "/api/v1/health/ready" ;;
    auth) echo "/" ;;
    student) echo "/student/today" ;;
    parent) echo "/parent" ;;
    teacher) echo "/teacher/dashboard" ;;
    admin) echo "/admin" ;;
  esac
}

status_one() {
  local name="$1"
  if [[ "$name" == workers ]]; then
    local pid_file="$RUNTIME_DIR/pids/$name.pid"
    local pid=""
    if [[ -f "$pid_file" ]] && pid_matches_service "$name" "$(cat "$pid_file")"; then pid="$(cat "$pid_file")"; fi
    if [[ -n "$pid" ]]; then echo "$name: ok (pid $pid)"; return 0; fi
    echo "$name: stopped (worker process not found)"; return 1
  fi
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
  elif systemctl is-active --quiet "qitu-$name.service" 2>/dev/null; then
    pid="$(systemctl show --property MainPID --value "qitu-$name.service" 2>/dev/null || echo '?')"
  fi

  local code
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' \
    "http://$QITU_BIND_HOST:$port$(probe_path_for "$name")" 2>/dev/null || true)"
  code="${code:-000}"

  # 单元本身挂了但端口有人回答 = 遗留进程在顶着，这不是健康状态，必须判为失败。
  if systemd_managed "$name"; then
    local unit_state
    unit_state="$(systemctl is-active "qitu-$name.service" 2>/dev/null || true)"
    if [[ "$unit_state" != "active" && "$code" =~ ^[23] ]]; then
      echo "$name: DEGRADED (:$port -> $code 由遗留进程提供，qitu-$name.service 状态=${unit_state:-unknown})；用 '$0 restart' 交还 systemd"
      return 1
    fi
  fi

  # 2xx/3xx 都算可用（部分应用在 basePath 外会用跳转处理 `/`）。
  if [[ "$code" =~ ^[23] ]]; then
    echo "$name: ok (pid ${pid:-?}, :$port -> $code)"
    return 0
  fi

  if [[ "$name" == auth && ! -f "$ROOT/apps/auth-portal/.next/BUILD_ID" ]]; then
    echo "  提示：auth 缺生产构建（没有 .next/BUILD_ID）。qitu-auth.service 跑的是 next start，"
    echo "        必须先 pnpm --filter @qitu/auth-portal build，再 systemctl restart qitu-auth.service；"
    echo "        不要让脚本在 :3100 起 next dev（见 tooling/auth-production.md）。"
  fi

  if [[ -n "$pid" ]]; then
    echo "$name: NOT SERVING (pid $pid 存活但 :$port -> $code)，看 $RUNTIME_DIR/logs/$name.log"
  else
    echo "$name: stopped (:$port -> $code)"
  fi
  return 1
}

build_runtime_dependencies() {
  # 以真正持有运行时的用户构建：root 部署后再由 postgres 起 `nest --watch`，
  # dist 归属不一致会让 watch 写不了产物（也会让重启后跑的还是旧运行时）。
  if [[ "$(id -u)" == 0 ]] && command -v runuser >/dev/null 2>&1; then
    runuser -u postgres -- bash -c 'cd "$1" && pnpm -r --workspace-concurrency=1 --filter "@qitu/api..." --filter "@qitu/workers..." build' bash "$ROOT"
  else
    (cd "$ROOT" && pnpm -r --workspace-concurrency=1 --filter '@qitu/api...' --filter '@qitu/workers...' build)
  fi
}

ensure_shared_packages() {
  [[ "$RUNTIME_BUILD_READY" == 1 ]] && return 0
  # pnpm selects the transitive workspace graph and builds it topologically.
  # A hand-maintained list missed ai-client/contracts and left stale runtime exports.
  echo "building API/worker dependency graphs (serial, as the runtime owner)..."
  if build_runtime_dependencies; then
    RUNTIME_BUILD_READY=1
    return 0
  fi
  BROKEN_PACKAGES="api/workers dependency graph"
  echo "runtime build failed; refusing to start services with stale dist" >&2
  return 1
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

frontend_build_usable() {
  # 生产构建可用 = 本轮没构建失败过，且 .next/BUILD_ID 存在。
  local name="$1" dir
  case " $BROKEN_FRONTENDS " in *" $name "*) return 1 ;; esac
  dir="$ROOT/$(app_dir_for "$name")/.next/BUILD_ID"
  [[ -f "$dir" ]]
}

frontend_need_build() {
  # 返回 0 = 需要重新构建（没有产物，或源码比产物新）。
  local name="$1" build_id="$2" dir newest_src build_mtime
  if [[ "${QITU_FORCE_FRONTEND_BUILD:-0}" == "1" ]]; then
    return 0
  fi
  [[ -f "$build_id" ]] || return 0
  dir="$ROOT/$(app_dir_for "$name")"
  newest_src="$(find "$dir/src" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.css' \) -printf '%T@\n' 2>/dev/null | sort -rn | head -1 | cut -d. -f1)"
  build_mtime="$(stat -c %Y "$build_id" 2>/dev/null || echo 0)"
  if [[ "$newest_src" =~ ^[0-9]+$ && "$build_mtime" =~ ^[0-9]+$ && "$newest_src" -gt "$build_mtime" ]]; then
    return 0
  fi
  return 1
}

build_frontend() {
  # 单个前端的生产构建（仅生产模式）。必须先停掉该应用再构建，不能往正在服务的 .next 里写。
  if [[ "$QITU_FRONTEND_MODE" != "production" ]]; then
    return 0
  fi
  local name="$1" dir build_id
  dir="$ROOT/$(app_dir_for "$name")"
  build_id="$dir/.next/BUILD_ID"
  if frontend_need_build "$name" "$build_id"; then
    echo "building $name ($(basename "$dir")) ..."
    if ! pnpm --filter "$(service_filter "$name")" build; then
      BROKEN_FRONTENDS="$BROKEN_FRONTENDS $name"
      echo "warning: $name 生产构建失败；脚本托管的会退回 next dev，systemd 托管的请先修构建再 start" >&2
    fi
  else
    echo "frontend $name build is up to date ($(basename "$dir"))"
  fi
  return 0
}

ensure_frontend_builds() {
  # 只在生产模式下构建；next start 不能跑在 dev 产物上。
  # 构建串行执行：并行 next build 峰值内存会超过这台 7.6 GB 机器的余量。
  if [[ "$QITU_FRONTEND_MODE" != "production" ]]; then
    return 0
  fi
  local name
  for name in auth student parent teacher admin; do
    build_frontend "$name"
  done
  return 0
}

start_spec_for() {
  # 输出 start_one 的三个参数：port|filter|mode（port 可以为空，用 | 分隔保留空字段）。
  case "$1" in
    api) echo "$QITU_API_PORT|@qitu/api|api" ;;
    workers) echo "|@qitu/workers|worker" ;;
    auth) echo "$QITU_AUTH_PORT|@qitu/auth-portal|next" ;;
    student) echo "$QITU_STUDENT_PORT|@qitu/student-center|next" ;;
    parent) echo "$QITU_PARENT_PORT|@qitu/parent-companion|next" ;;
    teacher) echo "$QITU_TEACHER_PORT|@qitu/teacher-workspace|next" ;;
    admin) echo "$QITU_ADMIN_PORT|@qitu/admin-console|next" ;;
    *) return 1 ;;
  esac
}

start_selected() {
  # 单服务启动（降内存切换时逐个应用，避免全站短断）。
  local name port filter mode
  for name in "$@"; do
    if ! IFS='|' read -r port filter mode <<<"$(start_spec_for "$name")"; then
      echo "unknown service: $name" >&2
      START_FAILED="$START_FAILED $name"
      continue
    fi
    case "$name" in
      api|workers)
        if ! ensure_shared_packages; then
          START_FAILED="$START_FAILED $name"
          continue
        fi
        ;;
      *) build_frontend "$name" ;;
    esac
    try_start "$name" "$port" "$filter" "$mode"
  done
  return 0
}

try_start() {
  # set -e 下裸调用 start_one 会巾死整个循环；单个服务失败只记录，不影响其余。
  if ! start_one "$@"; then
    START_FAILED="$START_FAILED $1"
  fi
  return 0
}

start_all() {
  if ! ensure_shared_packages; then
    START_FAILED="api workers (runtime build failed)"
    return 1
  fi
  ensure_frontend_builds
  START_FAILED=""
  try_start api "$QITU_API_PORT" '@qitu/api' api
  try_start workers "" '@qitu/workers' worker
  try_start auth "$QITU_AUTH_PORT" '@qitu/auth-portal' next
  try_start student "$QITU_STUDENT_PORT" '@qitu/student-center' next
  try_start parent "$QITU_PARENT_PORT" '@qitu/parent-companion' next
  try_start teacher "$QITU_TEACHER_PORT" '@qitu/teacher-workspace' next
  try_start admin "$QITU_ADMIN_PORT" '@qitu/admin-console' next
  if [[ -n "$START_FAILED" ]]; then
    echo "warning: 未启动的服务：$START_FAILED" >&2
  fi
  return 0
}

stop_all() {
  stop_one admin
  stop_one teacher
  stop_one parent
  stop_one student
  stop_one auth
  stop_one workers
  stop_one api
  # 把早期版本遗留、已经没人认领的 watch 进程一起收掉。
  reap_orphan_watchers
}

case "${1:-status}" in
  start)
    # 先做预检再启动，缺失环境变量时不会留下半启动状态。
    require_database_env_for_api
    if [[ $# -ge 2 && "$2" != "all" ]]; then
      START_FAILED=""
      start_selected "$2"
    else
      start_all
    fi
    if [[ -n "$START_FAILED" ]]; then
      exit 1
    fi
    ;;
  stop)
    if [[ $# -ge 2 && "$2" != "all" ]]; then
      stop_one "$2"
    else
      stop_all
    fi
    ;;
  restart)
    # 预检放在 stop 之前：缺 DATABASE_URL 时直接退出，不会先把服务停掉。
    require_database_env_for_api
    if [[ $# -ge 2 && "$2" != "all" ]]; then
      # Build before stopping a healthy runtime; a broken release must not take it down.
      case "$2" in api|workers) ensure_shared_packages ;; esac
      START_FAILED=""
      stop_one "$2"
      start_selected "$2"
    else
      ensure_shared_packages
      stop_all
      start_all
    fi
    if [[ -n "$START_FAILED" ]]; then
      exit 1
    fi
    ;;
  status)
    status_failed=0
    echo "mode: frontends=$QITU_FRONTEND_MODE api=watch"
    for svc in ${2:-api workers auth student parent teacher admin}; do
      status_one "$svc" || status_failed=1
    done
    leaked="$(orphan_watcher_pids | tr '\n' ' ')"
    if [[ -n "${leaked// /}" ]]; then
      echo "warning: 发现无人认领的 nest --watch 进程（pid $leaked）在吃内存；执行 '$0 clean' 回收"
      status_failed=1
    fi
    exit "$status_failed"
    ;;
  build)
    QITU_FORCE_FRONTEND_BUILD=1
    if [[ $# -ge 2 && "$2" != "all" ]]; then
      # 单服务只建自己需要的那一侧：不要为重启一个前端而重建整套 runtime 包。
      case "$2" in
        api|workers) ensure_shared_packages ;;
        *) build_frontend "$2" ;;
      esac
    else
      ensure_shared_packages
      ensure_frontend_builds
    fi
    if [[ -n "$BROKEN_PACKAGES$BROKEN_FRONTENDS" ]]; then
      echo "构建失败：packages:$BROKEN_PACKAGES frontends:$BROKEN_FRONTENDS" >&2
      exit 1
    fi
    echo "frontends built (QITU_FRONTEND_MODE=$QITU_FRONTEND_MODE)"
    ;;
  clean)
    reap_orphan_watchers
    ;;
  *) echo "usage: $0 {start|stop|restart|status|build|clean} [api|workers|auth|student|parent|teacher|admin]" >&2; exit 2 ;;
esac
