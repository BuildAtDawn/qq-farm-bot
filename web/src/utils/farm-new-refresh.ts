export function normalizeRefreshSeconds(value: unknown) {
  const seconds = Number(value)
  return Number.isFinite(seconds) ? Math.min(3600, Math.max(1, Math.round(seconds))) : 3
}

export function createFarmRefreshController(options: {
  getAccountId: () => string
  canRefresh: () => boolean
  refresh: (accountId: string) => Promise<unknown>
  onError: (cause: unknown) => void
}) {
  const pending = new Map<string, Promise<void>>()
  let timer: ReturnType<typeof setInterval> | null = null
  function run() {
    const accountId = options.getAccountId()
    if (!accountId || !options.canRefresh())
      return Promise.resolve()
    const previous = pending.get(accountId)
    if (previous)
      return previous
    const request = Promise.resolve()
      .then(() => options.refresh(accountId))
      .then(() => {})
      .catch(cause => options.onError(cause))
      .finally(() => { pending.delete(accountId) })
    pending.set(accountId, request)
    return request
  }
  function stop() {
    if (timer !== null)
      clearInterval(timer)
    timer = null
  }
  function start(seconds: number) {
    stop()
    timer = setInterval(() => {
      void run()
    }, normalizeRefreshSeconds(seconds) * 1000)
  }
  return { run, start, stop }
}
