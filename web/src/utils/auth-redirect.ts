export function safeAuthRedirect(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')
    || /[\\\u0000-\u0020\u007F]/.test(value))
    return '/'
  try {
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith('//') || /[\\\u0000-\u001F\u007F]/.test(decoded))
      return '/'
    const url = new URL(value, 'https://farm.invalid')
    if (url.origin !== 'https://farm.invalid' || /^\/login(?:\/|$)/i.test(decodeURIComponent(url.pathname)))
      return '/'
    return `${url.pathname}${url.search}${url.hash}`
  }
  catch {
    return '/'
  }
}

export function codeLoginLocation(path: string): string {
  return `/login?redirect=${encodeURIComponent(safeAuthRedirect(path))}`
}

export function adminNavigationDecision(
  to: { name?: unknown, fullPath: string, query: { redirect?: unknown } },
  authenticated: boolean,
) {
  if (to.name === 'code-login')
    return authenticated ? safeAuthRedirect(to.query.redirect) : true
  if (!authenticated)
    return { name: 'code-login', query: { redirect: to.fullPath }, replace: true }
  return true
}
