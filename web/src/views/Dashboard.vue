<script setup lang="ts">
import type { RuntimeLogEntry } from '@/utils/runtime-log'
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import api from '@/api'
import AccountOverviewCards from '@/components/AccountOverviewCards.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useAccountStore } from '@/stores/account'
import { useAppStore } from '@/stores/app'
import { useBagStore } from '@/stores/bag'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { FARM_BRAND } from '@/utils/branding'
import { milkTeaCountdown } from '@/utils/dashboard-activity-check'
import { partitionOperations } from '@/utils/dashboard-operations'
import { compactRuntimeLogs, matchesRuntimeLog, normalizeRuntimeLog } from '@/utils/runtime-log'

const { compactDashboard } = storeToRefs(useAppStore())
const statusStore = useStatusStore()
const accountStore = useAccountStore()
const bagStore = useBagStore()
const toastStore = useToastStore()

const {
  status,
  logs: statusLogs,
  accountLogs: statusAccountLogs,
  realtimeConnected,
  currentStatusReady,
} = storeToRefs(statusStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { dashboardItems } = storeToRefs(bagStore)

const logContainer = ref<HTMLElement | null>(null)
const autoScroll = ref(true)
const lastBagFetchAt = ref(0)
const illustratedLevels = ref({ crop: 0, mutant: 0 })
let illustratedLevelRequestId = 0
const clearingLogs = ref(false)
const refreshingLogs = ref(false)
const pendingLogCount = ref(0)
const logScrollStates = new Map<string, { top: number, atBottom: boolean }>()

const filter = reactive({
  module: '',
  event: '',
  keyword: '',
})

const hasActiveLogFilter = computed(() =>
  !!(filter.module || filter.event || filter.keyword),
)
const currentAccountDisconnected = computed(() =>
  currentStatusReady.value && !status.value?.connection?.connected,
)

const allLogs = computed(() => {
  const merged = [
    ...(statusLogs.value || []).map((log: any) => normalizeRuntimeLog(log)),
    ...(statusAccountLogs.value || []).map((log: any) => normalizeRuntimeLog(log, true)),
  ]
  const unique = new Map<string, RuntimeLogEntry>()
  for (const log of merged)
    unique.set(log.id, log)
  return [...unique.values()].sort((a, b) => a.ts - b.ts)
})

const filteredLogs = computed(() => allLogs.value.filter((log) => {
  return matchesRuntimeLog(log, filter)
}))

const visibleLogs = computed(() => compactRuntimeLogs(filteredLogs.value))
const logSummary = computed(() => {
  const counts = { info: 0, warn: 0, error: 0 }
  if (currentAccountId.value && currentStatusReady.value) {
    for (const log of filteredLogs.value)
      counts[log.level]++
  }
  return counts
})

const modules = [
  { label: '全部模块', value: '' },
  { label: '农场', value: 'farm' },
  { label: '好友', value: 'friend' },
  { label: '仓库', value: 'warehouse' },
  { label: '商城', value: 'shop' },
  { label: '任务', value: 'task' },
  { label: '活动', value: 'activity' },
  { label: '宠物', value: 'pet' },
  { label: '系统', value: 'system' },
]

const events = [
  { label: '全部事件', value: '' },
  { label: '农场巡查', value: '农场循环' },
  { label: '收获作物', value: '收获作物' },
  { label: '清理枯枝', value: '铲除植物' },
  { label: '种植种子', value: '种植种子' },
  { label: '施加化肥', value: '施肥' },
  { label: '土地提醒', value: '土地推送通知' },
  { label: '选择种子', value: '选择种子' },
  { label: '购买种子', value: '购买种子' },
  { label: '购买化肥', value: '购买化肥' },
  { label: '开启礼盒', value: '开启化肥礼包' },
  { label: '获取任务', value: '扫描任务' },
  { label: '完成任务', value: '领取任务' },
  { label: '免费礼包', value: 'mall_free_gifts' },
  { label: '分享奖励', value: 'daily_share' },
  { label: '会员礼包', value: 'vip_daily_gift' },
  { label: '月卡礼包', value: 'month_card_gift' },
  { label: '图鉴奖励', value: '图鉴奖励' },
  { label: '邮箱领取', value: 'email_rewards' },
  { label: '出售成功', value: 'sell_success' },
  { label: '神秘商人', value: '神秘商人自动购买' },
  { label: '土地升级', value: '升级土地' },
  { label: '土地解锁', value: '解锁土地' },
  { label: '好友巡查', value: '好友巡查循环' },
  { label: '访问好友', value: '进入农场' },
  { label: '激活宠物', value: '激活宠物' },
  { label: '派出宠物', value: '派出宠物' },
  { label: '召回宠物', value: '召回宠物' },
  { label: '喂食宠物', value: '喂食宠物' },
  { label: '资本模式派出', value: '资本模式派出' },
  { label: '资本模式召回', value: '资本模式召回' },
]

const eventLabelMap: Record<string, string> = Object.fromEntries(
  events.filter(event => event.value).map(event => [event.value, event.label]),
)

const nextFarmCheck = ref('--:--:--')
const nextHelpCheck = ref('--:--:--')
const nextStealCheck = ref('--:--:--')
const countdownNow = ref(Date.now())
const milkTeaCheck = computed(() => milkTeaCountdown(status.value?.nextChecks?.milkTea, countdownNow.value))
const localUptime = ref(0)

let localNextFarmRemainSec = 0
let localNextHelpRemainSec = 0
let localNextStealRemainSec = 0
const farmCountdownTotal = ref(1)
const helpCountdownTotal = ref(1)
const stealCountdownTotal = ref(1)

function resetDashboardState() {
  illustratedLevelRequestId += 1
  illustratedLevels.value = { crop: 0, mutant: 0 }
  lastBagFetchAt.value = 0
  localUptime.value = 0
  localNextFarmRemainSec = 0
  localNextHelpRemainSec = 0
  localNextStealRemainSec = 0
  farmCountdownTotal.value = 1
  helpCountdownTotal.value = 1
  stealCountdownTotal.value = 1
  nextFarmCheck.value = '--:--:--'
  nextHelpCheck.value = '--:--:--'
  nextStealCheck.value = '--:--:--'
}

function syncCountdownTotal(total: typeof farmCountdownTotal, remain: number, previousRemain: number) {
  if (remain > previousRemain || total.value <= 1)
    total.value = Math.max(1, remain)
}

function getCountdownProgress(remain: number, total: number) {
  return Math.max(0, Math.min(100, (remain / Math.max(1, total)) * 100))
}

const OP_META: Record<string, { label: string, icon: string, color: string }> = {
  harvest: { label: '收获', icon: 'i-carbon-crop-growth', color: 'text-green-500' },
  water: { label: '浇水', icon: 'i-carbon-rain-drop', color: 'text-blue-400' },
  weed: { label: '除草', icon: 'i-carbon-cut', color: 'text-yellow-500' },
  bug: { label: '除虫', icon: 'i-carbon-pest', color: 'text-red-400' },
  farming: { label: '一键务农', icon: 'i-carbon-clean', color: 'text-teal-500' },
  fertilize: { label: '施肥', icon: 'i-carbon-chemistry', color: 'text-emerald-500' },
  plant: { label: '种植', icon: 'i-carbon-tree', color: 'text-lime-500' },
  steal: { label: '偷菜', icon: 'i-carbon-run', color: 'text-orange-500' },
  helpWater: { label: '帮浇水', icon: 'i-carbon-rain-drop', color: 'text-blue-300' },
  goldenBugClear: { label: '清黄金虫', icon: 'i-carbon-clean', color: 'text-amber-500' },
  goldenBugPut: { label: '放黄金虫', icon: 'i-carbon-pest', color: 'text-yellow-500' },
  helpWeed: { label: '帮除草', icon: 'i-carbon-cut', color: 'text-yellow-400' },
  helpBug: { label: '帮除虫', icon: 'i-carbon-pest', color: 'text-red-300' },
  taskClaim: { label: '任务', icon: 'i-carbon-task-complete', color: 'text-indigo-500' },
  sell: { label: '出售', icon: 'i-carbon-shopping-cart', color: 'text-pink-500' },
  tongQiGift: { label: '同气礼包', icon: 'i-carbon-gift', color: 'text-rose-500' },
}

const filteredOperations = computed(() => {
  const operations = status.value?.operations || {}
  const result: Record<string, number> = {}

  for (const key of Object.keys(operations)) {
    if (key !== 'upgrade' && key !== 'levelUp')
      result[key] = operations[key]
  }

  return result
})

const operationGroups = computed(() => partitionOperations(filteredOperations.value))

function getEventLabel(event: string) {
  return eventLabelMap[event] || event
}

function updateCountdowns() {
  countdownNow.value = Date.now()
  if (currentAccountDisconnected.value) {
    nextFarmCheck.value = '账号未登录'
    nextHelpCheck.value = '账号未登录'
    nextStealCheck.value = '账号未登录'
    return
  }

  localUptime.value++

  if (localNextFarmRemainSec > 0) {
    localNextFarmRemainSec--
    nextFarmCheck.value = formatDuration(localNextFarmRemainSec)
  }
  else {
    nextFarmCheck.value = '检查中...'
  }

  if (localNextHelpRemainSec > 0) {
    localNextHelpRemainSec--
    nextHelpCheck.value = formatDuration(localNextHelpRemainSec)
  }
  else {
    nextHelpCheck.value = '检查中...'
  }

  if (localNextStealRemainSec > 0) {
    localNextStealRemainSec--
    nextStealCheck.value = formatDuration(localNextStealRemainSec)
  }
  else {
    nextStealCheck.value = '检查中...'
  }
}

watch(status, (newVal) => {
  countdownNow.value = Date.now()
  if (newVal?.nextChecks) {
    const farmRemainSec = newVal.nextChecks.farmRemainSec || 0
    const helpRemainSec = newVal.nextChecks.helpRemainSec || 0
    const stealRemainSec = newVal.nextChecks.stealRemainSec || 0
    syncCountdownTotal(farmCountdownTotal, farmRemainSec, localNextFarmRemainSec)
    syncCountdownTotal(helpCountdownTotal, helpRemainSec, localNextHelpRemainSec)
    syncCountdownTotal(stealCountdownTotal, stealRemainSec, localNextStealRemainSec)
    localNextFarmRemainSec = farmRemainSec
    localNextHelpRemainSec = helpRemainSec
    localNextStealRemainSec = stealRemainSec
    updateCountdowns()
  }

  if (newVal?.uptime !== undefined)
    localUptime.value = newVal.uptime
}, { deep: true })

function formatDuration(seconds: number) {
  if (seconds <= 0)
    return '00:00:00'

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainSeconds = Math.floor(seconds % 60)
  const pad = (value: number) => value.toString().padStart(2, '0')

  if (days > 0)
    return `${days}天 ${pad(hours)}:${pad(minutes)}:${pad(remainSeconds)}`
  return `${pad(hours)}:${pad(minutes)}:${pad(remainSeconds)}`
}

function getLogTagClass(tag: string) {
  if (tag === '错误')
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  if (tag === '系统')
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (tag === '活动')
    return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
  if (tag === '宠物')
    return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300'
  if (tag === '警告')
    return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
  return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
}

function getLogRowClass(log: RuntimeLogEntry) {
  if (log.level === 'error')
    return 'border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/20'
  if (log.level === 'warn')
    return 'border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20'
  return 'border-transparent hover:bg-white/55 dark:hover:bg-gray-800/45'
}

function getLogMsgClass(tag: string) {
  if (tag === '错误')
    return 'text-red-600 dark:text-red-400'
  return 'text-gray-700 dark:text-gray-300'
}

function formatLogTime(timeStr: string) {
  if (!timeStr)
    return ''
  const parts = timeStr.split(' ')
  return parts.length > 1 ? parts[1] : timeStr
}

function formatLogTimeRange(log: RuntimeLogEntry) {
  const start = formatLogTime(log.time)
  if (!log.lastTs || log.lastTs === log.ts)
    return start
  return `${start}–${new Date(log.lastTs).toLocaleTimeString('zh-CN', { hour12: false })}`
}

function getLogScrollStateKey() {
  return [currentAccountId.value, filter.module, filter.event, filter.keyword].join('|')
}

function restoreLogScroll() {
  nextTick(() => {
    const element = logContainer.value
    if (!element)
      return
    const saved = logScrollStates.get(getLogScrollStateKey())
    if (saved && !saved.atBottom) {
      element.scrollTop = saved.top
      autoScroll.value = false
    }
    else {
      scrollToBottom()
    }
  })
}

async function refreshRuntimeLogs() {
  if (!currentAccountId.value || refreshingLogs.value)
    return
  refreshingLogs.value = true
  try {
    await Promise.all([
      statusStore.fetchLogs(currentAccountId.value, { limit: 300 }),
      statusStore.fetchAccountLogs(currentAccountId.value, 300),
    ])
    toastStore.success('日志已刷新')
  }
  finally {
    refreshingLogs.value = false
  }
}

function getOpName(key: string | number) {
  return OP_META[String(key)]?.label || String(key)
}

function getOpIcon(key: string | number) {
  return OP_META[String(key)]?.icon || 'i-carbon-circle-dash'
}

function getOpColor(key: string | number) {
  return OP_META[String(key)]?.color || 'text-gray-400'
}

async function refreshBag(force = false) {
  if (!currentAccountId.value || !currentAccount.value?.running || !currentStatusReady.value || !status.value?.connection?.connected)
    return

  const now = Date.now()
  if (!force && now - lastBagFetchAt.value < 2500)
    return

  lastBagFetchAt.value = now
  await bagStore.fetchBag(currentAccountId.value)
}

async function refreshIllustratedLevels() {
  if (!currentAccountId.value || !status.value?.connection?.connected)
    return

  const accountId = currentAccountId.value
  const requestId = ++illustratedLevelRequestId
  const headers = { 'x-account-id': accountId }
  try {
    const [crop, mutant] = await Promise.all([
      api.get('/api/illustrated', { params: { illustrated_type: 1 }, headers }),
      api.get('/api/illustrated', { params: { illustrated_type: 2 }, headers }),
    ])
    if (requestId !== illustratedLevelRequestId || accountId !== currentAccountId.value)
      return
    illustratedLevels.value = {
      crop: Number(crop.data?.data?.level) || 0,
      mutant: Number(mutant.data?.data?.level) || 0,
    }
  }
  catch {
    if (requestId === illustratedLevelRequestId)
      illustratedLevels.value = { crop: 0, mutant: 0 }
  }
}

async function refresh(forceReloadLogs = false) {
  if (!currentAccountId.value)
    return

  const account = currentAccount.value
  if (!account)
    return

  // 首次加载、断线回退时走 HTTP；实时连接正常时优先依赖 WS 推送。
  if (!realtimeConnected.value) {
    await statusStore.fetchStatus(currentAccountId.value)
    await statusStore.fetchAccountLogs(currentAccountId.value)
  }

  if (forceReloadLogs || !realtimeConnected.value)
    await statusStore.fetchLogs(currentAccountId.value, { limit: 300 })

  // 仅在账号运行且连接稳定后再拉背包，避免启动阶段出现 500。
  await refreshBag()
}

function syncRealtimeAccount() {
  if (currentAccountId.value)
    statusStore.connectRealtime(currentAccountId.value)
}

function onLogFilterChange() {
  pendingLogCount.value = 0
  restoreLogScroll()
}

function onLogSearchTrigger() {
  pendingLogCount.value = 0
  restoreLogScroll()
}

watch(currentAccountId, async (newId, oldId) => {
  if (oldId !== undefined && newId !== oldId) {
    statusStore.clearAccountScopedData()
    bagStore.clearBag()
    resetDashboardState()
  }
  syncRealtimeAccount()
  await refresh(true)
  await refreshIllustratedLevels()
  scrollToBottom()
})

watch(() => status.value?.connection?.connected, (connected) => {
  if (connected) {
    refreshBag(true)
    refreshIllustratedLevels()
  }
})

watch(() => JSON.stringify(status.value?.operations || {}), (next, prev) => {
  if (!realtimeConnected.value || next === prev)
    return
  refreshBag()
})

function onLogScroll(event: Event) {
  const element = event.target as HTMLElement
  if (!element)
    return
  autoScroll.value = element.scrollHeight - element.scrollTop - element.clientHeight < 50
  logScrollStates.set(getLogScrollStateKey(), { top: element.scrollTop, atBottom: autoScroll.value })
  if (autoScroll.value)
    pendingLogCount.value = 0
}

async function clearLogs() {
  if (!currentAccountId.value)
    return
  if (!window.confirm('确认清空当前账号的页面运行记录？此操作不会删除磁盘诊断日志。'))
    return

  clearingLogs.value = true
  try {
    const { data } = await api.delete('/api/logs')
    if (data?.ok) {
      toastStore.success('日志已清空')
      await refresh(true)
    }
    else {
      toastStore.error(`清空失败: ${data?.error || '未知错误'}`)
    }
  }
  catch (error: any) {
    const message = error?.response?.data?.error || error?.message || '请求失败'
    toastStore.error(`清空失败: ${message}`)
  }
  finally {
    clearingLogs.value = false
  }
}

watch(filteredLogs, (next, previous) => {
  nextTick(() => {
    if (logContainer.value && autoScroll.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
      pendingLogCount.value = 0
    }
    else if (next.length > (previous?.length || 0)) {
      pendingLogCount.value += next.length - (previous?.length || 0)
    }
  })
}, { deep: true })

function scrollToBottom() {
  nextTick(() => {
    if (logContainer.value)
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    autoScroll.value = true
    pendingLogCount.value = 0
  })
}

onMounted(async () => {
  statusStore.setRealtimeLogsEnabled(true)
  syncRealtimeAccount()
  await refresh()
  await refreshIllustratedLevels()
  scrollToBottom()
})

// Auto refresh fallback every 10s (WS 断开或启用筛选时回退 HTTP)
useIntervalFn(refresh, 10000)
// Countdown timer (every 1s)
useIntervalFn(updateCountdowns, 1000)
function retryStatus() {
  if (currentAccountId.value && !statusStore.loading)
    void statusStore.fetchStatus(currentAccountId.value)
}

const syncLabel = computed(() => {
  if (!currentAccountId.value)
    return '未选择账号'
  if (statusStore.error)
    return '同步失败'
  if (!currentStatusReady.value)
    return '正在同步'
  if (currentAccountDisconnected.value)
    return '账号未连接'
  return realtimeConnected.value ? '实时同步中' : '轮询同步中'
})
const countdowns = computed((): { key: string, label: string, icon: string, time: string, progress: number, description?: string }[] => [
  { key: 'farm', label: '农场巡查', icon: 'i-carbon-sprout', time: nextFarmCheck.value, progress: getCountdownProgress(localNextFarmRemainSec, farmCountdownTotal.value) },
  { key: 'help', label: '好友帮助', icon: 'i-carbon-rain-drop', time: nextHelpCheck.value, progress: getCountdownProgress(localNextHelpRemainSec, helpCountdownTotal.value) },
  { key: 'steal', label: '好友偷菜', icon: 'i-carbon-run', time: nextStealCheck.value, progress: getCountdownProgress(localNextStealRemainSec, stealCountdownTotal.value) },
  { key: 'milk-tea', label: '奶茶自动化', icon: 'i-carbon-cafe', time: milkTeaCheck.value.time, progress: milkTeaCheck.value.progress, description: milkTeaCheck.value.description },
])
</script>

<template>
  <div class="dashboard-page" :class="{ 'dashboard-page--compact': compactDashboard }">
    <div class="dashboard-page-heading farm-section-heading">
      <div><h1>农场概览</h1><p>账号状态与运行记录</p></div>
      <BaseButton variant="secondary" size="sm" :aria-pressed="compactDashboard" @click="compactDashboard = !compactDashboard">
        <span v-if="compactDashboard" class="i-carbon-grid mr-1.5" aria-hidden="true" />
        <span v-else class="i-carbon-terminal mr-1.5" aria-hidden="true" />
        {{ compactDashboard ? '完整概览' : '专注日志' }}
      </BaseButton>
    </div>

    <section v-if="!compactDashboard" class="dashboard-hero" aria-label="农场日常">
      <div class="dashboard-hero-copy">
        <h2>{{ FARM_BRAND.headlineLead }}{{ FARM_BRAND.headlineTail }}</h2>
        <p>{{ FARM_BRAND.description }}</p>
      </div>
      <BaseButton to="/personal" variant="primary" size="sm">
        我的农场 <span class="i-carbon-arrow-up-right ml-2" aria-hidden="true" />
      </BaseButton>
    </section>

    <template v-if="!compactDashboard">
      <AccountOverviewCards
        compact
        :status="status" :current-status-ready="currentStatusReady" :current-account="currentAccount"
        :dashboard-items="dashboardItems" :illustrated-levels="illustratedLevels" :local-uptime="localUptime"
        :status-error="statusStore.error" :status-loading="statusStore.loading" @retry="retryStatus"
      />
    </template>
    <div v-else class="dashboard-monitor-status ui-subtle-panel">
      <span class="i-carbon-connection-signal" aria-hidden="true" /><span>{{ syncLabel }}</span><span class="ml-auto text-xs">当前账号 · 运行记录</span>
    </div>

    <div class="dashboard-workspace">
      <section class="ui-card dashboard-logs" aria-label="运行日志">
        <header class="dashboard-log-header">
          <div class="dashboard-log-heading">
            <span class="i-carbon-terminal" aria-hidden="true" />
            <h3>运行日志</h3>
            <span class="dashboard-log-sync">{{ syncLabel }}</span>
          </div>
          <div class="dashboard-log-tools">
            <BaseButton
              variant="ghost"
              size="sm"
              title="刷新日志"
              aria-label="刷新日志"
              :loading="refreshingLogs"
              @click="refreshRuntimeLogs"
            >
              <span class="i-carbon-renew" aria-hidden="true" />
            </BaseButton>
            <BaseButton
              variant="ghost"
              size="sm"
              title="清空当前账号运行日志"
              aria-label="清空当前账号运行日志"
              :loading="clearingLogs"
              @click="clearLogs"
            >
              <span class="i-carbon-trash-can" aria-hidden="true" />
            </BaseButton>
          </div>
        </header>
        <div class="dashboard-log-toolbar">
          <BaseInput
            v-model="filter.keyword"
            placeholder="搜索日志内容"
            aria-label="搜索日志内容"
            class="dashboard-log-search"
            clearable
            @keyup.enter="onLogSearchTrigger"
            @clear="onLogSearchTrigger"
          />

          <BaseSelect
            v-model="filter.module"
            :options="modules"
            placeholder="筛选模块"
            @change="onLogFilterChange"
          />

          <BaseSelect
            v-model="filter.event"
            :options="events"
            placeholder="筛选事件"
            @change="onLogFilterChange"
          />

          <BaseButton
            v-if="hasActiveLogFilter"
            variant="ghost"
            size="sm"
            title="重置筛选"
            aria-label="重置筛选"
            @click="Object.assign(filter, { module: '', event: '', keyword: '' }); onLogFilterChange()"
          >
            <span class="i-carbon-filter-remove" aria-hidden="true" />
          </BaseButton>
        </div>
        <div class="dashboard-log-summary">
          <span>匹配记录 <strong>{{ logSummary.info + logSummary.warn + logSummary.error }}</strong></span>
          <div class="dashboard-log-levels">
            <span class="dashboard-log-level--info"><i />常规 <b>{{ logSummary.info }}</b></span>
            <span class="dashboard-log-level--warn"><i />警告 <b>{{ logSummary.warn }}</b></span>
            <span class="dashboard-log-level--error"><i />错误 <b>{{ logSummary.error }}</b></span>
          </div>
        </div>
        <div class="dashboard-log-columns" aria-hidden="true">
          <span>时间</span><span>模块与事件</span><span>运行记录</span>
        </div>
        <div ref="logContainer" class="dashboard-log-scroll" tabindex="0" aria-label="运行日志列表" @scroll="onLogScroll">
          <div v-if="!currentAccountId || !currentStatusReady || !visibleLogs.length" class="dashboard-log-empty">
            <span :class="currentAccountId && !currentStatusReady ? 'i-svg-spinners-90-ring-with-bg' : 'i-carbon-document-blank'" aria-hidden="true" />
            <p>
              {{ !currentAccountId ? '尚未选择账号' : !currentStatusReady ? '正在同步运行记录' : hasActiveLogFilter ? '没有符合条件的日志' : '暂无日志' }}
            </p>
          </div>
          <div
            v-for="log in (currentAccountId && currentStatusReady ? visibleLogs : [])"
            :key="log.id"
            class="dashboard-log-row"
            :data-level="log.level"
            :class="getLogRowClass(log)"
          >
            <span class="dashboard-log-time">{{ formatLogTimeRange(log) }}</span>
            <div class="dashboard-log-meta">
              <span class="dashboard-log-tag" :class="getLogTagClass(log.tag)">{{ log.tag }}</span>
              <span v-if="log.event && log.source !== 'account'" class="dashboard-log-event">{{ getEventLabel(log.event) }}</span>
            </div>
            <p class="dashboard-log-message" :class="getLogMsgClass(log.tag)">
              <span v-if="log.level === 'error' || log.level === 'warn'" class="dashboard-log-severity" :title="log.level === 'error' ? '错误' : '警告'" :aria-label="log.level === 'error' ? '错误' : '警告'"><span :class="log.level === 'error' ? 'i-carbon-error-filled' : 'i-carbon-warning-filled'" aria-hidden="true" /></span>
              {{ log.msg }}
              <span v-if="(log.repeatCount || 1) > 1" class="dashboard-log-repeat" :title="`连续重复 ${log.repeatCount} 次`">×{{ log.repeatCount }}</span>
            </p>
          </div>

          <button
            v-if="pendingLogCount"
            type="button"
            class="dashboard-log-new"
            @click="scrollToBottom"
          >
            <div class="i-carbon-arrow-down" />
            {{ pendingLogCount }} 条新日志
          </button>
        </div>
        <footer class="dashboard-log-footer">
          <span class="dashboard-log-follow" :class="{ 'is-following': autoScroll }"><i />{{ autoScroll ? '跟随最新记录' : '正在查看历史记录' }}</span>
          <button type="button" :disabled="!currentAccountId || !currentStatusReady || !visibleLogs.length" title="跳到最新日志" @click="scrollToBottom">
            <span class="i-carbon-arrow-down" aria-hidden="true" />最新记录
          </button>
        </footer>
      </section>
      <aside v-if="!compactDashboard" class="dashboard-summary" aria-label="巡查与统计">
        <section class="ui-card dashboard-checks">
          <div class="dashboard-panel-heading">
            <h2>自动巡查</h2><span class="dashboard-sync" :class="{ 'is-online': currentStatusReady && !statusStore.error && status?.connection?.connected }"><span class="h-1.5 w-1.5 rounded-full bg-current" />{{ syncLabel }}</span>
          </div>
          <div v-for="check in countdowns" :key="check.key" class="dashboard-check" :class="`dashboard-check--${check.key}`">
            <span class="dashboard-check-icon"><span :class="check.icon" aria-hidden="true" /></span>
            <div class="dashboard-check-info">
              <h3>{{ check.label }}</h3><p>{{ currentStatusReady && !statusStore.error && status?.connection?.connected ? check.description || '下次检查倒计时' : syncLabel }}</p>
            </div>
            <div class="dashboard-check-time">
              {{ currentAccountId && currentStatusReady && !statusStore.error && status?.connection?.connected ? check.time : '—' }}<div class="dashboard-check-progress">
                <span :style="{ width: `${currentStatusReady && !statusStore.error && status?.connection?.connected ? check.progress : 0}%` }" />
              </div>
            </div>
          </div>
        </section>
        <section class="ui-card dashboard-operations">
          <div class="dashboard-panel-heading">
            <h2>今日统计</h2><span>{{ operationGroups.active.length }} 项有记录</span>
          </div>
          <div v-if="!currentAccountId || !currentStatusReady || currentAccountDisconnected || statusStore.error" class="farm-state-panel">
            <span class="i-carbon-chart-column" aria-hidden="true" /><p>{{ !currentAccountId ? '选择账号后查看统计' : statusStore.error ? '状态读取失败，请重新同步' : !currentStatusReady ? '正在同步账号状态' : '账号未连接' }}</p>
          </div>
          <template v-else>
            <div v-if="!operationGroups.active.length" class="farm-state-panel">
              <span class="i-carbon-sprout" aria-hidden="true" /><strong>等待第一份收获</strong><p class="text-xs">
                本轮巡查完成后，主动作统计会在这里更新。
              </p>
            </div>
            <div v-else class="dashboard-operation-grid" tabindex="0" role="region" aria-label="今日动作统计，可滚动查看">
              <div v-for="[key, val] in operationGroups.active" :key="key" class="dashboard-operation">
                <span class="flex items-center gap-1.5"><span :class="[getOpIcon(key), getOpColor(key)]" aria-hidden="true" /><span>{{ getOpName(key) }}</span></span><strong>{{ val }}<small>次</small></strong>
              </div>
            </div>
            <details v-if="operationGroups.inactive.length" class="dashboard-operation-inactive">
              <summary><span>其余 {{ operationGroups.inactive.length }} 项暂无记录</span><span class="i-carbon-chevron-down" aria-hidden="true" /></summary>
              <div>
                <span v-for="[key, val] in operationGroups.inactive" :key="key">{{ getOpName(key) }} <b>{{ val }}</b></span>
              </div>
            </details>
          </template>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.dashboard-page-heading h1 {
  font-size: 23px;
  font-weight: 700;
  letter-spacing: 0;
}
.dashboard-page-heading p {
  margin-top: 5px;
}
.dashboard-hero {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px 24px;
  overflow: hidden;
  min-height: 92px;
  padding: 16px 24px;
  border: 1px solid rgb(255 255 255 / 75%);
  border-radius: 8px;
  background: var(--surface-3);
}
.farm-background-enabled .dashboard-hero {
  background:
    linear-gradient(90deg, #edf7e6f5, #edf7e6df 42%, #edf7e64d),
    var(--farm-scene) center 58% / cover;
}
.dashboard-hero-copy {
  min-width: 0;
}
.dashboard-hero h2 {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.dashboard-hero p {
  margin-top: 4px;
  color: #4e694b;
  font-size: 12px;
}
.dashboard-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(340px, 0.7fr);
  align-items: start;
  gap: 16px;
  min-width: 0;
}
.dashboard-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  align-items: start;
  min-width: 0;
}
.dashboard-checks,
.dashboard-operations {
  padding: 16px 18px;
}
.dashboard-panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.dashboard-panel-heading h2 {
  font-size: 16px;
  font-weight: 650;
}
.dashboard-panel-heading > span {
  color: var(--muted-text);
  font-size: 12px;
}
.dashboard-sync {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 7px;
  border-radius: 4px;
  background: var(--surface-2);
}
.dashboard-sync.is-online {
  color: var(--theme-primary);
  background: #edf5e5;
}
.dashboard-check {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid var(--surface-border);
}
.dashboard-check:last-child {
  padding-bottom: 0;
}
.dashboard-check-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 8px;
  background: #e8f1d9;
  color: #4d803b;
  font-size: 22px;
}
.dashboard-check--help .dashboard-check-icon {
  background: #e7f0f6;
  color: #3c7d9d;
}
.dashboard-check--steal .dashboard-check-icon {
  background: #fbf0d6;
  color: #9a7736;
}
.dashboard-check-info {
  min-width: 0;
  flex: 1;
}
.dashboard-check-info h3 {
  font-size: 13px;
  font-weight: 600;
}
.dashboard-check-info p {
  margin-top: 5px;
  color: var(--muted-text);
  font-size: 12px;
}
.dashboard-check-time {
  max-width: 50%;
  text-align: right;
  font-size: 17px;
  font-weight: 650;
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.dashboard-check-progress {
  margin: 9px 0 0 auto;
  width: 88px;
  height: 3px;
  overflow: hidden;
  border-radius: 10px;
  background: var(--surface-3);
}
.dashboard-check-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #83a962;
}
.dashboard-operation-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  max-height: 360px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.dashboard-operation {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 8px;
  background: #f0f4e7;
}
.dashboard-operation:nth-child(4n + 2) {
  background: #faf2e1;
}
.dashboard-operation:nth-child(4n + 3) {
  background: #edf3f5;
}
.dashboard-operation:nth-child(4n + 4) {
  background: #f4eef6;
}
.dashboard-operation > span {
  min-width: 0;
  font-size: 12px;
  color: var(--muted-text);
  overflow-wrap: anywhere;
}
.dashboard-operation strong {
  flex-shrink: 0;
  max-width: 60%;
  text-align: right;
  overflow-wrap: anywhere;
  font-size: 21px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.dashboard-operation strong small {
  margin-left: 5px;
  font-size: 12px;
  font-weight: 400;
  color: var(--muted-text);
}
.dashboard-operations .farm-state-panel {
  min-height: 120px;
  padding: 16px;
}
.dashboard-logs {
  container-name: runtime-log;
  container-type: inline-size;
  min-width: 0;
  padding: 0;
  border-radius: 8px;
}
.dashboard-log-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  padding: 10px 14px;
}
.dashboard-log-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.dashboard-log-heading > span:first-child {
  color: var(--theme-primary);
  font-size: 19px;
}
.dashboard-log-heading h3 {
  font-size: 15px;
  font-weight: 650;
}
.dashboard-log-sync {
  color: var(--muted-text);
  font-size: 12px;
  margin-left: 3px;
}
.dashboard-log-tools {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.dashboard-log-tools :deep(button) {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 5px;
}
.dashboard-log-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 32px;
  align-items: center;
  gap: 6px;
  padding: 0 14px 10px;
}
.dashboard-log-search {
  grid-column: 1 / -1;
}
.dashboard-log-toolbar > * {
  min-width: 0;
}
.dashboard-log-toolbar :deep(.base-input),
.dashboard-log-toolbar :deep(.base-select-trigger) {
  border-radius: 5px;
  min-height: 36px;
  font-size: 13px;
}
.dashboard-log-toolbar > :deep(button) {
  padding: 0;
  width: 32px;
  height: 32px;
}
.dashboard-log-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  padding: 7px 14px;
  border-top: 1px solid var(--surface-border);
  background: var(--surface-2);
  font-size: 12px;
  color: var(--muted-text);
  font-variant-numeric: tabular-nums;
}
.dashboard-log-summary strong {
  margin-left: 5px;
  color: var(--theme-text);
  font-weight: 600;
}
.dashboard-log-levels {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.dashboard-log-levels > span,
.dashboard-log-follow {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.dashboard-log-levels b {
  font-weight: 500;
}
.dashboard-log-levels i,
.dashboard-log-follow i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #8d9a8a;
}
.dashboard-log-level--warn i {
  background: #c48a27;
}
.dashboard-log-level--error i {
  background: #cc6262;
}
.dashboard-log-columns,
.dashboard-log-row {
  display: grid;
  grid-template-columns: 78px minmax(75px, 100px) minmax(0, 1fr);
  gap: 8px;
}
.dashboard-log-columns {
  padding: 5px 14px 5px 17px;
  border-block: 1px solid var(--surface-border);
  font-size: 12px;
  color: var(--muted-text);
}
.dashboard-log-scroll {
  position: relative;
  max-height: 420px;
  min-height: 160px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  background: var(--surface-1);
}
.dashboard-log-row {
  align-items: baseline;
  padding: 6px 14px;
  border-bottom: 1px solid #eaf0e4;
  border-left: 3px solid transparent;
  font-size: 13px;
}
.dashboard-log-row:nth-child(even) {
  background: #f6f9f24d;
}
.dashboard-log-row:hover {
  background: #f0f6eb;
}
.dashboard-log-row[data-level='warn'] {
  border-left-color: #d4a349;
  background: #fff9ea;
}
.dashboard-log-row[data-level='error'] {
  border-left-color: #d67878;
  background: #fff2ef;
}
.dashboard-log-time {
  color: var(--muted-text);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  line-height: 1.8;
}
.dashboard-log-meta {
  min-width: 0;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 5px;
}
.dashboard-log-tag {
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 12px;
  line-height: 1.5;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.dashboard-log-event {
  color: var(--muted-text);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.dashboard-log-message {
  min-width: 0;
  margin: 0;
  line-height: 1.65;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.dashboard-log-severity {
  display: inline-flex;
  vertical-align: -2px;
  color: #b68027;
  margin-right: 2px;
}
.dashboard-log-row[data-level='error'] .dashboard-log-severity {
  color: #c45d58;
}
.dashboard-log-repeat {
  display: inline-block;
  margin-left: 6px;
  padding: 0 5px;
  border: 1px solid var(--surface-border);
  border-radius: 3px;
  color: var(--muted-text);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.dashboard-log-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 160px;
  color: var(--muted-text);
  font-size: 12px;
}
.dashboard-log-empty > span {
  font-size: 30px;
  opacity: 0.5;
}
.dashboard-log-new {
  position: sticky;
  bottom: 12px;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  width: max-content;
  max-width: calc(100% - 24px);
  margin: 8px auto;
  padding: 8px 14px;
  border-radius: 6px;
  background: var(--theme-primary);
  color: white;
  font-size: 12px;
  box-shadow: 0 3px 10px rgb(35 85 46 / 18%);
}
.dashboard-log-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 14px;
  border-top: 1px solid var(--surface-border);
  color: var(--muted-text);
  font-size: 12px;
}
.dashboard-log-follow.is-following i {
  background: var(--theme-primary);
}
.dashboard-log-footer button {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  color: var(--theme-primary);
}
.dashboard-log-footer button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dashboard-logs button:focus-visible,
.dashboard-log-scroll:focus-visible {
  outline: 2px solid var(--theme-primary);
  outline-offset: -2px;
}
.dashboard-monitor-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13px;
}
.dashboard-page--compact {
  height: 100%;
  min-height: 520px;
}
.dashboard-page--compact .dashboard-workspace {
  flex: 1;
  display: flex;
  min-height: 0;
}
.dashboard-page--compact .dashboard-logs {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.dashboard-page--compact .dashboard-log-scroll {
  flex: 1;
  height: auto;
  min-height: 180px;
  max-height: none;
}
.dashboard-operation-inactive {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--surface-border);
  color: var(--muted-text);
  font-size: 12px;
}
.dashboard-operation-inactive summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 32px;
  cursor: pointer;
  list-style: none;
}
.dashboard-operation-inactive summary::-webkit-details-marker {
  display: none;
}
.dashboard-operation-inactive[open] summary > span:last-child {
  transform: rotate(180deg);
}
.dashboard-operation-inactive > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  padding-top: 8px;
}
.dashboard-operation-inactive b {
  margin-left: 4px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
@container runtime-log (min-width: 640px) {
  .dashboard-log-toolbar {
    grid-template-columns: minmax(160px, 1fr) 120px 140px 32px;
  }
  .dashboard-log-search {
    grid-column: auto;
  }
}
@media (max-width: 1199px) {
  .dashboard-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .dashboard-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 639px) {
  .dashboard-page {
    gap: 12px;
  }
  .dashboard-page-heading h1 {
    font-size: 21px;
  }
  .dashboard-page-heading p {
    font-size: 12px;
  }
  .dashboard-hero {
    min-height: 88px;
    padding: 14px;
    gap: 10px;
  }
  .dashboard-hero h2 {
    font-size: 16px;
  }
  .dashboard-hero p {
    font-size: 12px;
    line-height: 1.6;
  }
  .dashboard-hero :deep(.base-button) {
    padding-inline: 10px;
  }
  .dashboard-summary {
    grid-template-columns: minmax(0, 1fr);
  }
  .dashboard-checks,
  .dashboard-operations {
    padding: 17px;
  }
  .dashboard-check-time {
    font-size: 17px;
  }
  .dashboard-log-scroll {
    height: 430px;
    max-height: 430px;
  }
  .dashboard-log-header {
    padding: 12px;
  }
  .dashboard-log-toolbar {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 32px;
    padding: 0 12px 12px;
  }
  .dashboard-log-search {
    grid-column: 1 / -1;
  }
  .dashboard-log-summary {
    padding: 9px 12px;
  }
  .dashboard-log-columns {
    display: none;
  }
  .dashboard-log-row {
    grid-template-columns: 94px minmax(0, 1fr);
    gap: 6px 10px;
    padding: 12px;
  }
  .dashboard-log-message {
    grid-column: 1 / -1;
  }
  .dashboard-log-footer {
    padding: 8px 12px;
  }
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  .farm-background-enabled .dashboard-hero {
    background:
      linear-gradient(90deg, #edf7e6fa, #edf7e6e6),
      url('/backgrounds/farm-day.webp') center / cover;
  }
}
</style>
