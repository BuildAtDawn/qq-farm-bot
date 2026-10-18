export type FertilizerTimeUnit = 'seconds' | 'minutes' | 'hours'

export const FERTILIZER_TIME_UNITS: { label: string, value: FertilizerTimeUnit, factor: number }[] = [
  { label: '秒', value: 'seconds', factor: 1 },
  { label: '分钟', value: 'minutes', factor: 60 },
  { label: '小时', value: 'hours', factor: 3600 },
]

export function fertilizerTimeFactor(unit: FertilizerTimeUnit) {
  return FERTILIZER_TIME_UNITS.find(item => item.value === unit)?.factor || 1
}

export function fertilizerTimeValue(seconds: unknown, unit: FertilizerTimeUnit) {
  const value = Number(seconds)
  return Number.isFinite(value) ? Number((value / fertilizerTimeFactor(unit)).toFixed(2)) : 0
}

export function fertilizerTimeSeconds(value: unknown, unit: FertilizerTimeUnit) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0)
    return 0
  return Math.round(numeric * fertilizerTimeFactor(unit))
}
