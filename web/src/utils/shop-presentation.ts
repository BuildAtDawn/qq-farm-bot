/** Preserve source order and the existing purchase-button eligibility when grouping goods. */
export function groupMallGoods<T extends { canBuy?: unknown, isSoldOut?: unknown }>(items: readonly T[], canAfford: (item: T) => boolean) {
  const available: T[] = []
  const unavailable: T[] = []
  for (const item of items) {
    const target = item.canBuy && !item.isSoldOut && canAfford(item) ? available : unavailable
    target.push(item)
  }
  return { available, unavailable }
}
