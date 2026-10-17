<script setup lang="ts">
import type { TeaCandidate, TeaHireRecords, TeaItem, TeaState } from '@/utils/milk-tea'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import api from '@/api'
import { isWithinActivityWindowMs, MILK_TEA_ACTIVITY_WINDOW, MILK_TEA_AUTOMATION_OPTIONS } from '@/constants/activity-windows'
import { useAccountStore } from '@/stores/account'
import { teaActionReason, teaBalance, teaCandidateAvailable, teaCurrencyImage, teaDate, teaGoodsReason, teaHireReason, teaImage, teaInteger, teaNameValid, teaNumber, teaOpenSlots, teaPhase, teaPlainText, teaPurchaseMax, teaQuickEntries, teaRecentLogs } from '@/utils/milk-tea'
import MilkTeaAutomationStatus from './MilkTeaAutomationStatus.vue'
import MilkTeaCraftDialog from './MilkTeaCraftDialog.vue'
import MilkTeaDialog from './MilkTeaDialog.vue'
import MilkTeaExchangePanel from './MilkTeaExchangePanel.vue'
import MilkTeaRewardIcon from './MilkTeaRewardIcon.vue'
import MilkTeaRewardsPanel from './MilkTeaRewardsPanel.vue'
import MilkTeaShopDialogs from './MilkTeaShopDialogs.vue'
import MilkTeaShopPanel from './MilkTeaShopPanel.vue'
import MilkTeaWorkPanel from './MilkTeaWorkPanel.vue'
import '@/styles/milk-tea-workbench.css'

const emit = defineEmits<{ back: [] }>()
const accounts = useAccountStore()
const state = ref<TeaState | null>(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const modal = ref('')
const purchaseCount = ref(1)
const records = ref<any>(null)
const shopName = ref('')
const craftInitialUids = ref<string[]>([])
const hireDuration = ref(1)
const hireSlot = ref(0)
const automation = ref<Record<string, boolean> | null>(null)
const logs = ref<any[]>([])
const contextLoading = ref(false)
const contextError = ref('')
const now = ref(Date.now())
const lastUpdated = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
let generation = 0
let recordsRevision = 0
const nowSec = computed(() => state.value && lastUpdated.value
  ? Number(state.value.serverTime) + Math.max(0, now.value - lastUpdated.value) / 1000
  : now.value / 1000)
const phase = computed(() => state.value ? teaPhase(state.value, nowSec.value) : null)
const inWindow = computed(() => isWithinActivityWindowMs(MILK_TEA_ACTIVITY_WINDOW, now.value))
const active = computed(() => inWindow.value && (!state.value || ['business', 'settling'].includes(phase.value || '')))
const blocked = computed(() => loading.value || busy.value || !accounts.currentAccountId || !active.value)
const selectedGoods = computed(() => state.value?.goods?.find(good => `goods:${good.id}` === modal.value))
const purchaseMax = computed(() => selectedGoods.value && state.value && !teaGoodsReason(selectedGoods.value, teaPhase(state.value, nowSec.value)) ? teaPurchaseMax(selectedGoods.value) : 0)
const validPurchase = computed(() => Number.isSafeInteger(purchaseCount.value) && purchaseCount.value >= 1 && purchaseCount.value <= purchaseMax.value)
const selectedRecipe = computed(() => state.value?.recipes?.find(recipe => `recipe:${recipe.recipe_id}` === modal.value))
const selectedInteraction = computed(() => state.value?.interactions?.find(interaction => `interact:${interaction.interaction_id}` === modal.value))
const hireRecords = computed(() => records.value as TeaHireRecords | null)
const hireCandidates = computed(() => [...(hireRecords.value?.friends || []), ...(hireRecords.value?.robots || [])])
const availableSlots = computed(() => state.value ? teaOpenSlots(state.value, nowSec.value) : [])
const selectedDuration = computed(() => state.value?.durations?.find(duration => Number(duration.duration_id) === Number(hireDuration.value)))
const hireReason = computed(() => state.value ? teaHireReason(state.value, selectedDuration.value, nowSec.value) : '暂无活动数据')
const quickEntries = computed(() => state.value ? teaQuickEntries(state.value, nowSec.value) : [])
const automationOptions = computed(() => MILK_TEA_AUTOMATION_OPTIONS.filter(option => !option.businessOnly || phase.value === 'business'))
const automationEnabled = computed(() => automationOptions.value.filter(option => automation.value?.[option.key]).length)
const remaining = computed(() => {
  const seconds = Math.max(0, Number(state.value?.endTime || MILK_TEA_ACTIVITY_WINDOW.endMs / 1000) - nowSec.value)
  return `${Math.floor(seconds / 86400)} 天 ${Math.floor(seconds % 86400 / 3600)} 小时`
})
const modalTitle = computed(() => {
  if (selectedGoods.value)
    return '兑换商品'
  if (selectedRecipe.value)
    return selectedRecipe.value.recipe_name
  if (selectedInteraction.value)
    return selectedInteraction.value.name
  return ({ create: '开店营业', rename: '修改店名', hireList: '管理员工', boost: '使用宣传喇叭', rules: '活动时间与规则', invite: '原生分享', work: '我的工作', rewards: '活动奖励', fund: '成长基金', exchange: '兑换商店', recipes: '全部配方', automation: '自动化状态' } as Record<string, string>)[modal.value] || '活动详情'
})
watch(modal, (kind) => {
  purchaseCount.value = 1
  if (kind === 'create' || kind === 'rename')
    shopName.value = state.value?.summary.shop_name || '奶茶冲鸭'
})
watch(purchaseMax, (maximum) => {
  if (purchaseCount.value > maximum)
    purchaseCount.value = Math.max(1, maximum)
})
watch(availableSlots, (slots) => {
  if (!slots.includes(Number(hireSlot.value)))
    hireSlot.value = slots[0] ?? 0
})
function clampPurchase() {
  purchaseCount.value = Math.min(Math.max(1, purchaseMax.value), Math.max(1, Math.floor(Number(purchaseCount.value) || 1)))
}
function totalCost(cost: TeaItem) {
  return (teaInteger(cost.count) * BigInt(validPurchase.value ? purchaseCount.value : 0)).toString()
}
function close() {
  if (!busy.value) {
    modal.value = ''
    recordsRevision++
  }
}
function acceptActivity(activity: any) {
  if (!activity || !activity.summary || !Number.isFinite(Number(activity.serverTime))
    || ![activity.startTime, activity.settleTime, activity.endTime].every((value: unknown) => Number.isFinite(value) && Number(value) > 0)
    || activity.startTime > activity.settleTime || activity.settleTime > activity.endTime) {
    throw new Error('活动协议数据不完整，请刷新后重试')
  }
  if (['business', 'settling'].includes(teaPhase(activity, Number(activity.serverTime)))
    && (!Array.isArray(activity.recipes) || !Array.isArray(activity.goods) || !Array.isArray(activity.balances) || !activity.work
      || (teaInteger(activity.summary.shop_open_at) > 0n && !activity.shop))) {
    throw new Error('活动内容读取不完整，请刷新后重试')
  }
  state.value = activity
  lastUpdated.value = Date.now()
  now.value = lastUpdated.value
}
async function refreshContext() {
  if (document.hidden || contextLoading.value || !accounts.currentAccountId || !isWithinActivityWindowMs(MILK_TEA_ACTIVITY_WINDOW) || (state.value && !active.value))
    return
  const token = generation
  const accountId = accounts.currentAccountId
  contextLoading.value = true
  const result = await Promise.allSettled([
    api.get('/api/settings', { headers: { 'x-account-id': accountId } }),
    api.get('/api/logs', { headers: { 'x-account-id': accountId }, params: { module: 'activity', keyword: '奶茶热销中', limit: 6 } }),
  ])
  if (token !== generation)
    return
  const failures: string[] = []
  const [settingsResult, logsResult] = result
  if (settingsResult?.status === 'fulfilled' && settingsResult.value.data.ok && settingsResult.value.data.data?.automation)
    automation.value = settingsResult.value.data.data.automation
  else
    failures.push('自动化状态读取失败')
  if (logsResult?.status === 'fulfilled' && logsResult.value.data.ok && Array.isArray(logsResult.value.data.data))
    logs.value = teaRecentLogs(logsResult.value.data.data, String(accountId))
  else
    failures.push('执行记录读取失败')
  contextError.value = failures.join('；')
  contextLoading.value = false
}
async function refresh() {
  if (document.hidden || loading.value || busy.value || !accounts.currentAccountId || !isWithinActivityWindowMs(MILK_TEA_ACTIVITY_WINDOW))
    return
  const token = generation
  const accountId = accounts.currentAccountId
  loading.value = true
  try {
    const { data } = await api.get('/api/activity/milk-tea', { headers: { 'x-account-id': accountId }, timeout: 100000 })
    if (token !== generation)
      return
    if (!data.ok || !data.activity)
      throw new Error(data.error || '活动数据读取失败')
    acceptActivity(data.activity)
    error.value = ''
    void refreshContext()
  }
  catch (e: any) {
    if (token === generation)
      error.value = e.response?.data?.error || e.message
  }
  finally {
    if (token === generation)
      loading.value = false
  }
}
async function act(action: string, params: Record<string, any> = {}) {
  if (busy.value || loading.value || !accounts.currentAccountId || !isWithinActivityWindowMs(MILK_TEA_ACTIVITY_WINDOW))
    return
  now.value = Date.now()
  const reason = teaActionReason(state.value, action, params, nowSec.value)
  if (reason) {
    error.value = reason
    return
  }
  const token = generation
  const accountId = accounts.currentAccountId
  busy.value = true
  error.value = ''
  try {
    const { data } = await api.post('/api/activity/milk-tea/operate', { accountId, action, params }, { headers: { 'x-account-id': accountId }, timeout: 190000 })
    if (token !== generation)
      return
    if (!data.ok)
      throw new Error(data.error || '操作失败')
    acceptActivity(data.activity)
    if (action !== 'upgrade')
      modal.value = ''
    records.value = null
  }
  catch (e: any) {
    if (token === generation) {
      const message = e.response?.data?.error || e.message
      error.value = action === 'buy' && (e.code === 'ECONNABORTED' || /timeout/i.test(message || ''))
        ? '兑换结果暂未确认，请等待数据刷新后核对库存和限购，勿重复提交'
        : message
    }
  }
  finally {
    if (token === generation) {
      busy.value = false
      void refreshContext()
    }
  }
}
async function loadRecords(kind: string, params: Record<string, unknown> = {}) {
  if (busy.value || loading.value || !accounts.currentAccountId || !isWithinActivityWindowMs(MILK_TEA_ACTIVITY_WINDOW) || !active.value)
    return
  const token = generation
  const revision = ++recordsRevision
  const accountId = accounts.currentAccountId
  busy.value = true
  error.value = ''
  try {
    const { data } = await api.post('/api/activity/milk-tea/records', { accountId, kind, params }, { headers: { 'x-account-id': accountId }, timeout: 100000 })
    if (token !== generation || revision !== recordsRevision || modal.value !== kind)
      return
    if (!data.ok)
      throw new Error(data.error || '记录读取失败')
    records.value = data
  }
  catch (e: any) {
    if (token === generation && revision === recordsRevision)
      error.value = e.response?.data?.error || e.message
  }
  finally {
    if (token === generation && revision === recordsRevision)
      busy.value = false
  }
}
async function open(kind: string) {
  if (busy.value || loading.value || !accounts.currentAccountId || !isWithinActivityWindowMs(MILK_TEA_ACTIVITY_WINDOW) || !active.value)
    return
  modal.value = kind
  error.value = ''
  records.value = null
  if (kind === 'hireList') {
    hireDuration.value = Number(state.value?.durations?.[0]?.duration_id || 1)
    hireSlot.value = availableSlots.value[0] ?? 0
  }
  if (['sales', 'rank', 'hireList'].includes(kind))
    await loadRecords(kind, kind === 'hireList' ? { durationId: hireDuration.value } : {})
}
function craft(uids: string[]) {
  craftInitialUids.value = [...uids]
  void open('craft')
}
function hire(worker: TeaCandidate) {
  if (!state.value || !hireRecords.value || hireReason.value || !teaCandidateAvailable(worker, nowSec.value)
    || Number(hireRecords.value.duration_id) !== Number(hireDuration.value)
    || teaInteger(hireRecords.value.wage_total) <= 0n || teaInteger(teaBalance(state.value, '1041')) < teaInteger(hireRecords.value.wage_total)) {
    return
  }
  void act('hire', { targetGid: String(worker.friend.gid), durationId: Number(hireDuration.value), slotIndex: Number(hireSlot.value) })
}
function visible() {
  now.value = Date.now()
  if (!document.hidden)
    void refresh()
}
watch(() => accounts.currentAccountId, () => {
  generation++
  recordsRevision++
  state.value = null
  loading.value = false
  busy.value = false
  modal.value = ''
  error.value = ''
  records.value = null
  automation.value = null
  logs.value = []
  contextLoading.value = false
  contextError.value = ''
  lastUpdated.value = 0
  craftInitialUids.value = []
  void refresh()
})
onMounted(() => {
  void refresh()
  document.addEventListener('visibilitychange', visible)
  timer = setInterval(() => {
    now.value = Date.now()
    if (!isWithinActivityWindowMs(MILK_TEA_ACTIVITY_WINDOW) || (state.value && ['ended', 'upcoming'].includes(teaPhase(state.value, nowSec.value)))) {
      generation++
      recordsRevision++
      clearInterval(timer)
      modal.value = ''
      emit('back')
      return
    }
    if (!document.hidden)
      void refresh()
  }, 15000)
})
onUnmounted(() => {
  generation++
  recordsRevision++
  clearInterval(timer)
  document.removeEventListener('visibilitychange', visible)
})
</script>

<template>
  <section class="milk-workbench" aria-label="奶茶活动工作台" :aria-busy="busy || loading">
    <header class="tea-workbench-heading">
      <img :src="teaImage('icon_s4_milktea_1')" alt="">
      <div>
        <div class="tea-title-line">
          <h2>{{ state?.title || '奶茶热销中' }}</h2><span class="tea-badge"><span v-if="active" class="tea-dot" />{{ !inWindow ? now < MILK_TEA_ACTIVITY_WINDOW.startMs ? '未开始' : '已结束' : phase === 'settling' ? '结算期' : phase === 'ended' ? '已结束' : phase === 'upcoming' ? '未开始' : '进行中' }}</span>
        </div>
        <p class="tea-window">
          <time>{{ teaDate(state?.startTime || MILK_TEA_ACTIVITY_WINDOW.startMs / 1000) }}</time><span>—</span><time>{{ teaDate(state?.endTime || MILK_TEA_ACTIVITY_WINDOW.endMs / 1000) }}</time><span>UTC+8</span>
        </p>
      </div>
      <div class="tea-header-tools">
        <span>剩余 {{ remaining }}</span>
        <button type="button" class="tea-icon-button" aria-label="活动时间与规则" title="活动时间与规则" :disabled="blocked || !state" @click="open('rules')">
          <span class="i-carbon-information" aria-hidden="true" />
        </button>
        <button type="button" class="tea-icon-button" aria-label="刷新活动" title="刷新活动" :disabled="blocked" :aria-busy="loading" @click="refresh">
          <span :class="loading ? 'i-svg-spinners-180-ring' : 'i-carbon-renew'" aria-hidden="true" />
        </button>
        <span v-if="busy" class="tea-operation-status" role="status">正在执行操作…</span>
      </div>
    </header>
    <div v-if="!accounts.currentAccountId" class="tea-state">
      <span class="i-carbon-user" aria-hidden="true" /><h3>请先选择账号</h3>
    </div>
    <div v-else-if="!active" class="tea-state">
      <span class="i-carbon-locked" aria-hidden="true" /><h3>{{ now < MILK_TEA_ACTIVITY_WINDOW.startMs || phase === 'upcoming' ? '活动尚未开始' : '活动已结束' }}</h3><button type="button" class="tea-button" @click="emit('back')">
        全部活动
      </button>
    </div>
    <div v-else-if="!state" class="tea-state" :aria-busy="loading">
      <span v-if="loading" class="i-svg-spinners-180-ring" aria-hidden="true" />
      <span v-else-if="error" class="i-carbon-warning-alt" aria-hidden="true" />
      <span v-else class="i-carbon-catalog" aria-hidden="true" />
      <h3>{{ loading ? '正在加载活动数据…' : error ? '活动数据读取失败' : '暂无活动数据' }}</h3>
      <p v-if="error" role="alert">
        {{ error }}
      </p>
      <button v-if="!loading" type="button" class="tea-button" @click="refresh">
        <span class="i-carbon-renew" aria-hidden="true" />重新读取
      </button>
    </div>
    <template v-else>
      <div class="tea-workspace-layout">
        <aside class="tea-workspace-nav" aria-label="奶茶活动导航">
          <button type="button" class="tea-link tea-workspace-back" @click="emit('back')">
            <span class="i-carbon-arrow-left" aria-hidden="true" />活动中心
          </button>
          <img class="tea-workspace-logo" :src="teaImage('img_s4Main_logo')" alt="奶茶热销中">
          <div class="tea-workspace-current">
            <span class="i-carbon-store" aria-hidden="true" />我的小店
          </div>
          <nav class="tea-quick-entries" aria-label="活动快捷入口">
            <button v-for="entry in quickEntries" :key="entry.key" type="button" class="tea-quick-entry" :class="{ 'tea-quick-entry--attention': entry.attention }" :disabled="blocked" @click="open(entry.key)">
              <span :class="entry.icon" aria-hidden="true" /><span><b>{{ entry.name }}</b><small>{{ entry.text }}</small><progress v-if="entry.progress !== null" :value="entry.progress" max="100" :aria-label="`${entry.name}进度`" /></span><span class="i-carbon-chevron-right" aria-hidden="true" />
            </button>
          </nav>
          <button type="button" class="tea-link tea-workspace-auto" :disabled="blocked" @click="open('automation')">
            <span class="i-carbon-settings-adjust" aria-hidden="true" />自动化状态
          </button>
        </aside>
        <div class="tea-workspace-main">
          <p v-if="error" class="tea-error" role="alert">
            {{ error }}
          </p>
          <div class="tea-shop-surface">
            <MilkTeaShopPanel v-if="state.shop" :state="state" :now="nowSec" :blocked="blocked" :automation="automation" :logs="logs" :context-loading="contextLoading" :context-error="contextError" @action="act" @open="open" @craft="craft" />
            <div v-else class="tea-state">
              <img :src="teaImage('img_s4TeaUpLv_house')" alt="" style="width: 104px; height: 78px"><h3>奶茶小铺尚未开业</h3>
              <button type="button" class="tea-button tea-button--primary" :disabled="blocked || phase !== 'business'" @click="open('create')">
                <span class="i-carbon-store" aria-hidden="true" />开店营业
              </button>
            </div>
          </div>
          <footer class="tea-footer">
            <span><span class="tea-dot" />{{ loading ? '正在同步…' : `数据更新于 ${teaDate(lastUpdated / 1000)}` }}</span><span>进入结算：{{ teaDate(state.settleTime) }} · UTC+8</span>
          </footer>
        </div>
      </div>
    </template>

    <template v-if="state && active">
      <MilkTeaCraftDialog v-if="modal === 'craft'" :state="state" :now="nowSec" :busy="busy" :loading="loading" :error="error" :initial-uids="craftInitialUids" @close="close" @craft="act('craft', $event)" />
      <MilkTeaShopDialogs v-else-if="['upgrade', 'levels', 'sales', 'rank'].includes(modal)" :kind="modal" :state="state" :now="nowSec" :records="records" :busy="busy || loading" :error="error" @close="close" @action="act" @records="loadRecords" />
      <MilkTeaDialog v-else-if="modal" :title="modalTitle" :busy="busy" :wide="['rewards', 'fund', 'exchange', 'recipes'].includes(modal)" @close="close">
        <p v-if="error" class="tea-error" role="alert">
          {{ error }}
        </p>
        <MilkTeaWorkPanel v-if="modal === 'work'" :state="state" :now="nowSec" :blocked="blocked" @action="act" @open="open" />
        <MilkTeaExchangePanel v-else-if="modal === 'exchange'" :state="state" :now="nowSec" :blocked="blocked" @open="open" />
        <MilkTeaRewardsPanel v-else-if="modal === 'rewards' || modal === 'fund'" :state="state" :blocked="blocked" :section="modal" @action="act" @native="open('invite')" />
        <template v-else-if="modal === 'automation'">
          <p v-if="contextError" class="tea-error" role="alert">
            {{ contextError }}
          </p>
          <div class="tea-automation-summary">
            <b>{{ automation ? `${automationEnabled} 项开启 · ${automationOptions.length - automationEnabled} 项关闭` : contextLoading ? '读取中' : '尚未读取' }}</b><small>状态只读</small>
          </div>
          <div v-for="option in automationOptions" :key="option.key" class="tea-automation-row">
            <span>{{ option.label }}</span><MilkTeaAutomationStatus :enabled="automation ? automation[option.key] === true : null" />
          </div>
          <RouterLink class="tea-button" to="/settings?tab=account-config" @click="close">
            账号设置<span class="i-carbon-arrow-right" aria-hidden="true" />
          </RouterLink>
        </template>
        <template v-else-if="modal === 'recipes'">
          <article v-for="recipe in state.recipes" :key="String(recipe.recipe_id)" class="tea-recipe-detail-row">
            <img :src="recipe.config?.image || teaImage('img_s4TeaUI_tea')" alt=""><div>
              <b>{{ recipe.recipe_name }}</b><p class="tea-muted">
                {{ recipe.unlocked ? '已解锁' : '未解锁' }} · {{ teaNumber(recipe.token_price) }} 奶茶券 / 杯
              </p>
            </div><button type="button" class="tea-button" :disabled="blocked" @click="open(`recipe:${recipe.recipe_id}`)">
              配方详情
            </button>
          </article>
        </template>
        <template v-else-if="modal === 'create' || modal === 'rename'">
          <label class="tea-label">店名<input v-model="shopName" class="tea-input tea-name-input" maxlength="8" :disabled="blocked" aria-label="店名"></label>
          <p class="tea-muted">
            2–8 个字符
          </p>
          <p v-if="modal === 'rename' && Number(state.summary.rename_cd_until_at) > nowSec" class="tea-rule-note">
            下次可修改时间：{{ teaDate(state.summary.rename_cd_until_at) }}
          </p>
          <div v-if="modal === 'create' && state.summary.opening_gift_preview?.length" class="tea-rewards">
            <MilkTeaRewardIcon v-for="item in state.summary.opening_gift_preview" :key="String(item.id)" :item="item" named />
          </div>
        </template>
        <template v-else-if="selectedGoods">
          <div class="tea-product">
            <img v-if="selectedGoods.items[0]?.image" :src="selectedGoods.items[0].image" :alt="selectedGoods.name"><div>
              <b>{{ selectedGoods.name }}</b><p class="tea-muted">
                {{ selectedGoods.desc }}
              </p>
            </div>
          </div>
          <h3 class="tea-subheading">
            兑换内容
          </h3><div class="tea-rewards">
            <MilkTeaRewardIcon v-for="item in selectedGoods.items" :key="String(item.id)" :item="item" named />
          </div>
          <div class="tea-purchase-quantity">
            <span>兑换数量</span><div class="tea-stepper">
              <button type="button" aria-label="减少兑换数量" :disabled="blocked || purchaseCount <= 1 || !purchaseMax" @click="purchaseCount = Math.max(1, purchaseCount - 1)">
                <span class="i-carbon-subtract" aria-hidden="true" />
              </button>
              <input v-model.number="purchaseCount" type="number" min="1" :max="Math.max(1, purchaseMax)" step="1" aria-label="兑换数量" :disabled="blocked || !purchaseMax" @change="clampPurchase">
              <button type="button" aria-label="增加兑换数量" :disabled="blocked || purchaseCount >= purchaseMax || !purchaseMax" @click="purchaseCount = Math.min(purchaseMax, purchaseCount + 1)">
                <span class="i-carbon-add" aria-hidden="true" />
              </button>
            </div><button type="button" class="tea-link" :disabled="blocked || !purchaseMax" @click="purchaseCount = purchaseMax">
              最大
            </button>
          </div>
          <input v-model.number="purchaseCount" class="tea-purchase-range" type="range" min="1" :max="Math.max(1, purchaseMax)" aria-label="滑动选择兑换数量" :disabled="blocked || purchaseMax <= 1">
          <p class="tea-muted">
            剩余限购 {{ teaNumber(selectedGoods.remaining) }} · 当前最多可兑换 {{ teaNumber(purchaseMax) }}
          </p>
          <div class="tea-purchase-costs">
            <span>合计消耗</span><span v-for="cost in selectedGoods.costs" :key="String(cost.id)" class="tea-price"><img v-if="teaCurrencyImage(cost)" :src="teaCurrencyImage(cost)" :alt="cost.name"><span v-else>{{ cost.name }}</span><b class="tea-number">{{ teaNumber(totalCost(cost)) }}</b></span>
          </div>
        </template>
        <template v-else-if="modal === 'hireList'">
          <div class="tea-hire-options">
            <fieldset class="tea-hire-durations">
              <legend>雇佣时长</legend><label v-for="duration in state.durations" :key="duration.duration_id" class="tea-hire-duration"><input v-model.number="hireDuration" type="radio" name="tea-hire-duration" :value="duration.duration_id" :disabled="blocked" @change="loadRecords('hireList', { durationId: hireDuration })"><span><b>{{ duration.duration_sec / 3600 }} 小时</b><small v-for="cost in duration.duration_cost.split(';').filter(Boolean)" :key="cost">{{ teaNumber(cost.split(':')[1]) }} {{ cost.split(':')[0] === '1041' ? '奶茶券' : `物品 ${cost.split(':')[0]}` }} / 人</small></span></label>
            </fieldset>
            <label class="tea-label">员工位<select v-model.number="hireSlot" class="tea-select" :disabled="blocked || !availableSlots.length"><option v-if="!availableSlots.length" :value="0">暂无空闲位置</option><option v-for="slot in availableSlots" :key="slot" :value="slot">员工位 {{ slot + 1 }}</option></select></label>
          </div>
          <p v-if="hireReason" class="tea-rule-note">
            {{ hireReason }}
          </p>
          <p v-if="busy" class="tea-inline-state">
            正在读取员工列表…
          </p>
          <template v-else-if="hireRecords">
            <p class="tea-muted">
              本次工资 {{ teaNumber(hireRecords.wage_total) }} 奶茶券 · 当前余额 {{ teaNumber(teaBalance(state, '1041')) }}
            </p>
            <p v-if="!hireCandidates.length" class="tea-inline-state">
              暂无可雇佣员工
            </p>
            <article v-for="worker in hireCandidates" :key="String(worker.friend.gid)" class="tea-hire-candidate">
              <span class="tea-avatar"><img v-if="worker.is_robot" :src="teaImage('hamster-idle')" alt=""><span v-else class="i-carbon-user" aria-hidden="true" /></span>
              <div><b>{{ worker.friend.name }}</b><p>{{ worker.talent_name }} · {{ worker.is_robot ? '实习员工' : '好友' }}</p></div>
              <button type="button" class="tea-button" :disabled="blocked || !!hireReason || !teaCandidateAvailable(worker, nowSec) || teaInteger(hireRecords.wage_total) <= 0n || teaInteger(teaBalance(state, '1041')) < teaInteger(hireRecords.wage_total) || Number(hireRecords.duration_id) !== Number(hireDuration)" @click="hire(worker)">
                {{ !teaCandidateAvailable(worker, nowSec) ? '暂不可雇佣' : '确认雇佣' }}
              </button>
            </article>
          </template>
        </template>
        <template v-else-if="modal === 'boost' && state.shop">
          <div class="tea-product">
            <img :src="teaImage('icon_s4_boost')" alt=""><div>
              <b>宣传喇叭 ×1</b><p class="tea-muted">
                现有 {{ teaNumber(teaBalance(state, state.shop.sales_item_id)) }} 个
              </p>
            </div>
          </div>
          <p class="tea-next-unlock">
            预计售出 {{ teaNumber(state.shop.boost_cups_per_use) }} 杯
          </p>
          <div class="tea-rewards">
            <MilkTeaRewardIcon v-for="item in state.shop.boost_preview_rewards || []" :key="String(item.id)" :item="item" named />
          </div>
          <p class="tea-rule-note">
            仅消耗已有宣传喇叭，不自动补购，不消耗钻石。
          </p>
        </template>
        <template v-else-if="selectedInteraction">
          <p>{{ teaPlainText(selectedInteraction.des).replace(/\{\d+\}/g, '对应数量') }}</p>
          <p class="tea-rule-note">
            本班剩余互动 {{ Math.max(0, Number(state.work.my_shift?.interact_limit || 0) - Number(state.work.my_shift?.interact_count || 0)) }} 次。执行结果以服务端结算为准。
          </p>
        </template>
        <template v-else-if="selectedRecipe">
          <div class="tea-material-summary">
            <img :src="selectedRecipe.config?.image || teaImage('img_s4TeaUI_tea')" :alt="selectedRecipe.recipe_name"><div><h3>{{ selectedRecipe.recipe_name }}</h3><p>{{ selectedRecipe.unlocked ? '已解锁' : '未解锁' }}</p></div>
          </div>
          <p>{{ teaPlainText(selectedRecipe.config?.drink_desc) }}</p>
          <div class="tea-purchase-costs">
            <span>每杯售出价格</span><span class="tea-price"><img :src="teaImage('icon_s4_ticket')" alt="奶茶券">{{ teaNumber(selectedRecipe.token_price) }}</span><span class="tea-price"><img src="/game-config/resource-icons/gold.png" alt="金币">{{ teaNumber(selectedRecipe.coin_price) }}</span>
          </div>
          <p v-if="!selectedRecipe.unlocked" class="tea-rule-note">
            {{ state.levels?.find(level => level.recipe_names?.includes(selectedRecipe!.recipe_name))?.level ? `店铺 ${state.levels.find(level => level.recipe_names?.includes(selectedRecipe!.recipe_name))?.level} 级解锁` : '暂未解锁' }}
          </p>
        </template>
        <template v-else-if="modal === 'rules'">
          <dl>
            <div class="tea-effect">
              <dt>活动开始</dt><dd>{{ teaDate(state.startTime) }}</dd>
            </div><div class="tea-effect">
              <dt>进入结算</dt><dd>{{ teaDate(state.settleTime) }}</dd>
            </div><div class="tea-effect">
              <dt>活动结束</dt><dd>{{ teaDate(state.endTime) }}</dd>
            </div><div class="tea-effect">
              <dt>时区</dt><dd>UTC+8 / Asia/Shanghai</dd>
            </div>
          </dl>
          <p v-if="state.rules" class="tea-rule-note">
            {{ teaPlainText(state.rules) }}
          </p>
          <img :src="teaImage('img_S4_rule1')" alt="活动规则" style="display: block; width: 100%; margin-top: 18px">
        </template>
        <p v-else class="tea-rule-note">
          此功能需要 QQ 原生分享，网页不会直接发送邀请或分享。
        </p>
        <template #footer>
          <button type="button" class="tea-button" :disabled="busy" @click="close">
            关闭
          </button>
          <button v-if="modal === 'create' || modal === 'rename'" type="button" class="tea-button tea-button--primary" :disabled="blocked || !teaNameValid(shopName) || (modal === 'rename' && Number(state.summary.rename_cd_until_at) > nowSec)" @click="act(modal, { shopName: shopName.trim() })">
            {{ modal === 'create' ? '确认开店' : '保存店名' }}
          </button>
          <button v-else-if="selectedGoods" type="button" class="tea-button tea-button--primary" :disabled="blocked || !validPurchase || !!teaGoodsReason(selectedGoods, phase!)" @click="act('buy', { goodsId: selectedGoods.id, count: purchaseCount })">
            {{ selectedGoods.paid ? '不支持钻石购买' : '确认兑换' }}
          </button>
          <button v-else-if="modal === 'boost'" type="button" class="tea-button tea-button--primary" :disabled="blocked || !!teaActionReason(state, 'boost', {}, nowSec)" @click="act('boost')">
            使用 1 个
          </button>
          <button v-else-if="selectedInteraction" type="button" class="tea-button tea-button--primary" :disabled="blocked || !!teaActionReason(state, 'interact', { interactionType: selectedInteraction.interaction_id }, nowSec)" @click="act('interact', { interactionType: selectedInteraction.interaction_id })">
            确认互动
          </button>
          <button v-else-if="selectedRecipe?.unlocked && selectedRecipe.is_advanced" type="button" class="tea-button tea-button--primary" :disabled="blocked || phase !== 'business'" @click="craft([])">
            选材制作
          </button>
        </template>
      </MilkTeaDialog>
    </template>
  </section>
</template>
