#!/usr/bin/env bash
# start.sh / stop.sh 共用；进程记录只保存在被 Git 忽略的 core/data 下。
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENTRY="$ROOT_DIR/core/client.js"
PID_FILE="$ROOT_DIR/core/data/local-start.pid"
LOG_FILE="$ROOT_DIR/core/data/local-service.log"
LOCK_DIR="$ROOT_DIR/core/data/local-service.lock"
umask 077

fail() { echo "[ERROR] $*" >&2; exit 1; }

lock_service() {
  mkdir -p "$ROOT_DIR/core/data"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    local owner=''
    [[ ! -f "$LOCK_DIR/owner" ]] || read -r owner < "$LOCK_DIR/owner"
    if [[ "$owner" =~ ^[1-9][0-9]*$ ]] && ! kill -0 "$owner" 2>/dev/null; then
      rm -f "$LOCK_DIR/owner"
      rmdir "$LOCK_DIR" || fail "无法清理过期的启动锁：$LOCK_DIR"
      mkdir "$LOCK_DIR" 2>/dev/null || fail "另一个启停脚本正在运行，请稍后再试。"
    else
      fail "另一个启停脚本正在运行，请稍后再试。"
    fi
  fi
  printf '%s\n' "$$" > "$LOCK_DIR/owner"
  trap 'rm -f "$LOCK_DIR/owner"; rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

read_service_record() {
  SERVICE_PID=''
  SERVICE_STARTED=''
  SERVICE_PORT=''
  [[ -f "$PID_FILE" ]] || return 0
  {
    IFS= read -r SERVICE_PID || true
    IFS= read -r SERVICE_STARTED || true
    IFS= read -r SERVICE_PORT || true
  } < "$PID_FILE"
}

is_service_process() {
  [[ "$SERVICE_PID" =~ ^[1-9][0-9]*$ && -n "$SERVICE_STARTED" ]] || return 1
  local command_line started group
  command_line="$(ps -p "$SERVICE_PID" -o command= 2>/dev/null)" || return 1
  started="$(LC_ALL=C ps -p "$SERVICE_PID" -o lstart= 2>/dev/null)" || return 1
  group="$(ps -p "$SERVICE_PID" -o pgid= 2>/dev/null)" || return 1
  [[ "$command_line" == *" $ENTRY" && "$started" == "$SERVICE_STARTED" && "${group// /}" == "$SERVICE_PID" ]]
}

service_group_alive() { kill -0 -- "-$SERVICE_PID" 2>/dev/null; }

health_ready() {
  node - "$BOT_PORT" <<'NODE'
const http = require('node:http');
const request = http.get({ hostname: '127.0.0.1', port: Number(process.argv[2]), path: '/api/health', timeout: 1000 }, response => {
  let body = '';
  response.on('data', chunk => { body += chunk; });
  response.on('end', () => {
    try { process.exit(response.statusCode === 200 && JSON.parse(body).ok === true ? 0 : 1); }
    catch { process.exit(1); }
  });
});
request.on('timeout', () => request.destroy());
request.on('error', () => process.exit(1));
NODE
}
