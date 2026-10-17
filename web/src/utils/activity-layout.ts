export function portraitActivityWidth(containerWidth: number, availableHeight: number, stacked: boolean): number | null {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0)
    return null

  const width = Math.min(620, containerWidth)
  if (stacked)
    return Math.floor(width)

  // Below-fold content must remain readable even when the first viewport is full.
  const height = Number.isFinite(availableHeight) ? Math.max(0, availableHeight) : 0
  return Math.floor(Math.min(width, Math.max(Math.min(280, width), height * 900 / 1600)))
}
