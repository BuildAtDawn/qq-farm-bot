const CAPACITY_SECONDS = 999 * 3600;
// Standard IDs/durations match ItemInfo.json. Legacy IDs retain warehouse mappings.
const ITEMS = new Map([
  [80001, ['normal', 1]], [80002, ['normal', 4]],
  [80003, ['normal', 8]], [80004, ['normal', 12]],
  [80011, ['organic', 1]], [80012, ['organic', 4]],
  [80013, ['organic', 8]], [80014, ['organic', 12]],
  [79873, ['normal', 1]], [80514, ['normal', 4]], [80132, ['normal', 12]],
]);

function fertilizerRefillInfo(itemId) {
  const entry = ITEMS.get(Number(itemId));
  if (!entry) return null;
  const [pool, hours] = entry;
  return { pool, containerId: pool === 'normal' ? 1011 : 1012,
    secondsPerItem: hours * 3600, capacitySeconds: CAPACITY_SECONDS };
}

function containerSnapshot(items) {
  const result = {
    normal: { seconds: 0, capacitySeconds: CAPACITY_SECONDS },
    organic: { seconds: 0, capacitySeconds: CAPACITY_SECONDS },
  };
  for (const item of items) {
    const pool = Number(item.id) === 1011 ? 'normal' : Number(item.id) === 1012 ? 'organic' : null;
    if (!pool) continue;
    const seconds = Number(item.count);
    if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error('化肥容器数据无效，请刷新后重试');
    result[pool].seconds += seconds;
  }
  return result;
}

function planFertilizerUse(items, itemId, count, uid = 0) {
  const info = fertilizerRefillInfo(itemId);
  if (!info) throw new Error('未确认该化肥道具的时长');
  if (!Number.isSafeInteger(count) || count <= 0) throw new Error('使用数量必须是正整数');
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error('无效的物品 UID');
  const current = containerSnapshot(items)[info.pool].seconds;
  const maxByCapacity = Math.max(0, Math.floor((info.capacitySeconds - current) / info.secondsPerItem));
  if (count > maxByCapacity) throw new Error(`化肥容量不足，当前最多可使用 ${maxByCapacity} 个，请刷新预览`);
  const stacks = items.filter(item => Number(item.id) === Number(itemId)
    && !(item.locked === true || item.locked === 1 || item.locked === '1')
    && (uid === 0 || Number(item.uid || 0) === uid)
    && Number.isSafeInteger(Number(item.count)) && Number(item.count) > 0);
  if (stacks.reduce((sum, item) => sum + Number(item.count), 0) < count)
    throw new Error('可用化肥库存不足或已锁定，请刷新预览');
  let remaining = count;
  const allocations = [];
  for (const item of stacks) {
    if (!remaining) break;
    const used = Math.min(remaining, Number(item.count));
    allocations.push({ count: used, uid: Number(item.uid || 0) });
    remaining -= used;
  }
  return { info, allocations, currentSeconds: current, addedSeconds: count * info.secondsPerItem,
    afterSeconds: current + count * info.secondsPerItem };
}

module.exports = { fertilizerRefillInfo, containerSnapshot, planFertilizerUse };
