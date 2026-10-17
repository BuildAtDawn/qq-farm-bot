// Device-local presentation preferences must never change account automation settings.
export const UI_PREFERENCES = {
  compactDashboard: 'ui_dashboard_compact',
} as const

export function readUiPreference(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key)
    return value === 'true' ? true : value === 'false' ? false : fallback
  }
  catch {
    return fallback
  }
}

export function writeUiPreference(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value))
  }
  catch {
    // Presentation still works for this session if browser storage is unavailable.
  }
}

export function initializeFarmAppearance(root: HTMLElement): void {
  root.classList.remove('dark')
  // Remove inline values left by an older shell during hot reloads.
  for (const key of ['bg', 'text', 'primary', 'secondary', 'gradient'])
    root.style.removeProperty(`--theme-${key}`)
}
