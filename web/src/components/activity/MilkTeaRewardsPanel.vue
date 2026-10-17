<script setup lang="ts">
import type { TeaState } from '@/utils/milk-tea'
import { computed } from 'vue'
import { teaNumber } from '@/utils/milk-tea'
import MilkTeaRewardIcon from './MilkTeaRewardIcon.vue'

const props = defineProps<{ state: TeaState, blocked: boolean, section?: 'rewards' | 'fund' }>()
const emit = defineEmits<{ action: [action: string], native: [] }>()
const milestones = computed(() => [...(props.state.share?.milestones || [])].sort((a, b) => Number(a.threshold) - Number(b.threshold)))
const tiers = computed(() => [...(props.state.fund?.tiers || [])].sort((a, b) => Number(a.tier_id) - Number(b.tier_id)))
function label(value: number) {
  return Number(value) === 3 ? '已领取' : Number(value) === 2 ? '可领取' : '未达成'
}
</script>

<template>
  <div class="tea-panel">
    <section v-if="section !== 'fund'" class="tea-reward-section">
      <header class="tea-heading">
        <div><h3>快乐不独享</h3><span v-if="state.share" class="tea-badge tea-badge--positive">{{ teaNumber(state.share.current_score) }} 快乐值</span></div>
        <button v-if="state.share?.daily" type="button" class="tea-button tea-button--primary" :disabled="blocked || state.share.daily.daily_reward_claimed" @click="emit('action', 'shareDaily')">
          <span class="i-carbon-checkmark" aria-hidden="true" />{{ state.share.daily.daily_reward_claimed ? '今日已领取' : '领取每日快乐值' }}
        </button>
      </header>
      <template v-if="state.share">
        <p v-if="state.share.my_pool" class="tea-muted">
          快乐包已被领取 {{ teaNumber(state.share.my_pool.claimed_count) }} / {{ teaNumber(state.share.my_pool.claim_limit) }}
        </p>
        <div v-if="milestones.length" class="tea-reward-track">
          <article v-for="tier in milestones" :key="tier.tier_id" class="tea-reward-step" :class="{ 'tea-reward-step--reached': Number(tier.state) === 2 || Number(tier.state) === 3 }">
            <h4>{{ teaNumber(tier.threshold) }} 快乐值</h4>
            <div class="tea-rewards">
              <MilkTeaRewardIcon v-for="item in tier.rewards" :key="String(item.id)" :item="item" named />
            </div>
            <span class="tea-badge" :class="{ 'tea-badge--positive': Number(tier.state) === 2 }">{{ label(tier.state) }}</span>
          </article>
        </div>
        <p v-else class="tea-inline-state">
          暂无快乐值奖励数据
        </p>
        <div class="tea-actions">
          <button type="button" class="tea-button" :disabled="blocked || !milestones.some(tier => Number(tier.state) === 2)" @click="emit('action', 'shareRewards')">
            <span class="i-carbon-gift" aria-hidden="true" />领取快乐值奖励
          </button>
          <button type="button" class="tea-link" :disabled="blocked" @click="emit('native')">
            <span class="i-carbon-launch" aria-hidden="true" />分享快乐
          </button>
          <button type="button" class="tea-link" :disabled="blocked" @click="emit('native')">
            领取日志
          </button>
        </div>
      </template>
      <p v-else class="tea-inline-state">
        尚未读取到快乐值活动数据
      </p>
    </section>
    <section v-if="section !== 'rewards'" class="tea-reward-section">
      <header class="tea-heading">
        <div><h3>成长基金</h3><span v-if="state.fund" class="tea-badge" :class="{ 'tea-badge--positive': state.fund.unlocked }">{{ state.fund.unlocked ? '已解锁' : '未购买' }}</span></div>
        <button v-if="state.fund?.unlocked" type="button" class="tea-button tea-button--primary" :disabled="blocked || !tiers.some(tier => Number(tier.state) === 2)" @click="emit('action', 'fundRewards')">
          <span class="i-carbon-gift" aria-hidden="true" />领取基金奖励
        </button>
      </header>
      <template v-if="state.fund">
        <div v-if="tiers.length" class="tea-reward-track">
          <article v-for="tier in tiers" :key="tier.tier_id" class="tea-reward-step" :class="{ 'tea-reward-step--reached': tier.conditions?.length ? tier.conditions.every(condition => condition.reached) : Number(tier.state) === 2 || Number(tier.state) === 3 }">
            <h4 v-if="tier.conditions?.[0]?.target_value">
              店铺 Lv.{{ tier.conditions[0].target_value }}
            </h4><h4 v-else>
              档位 {{ tier.tier_id }}
            </h4>
            <div class="tea-rewards">
              <MilkTeaRewardIcon v-for="item in tier.reward" :key="String(item.id)" :item="item" named />
            </div>
            <span class="tea-badge" :class="{ 'tea-badge--positive': state.fund.unlocked && Number(tier.state) === 2 }">{{ !state.fund.unlocked ? '基金未解锁' : label(tier.state) }}</span>
          </article>
        </div>
        <p v-else class="tea-inline-state">
          暂无基金奖励数据
        </p>
        <div v-if="!state.fund.unlocked" class="tea-rule-note">
          <p>不支持在网页购买付费基金</p>
          <div v-if="state.fund.unlock_cost?.length" class="tea-rewards">
            <MilkTeaRewardIcon v-for="item in state.fund.unlock_cost" :key="String(item.id)" :item="item" named />
          </div>
        </div>
      </template>
      <p v-else class="tea-inline-state">
        尚未读取到成长基金数据
      </p>
    </section>
  </div>
</template>
