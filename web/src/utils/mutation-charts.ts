export interface MutationStatistics {
  completedRecords: number
  mutatedRecords: number
  mutationRate: number | null
  types: { id: number, name: string, count: number, percentage: number }[]
}

export function chartPercent(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0
}

export function mutationChartData(statistics: MutationStatistics) {
  return {
    // A record can have several mutation types; these bars do not form a pie.
    types: [...statistics.types].sort((a, b) => b.count - a.count).map(item => ({
      ...item,
      width: chartPercent(item.percentage),
    })),
    rate: chartPercent(statistics.mutationRate),
    unmutated: Math.max(0, statistics.completedRecords - statistics.mutatedRecords),
    hasRate: statistics.completedRecords > 0 && statistics.mutationRate !== null && Number.isFinite(statistics.mutationRate),
  }
}
