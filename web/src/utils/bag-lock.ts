export function isBagItemLocked(item: any) {
  return item?.locked === true || item?.locked === 1 || item?.locked === '1'
}

export function getSeedLockUids(originalItems: any[], seedIds: number[], locked: boolean): number[] {
  const ids = new Set(seedIds)
  return [...new Set(originalItems
    .filter(item => ids.has(Number(item.id)) && Number(item.count) > 0 && isBagItemLocked(item) !== locked)
    .map(item => Number(item.uid))
    .filter(uid => Number.isSafeInteger(uid) && uid > 0))]
}
