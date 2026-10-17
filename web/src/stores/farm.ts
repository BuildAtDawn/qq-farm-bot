import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export type FertilizerType = 'normal' | 'organic'

export interface BagSeed {
  seedId: number
  name: string
  count: number
  image?: string
  plantSize?: number
  requiredLevel?: number
}

export interface RipenAllPreview {
  token: string
  expiresAt: number
  targetCount: number
  actionCount: number
  applicationCount: number
  cost: Record<FertilizerType, number>
  inventory: Record<FertilizerType, number>
  sufficient: boolean
  skipped: { landId: number, reason: string }[]
}

export interface RipenAllStepResult {
  success: boolean
  landIds: number[]
  updatedLands: Land[]
  fertilizerType: FertilizerType
  stopped: string
  cursor: number
  done: boolean
  completed: number
  total: number
  used: Record<FertilizerType, number>
}

export interface FertilizeLandResult {
  success: boolean
  landId: number
  fertilizerType: FertilizerType
  fertilizerRemainingSec: number | null
  updatedLand: Land | null
}

export interface Land {
  id: number
  plantName?: string
  phaseName?: string
  phase?: number
  imagePhase?: number
  seedImage?: string
  plantImage?: string
  status: string
  matureInSec: number
  phaseStartTime?: number
  phaseEndTime?: number
  currentPhaseNumber?: number
  totalPhases?: number
  phaseInSec?: number | null
  needWater?: boolean
  needWeed?: boolean
  needBug?: boolean
  [key: string]: any
}

export const useFarmStore = defineStore('farm', () => {
  const lands = ref<Land[]>([])
  const seeds = ref<any[]>([])
  const summary = ref<any>({})
  const weather = ref<any>(null)
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')
  const fertilizePending = ref(false)
  const fertilizeError = ref('')
  let requestSequence = 0
  let accountGeneration = 0
  const landUpdates = new Map<number, { accountId: string, land: Land, expiresAt: number }>()
  const dogSkillGiftPendingCount = ref(0)
  const dogSkillGiftLoading = ref(false)
  const dogSkillGiftError = ref('')

  function clearFarmData() {
    requestSequence++
    accountGeneration++
    loaded.value = false
    loading.value = false
    error.value = ''
    fertilizeError.value = ''
    landUpdates.clear()
    lands.value = []
    seeds.value = []
    summary.value = {}
    weather.value = null
    dogSkillGiftPendingCount.value = 0
    dogSkillGiftError.value = ''
  }

  function isCurrentAccount(accountId: string) {
    const accountStore = useAccountStore()
    const currentId = String((accountStore.currentAccountId as { value?: string })?.value ?? accountStore.currentAccountId ?? '')
    return currentId === String(accountId)
  }

  function updateLandSummary() {
    for (const status of ['harvestable', 'growing', 'empty', 'dead'])
      summary.value[status] = lands.value.filter(item => item.status === status).length
  }

  async function fetchLands(accountId: string) {
    if (!accountId)
      return false
    const requestedId = String(accountId)
    const sequence = ++requestSequence
    loading.value = true
    error.value = ''
    try {
      const { data } = await api.get('/api/lands', {
        headers: { 'x-account-id': accountId },
        skipErrorToast: true,
      } as any)
      if (!isCurrentAccount(requestedId) || sequence !== requestSequence)
        return false
      if (!data?.ok)
        throw new Error(data?.error || '土地读取失败')
      const now = Date.now()
      lands.value = (data.data?.lands || []).map((land: Land) => {
        const overlay = landUpdates.get(Number(land.id))
        if (overlay && overlay.accountId === requestedId && overlay.expiresAt > now
          && overlay.land.plantId === land.plantId && overlay.land.currentSeason === land.currentSeason
          && land.status === 'growing' && Number(land.phaseStartTime || 0) <= Number(overlay.land.phaseStartTime || 0)
          && Number(land.matureInSec) > Math.max(0, Number(overlay.land.matureInSec)
          - Math.floor((now - Number(overlay.land.snapshotAt)) / 1000))) {
          return { ...land, ...overlay.land }
        }
        landUpdates.delete(Number(land.id))
        return { ...land, snapshotAt: now }
      })
      summary.value = data.data?.summary || {}
      updateLandSummary()
      weather.value = data.data?.weather || null
      loaded.value = true
      return true
    }
    catch (cause: any) {
      if (isCurrentAccount(requestedId) && sequence === requestSequence)
        error.value = String(cause?.response?.data?.error || cause?.message || '土地读取失败')
      return false
    }
    finally {
      if (sequence === requestSequence)
        loading.value = false
    }
  }

  async function applyFertilizer(accountId: string, landId: number, fertilizerType: FertilizerType) {
    if (!accountId || !landId || fertilizePending.value)
      return false
    const generation = accountGeneration
    fertilizePending.value = true
    fertilizeError.value = ''
    try {
      const { data } = await api.post('/api/land/fertilize', { landId, fertilizerType }, {
        headers: { 'x-account-id': accountId },
        skipErrorToast: true,
      } as any)
      if (!data?.ok || !data.data?.success)
        throw new Error(data?.error || '当前无法继续施肥')
      const result = data.data as FertilizeLandResult
      if (!isCurrentAccount(accountId) || generation !== accountGeneration)
        return false
      if (result.updatedLand) {
        const land = { ...result.updatedLand, snapshotAt: Date.now() }
        landUpdates.set(landId, { accountId: String(accountId), land, expiresAt: Date.now() + 60000 })
        lands.value = lands.value.map(item => Number(item.id) === landId ? { ...item, ...land } : item)
        updateLandSummary()
      }
      else {
        // Do not continue an automatic loop without a successful reply's land snapshot.
        await fetchLands(accountId)
      }
      return result
    }
    catch (cause: any) {
      if (isCurrentAccount(accountId) && generation === accountGeneration)
        fertilizeError.value = String(cause?.response?.data?.error || cause?.message || '施肥失败')
      return false
    }
    finally {
      fertilizePending.value = false
    }
  }

  async function previewRipenAll(accountId: string): Promise<RipenAllPreview> {
    const { data } = await api.post('/api/farm/ripen-all/preview', {}, {
      headers: { 'x-account-id': accountId },
      skipErrorToast: true,
    } as any)
    if (!data?.ok)
      throw new Error(data?.error || '催熟预览读取失败')
    return data.data
  }

  async function ripenAllStep(accountId: string, token: string, cursor: number): Promise<RipenAllStepResult> {
    if (!accountId || fertilizePending.value)
      throw new Error('施肥操作正在执行')
    const generation = accountGeneration
    fertilizePending.value = true
    try {
      const { data } = await api.post('/api/farm/ripen-all/step', { token, cursor }, {
        headers: { 'x-account-id': accountId },
        skipErrorToast: true,
      } as any)
      if (!data?.ok || !data.data?.success || !Array.isArray(data.data.updatedLands))
        throw new Error(data?.error || '催熟已停止')
      const result = data.data as RipenAllStepResult
      if (isCurrentAccount(accountId) && generation === accountGeneration) {
        const now = Date.now()
        const updates = new Map(result.updatedLands.map(item => [Number(item.id), { ...item, snapshotAt: now }]))
        for (const [landId, land] of updates)
          landUpdates.set(landId, { accountId: String(accountId), land, expiresAt: now + 60000 })
        lands.value = lands.value.map(item => updates.has(Number(item.id)) ? { ...item, ...updates.get(Number(item.id)) } : item)
        updateLandSummary()
      }
      return result
    }
    finally {
      fertilizePending.value = false
    }
  }

  async function fetchSeeds(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    const { data } = await api.get('/api/seeds', {
      headers: { 'x-account-id': accountId },
    })
    if (!isCurrentAccount(requestedId))
      return
    if (data && data.ok)
      seeds.value = data.data || []
  }

  async function fetchDogSkillGiftStatus(accountId: string) {
    if (!accountId)
      return
    dogSkillGiftLoading.value = true
    dogSkillGiftError.value = ''
    try {
      const { data } = await api.get('/api/dog/skill-gifts', {
        headers: { 'x-account-id': accountId },
      })
      if (isCurrentAccount(accountId) && data?.ok)
        dogSkillGiftPendingCount.value = Math.max(0, Number(data.data?.pendingCount) || 0)
    }
    catch (error: any) {
      if (isCurrentAccount(accountId))
        dogSkillGiftError.value = String(error?.response?.data?.error || error?.message || '礼包状态读取失败')
    }
    finally {
      dogSkillGiftLoading.value = false
    }
  }

  async function claimDogSkillGifts(accountId: string) {
    if (!accountId)
      return null
    dogSkillGiftLoading.value = true
    dogSkillGiftError.value = ''
    try {
      const { data } = await api.post('/api/dog/skill-gifts/claim', {}, {
        headers: { 'x-account-id': accountId },
      })
      if (!data?.ok)
        throw new Error(data?.error || '礼包拾取失败')
      if (isCurrentAccount(accountId))
        dogSkillGiftPendingCount.value = Math.max(0, Number(data.data?.pending) || 0)
      return data.data
    }
    catch (error: any) {
      if (isCurrentAccount(accountId))
        dogSkillGiftError.value = String(error?.response?.data?.error || error?.message || '礼包拾取失败')
      return null
    }
    finally {
      dogSkillGiftLoading.value = false
    }
  }

  async function operate(accountId: string, opType: string) {
    if (!accountId)
      return
    landUpdates.clear()
    const { data } = await api.post('/api/farm/operate', { opType }, {
      headers: { 'x-account-id': accountId },
    })
    if (!data?.ok)
      throw new Error(data?.error || '农场操作失败')
    await fetchLands(accountId)
    return data
  }

  async function fetchBagSeeds(accountId: string): Promise<BagSeed[]> {
    const { data } = await api.get('/api/bag/seeds', {
      headers: { 'x-account-id': accountId },
      skipErrorToast: true,
    } as any)
    if (!data?.ok || !Array.isArray(data.data?.seeds))
      throw new Error(data?.error || '背包种子读取失败')
    return data.data.seeds
  }

  async function plantSelectedBagSeeds(accountId: string, seedIds: number[]) {
    const generation = accountGeneration
    const { data } = await api.post('/api/farm/plant-bag', { seedIds }, {
      headers: { 'x-account-id': accountId },
      skipErrorToast: true,
      timeout: 190000,
    } as any)
    if (!data?.ok)
      throw new Error(data?.error || '背包种植失败')
    if (isCurrentAccount(accountId) && generation === accountGeneration) {
      landUpdates.clear()
      await fetchLands(accountId)
    }
    return data.data as { planted: number, remaining: number, plantedLandIds: number[] }
  }

  async function fertilizeLand(accountId: string, landId: number) {
    if (!accountId)
      return
    const { data } = await api.post('/api/land/fertilize', { landId }, {
      headers: { 'x-account-id': accountId },
    })
    await fetchLands(accountId)
    return data
  }

  async function removePlant(accountId: string, landId: number) {
    if (!accountId)
      return
    const { data } = await api.post('/api/land/remove', { landId }, {
      headers: { 'x-account-id': accountId },
    })
    if (!data?.ok)
      throw new Error(data?.error || '铲除失败')
    landUpdates.delete(landId)
    await fetchLands(accountId)
    return data
  }

  async function removeAllPlants(accountId: string) {
    if (!accountId)
      return
    const { data } = await api.post('/api/land/remove-all', {}, {
      headers: { 'x-account-id': accountId },
    })
    if (!data?.ok)
      throw new Error(data?.error || '铲除失败')
    landUpdates.clear()
    await fetchLands(accountId)
    return data
  }

  async function removeDeadPlants(accountId: string) {
    if (!accountId)
      return
    const { data } = await api.post('/api/land/remove-dead', {}, {
      headers: { 'x-account-id': accountId },
    })
    if (!data?.ok)
      throw new Error(data?.error || '铲除枯萎失败')
    landUpdates.clear()
    await fetchLands(accountId)
    return data
  }

  return {
    lands,
    summary,
    weather,
    seeds,
    loading,
    loaded,
    error,
    fertilizePending,
    fertilizeError,
    applyFertilizer,
    previewRipenAll,
    ripenAllStep,
    dogSkillGiftPendingCount,
    dogSkillGiftLoading,
    dogSkillGiftError,
    clearFarmData,
    fetchLands,
    fetchSeeds,
    fetchDogSkillGiftStatus,
    claimDogSkillGifts,
    operate,
    fetchBagSeeds,
    plantSelectedBagSeeds,
    fertilizeLand,
    removePlant,
    removeAllPlants,
    removeDeadPlants,
  }
})
