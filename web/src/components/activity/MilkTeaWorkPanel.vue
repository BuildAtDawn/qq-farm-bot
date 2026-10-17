<script setup lang="ts">
import type { TeaState } from '@/utils/milk-tea'
import { computed } from 'vue'
import { teaCanInteract, teaDate, teaDuration, teaImage, teaInteractionReward, teaNumber, teaPhase, teaPlainText } from '@/utils/milk-tea'

const props = defineProps<{ state: TeaState, now: number, blocked: boolean }>()
const emit = defineEmits<{ open: [kind: string], action: [action: string, params?: Record<string, unknown>] }>()
const shift = computed(() => props.state.work?.my_shift)
const business = computed(() => teaPhase(props.state, props.now) === 'business')
const slips = computed(() => props.state.work?.slips || [])
function description(value?: string) {
  return teaPlainText(value).replace(/\{\d+\}/g, '对应数量')
}
</script>

<template>
  <div class="tea-panel tea-work-detail">
    <div class="tea-work-toolbar">
      <span class="tea-badge" :class="{ 'tea-badge--warning': state.summary.has_unclaimed_wage }">{{ state.summary.has_unclaimed_wage ? '有待领取工资' : '暂无待领取工资' }}</span>
      <button type="button" class="tea-button tea-button--primary" :disabled="blocked || !state.summary.has_unclaimed_wage" @click="emit('action', 'wages')">
        <span class="i-carbon-checkmark" aria-hidden="true" />领取工资
      </button>
    </div>
    <div class="tea-work-columns">
      <section>
        <header class="tea-heading">
          <h3>当前兼职</h3>
        </header>
        <template v-if="shift">
          <div class="tea-shift-header">
            <span class="tea-avatar"><img v-if="/^https?:\/\//.test(shift.employer?.avatar || '')" :src="shift.employer.avatar" alt="老板头像"><span v-else class="i-carbon-user" aria-hidden="true" /></span>
            <div><h3>{{ shift.shop_name || '奶茶小铺' }}</h3><p>老板：{{ shift.employer?.name || '—' }} · {{ shift.talent_name }}</p></div>
            <span class="tea-badge" :class="{ 'tea-badge--positive': Number(shift.end_at) > now }">{{ Number(shift.end_at) > now ? '工作中' : '已下班' }}</span>
          </div>
          <div class="tea-shift-facts">
            <div><p>距离下班</p><strong class="tea-number">{{ teaDuration(Number(shift.end_at) - now) }}</strong></div>
            <div><p>预计工资</p><strong class="tea-number">{{ teaNumber(shift.wage_total) }}<small>奶茶券</small></strong></div>
            <div><p>本班互动</p><strong class="tea-number">{{ teaNumber(shift.interact_count) }}<small>/ {{ teaNumber(shift.interact_limit) }}</small></strong></div>
          </div>
          <p class="tea-muted">
            下班时间：{{ teaDate(shift.end_at) }} · UTC+8
          </p>
          <p v-if="shift.interact?.type" class="tea-next-unlock">
            {{ teaInteractionReward(shift.interact) }}
          </p>
          <h3 class="tea-subheading">
            工作互动
          </h3>
          <div class="tea-interactions">
            <button v-for="interaction in state.interactions" :key="interaction.interaction_id" type="button" class="tea-interaction" :disabled="blocked || !teaCanInteract(state, now)" @click="emit('open', `interact:${interaction.interaction_id}`)">
              <img :src="teaImage(`icon_S4MyJob_interact_${interaction.interaction_id}`)" alt="">
              <span><b>{{ interaction.name }}</b><small>{{ description(interaction.des) }}</small></span>
            </button>
          </div>
          <p v-if="!teaCanInteract(state, now)" class="tea-next-unlock">
            {{ !business ? '结算期不可互动' : Number(shift.end_at) <= now ? '当前班次已结束' : '本班互动次数已用完' }}
          </p>
        </template>
        <div v-else class="tea-work-empty">
          <img :src="teaImage('hamster-idle')" alt="" style="width: 78px; height: 90px">
          <h3>暂无进行中的兼职</h3><p v-if="state.work?.talent_name">
            当前特长：{{ state.work.talent_name }}
          </p>
        </div>
        <h3 class="tea-subheading">
          兼职记录
        </h3>
        <p v-if="!slips.length" class="tea-inline-state">
          暂无工作记录
        </p>
        <article v-for="slip in slips" :key="String(slip.shift_id)" class="tea-slip">
          <header><h4>{{ slip.shop_name || '奶茶小铺' }} · {{ slip.employer?.name || '—' }}</h4><time>{{ teaDate(slip.end_at) }}</time></header>
          <dl>
            <div><dt>工作时长</dt><dd>{{ Number.isFinite(Number(slip.work_sec)) ? `${Math.round(Number(slip.work_sec) / 3600 * 10) / 10} 小时` : '—' }}</dd></div>
            <div><dt>兼职工资</dt><dd>{{ teaNumber(slip.wages?.final_wage) }} 奶茶券</dd></div>
            <div><dt>互动收益</dt><dd>{{ teaInteractionReward(slip.interact) }}</dd></div>
          </dl>
        </article>
      </section>
    </div>
  </div>
</template>
