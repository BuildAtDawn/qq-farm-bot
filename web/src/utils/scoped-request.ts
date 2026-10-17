// Coalesce identical reads, cancel stale reads and never apply another account's data.
export function createScopedRequest<T>(options: {
  key: () => string
  fetch: (signal: AbortSignal) => Promise<T>
  apply: (value: T) => void
  error: (error: unknown) => void
  loading: (value: boolean) => void
}) {
  let revision = 0
  let pending: { key: string, controller: AbortController, promise: Promise<void> } | null = null
  function invalidate() {
    revision++
    pending?.controller.abort()
    pending = null
    options.loading(false)
  }
  function run() {
    const key = options.key()
    if (!key)
      return Promise.resolve()
    if (pending?.key === key)
      return pending.promise
    invalidate()
    const version = revision
    const controller = new AbortController()
    options.loading(true)
    const promise = Promise.resolve().then(() => options.fetch(controller.signal)).then((value) => {
      if (revision === version && options.key() === key)
        options.apply(value)
    }).catch((error) => {
      if (revision === version && options.key() === key && !controller.signal.aborted)
        options.error(error)
    }).finally(() => {
      if (revision === version) {
        pending = null
        options.loading(false)
      }
    })
    pending = { key, controller, promise }
    return promise
  }
  return { run, invalidate }
}
