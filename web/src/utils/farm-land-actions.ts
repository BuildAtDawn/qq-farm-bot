import type { Land } from '@/stores/farm'

export function canRemoveLand(land: Land | undefined) {
  return !!land?.unlocked && !land.occupiedByMaster
    && Number(land.plantId) > 0 && ['growing', 'harvestable', 'dead'].includes(land.status)
}
