<script setup lang="ts">
import type { BagSeed, FertilizerType, Land, RipenAllPreview } from '@/stores/farm'
import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import FarmNewLandCard from '@/components/FarmNewLandCard.vue'
import FarmScene from '@/components/FarmScene.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useAccountStore } from '@/stores/account'
import { useFarmStore } from '@/stores/farm'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { canRemoveLand } from '@/utils/farm-land-actions'
import { createFarmRefreshController, normalizeRefreshSeconds } from '@/utils/farm-new-refresh'
import { fertilizerHours, runRipenAll } from '@/utils/ripen-all'
import { canNormalFertilize, canRipenLand, ripenLand } from '@/utils/ripen-land'

const farmStore = useFarmStore()
const accountStore = useAccountStore()
const statusStore = useStatusStore()
const toast = useToastStore()
const { lands, summary, weather, loading, loaded, error, fertilizePending, fertilizeError, dogSkillGiftPendingCount, dogSkillGiftLoading, dogSkillGiftError } = storeToRefs(farmStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const visibility = useDocumentVisibility()
const landView = ref<'default' | 'compact' | 'scene'>('default')
const autoRefreshEnabled = ref(false)
const autoRefreshSeconds = ref(3)
const fertilizingLandId = ref<number | null>(null)
const ripeningLandId = ref<number | null>(null)
const operating = ref(false)
const plantingMode = ref<'bag' | 'strategy'>('bag')
const bagSeeds = ref<BagSeed[]>([])
const selectedSeedIds = ref<number[]>([])
const bagSeedsLoading = ref(false)
const bagSeedsError = ref('')
let bagRequestSequence = 0
const ripenAllPreviewLoading = ref(false)
const ripenAllRunning = ref(false)
const ripenAllProgress = ref('')
const pendingRipenAll = ref<{ preview: RipenAllPreview, accountId: string, sequence: number } | null>(null)
const clock = ref(Date.now())
const operations = [
  { type: 'harvest', label: '收获', title: '收获所有成熟作物', icon: 'i-carbon-wheat', color: 'bg-blue-600 hover:bg-blue-700', message: '确定要收获所有成熟作物吗？' },
  { type: 'plant', label: '种植', title: '选择背包种子或按系统策略种植', icon: 'i-carbon-sprout', color: 'bg-green-600 hover:bg-green-700', message: '确定要一键种植吗？将根据当前策略配置执行。' },
  { type: 'clear', label: '务农', title: '一键务农：浇水、除草、除虫', icon: 'i-carbon-clean', color: 'bg-teal-600 hover:bg-teal-700', message: '确定要执行一键务农吗？将自动浇水、除草、除虫。' },
  { type: 'all', label: '全收', title: '一键全收：务农、收获、种植及按配置升级', icon: 'i-carbon-flash', color: 'bg-orange-600 hover:bg-orange-700', message: '确定要执行一键全收吗？将务农、收获、种植，并根据配置升级土地。' },
  { type: 'upgrade', label: '升级', title: '升级所有可升级的土地', icon: 'i-carbon-upgrade', color: 'bg-purple-600 hover:bg-purple-700', message: '确定要升级所有可升级的土地吗？此操作会消耗金币。' },
  { type: 'removeDead', label: '除枯', title: '铲除所有已枯萎的作物', icon: 'i-carbon-clean', color: 'bg-amber-600 hover:bg-amber-700', message: '确定要铲除所有已枯萎的作物吗？' },
  { type: 'removeAll', label: '清空', title: '铲除全部作物，包括生长中、成熟和枯萎作物', icon: 'i-carbon-trash-can', color: 'bg-red-600 hover:bg-red-700', message: '确定要铲除全部已种植作物吗？包括生长中、成熟和枯萎的作物，此操作不可恢复。' },
] as const
type FarmOperation = typeof operations[number] | { type: 'remove', label: '铲除', message: string, land: Land }
const pendingOperation = ref<{ operation: FarmOperation, accountId: string, sequence: number } | null>(null)
const confirmVisible = computed(() => pendingOperation.value !== null)
const plantingDisabled = computed(() => pendingOperation.value?.operation.type === 'plant'
  && plantingMode.value === 'bag'
  && (bagSeedsLoading.value || !!bagSeedsError.value || selectedSeedIds.value.length === 0))
let disposed = false
let actionSequence = 0
let preferencesLoaded = false

const accountRunning = computed(() => !!currentAccount.value?.running
  || (statusStore.currentStatusReady && !!statusStore.status?.connection?.connected))
const busy = computed(() => fertilizePending.value || ripeningLandId.value !== null || operating.value || confirmVisible.value
  || ripenAllPreviewLoading.value || ripenAllRunning.value || pendingRipenAll.value !== null)
const displayLands = computed(() => lands.value.map(land => ({
  ...land,
  matureInSec: Math.max(0, Number(land.matureInSec || 0)
  - Math.floor(Math.max(0, clock.value - Number(land.snapshotAt || clock.value)) / 1000)),
  phaseInSec: land.phaseInSec == null
    ? null
    : Math.max(0, land.phaseInSec
    - Math.floor(Math.max(0, clock.value - Number(land.snapshotAt || clock.value)) / 1000)),
})))

const refreshController = createFarmRefreshController({
  getAccountId: () => currentAccountId.value,
  canRefresh: () => !disposed && visibility.value === 'visible' && accountRunning.value && !busy.value,
  refresh: async (accountId) => {
    if (!statusStore.realtimeConnected)
      await statusStore.fetchStatus(accountId)
    if (!disposed && accountId === currentAccountId.value && accountRunning.value) {
      await Promise.all([
        farmStore.fetchLands(accountId),
        farmStore.fetchDogSkillGiftStatus(accountId),
      ])
    }
  },
  onError: () => {}, // Store/API already expose failed reads.
})

function preferenceKey(accountId: string) {
  return `qq-farm-bot-404:farm:${accountId}`
}
function loadPreferences(accountId: string) {
  preferencesLoaded = false
  autoRefreshEnabled.value = false
  autoRefreshSeconds.value = 3
  landView.value = 'default'
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey(accountId)) || '{}')
    autoRefreshEnabled.value = saved.enabled === true
    autoRefreshSeconds.value = normalizeRefreshSeconds(saved.seconds ?? 3)
    landView.value = saved.view === 'compact' || saved.view === 'scene' ? saved.view : 'default'
  }
  catch {
    // Keep defaults when local storage is unavailable or malformed.
  }
  preferencesLoaded = true
}
function savePreferences() {
  if (!preferencesLoaded || !currentAccountId.value)
    return
  try {
    localStorage.setItem(preferenceKey(currentAccountId.value), JSON.stringify({
      enabled: autoRefreshEnabled.value,
      seconds: autoRefreshSeconds.value,
      view: landView.value,
    }))
  }
  catch {
    // Preferences must never prevent viewing the farm.
  }
}
function restartRefresh() {
  refreshController.stop()
  if (!disposed && visibility.value === 'visible' && accountRunning.value && !busy.value)
    refreshController.start(autoRefreshEnabled.value ? autoRefreshSeconds.value : 60)
}
function changeRefreshSeconds(event: Event) {
  const input = event.target as HTMLInputElement
  autoRefreshSeconds.value = normalizeRefreshSeconds(input.value)
  input.value = String(autoRefreshSeconds.value)
}
function actionCancelled(accountId: string, sequence: number) {
  return disposed || sequence !== actionSequence || accountId !== currentAccountId.value
    || !accountRunning.value || visibility.value !== 'visible'
}
function requestOperation(operation: typeof operations[number]) {
  if (!currentAccountId.value || !accountRunning.value || busy.value || loading.value)
    return
  pendingOperation.value = { operation, accountId: currentAccountId.value, sequence: actionSequence }
  if (operation.type === 'plant') {
    bagRequestSequence++
    bagSeedsLoading.value = false
    plantingMode.value = 'bag'
    selectedSeedIds.value = []
    bagSeeds.value = []
    void loadBagSeeds()
  }
}

async function loadBagSeeds() {
  const pending = pendingOperation.value
  if (pending?.operation.type !== 'plant' || bagSeedsLoading.value)
    return
  const request = ++bagRequestSequence
  bagSeedsLoading.value = true
  bagSeedsError.value = ''
  try {
    const seeds = await farmStore.fetchBagSeeds(pending.accountId)
    if (request === bagRequestSequence && pendingOperation.value === pending && !actionCancelled(pending.accountId, pending.sequence)) {
      bagSeeds.value = seeds.filter(seed => seed.count > 0)
      selectedSeedIds.value = selectedSeedIds.value.filter(id => bagSeeds.value.some(seed => seed.seedId === id))
    }
  }
  catch (cause: any) {
    if (request === bagRequestSequence && pendingOperation.value === pending)
      bagSeedsError.value = String(cause?.response?.data?.error || cause?.message || '背包种子读取失败')
  }
  finally {
    if (request === bagRequestSequence)
      bagSeedsLoading.value = false
  }
}

async function requestRipenAll() {
  const accountId = currentAccountId.value
  if (!accountId || !accountRunning.value || busy.value || loading.value)
    return
  const sequence = actionSequence
  ripenAllPreviewLoading.value = true
  try {
    const preview = await farmStore.previewRipenAll(accountId)
    if (!actionCancelled(accountId, sequence))
      pendingRipenAll.value = { preview, accountId, sequence }
  }
  catch (cause: any) {
    if (!actionCancelled(accountId, sequence))
      toast.error(String(cause?.response?.data?.error || cause?.message || '催熟预览失败'))
  }
  finally {
    ripenAllPreviewLoading.value = false
  }
}

async function executeRipenAll() {
  const pending = pendingRipenAll.value
  if (!pending || ripenAllRunning.value)
    return
  pendingRipenAll.value = null
  const { preview, accountId, sequence } = pending
  if (actionCancelled(accountId, sequence))
    return
  ripenAllRunning.value = true
  ripenAllProgress.value = `催熟中 0/${preview.targetCount}`
  try {
    const result = await runRipenAll({
      preview,
      cancelled: () => actionCancelled(accountId, sequence),
      step: (token, cursor) => farmStore.ripenAllStep(accountId, token, cursor),
      onProgress: (result) => { ripenAllProgress.value = `催熟中 ${result.completed}/${result.total}` },
    })
    if (result)
      toast.success(`已催熟 ${result.completed} 块作物，普通肥 ${fertilizerHours(result.used.normal)} 小时，有机肥 ${fertilizerHours(result.used.organic)} 小时`)
  }
  catch (cause: any) {
    if (!actionCancelled(accountId, sequence))
      toast.warning(`${ripenAllProgress.value}，已停止：${String(cause?.response?.data?.error || cause?.message || '催熟失败')}`)
  }
  finally {
    ripenAllRunning.value = false
    ripenAllProgress.value = ''
    if (!actionCancelled(accountId, sequence)) {
      await farmStore.fetchLands(accountId)
      await statusStore.fetchStatus(accountId)
    }
  }
}

function requestRemoveLand(land: Land) {
  const snapshot = lands.value.find(item => item.id === land.id)
  if (!currentAccountId.value || !accountRunning.value || busy.value || loading.value || !canRemoveLand(snapshot))
    return
  pendingOperation.value = {
    accountId: currentAccountId.value,
    sequence: actionSequence,
    operation: {
      type: 'remove',
      label: '铲除',
      land: { ...snapshot! },
      message: `确定要铲除 #${land.id} ${snapshot?.plantName || '该作物'} 吗？此操作不可恢复。`,
    },
  }
}

async function executeOperation() {
  const pending = pendingOperation.value
  if (!pending || operating.value || fertilizePending.value || ripeningLandId.value !== null || plantingDisabled.value)
    return
  pendingOperation.value = null
  const { operation, accountId, sequence } = pending
  if (actionCancelled(accountId, sequence))
    return
  operating.value = true
  try {
    if (operation.type === 'plant' && plantingMode.value === 'bag') {
      const result = await farmStore.plantSelectedBagSeeds(accountId, bagSeeds.value
        .filter(seed => selectedSeedIds.value.includes(seed.seedId)).map(seed => seed.seedId))
      if (!actionCancelled(accountId, sequence))
        toast.success(`已种植 ${result.planted} 株，剩余 ${result.remaining} 块空地`)
    }
    else if (operation.type === 'remove') {
      const latest = lands.value.find(land => land.id === operation.land.id)
      if (!canRemoveLand(latest) || latest?.plantId !== operation.land.plantId
        || latest?.currentSeason !== operation.land.currentSeason) {
        toast.warning('作物状态已变化，请刷新后重试')
        return
      }
      await farmStore.removePlant(accountId, operation.land.id)
      if (!actionCancelled(accountId, sequence))
        toast.success(`第 ${operation.land.id} 块土地的作物已铲除`)
    }
    else if (operation.type === 'removeAll' || operation.type === 'removeDead') {
      const result = operation.type === 'removeDead'
        ? await farmStore.removeDeadPlants(accountId)
        : await farmStore.removeAllPlants(accountId)
      if (!actionCancelled(accountId, sequence))
        toast.success(result?.data?.message || `已铲除 ${Number(result?.data?.removed || 0)} 块土地的作物`)
    }
    else {
      await farmStore.operate(accountId, operation.type)
      if (!actionCancelled(accountId, sequence))
        toast.success(`${operation.label}已执行`)
    }
  }
  catch (cause: any) {
    if (!actionCancelled(accountId, sequence))
      toast.error(String(cause?.response?.data?.error || cause?.message || `${operation.label}失败`))
  }
  finally {
    operating.value = false
  }
}

async function handleFertilize(land: Land, fertilizerType: FertilizerType) {
  const accountId = currentAccountId.value
  const snapshot = lands.value.find(item => item.id === land.id)
  if (!accountId || busy.value || loading.value || !accountRunning.value || !canRipenLand(snapshot))
    return
  if (fertilizerType === 'normal' && !canNormalFertilize(snapshot))
    return
  const sequence = actionSequence
  fertilizingLandId.value = land.id
  try {
    const result = await farmStore.applyFertilizer(accountId, land.id, fertilizerType)
    if (actionCancelled(accountId, sequence))
      return
    if (result)
      toast.success(`第 ${land.id} 块土地已施${fertilizerType === 'normal' ? '普通' : '有机'}化肥`)
    else
      toast.warning(fertilizeError.value || '当前无法继续施肥')
  }
  finally {
    if (sequence === actionSequence)
      fertilizingLandId.value = null
  }
}
async function handleRipen(land: Land) {
  const accountId = currentAccountId.value
  const snapshot = lands.value.find(item => item.id === land.id)
  if (!accountId || busy.value || loading.value || !accountRunning.value || !canRipenLand(snapshot))
    return
  const sequence = ++actionSequence
  ripeningLandId.value = land.id
  const cancelled = () => actionCancelled(accountId, sequence)
  try {
    const result = await ripenLand({
      getLand: () => lands.value.find(item => item.id === land.id),
      cancelled,
      fertilize: type => farmStore.applyFertilizer(accountId, land.id, type),
    })
    if (result.cancelled)
      return
    const count = `普通 ${result.normalCount} 次，有机 ${result.organicCount} 次`
    if (!result.matured) {
      const reasons: Record<string, string> = {
        'unavailable': fertilizeError.value || '当前无法继续施肥',
        'no-progress': '作物状态未继续推进，请刷新后重试',
        'empty': '有机化肥已用尽',
        'unconfirmed': '未返回最新土地状态，请刷新后重试',
        'changed': '作物状态已变化，请刷新后重试',
        'limit': '已达到本次施肥次数上限，请刷新后确认',
      }
      toast.warning(`已停止催熟（${count}）：${reasons[result.stopped] || '当前无法继续施肥'}`)
      return
    }
    toast.success(`第 ${land.id} 块土地催熟完成（${count}）`)
  }
  catch (cause: any) {
    if (!cancelled())
      toast.error(String(cause?.response?.data?.error || cause?.message || '催熟操作失败'))
  }
  finally {
    if (sequence === actionSequence) {
      ripeningLandId.value = null
    }
  }
}

watch(currentAccountId, (accountId, previousId) => {
  actionSequence++
  bagRequestSequence++
  bagSeedsLoading.value = false
  pendingRipenAll.value = null
  pendingOperation.value = null
  ripeningLandId.value = null
  fertilizingLandId.value = null
  if (previousId !== undefined && accountId !== previousId)
    farmStore.clearFarmData()
  loadPreferences(accountId)
  restartRefresh()
  void refreshController.run()
}, { immediate: true })
watch([autoRefreshEnabled, autoRefreshSeconds, landView], () => {
  savePreferences()
  restartRefresh()
})
watch([accountRunning, visibility, busy], ([running, visible]) => {
  restartRefresh()
  if (visible !== 'visible' || !running) {
    actionSequence++
    pendingRipenAll.value = null
    pendingOperation.value = null
    ripeningLandId.value = null
    fertilizingLandId.value = null
  }
  else {
    void refreshController.run()
  }
})
const { pause } = useIntervalFn(() => {
  clock.value = Date.now()
}, 1000)
onUnmounted(() => {
  disposed = true
  actionSequence++
  pause()
  refreshController.stop()
})
</script>

<template>
  <section class="farm-new-panel" aria-label="我的农场">
    <div class="farm-new-toolbar">
      <div class="farm-new-heading">
        <span class="farm-new-heading-icon i-carbon-sprout" />
        <div>
          <h3>土地详情</h3>
          <span class="farm-new-caption">{{ loaded && !error ? `${lands.length} 块土地` : '我的农场' }}</span>
        </div>
      </div>
      <div class="farm-new-tools">
        <button type="button" class="farm-new-refresh" title="刷新土地" aria-label="刷新土地" :disabled="loading || busy || !accountRunning" @click="refreshController.run()">
          <span :class="loading ? 'i-svg-spinners-90-ring-with-bg' : 'i-carbon-renew'" />
          <span>刷新</span>
        </button>
        <div class="farm-new-auto-refresh">
          <BaseSwitch v-model="autoRefreshEnabled" label="定时" aria-label="定时刷新土地" />
          <label class="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <input class="farm-new-interval" type="number" :value="autoRefreshSeconds" min="1" max="3600" step="1" :disabled="!autoRefreshEnabled" aria-label="土地详情刷新间隔（秒）" @change="changeRefreshSeconds">
            秒
          </label>
        </div>
        <div class="land-view-switch" role="group" aria-label="土地布局">
          <button type="button" title="默认视图" aria-label="默认视图" :aria-pressed="landView === 'default'" @click="landView = 'default'">
            <span class="i-carbon-grid" /><span>标准</span>
          </button>
          <button type="button" title="缩放视图" aria-label="缩放视图" :aria-pressed="landView === 'compact'" @click="landView = 'compact'">
            <span class="i-carbon-zoom-out" /><span>紧凑</span>
          </button>
          <button type="button" title="UI视图" aria-label="UI视图" :aria-pressed="landView === 'scene'" @click="landView = 'scene'">
            <span class="i-carbon-image" /><span>场景</span>
          </button>
        </div>
      </div>
    </div>
    <div class="farm-new-command-bar">
      <div class="farm-new-summary" aria-label="土地状态统计">
        <span class="farm-stat" data-status="harvestable"><i /><span>可收</span><strong>{{ loaded && !error ? (summary.harvestable || 0) : '--' }}</strong></span>
        <span class="farm-stat" data-status="growing"><i /><span>生长</span><strong>{{ loaded && !error ? (summary.growing || 0) : '--' }}</strong></span>
        <span class="farm-stat" data-status="empty"><i /><span>空闲</span><strong>{{ loaded && !error ? (summary.empty || 0) : '--' }}</strong></span>
        <span class="farm-stat" data-status="dead"><i /><span>枯萎</span><strong>{{ loaded && !error ? (summary.dead || 0) : '--' }}</strong></span>
      </div>
      <div class="farm-new-actions" role="group" aria-label="农场批量操作">
        <template v-for="operation in operations" :key="operation.type">
          <button
            type="button" class="farm-operation" :data-operation="operation.type"
            :title="operation.title" :aria-label="operation.title"
            :disabled="busy || loading || !accountRunning" @click="requestOperation(operation)"
          >
            <span :class="operation.icon" aria-hidden="true" />
            {{ operation.label }}
          </button>
          <button
            v-if="operation.type === 'clear'"
            type="button" class="farm-operation" data-operation="ripenAll"
            title="催熟全部作物，先预览化肥消耗" aria-label="催熟全部作物，先预览化肥消耗"
            :disabled="busy || loading || !accountRunning" @click="requestRipenAll"
          >
            <span :class="ripenAllPreviewLoading || ripenAllRunning ? 'i-svg-spinners-90-ring-with-bg' : 'i-carbon-chemistry'" aria-hidden="true" />
            {{ ripenAllPreviewLoading ? '预览' : '催熟' }}
          </button>
        </template>
      </div>
      <p v-if="ripenAllRunning" class="farm-operation-progress" role="status">
        {{ ripenAllProgress }}
      </p>
    </div>
    <div v-if="dogSkillGiftPendingCount > 0" class="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
      <span class="i-carbon-gift text-xl" />
      <span class="min-w-0 flex-1">待拾取同气连枝礼包 ×{{ dogSkillGiftPendingCount }}</span>
      <button type="button" class="inline-flex items-center gap-1.5 rounded bg-amber-600 px-3 py-1.5 text-white hover:bg-amber-700" :aria-busy="dogSkillGiftLoading" :disabled="dogSkillGiftLoading || busy || !accountRunning" @click="farmStore.claimDogSkillGifts(currentAccountId)">
        <span v-if="dogSkillGiftLoading" class="i-svg-spinners-90-ring-with-bg" aria-hidden="true" />拾取
      </button>
    </div>
    <div v-else-if="dogSkillGiftError" class="px-4 py-2 text-xs text-red-700 dark:text-red-300">
      {{ dogSkillGiftError }}
    </div>
    <div class="p-3 sm:p-5">
      <div v-if="!currentAccountId" class="farm-new-empty">
        <span class="i-carbon-user-offline text-4xl" /><strong>未登录账号</strong><span>请先添加农场账号</span>
      </div>
      <div v-else-if="!accountRunning" class="farm-new-empty">
        <span class="i-carbon-connection-signal-off text-4xl" /><strong>账号未运行</strong><span>请先启动账号，启动后会立即读取土地</span>
      </div>
      <div v-else-if="loading && !loaded" class="farm-new-empty">
        <span class="i-svg-spinners-90-ring-with-bg text-4xl text-green-500" />正在读取土地
      </div>
      <div v-else-if="error" class="farm-new-empty text-red-600 dark:text-red-300">
        <span class="i-carbon-warning-alt text-4xl" /><span>{{ error }}</span>
        <button type="button" class="farm-new-retry" :disabled="loading || busy" @click="refreshController.run()">
          重试
        </button>
      </div>
      <div v-else-if="!loaded || !lands.length" class="farm-new-empty">
        <span class="i-carbon-sprout text-4xl" /><span>{{ loaded ? '当前没有可展示的土地' : '尚未读取土地详情' }}</span>
        <button type="button" class="farm-new-retry" :disabled="loading || busy" @click="refreshController.run()">
          读取
        </button>
      </div>
      <FarmScene
        v-else-if="landView === 'scene'" :lands="displayLands" :weather="weather"
        @fertilize="handleRipen" @remove="requestRemoveLand"
      />
      <div v-else class="land-grid" :class="landView === 'compact' ? 'land-grid--compact' : 'land-grid--standard'" :aria-busy="loading">
        <FarmNewLandCard
          v-for="land in displayLands" :key="land.id" :land="land" :compact="landView === 'compact'" :refined="landView === 'default'"
          :show-remove-action="canRemoveLand(land)" :remove-disabled="busy || loading || !accountRunning"
          :show-fertilizer-actions="canRipenLand(land)" :show-ripen-action="canRipenLand(land)"
          :fertilizer-pending="fertilizingLandId === land.id || ripeningLandId === land.id"
          :normal-fertilizer-disabled="busy || loading || !canNormalFertilize(land)" :organic-fertilizer-disabled="busy || loading"
          :ripen-pending="ripeningLandId === land.id" :ripen-disabled="busy || loading"
          @fertilize="handleFertilize" @ripen="handleRipen" @remove="requestRemoveLand"
        />
      </div>
    </div>
    <ConfirmModal
      :show="pendingRipenAll !== null" title="催熟全部 · 消耗预览"
      :is-alert="!pendingRipenAll?.preview.sufficient || !pendingRipenAll?.preview.targetCount"
      :confirm-text="pendingRipenAll?.preview.sufficient && pendingRipenAll?.preview.targetCount ? '确认催熟' : '关闭'"
      @confirm="pendingRipenAll?.preview.sufficient && pendingRipenAll?.preview.targetCount ? executeRipenAll() : pendingRipenAll = null"
      @cancel="pendingRipenAll = null" @close="pendingRipenAll = null"
    >
      <template v-if="pendingRipenAll">
        <p class="mb-3">
          本次可催熟 {{ pendingRipenAll.preview.targetCount }} 块作物
        </p>
        <div class="ripen-preview-grid">
          <span>化肥</span><span>预计消耗</span><span>当前剩余</span>
          <template v-for="kind in (['normal', 'organic'] as const)" :key="kind">
            <span class="inline-flex items-center gap-1">
              <img :src="`/game-config/resource-icons/fertilizer-${kind}.png`" alt="" class="h-5 w-5 object-contain">
              {{ kind === 'normal' ? '普通' : '有机' }}
            </span>
            <strong>{{ fertilizerHours(pendingRipenAll.preview.cost[kind]) }} 小时</strong>
            <span :class="{ 'text-red-500': pendingRipenAll.preview.inventory[kind] < pendingRipenAll.preview.cost[kind] }">
              {{ fertilizerHours(pendingRipenAll.preview.inventory[kind]) }} 小时
            </span>
          </template>
        </div>
        <p v-if="!pendingRipenAll.preview.sufficient" class="mt-3 text-red-500">
          化肥不足，无法催熟全部
        </p>
        <div v-if="pendingRipenAll.preview.skipped.length" class="mt-3 max-h-32 overflow-y-auto text-left text-xs">
          <p v-for="item in pendingRipenAll.preview.skipped" :key="item.landId">
            #{{ item.landId }} 已跳过：{{ item.reason }}
          </p>
        </div>
      </template>
    </ConfirmModal>
    <ConfirmModal
      :show="confirmVisible" :title="pendingOperation ? `确认${pendingOperation.operation.label}` : '确认操作'"
      :message="pendingOperation?.operation.message || ''"
      :confirm-disabled="plantingDisabled"
      :confirm-text="pendingOperation?.operation.type === 'plant' ? (plantingMode === 'bag' ? '种植所选种子' : '按策略一键种植') : '确定'"
      :type="pendingOperation?.operation.type === 'removeAll' || pendingOperation?.operation.type === 'remove' ? 'danger' : 'primary'"
      @confirm="executeOperation" @cancel="pendingOperation = null" @close="pendingOperation = null"
    >
      <div v-if="pendingOperation?.operation.type === 'plant'" class="plant-selection">
        <div class="plant-modes" role="group" aria-label="种植方式">
          <label><input v-model="plantingMode" type="radio" value="bag">背包选种</label>
          <label><input v-model="plantingMode" type="radio" value="strategy">系统策略</label>
        </div>
        <template v-if="plantingMode === 'bag'">
          <p v-if="bagSeedsLoading" role="status">正在读取背包种子…</p>
          <div v-else-if="bagSeedsError" role="alert">
            <p>{{ bagSeedsError }}</p>
            <button type="button" class="farm-operation mt-2" @click="loadBagSeeds">
              <span class="i-carbon-renew" aria-hidden="true" />重试
            </button>
          </div>
          <p v-else-if="!bagSeeds.length">背包暂无可用种子</p>
          <div v-else class="plant-seeds">
            <label v-for="seed in bagSeeds" :key="seed.seedId" class="plant-seed">
              <input v-model="selectedSeedIds" type="checkbox" :value="seed.seedId">
              <img v-if="seed.image" :src="seed.image" alt="" class="h-9 w-9 shrink-0 object-contain">
              <span class="min-w-0 flex-1">
                <span class="block break-words">{{ seed.name }}</span>
                <small v-if="seed.plantSize === 2">2×2</small>
              </span>
              <strong class="shrink-0">×{{ seed.count }}</strong>
            </label>
          </div>
        </template>
        <p v-else>{{ pendingOperation.operation.message }}</p>
      </div>
      <template v-else>{{ pendingOperation?.operation.message }}</template>
    </ConfirmModal>
  </section>
</template>

<style scoped>
.plant-selection {
  text-align: left;
  white-space: normal;
}
.plant-modes {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 12px;
}
.plant-modes label,
.plant-seed {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.plant-seeds {
  max-height: min(40vh, 320px);
  overflow-y: auto;
}
.plant-seed {
  padding: 8px 0;
  border-bottom: 1px solid var(--surface-3);
}
.ripen-preview-grid {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  gap: 10px 8px;
  text-align: right;
  font-size: 12px;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
.ripen-preview-grid > :nth-child(3n + 1) {
  text-align: left;
}
.farm-new-panel {
  container-name: farm-controls;
  container-type: inline-size;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  background: var(--surface-1);
  box-shadow: var(--surface-shadow-soft);
  --ui-ink: #293b32;
  --ui-muted: #758178;
  --ui-border: #dce4da;
  --ui-primary: var(--theme-primary, #438d63);
  --ui-primary-soft: #edf7ed;
  --ui-violet: #8f79bc;
  --ui-shadow-sm: 0 2px 8px rgba(40, 48, 44, 0.08);
  --ui-shadow-md: 0 8px 20px rgba(40, 48, 44, 0.12);
}
:global(.dark) .farm-new-panel {
  --ui-ink: #e5eae4;
  --ui-muted: #a2ada4;
  --ui-border: #46554a;
  --ui-primary-soft: #263e30;
}
.farm-new-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--surface-border);
}
.farm-new-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}
.farm-new-heading-icon {
  width: 38px;
  height: 38px;
  padding: 9px;
  border-radius: 12px;
  color: var(--theme-primary);
  background: color-mix(in srgb, var(--theme-primary) 9%, transparent);
}
.farm-new-heading h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.4;
}
.farm-new-caption {
  font-size: 12px;
  color: var(--muted-text);
}
.farm-new-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.farm-new-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 6px 10px;
  border-radius: 8px;
  color: var(--muted-text);
  font-size: 13px;
}
.farm-new-refresh:hover {
  background: var(--surface-2);
  color: var(--theme-primary);
}
.farm-new-auto-refresh {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 4px 10px;
  border: 1px solid var(--surface-border);
  border-radius: 9px;
}
.farm-new-auto-refresh :deep(label) {
  gap: 8px;
}
.farm-new-auto-refresh :deep(label > span) {
  font-size: 12px;
}
.farm-new-interval {
  width: 48px;
  padding: 3px 2px;
  border: 0;
  border-bottom: 1px solid var(--surface-border-strong);
  border-radius: 0;
  color: var(--theme-text);
  background: transparent;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.farm-new-interval:disabled {
  opacity: 0.4;
}
.land-view-switch {
  display: flex;
  flex-shrink: 0;
  gap: 3px;
  border: 1px solid var(--surface-border);
  border-radius: 9px;
  padding: 3px;
  background: var(--surface-2);
}
.land-view-switch button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 30px;
  padding: 4px 9px;
  border-radius: 6px;
  color: var(--muted-text);
  font-size: 12px;
}
.land-view-switch button[aria-pressed='true'] {
  color: var(--theme-primary);
  background: var(--surface-1);
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.07);
}
.farm-new-command-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--surface-border);
  background: color-mix(in srgb, var(--surface-2) 50%, transparent);
}
.farm-new-summary {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}
.farm-stat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted-text);
  white-space: nowrap;
}
.farm-stat strong {
  color: var(--theme-text);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.farm-stat i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #a6afa7;
}
.farm-stat[data-status='harvestable'] i {
  background: #d6a243;
}
.farm-stat[data-status='growing'] i {
  background: #6aaa78;
}
.farm-stat[data-status='dead'] i {
  background: #cb8c85;
}
.farm-new-actions {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.farm-operation-progress {
  color: var(--theme-primary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
@container farm-controls (max-width: 760px) {
  .farm-new-actions {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
.farm-operation {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 68px;
  min-height: 34px;
  padding: 6px 10px;
  border: 1px solid var(--surface-border-strong);
  border-radius: 8px;
  background: var(--surface-1);
  color: var(--theme-text);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition:
    background 150ms,
    border-color 150ms;
}
.farm-operation:hover:not(:disabled) {
  border-color: var(--theme-primary);
  color: var(--theme-primary);
  background: color-mix(in srgb, var(--theme-primary) 5%, var(--surface-1));
}
.farm-operation[data-operation='all'] {
  color: #fff;
  border-color: var(--theme-primary);
  background: var(--theme-primary);
}
.farm-operation[data-operation='all']:hover:not(:disabled) {
  color: #fff;
  background: var(--theme-secondary);
}
.farm-operation[data-operation='removeAll'] {
  color: #bf6262;
  border-color: color-mix(in srgb, #bf6262 25%, var(--surface-border));
  background: transparent;
}
.farm-operation[data-operation='removeAll']:hover:not(:disabled) {
  color: #b54d4d;
  border-color: #bf6262;
  background: color-mix(in srgb, #bf6262 7%, transparent);
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.land-grid--standard {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 14px;
}
@media (max-width: 639px) {
  .land-grid--standard {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
}
.land-grid--compact {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 120px), 1fr));
  gap: 8px;
}
.farm-new-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 240px;
  text-align: center;
  color: var(--ui-muted);
}
.farm-new-empty strong {
  color: var(--ui-ink);
  font-size: 18px;
}
.farm-new-retry {
  padding: 6px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 3px;
}
@media (max-width: 767px) {
  .farm-new-actions {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
@media (max-width: 480px) {
  .farm-new-toolbar {
    padding: 14px;
  }
  .farm-new-tools {
    gap: 8px;
    width: 100%;
  }
  .farm-new-command-bar {
    padding: 12px 14px;
    gap: 12px;
  }
  .farm-new-summary {
    width: 100%;
    justify-content: space-between;
    gap: 8px;
  }
  .farm-new-actions {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    width: 100%;
    gap: 6px;
  }
  .farm-operation {
    min-width: 0;
    padding: 7px 4px;
    font-size: 12px;
  }
  .farm-operation[data-operation='removeAll'] {
    margin-left: 0;
  }
  .farm-new-auto-refresh {
    gap: 7px;
    padding: 4px 7px;
  }
  .land-grid--compact {
    gap: 4px;
  }
}
</style>
