import type { FertilizeLandResult, Land } from '@/stores/farm'

export function canRipenLand(land: Land | undefined) {
  return !!land?.unlocked && !land.occupiedByMaster && land.status === 'growing' && Number(land.matureInSec) > 0
}

export function canNormalFertilize(land: Land | undefined) {
  return canRipenLand(land) && Number(land?.leftInorcFertTimes) > 0
}

export async function ripenLand(options: {
  getLand: () => Land | undefined
  cancelled: () => boolean
  fertilize: (type: 'normal' | 'organic') => Promise<FertilizeLandResult | false>
}) {
  let normalCount = 0
  let organicCount = 0
  let stopped = ''
  const initialLand = options.getLand()
  const sameCrop = () => options.getLand()?.plantId === initialLand?.plantId
    && options.getLand()?.currentSeason === initialLand?.currentSeason
  const active = () => !options.cancelled() && sameCrop() && canRipenLand(options.getLand())

  if (active() && canNormalFertilize(options.getLand())) {
    const result = await options.fertilize('normal')
    if (result) {
      normalCount++
      if (!result.updatedLand)
        stopped = 'unconfirmed'
    }
  }
  while (!stopped && active()) {
    const before = Number(options.getLand()?.matureInSec)
    const result = await options.fertilize('organic')
    if (!result) {
      stopped = 'unavailable'
      break
    }
    organicCount++
    if (options.cancelled())
      break
    if (!result.updatedLand) {
      stopped = 'unconfirmed'
      break
    }
    if (!active())
      break
    if (Number(options.getLand()?.matureInSec) >= before) {
      stopped = 'no-progress'
      break
    }
    if (result.fertilizerRemainingSec !== null && Number(result.fertilizerRemainingSec) <= 0) {
      stopped = 'empty'
      break
    }
    if (organicCount >= 100) {
      stopped = 'limit'
      break
    }
  }
  const matured = sameCrop() && options.getLand()?.status === 'harvestable'
  if (!stopped && !matured && !options.cancelled())
    stopped = 'changed'
  return { normalCount, organicCount, stopped, matured, cancelled: options.cancelled() }
}
