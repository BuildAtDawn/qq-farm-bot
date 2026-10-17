<script setup lang="ts">
import type { TeaLevel, TeaState } from '@/utils/milk-tea'
import { computed, ref, watch } from 'vue'
import { teaCanUpgrade, teaDate, teaImage, teaInteger, teaInteractionReward, teaNumber } from '@/utils/milk-tea'
import MilkTeaDialog from './MilkTeaDialog.vue'
import MilkTeaRewardIcon from './MilkTeaRewardIcon.vue'

const props = defineProps<{ kind: string, state: TeaState, records: any, busy: boolean, error: string, now: number }>()
const emit = defineEmits<{ close: [], action: [action: string], records: [kind: string, params: Record<string, unknown>] }>()
const preview = ref(false)
const notice = ref('')
const selectedLevel = ref(Number(props.state.shop?.level || 1))
const previewLevel = computed(() => props.state.levels?.find(level => Number(level.level) === selectedLevel.value))
const previousLevel = computed(() => props.state.levels?.find(level => Number(level.level) === selectedLevel.value - 1))
watch(() => props.kind, () => {
  preview.value = props.kind === 'levels'
  notice.value = ''
}, { immediate: true })
const current = computed(() => props.state.levels?.find(level => Number(level.level) === Number(props.state.shop?.level)))
const next = computed(() => props.state.levels?.find(level => Number(level.level) === Number(props.state.shop?.level) + 1))
const title = computed(() => preview.value ? '等级预览' : ({ upgrade: '店铺升级', sales: '营业记录', rank: '排行榜' } as Record<string, string>)[props.kind] || '店铺详情')
const progress = computed(() => {
  const target = teaInteger(props.state.shop?.next_level_revenue)
  return target > 0n ? Math.min(100, Number(teaInteger(props.state.shop?.total_revenue) * 1000n / target) / 10) : 100
})
function effects(level?: TeaLevel, previous?: TeaLevel) {
  if (!level)
    return []
  const values = [
    { name: '热卖速度', text: `${level.base_popularity} 杯 / 小时` },
    { name: '员工位', text: `${level.employee_slot_count} 个` },
  ]
  const recipes = (level.recipe_names || []).filter(name => !(previous?.recipe_names || []).includes(name))
  if (recipes.length)
    values.push({ name: '新配方', text: recipes.join('、') })
  if (level.shop_item_string)
    values.push({ name: '商品解锁', text: level.shop_item_string })
  if (level.advanced_price_percent)
    values.push({ name: '特殊奶茶售价', text: `+${level.advanced_price_percent / 100}%` })
  return values
}
const salesDay = computed(() => {
  const day = String(props.records?.day || '')
  return /^\d{8}$/.test(day) ? `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}` : props.records?.day ? teaDate(props.records.day) : ''
})
const avatar = (value?: string) => /^https?:\/\//.test(value || '')
</script>

<template>
  <MilkTeaDialog :title="title" :busy="busy" :wide="kind === 'sales' || kind === 'rank'" @close="emit('close')">
    <p v-if="error" class="tea-error" role="alert">
      {{ error }}
    </p>
    <template v-if="kind === 'upgrade' && !preview && state.shop">
      <div class="tea-heading">
        <div><img :src="teaImage('img_s4TeaUpLv_house')" alt="" style="width: 72px; height: 53px"><h3>Lv.{{ state.shop.level }} <span class="i-carbon-arrow-right" aria-hidden="true" /> {{ next ? `Lv.${next.level}` : '已满级' }}</h3></div>
        <button type="button" class="tea-link" :disabled="busy" @click="preview = true">
          等级预览
        </button>
      </div>
      <div class="tea-progress-label">
        <span>营业额进度</span><span class="tea-number">{{ teaNumber(state.shop.total_revenue) }} / {{ next ? teaNumber(state.shop.next_level_revenue) : '已满级' }}</span>
      </div>
      <progress :value="progress" max="100" aria-label="店铺升级进度" />
      <h3 class="tea-subheading">
        升级效果
      </h3>
      <dl v-if="next">
        <div v-for="effect in effects(next, current)" :key="effect.name" class="tea-effect">
          <dt>{{ effect.name }}</dt><dd>{{ effect.text }}</dd>
        </div>
      </dl>
      <p v-else class="tea-muted">
        店铺已满级
      </p>
      <h3 v-if="next?.rewards?.length" class="tea-subheading">
        升级奖励
      </h3>
      <div class="tea-rewards">
        <MilkTeaRewardIcon v-for="item in next?.rewards || []" :key="String(item.id)" :item="item" named />
      </div>
    </template>
    <template v-else-if="preview">
      <div class="tea-level-summary">
        <img :src="teaImage('img_s4TeaUpLv_house')" alt=""><div>
          <h3>当前等级 Lv.{{ state.shop?.level }}</h3><p class="tea-muted">
            累计营业额 {{ teaNumber(state.shop?.total_revenue) }}
          </p>
        </div>
      </div>
      <nav class="tea-level-picker" aria-label="选择预览等级">
        <button v-for="level in state.levels" :key="level.level" type="button" :aria-pressed="selectedLevel === Number(level.level)" :disabled="busy" @click="selectedLevel = Number(level.level)">
          <b>Lv.{{ level.level }}</b><small>{{ Number(level.level) < Number(state.shop?.level) ? '已达成' : Number(level.level) === Number(state.shop?.level) ? '当前等级' : Number(level.level) === Number(state.shop?.level) + 1 ? '下一等级' : '未解锁' }}</small>
        </button>
      </nav>
      <section v-if="previewLevel" class="tea-level-detail">
        <header class="tea-heading">
          <h3>Lv.{{ previewLevel.level }}</h3><span class="tea-muted">所需营业额 {{ teaNumber(previewLevel.revenue_required) }}</span>
        </header>
        <dl>
          <div v-for="effect in effects(previewLevel, previousLevel)" :key="effect.name" class="tea-effect">
            <dt>{{ effect.name }}</dt><dd>{{ effect.text }}</dd>
          </div>
        </dl>
        <h3 v-if="previewLevel.rewards?.length" class="tea-subheading">
          升级奖励
        </h3>
        <div class="tea-rewards">
          <MilkTeaRewardIcon v-for="item in previewLevel.rewards || []" :key="String(item.id)" :item="item" named />
        </div>
      </section>
    </template>
    <template v-else-if="kind === 'sales'">
      <p v-if="!records" class="tea-inline-state">
        {{ busy ? '正在读取营业记录…' : error ? '营业记录读取失败' : '暂无营业记录' }}
      </p>
      <template v-else>
        <header class="tea-heading">
          <h3>{{ salesDay }}</h3><small>售出 {{ teaNumber(records.cups) }} 杯</small>
        </header>
        <table v-if="records.drinks?.length" class="tea-table">
          <thead><tr><th>奶茶</th><th>售出杯数</th></tr></thead>
          <tbody>
            <tr v-for="drink in records.drinks" :key="drink.recipe_id">
              <td><span class="tea-product"><img v-if="drink.image" :src="drink.image" :alt="drink.name"><b>{{ drink.name }}</b></span></td><td class="tea-number">
                {{ teaNumber(drink.cups) }}
              </td>
            </tr>
          </tbody>
        </table>
        <h3 class="tea-subheading">
          营业收益
        </h3>
        <div class="tea-rewards">
          <MilkTeaRewardIcon v-for="item in records.rewards || []" :key="String(item.id)" :item="item" named />
        </div>
        <p v-if="!records.rewards?.length" class="tea-muted">
          暂无收益
        </p>
        <h3 class="tea-subheading">
          雇员记录
        </h3>
        <p v-if="!records.hires?.length" class="tea-muted">
          暂无雇员记录
        </p>
        <article v-for="hire in records.hires || []" :key="hire.shift_id" class="tea-slip">
          <header><h4>{{ hire.friend?.name || '员工' }} · {{ hire.talent_name }}</h4><time>{{ teaDate(hire.hire_at) }}</time></header>
          <dl><div><dt>工作时长</dt><dd>{{ Number(hire.duration_sec) / 3600 }} 小时</dd></div><div><dt>支付工资</dt><dd>{{ teaNumber(hire.wages?.final_wage) }} 奶茶券</dd></div><div><dt>互动收益</dt><dd>{{ teaInteractionReward(hire.interact) }}</dd></div></dl>
        </article>
      </template>
    </template>
    <template v-else-if="kind === 'rank'">
      <p v-if="!records" class="tea-inline-state">
        {{ busy ? '正在读取排行榜…' : error ? '排行榜读取失败' : '暂无排行' }}
      </p>
      <template v-else>
        <p v-if="records.snapshot_time" class="tea-muted">
          更新于 {{ teaDate(records.snapshot_time) }} · UTC+8
        </p>
        <p v-if="records.my_rank" class="tea-next-unlock">
          我的排名 {{ records.my_rank }}
        </p>
        <table v-if="records.ranks?.length" class="tea-table">
          <thead><tr><th>排名</th><th>玩家 / 店铺</th><th>营业额</th><th /></tr></thead>
          <tbody>
            <tr v-for="entry in records.ranks" :key="String(entry.owner?.gid)">
              <td class="tea-number">
                {{ entry.rank }}
              </td>
              <td>
                <div class="tea-rank-player">
                  <span class="tea-avatar"><img v-if="avatar(entry.owner?.avatar)" :src="entry.owner.avatar" alt=""><span v-else class="i-carbon-user" aria-hidden="true" /></span><div><b>{{ entry.owner?.name || '—' }}</b><p>{{ entry.shop_name }} · Lv.{{ entry.level }}</p></div>
                </div>
              </td>
              <td class="tea-number">
                {{ teaNumber(entry.total_revenue) }}
              </td>
              <td>
                <button v-if="entry.can_show_off" type="button" class="tea-link" @click="notice = '此功能需要 QQ 原生分享'">
                  炫耀
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="tea-inline-state">
          暂无排行
        </p>
      </template>
    </template>
    <p v-if="notice" class="tea-rule-note" role="status">
      {{ notice }}
    </p>
    <template #footer>
      <template v-if="preview && kind === 'upgrade'">
        <button type="button" class="tea-button" :disabled="busy" @click="preview = false">
          <span class="i-carbon-arrow-left" aria-hidden="true" />返回升级
        </button>
      </template>
      <template v-if="kind === 'rank' && records">
        <p>第 {{ records.page || 1 }} 页</p><button type="button" class="tea-button" :disabled="busy || Number(records.page || 1) <= 1" @click="emit('records', 'rank', { page: Number(records.page || 1) - 1 })">
          上一页
        </button><button type="button" class="tea-button" :disabled="busy || !records.has_more" @click="emit('records', 'rank', { page: Number(records.page || 1) + 1 })">
          下一页
        </button>
      </template>
      <button v-if="kind === 'upgrade' && !preview" type="button" class="tea-button tea-button--primary" :disabled="busy || !teaCanUpgrade(state, now)" @click="emit('action', 'upgrade')">
        {{ busy ? '升级中…' : '确认升级' }}
      </button>
      <button v-else type="button" class="tea-button" :disabled="busy" @click="emit('close')">
        关闭
      </button>
    </template>
  </MilkTeaDialog>
</template>
