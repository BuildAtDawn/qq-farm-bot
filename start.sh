#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/scripts/local-service-common.sh"
BOT_PORT="${ADMIN_PORT:-3007}"
[[ "$BOT_PORT" =~ ^[0-9]{1,5}$ ]] || fail "ADMIN_PORT 必须是 1–65535 的整数。"
(( 10#$BOT_PORT >= 1 && 10#$BOT_PORT <= 65535 )) || fail "ADMIN_PORT 必须是 1–65535 的整数。"
BOT_PORT="$((10#$BOT_PORT))"
command -v node >/dev/null 2>&1 || fail "请先安装 Node.js 20+。"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || fail "请升级到 Node.js 20+。"
lock_service
read_service_record

if is_service_process; then
  echo "[INFO] 服务已在运行，PID：$SERVICE_PID"
  echo "[INFO] 面板：http://localhost:$SERVICE_PORT"
  exit 0
fi
if [[ "$SERVICE_PID" =~ ^[1-9][0-9]*$ ]] && kill -0 "$SERVICE_PID" 2>/dev/null; then
  fail "进程记录与当前进程不匹配，未操作该进程。请检查 ${PID_FILE}。"
fi
rm -f "$PID_FILE"

node - "$BOT_PORT" <<'NODE' || fail "端口 $BOT_PORT 已被占用，未启动服务。可通过 ADMIN_PORT 指定其他端口。"
const server = require('node:net').createServer();
server.on('error', () => process.exit(1));
server.listen(Number(process.argv[2]), '0.0.0.0', () => server.close());
NODE

cd "$ROOT_DIR"
if [[ ! -d core/node_modules || ! -d web/node_modules ]]; then
  echo "[INFO] 正在安装项目依赖..."
  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm install -r
  elif command -v pnpm >/dev/null 2>&1; then
    pnpm install -r
  else
    fail "首次安装依赖需要 pnpm 10 或 Corepack。"
  fi
fi

echo "[INFO] 正在构建最新前端..."
npm --prefix "$ROOT_DIR/web" run build
echo "[INFO] 正在后台启动服务..."
SERVICE_PID="$(node - "$ENTRY" "$LOG_FILE" "$BOT_PORT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const [entry, logFile, port] = process.argv.slice(2);
const fd = fs.openSync(logFile, 'a', 0o600);
const child = spawn(process.execPath, [entry], {
  cwd: path.dirname(entry), detached: true,
  env: { ...process.env, ADMIN_PORT: port }, stdio: ['ignore', fd, fd],
});
fs.closeSync(fd);
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('spawn', () => { console.log(child.pid); child.unref(); });
NODE
)"
SERVICE_STARTED="$(LC_ALL=C ps -p "$SERVICE_PID" -o lstart=)" || fail "服务启动后退出。请查看日志：$LOG_FILE"
printf '%s\n' "$SERVICE_PID" "$SERVICE_STARTED" "$BOT_PORT" > "$PID_FILE.tmp"
mv "$PID_FILE.tmp" "$PID_FILE"

for ((attempt=0; attempt<30; attempt++)); do
  if ! is_service_process; then
    rm -f "$PID_FILE"
    fail "服务启动后退出。请查看日志：$LOG_FILE"
  fi
  if health_ready; then
    echo "[OK] 服务已启动，关闭终端后仍会继续运行。"
    echo "[INFO] 面板：http://localhost:$BOT_PORT"
    echo "[INFO] 日志：$LOG_FILE"
    echo "[INFO] 停止：$ROOT_DIR/stop.sh"
    exit 0
  fi
  sleep 0.5
done
kill -TERM -- "-$SERVICE_PID" 2>/dev/null || true
# 保留进程记录，若退出未完成，stop.sh 仍能安全处理。
fail "服务未在等待时间内就绪，已请求停止。请查看日志：$LOG_FILE"
