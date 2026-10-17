import { isBagItemLocked } from './bag-lock'

export function fertilizerUsePreview(item: any, containers: any, originalItems: any[], quantity: unknown) {
  const info = item?.fertilizerRefill
  if (!info)
    return null
  const pool = info.pool
  const current = containers?.[pool]?.seconds
  const secondsPerItem = Number(info.secondsPerItem)
  const capacity = Number(info.capacitySeconds)
  const validSnapshot = (pool === 'normal' || pool === 'organic')
    && Number.isSafeInteger(current) && current >= 0
    && Number.isSafeInteger(secondsPerItem) && secondsPerItem > 0
    && capacity === 999 * 3600
    && containers?.[pool]?.capacitySeconds === capacity
  const stock = originalItems
    .filter(row => Number(row.id) === Number(item.id) && !isBagItemLocked(row)
      && Number.isSafeInteger(Number(row.count)) && Number(row.count) > 0)
    .reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row.count) || 0)), 0)
  const maxCount = validSnapshot ? Math.min(stock, Math.max(0, Math.floor((capacity - current) / secondsPerItem))) : 0
  const selected = Number(quantity)
  const validQuantity = Number.isSafeInteger(selected) && selected > 0 && selected <= maxCount
  return {
    ready: validSnapshot,
    label: pool === 'organic' ? '有机化肥' : '普通化肥',
    currentSeconds: validSnapshot ? current : 0,
    capacitySeconds: capacity,
    secondsPerItem,
    maxCount,
    addedSeconds: validQuantity ? selected * secondsPerItem : 0,
    afterSeconds: validSnapshot ? current + (validQuantity ? selected * secondsPerItem : 0) : 0,
    valid: validSnapshot && validQuantity,
    error: !validSnapshot
      ? '容量数据尚未就绪，请重新读取'
      : !maxCount
          ? '剩余容量不足以容纳一个道具，或可用库存为空'
          : !validQuantity ? `使用数量须为 1–${maxCount} 的整数` : '',
  }
}

export function formatFertilizerHours(seconds: number) {
  return `${(seconds / 3600).toFixed(3).replace(/\.?0+$/, '')} h`
}
