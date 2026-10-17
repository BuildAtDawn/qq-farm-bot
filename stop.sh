#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/scripts/local-service-common.sh"
lock_service
read_service_record
if [[ ! "$SERVICE_PID" =~ ^[1-9][0-9]*$ ]] || ! kill -0 "$SERVICE_PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "[INFO] 服务未运行。"
  exit 0
fi
is_service_process || fail "进程记录与当前进程不匹配，未停止该进程。请检查 ${PID_FILE}。"
echo "[INFO] 正在停止服务，PID：$SERVICE_PID..."
kill -TERM -- "-$SERVICE_PID"
for ((attempt=0; attempt<30; attempt++)); do
  if ! service_group_alive; then
    rm -f "$PID_FILE"
    echo "[OK] 服务已停止。"
    exit 0
  fi
  sleep 0.5
done
echo "[INFO] 服务未及时退出，正在强制停止..."
kill -KILL -- "-$SERVICE_PID" 2>/dev/null || true
for ((attempt=0; attempt<10; attempt++)); do
  if ! service_group_alive; then
    rm -f "$PID_FILE"
    echo "[OK] 服务已停止。"
    exit 0
  fi
  sleep 0.5
done
fail "仍有进程未退出，保留了进程记录：$PID_FILE"
