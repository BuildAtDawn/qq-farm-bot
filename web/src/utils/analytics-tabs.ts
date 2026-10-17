export const analyticsTabs = [
  { key: 'strategy', label: '种植策略', icon: 'i-carbon-chart-line' },
  { key: 'crops', label: '作物数据', icon: 'i-carbon-sprout' },
  { key: 'mutations', label: '变异研究', icon: 'i-carbon-chemistry' },
  { key: 'blacklist', label: '偷菜黑名单', icon: 'i-carbon-subtract-alt' },
] as const

export type AnalyticsTab = typeof analyticsTabs[number]['key']

export function resolveAnalyticsTab(value: unknown): AnalyticsTab {
  return analyticsTabs.find(tab => tab.key === value)?.key || 'strategy'
}
