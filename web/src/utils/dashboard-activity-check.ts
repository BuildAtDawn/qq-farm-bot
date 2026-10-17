export interface ActivityCheckStatus {
  state: 'upcoming' | 'ended' | 'disabled' | 'paused' | 'running' | 'scheduled' | 'idle'
  intervalSec: number
  enabledActionCount: number
  nextRunAt: number | null
}

export function milkTeaCountdown(check: ActivityCheckStatus | undefined, now: number) {
  const labels = { upcoming: '未开始', ended: '已结束', disabled: '未开启', paused: '已暂停', running: '检查中...', idle: '等待调度' }
  const description = check?.enabledActionCount ? `已开启 ${check.enabledActionCount} 项 · 每 ${check.intervalSec / 60} 分钟检查` : '奶茶热销中'
  if (!check)
    return { time: '等待同步', progress: 0, description }
  if (check.state !== 'scheduled')
    return { time: labels[check.state], progress: 0, description }
  if (!Number.isFinite(check.nextRunAt) || check.nextRunAt === null)
    return { time: '等待调度', progress: 0, description }
  const seconds = Math.max(0, Math.ceil((check.nextRunAt - now) / 1000))
  const pad = (value: number) => String(value).padStart(2, '0')
  return {
    time: seconds ? `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}` : '等待检查',
    progress: Math.max(0, Math.min(100, seconds / Math.max(1, check.intervalSec) * 100)),
    description,
  }
}
