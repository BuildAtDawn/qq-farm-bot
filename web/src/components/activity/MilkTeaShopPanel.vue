<script setup lang="ts">
import type { TeaRecipe, TeaState } from '@/utils/milk-tea'
import { computed } from 'vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { MILK_TEA_AUTOMATION_OPTIONS } from '@/constants/activity-windows'
import { teaBalance, teaCanUpgrade, teaDate, teaDuration, teaFruitUids, teaImage, teaInteger, teaInventoryEstimate, teaNumber, teaOpenSlots, teaPhase } from '@/utils/milk-tea'
import MilkTeaAutomationStatus from './MilkTeaAutomationStatus.vue'
import MilkTeaRewardIcon from './MilkTeaRewardIcon.vue'

const props = defineProps<{
  state: TeaState
  now: number
  blocked: boolean
  automation: Record<string, boolean> | null
  logs: any[]
  contextLoading: boolean
  contextError: string
}>()
const emit = defineEmits<{ action: [action: string, params?: Record<string, unknown>], open: [kind: string], craft: [uids: string[]] }>()
const available = computed(() => teaFruitUids(props.state.recipes || []))
const business = computed(() => teaPhase(props.state, props.now) === 'business')
const shop = computed(() => props.state.shop!)
const next = computed(() => props.state.levels?.find(level => Number(level.level) === Number(shop.value?.level) + 1))
const current = computed(() => props.state.levels?.find(level => Number(level.level) === Number(shop.value?.level)))
const progress = computed(() => {
  const target = teaInteger(shop.value?.next_level_revenue)
  return target > 0n ? Math.min(100, Number(teaInteger(shop.value?.total_revenue) * 1000n / target) / 10) : 100
})
const gap = computed(() => {
  const value = teaInteger(shop.value?.next_level_revenue) - teaInteger(shop.value?.total_revenue)
  return value > 0n ? value.toString() : '0'
})
const pending = computed(() => shop.value?.pending_rewards || [])
const hasPending = computed(() => pending.value.some(item => teaInteger(item.count) > 0n))
const primaryPending = computed(() => pending.value.find(item => String(item.id ?? item.itemId) === '1041'))
const extraPending = computed(() => pending.value.filter(item => String(item.id ?? item.itemId) !== '1041' && teaInteger(item.count) > 0n))
const allRecipes = computed(() => [...(props.state.recipes || [])].sort((a, b) => Number(b.unlocked) - Number(a.unlocked)
  || Number(String(b.stock_cups) === '-1') - Number(String(a.stock_cups) === '-1')
  || Number(b.recipe_id) - Number(a.recipe_id)))
const inventory = computed(() => allRecipes.value.filter(recipe => recipe.unlocked && recipe.is_advanced))
const estimate = computed(() => teaInventoryEstimate(props.state, props.now))
const activeSlots = computed(() => (shop.value?.slots || []).filter(slot => Number(slot.end_at) > props.now))
const automationOptions = computed(() => MILK_TEA_AUTOMATION_OPTIONS.filter(option => !option.businessOnly || business.value))
const enabledCount = computed(() => automationOptions.value.filter(option => props.automation?.[option.key]).length)
const shownAutomation = computed(() => automationOptions.value.filter(option => ['milk_tea_cashier', 'milk_tea_craft', 'milk_tea_upgrade', 'milk_tea_hire'].includes(option.key)))
function materialCount(recipe: TeaRecipe) {
  return (recipe.fruits || []).filter(item => teaFruitUids([recipe]).includes(String(item.uid))).reduce((sum, item) => sum + teaInteger(item.count), 0n).toString()
}
</script>

<template>
  <div class="tea-metrics">
    <div class="tea-metric">
      <img :src="teaImage('icon_s4_ticket')" alt=""><p>可用奶茶券</p><strong class="tea-number">{{ teaNumber(teaBalance(state, '1041')) }}</strong><small>活动兑换货币</small>
    </div>
    <div class="tea-metric">
      <p>高级奶茶库存</p><strong class="tea-number">{{ teaNumber(estimate.cups) }}<small>杯</small></strong><small>{{ inventory.filter(recipe => teaInteger(recipe.stock_cups) > 0n).length }} 款在售</small>
    </div>
    <div class="tea-metric">
      <p>库存预估券收益</p><strong class="tea-number">{{ teaNumber(estimate.tokens) }}<small>券</small></strong><small>仅计已制作的高级奶茶</small>
    </div>
    <div class="tea-metric">
      <p>高级库存预计支撑至</p><strong class="tea-stock-until">{{ estimate.cups === '0' ? '等待补货' : estimate.until ? teaDate(estimate.until) : '暂不可估算' }}</strong><small>当前 {{ teaNumber(shop.effective_cups_per_hour) }} 杯 / 小时 · {{ business ? '营业中' : '结算期' }}</small>
    </div>
  </div>
  <div class="tea-shop-columns">
    <div class="tea-operating">
      <header class="tea-heading">
        <div class="tea-shop-name">
          <h3>{{ state.summary.shop_name || '奶茶小铺' }}</h3><span class="tea-badge">Lv.{{ shop.level }}</span>
          <button type="button" class="tea-icon-button" :disabled="blocked || !business" aria-label="修改店名" title="修改店名" @click="emit('open', 'rename')">
            <span class="i-carbon-edit" aria-hidden="true" />
          </button>
          <BaseSwitch class="tea-shop-hire" aria-label="允许被雇佣" label="允许被雇佣" :model-value="!state.summary.hire_disabled" :disabled="blocked || !business" @update:model-value="emit('action', 'hireDisabled', { disabled: !$event })" />
        </div>
        <button type="button" class="tea-link" :disabled="blocked" @click="emit('open', 'sales')">
          <span class="i-carbon-document" aria-hidden="true" />营业记录
        </button>
      </header>
      <div class="tea-claim">
        <img :src="teaImage('icon_s4_ticket')" alt="">
        <div>
          <p>待领取收益 <span v-if="state.summary.cashier_full" class="tea-badge tea-badge--warning">收银台已满</span></p>
          <strong class="tea-number">{{ teaNumber(primaryPending?.count ?? '0') }}</strong><small>奶茶券</small>
          <div v-if="extraPending.length" class="tea-rewards">
            <MilkTeaRewardIcon v-for="item in extraPending" :key="String(item.id)" :item="item" named />
          </div>
        </div>
        <button type="button" class="tea-button tea-button--primary" :disabled="blocked || !hasPending" @click="emit('action', 'cashier')">
          <span class="i-carbon-checkmark" aria-hidden="true" />领取收益
        </button>
      </div>
      <header class="tea-heading">
        <div><h3>在售库存</h3><small>{{ allRecipes.filter(recipe => recipe.unlocked).length }} / {{ allRecipes.length }} 配方已解锁</small></div>
        <button type="button" class="tea-link" :disabled="blocked" @click="emit('open', 'recipes')">
          全部配方<span class="i-carbon-arrow-right" aria-hidden="true" />
        </button>
      </header>
      <div class="tea-stock-grid">
        <button v-for="recipe in inventory" :key="String(recipe.recipe_id)" type="button" class="tea-stock-item" :disabled="blocked" @click="emit('open', `recipe:${recipe.recipe_id}`)">
          <img :src="recipe.config?.image || teaImage('img_s4TeaUI_tea')" alt="">
          <span><b>{{ recipe.recipe_name }}</b><strong class="tea-number">{{ teaNumber(recipe.stock_cups) }}<small>杯</small></strong><small>{{ /^\d+$/.test(String(recipe.stock_cups)) && /^\d+$/.test(String(recipe.token_price)) ? `≈ ${teaNumber(teaInteger(recipe.stock_cups) * teaInteger(recipe.token_price))} 券` : '收益待确认' }}</small></span>
        </button>
        <div class="tea-stock-basic">
          <button v-for="recipe in allRecipes.filter(item => item.unlocked && !item.is_advanced)" :key="String(recipe.recipe_id)" type="button" class="tea-link" :disabled="blocked" @click="emit('open', `recipe:${recipe.recipe_id}`)">
            {{ recipe.recipe_name }} · {{ String(recipe.stock_cups) === '-1' ? '不限量供应' : `${teaNumber(recipe.stock_cups)} 杯` }} · {{ teaNumber(recipe.token_price) }} 券 / 杯
          </button>
        </div>
      </div>
      <div v-if="available.length && business" class="tea-craft-prompt">
        <div><h3>有材料可以制作了</h3><p>{{ allRecipes.filter(recipe => teaFruitUids([recipe]).length).map(recipe => `${recipe.recipe_name}材料 ${teaNumber(materialCount(recipe))} 枚`).join(' · ') }}</p></div><button type="button" class="tea-button tea-button--primary" :disabled="blocked" @click="emit('craft', [])">
          制作奶茶
        </button>
      </div>
      <p class="tea-estimate-note">
        收益按当前售价估算；支撑时间为高级总库存 ÷ 当前总销售速度，不代表各款实际售罄顺序，不含补货、喇叭及员工变动。{{ estimate.capped ? '库存可能无法在营业截止前售完。' : '' }}
      </p>
      <div class="tea-actions">
        <button type="button" class="tea-link" :disabled="blocked || !business || teaInteger(teaBalance(state, shop.sales_item_id)) < 1n" @click="emit('open', 'boost')">
          宣传喇叭 {{ teaNumber(teaBalance(state, shop.sales_item_id)) }} 个 · 使用
        </button><button type="button" class="tea-link" :disabled="blocked" @click="emit('open', 'automation')">
          账号设置 / 自动化状态
        </button>
      </div>
    </div>
    <aside class="tea-rail">
      <section class="tea-rail-section">
        <header class="tea-heading">
          <h3>店铺成长</h3><button type="button" class="tea-link" :disabled="blocked" @click="emit('open', 'levels')">
            等级预览<span class="i-carbon-arrow-up-right" aria-hidden="true" />
          </button>
        </header>
        <div class="tea-level">
          <img :src="teaImage('img_s4TeaUpLv_house')" alt=""><strong class="tea-number"><small>Lv.</small>{{ shop.level }}</strong><span>{{ next ? `下一等级 Lv.${next.level}` : '已满级' }}</span>
        </div>
        <div class="tea-progress-label">
          <span>营业额进度</span><span class="tea-number">{{ teaNumber(shop.total_revenue) }} / {{ next ? teaNumber(shop.next_level_revenue) : '已满级' }}</span>
        </div>
        <progress :value="progress" max="100" aria-label="店铺升级进度" />
        <p v-if="next" class="tea-next-unlock">
          {{ (next.recipe_names || []).filter(name => !(current?.recipe_names || []).includes(name)).join('、') }}<span v-if="next.employee_slot_count > (current?.employee_slot_count || 0)"> · 员工位 {{ next.employee_slot_count }} 个</span><span v-if="next.shop_item_string"> · {{ next.shop_item_string }}</span>
        </p>
        <button type="button" class="tea-button" :disabled="blocked || !teaCanUpgrade(state, now)" @click="emit('open', 'upgrade')">
          {{ !next ? '店铺已满级' : teaCanUpgrade(state, now) ? '升级店铺' : `还差 ${teaNumber(gap)} 营业额` }}
        </button>
      </section>
      <section class="tea-rail-section">
        <header class="tea-heading">
          <h3>店员</h3><small>{{ activeSlots.length }} / {{ current?.employee_slot_count ?? '—' }} 在岗</small>
        </header>
        <div v-for="slot in activeSlots" :key="slot.slot_index" class="tea-employee">
          <img :src="teaImage('hamster-idle')" alt=""><div><b>{{ slot.employee?.name || '员工' }}</b><small>{{ slot.talent_name }}</small></div>
          <time :title="`${teaDate(slot.end_at)} 下班`">{{ teaDuration(Number(slot.end_at) - now) }}<small>后下班</small></time>
        </div>
        <p v-if="!activeSlots.length" class="tea-muted">
          暂无在岗员工
        </p>
        <p v-if="teaOpenSlots(state, now).length" class="tea-employee-lock">
          {{ teaOpenSlots(state, now).length }} 个空闲员工位
        </p>
        <p v-else-if="next && next.employee_slot_count > (current?.employee_slot_count || 0)" class="tea-employee-lock">
          店铺 {{ next.level }} 级解锁新员工位
        </p>
        <button type="button" class="tea-button" :disabled="blocked || !business" @click="emit('open', 'hireList')">
          <span class="i-carbon-group" aria-hidden="true" />管理员工
        </button>
      </section>
      <section class="tea-rail-section">
        <header class="tea-heading">
          <h3>自动化状态</h3><span class="tea-badge" :class="{ 'tea-badge--positive': automation }">{{ automation ? `${enabledCount} 项开启` : contextLoading ? '读取中' : '未读取' }}</span>
        </header>
        <div class="tea-auto-list">
          <div v-for="option in shownAutomation" :key="option.key" class="tea-auto-row" :data-enabled="automation?.[option.key] === true">
            <span>{{ option.label }}</span><MilkTeaAutomationStatus :enabled="automation ? automation[option.key] === true : null" />
          </div>
        </div>
        <button type="button" class="tea-link" :disabled="blocked" @click="emit('open', 'automation')">
          <span class="i-carbon-settings-adjust" aria-hidden="true" />查看全部自动化
        </button>
      </section>
    </aside>
  </div>
  <section class="tea-log-section">
    <header class="tea-heading">
      <div><h3>最近执行</h3><small>本活动</small></div><button type="button" class="tea-link" :disabled="blocked" @click="emit('open', 'rank')">
        <span class="i-carbon-trophy" aria-hidden="true" />排行榜
      </button>
    </header>
    <p v-if="contextError" class="tea-inline-state">
      {{ contextError }}
    </p>
    <p v-else-if="!logs.length" class="tea-inline-state">
      {{ contextLoading ? '正在读取执行记录…' : '暂无本活动执行记录' }}
    </p>
    <div v-for="(log, index) in logs.slice(0, 3)" :key="log.logId || `${log.ts}-${index}`" class="tea-log" :data-result="log.meta?.result">
      <time :title="teaDate(Number(log.ts) / 1000)">{{ teaDate(Number(log.ts) / 1000) }}</time><span :class="log.meta?.result === 'error' ? 'i-carbon-warning-alt' : log.meta?.result === 'skip' ? 'i-carbon-subtract' : 'i-carbon-checkmark-outline'" aria-hidden="true" /><span>{{ log.msg }}</span>
    </div>
  </section>
</template>
