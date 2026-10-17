<script setup lang="ts">
import type { ActivityLabels } from './types'
import type { HeluDrawReward, HeluSolarTerm, HeluSolarTerms } from '@/stores/activity'
import BaseButton from '@/components/ui/BaseButton.vue'

defineProps<{
  solarTerms?: HeluSolarTerms | null
  loading?: boolean
  labels: ActivityLabels
}>()

defineEmits<{
  claim: [term: HeluSolarTerm]
}>()

const T = {
  currentTerm: '\u5F53\u524D\u8282\u4EE4',
  claimableUnit: '\u4E2A\u53EF\u9886',
  termUnit: '\u4E2A\u8282\u4EE4',
  itemPrefix: '\u7269\u54C1',
  none: '\u65E0',
  termPrefix: '\u8282\u4EE4',
  reward: '\u5956\u52B1',
  claimReward: '\u9886\u53D6\u5956\u52B1',
  unavailable: '\u4E0D\u53EF\u9886\u53D6',
}

function formatTime(value?: number) {
  const raw = Number(value || 0)
  if (!raw)
    return '-'
  const date = new Date(raw > 1000000000000 ? raw : raw * 1000)
  if (Number.isNaN(date.getTime()))
    return '-'
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

function rewardName(item: { itemName?: string, name?: string, itemId?: number }) {
  return item.itemName || item.name || `${T.itemPrefix}${item.itemId || ''}`
}

function rewardCount(item: { itemCount?: number, count?: number }) {
  return item.itemCount || item.count || 1
}

function rewardSummary(items?: HeluDrawReward[]) {
  if (!items?.length)
    return T.none
  return items.map(item => `${rewardName(item)}x${rewardCount(item)}`).join(' / ')
}


</script>

<template>
  <section class="solar-notes">
    <header class="notes-banner">
      <div class="banner-copy">
        <span class="banner-eyebrow">四时有信 · 常驻活动</span>
        <h2>{{ labels.notesTab }}</h2>
        <p>{{ solarTerms?.currentTerm ? `当前节令 · ${solarTerms.currentTerm.title}` : solarTerms?.nextTerm ? `下一节令 · ${solarTerms.nextTerm.title}` : '静候下一封节令来信' }}</p>
        <div class="banner-stats">
          <span><strong>{{ solarTerms?.claimableCount || 0 }}</strong> 份赠礼可领取</span>
          <span>{{ solarTerms?.terms?.length || 0 }} 个节令已收录</span>
        </div>
      </div>
    </header>
    <p v-if="solarTerms?.warning" role="alert" class="m-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">{{ solarTerms.warning }}</p>
    <div class="notes-heading"><h3>节令赠礼</h3><span>时间均为北京时间</span></div>
    <div v-if="!solarTerms?.terms?.length" class="notes-empty">{{ labels.empty }}</div>
    <div v-else class="notes-grid">
      <article v-for="term in solarTerms.terms" :key="term.id" class="term-letter" :class="{ 'is-claimable': term.claimable, 'is-claimed': term.status === 3, 'is-upcoming': term.statusLabel === '未开始' || term.statusLabel === '未开启', 'is-ended': term.statusLabel === '已结束' }">
        <div class="term-heading">
          <div class="term-seal" aria-hidden="true">{{ (term.title || '节令').slice(0, 2) }}</div>
          <div class="min-w-0 flex-1"><h4>{{ term.title || `节令 ${term.id}` }}</h4><span class="term-status"><span v-if="term.statusLabel === '未开始' || term.statusLabel === '未开启'" class="i-carbon-time" aria-hidden="true" /><span v-else-if="term.statusLabel === '已结束'" class="i-carbon-archive" aria-hidden="true" />{{ term.statusLabel || T.unavailable }}</span></div>
          <div v-if="term.status === 3" class="i-carbon-checkmark-outline shrink-0 text-xl text-emerald-600" aria-hidden="true" />
        </div>
        <dl class="term-dates">
          <div><dt>开启</dt><dd>{{ formatTime(term.startTime) }}</dd></div>
          <div><dt>截止</dt><dd>{{ formatTime(term.endTime) }}</dd></div>
        </dl>
        <div class="letter-rewards" :aria-label="rewardSummary(term.rewards)">
          <div v-for="(item, index) in term.rewards" :key="`${term.id}-${item.itemId}-${index}`" class="letter-reward">
            <div class="reward-icon"><img v-if="item.image" :src="item.image" alt="" loading="lazy"><span v-else class="i-carbon-gift" aria-hidden="true" /></div>
            <span class="reward-name">{{ rewardName(item) }}</span><strong>×{{ rewardCount(item) }}</strong>
          </div>
          <p v-if="!term.rewards?.length" class="text-xs text-gray-500">暂无奖励信息</p>
        </div>
        <BaseButton v-if="term.claimable" class="mt-auto w-full" variant="primary" :loading="loading" :disabled="loading" @click="$emit('claim', term)">{{ T.claimReward }}</BaseButton>
        <div v-else class="letter-footer">{{ term.status === 3 ? '赠礼已收下' : term.statusLabel || T.unavailable }}</div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.solar-notes{overflow:hidden;border:1px solid #e5e9dd;border-radius:20px;background:#fafbf7;color:#334638}
.notes-banner{min-height:230px;display:flex;align-items:center;background:linear-gradient(90deg,rgba(24,52,40,.93),rgba(24,52,40,.65) 50%,rgba(24,52,40,.08)),url('/activity/solar-terms/banner.png') center 65%/cover}
.banner-copy{padding:28px 32px;color:#fff9e8;max-width:100%}.banner-eyebrow{font-size:12px;letter-spacing:.18em;color:#e4dcac}.banner-copy h2{margin:12px 0;font-family:serif;font-size:32px;letter-spacing:.12em}.banner-copy p{font-size:14px;color:#ecf0df}.banner-stats{display:flex;flex-wrap:wrap;gap:12px;margin-top:22px;align-items:center;font-size:12px}.banner-stats span:first-child{border:1px solid #fff3;padding:7px 12px;border-radius:10px;background:#163c3655}.banner-stats strong{font-size:22px;margin-right:4px;color:#ffe3a0}
.notes-tips{margin:16px 20px 0;font-size:13px;line-height:1.7;white-space:pre-line;overflow-wrap:anywhere}.notes-heading{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:20px 20px 12px}.notes-heading h3{font-weight:600;font-size:15px}.notes-heading span{font-size:11px;color:#7b8577}.notes-empty{padding:40px;text-align:center;color:#7b8577}.notes-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;padding:0 20px 20px}
.term-letter{display:flex;flex-direction:column;min-width:0;padding:18px;border:1px solid #e4e7db;border-radius:14px;background:#fffef9;box-shadow:0 3px 12px #34473505}.term-letter.is-claimable{border-color:#89ab82;box-shadow:0 3px 14px #4469420d}.term-heading{display:flex;gap:12px;align-items:center}.term-seal{display:grid;place-items:center;width:44px;height:48px;flex-shrink:0;border:1px solid #c0cbb0;border-radius:12px 4px;background:#eef1e3;font-family:serif;font-size:17px;color:#5b704c}.term-heading h4{font-family:serif;font-weight:600;font-size:19px;overflow-wrap:anywhere}.term-status{font-size:11px;color:#7c8476}.is-claimable .term-status{color:#327b4d}.term-dates{display:grid;gap:6px;margin:16px 0;padding-bottom:14px;border-bottom:1px dashed #dde2d4;font-size:11px}.term-dates div{display:flex;gap:12px}.term-dates dt{flex-shrink:0;color:#89917e}.term-dates dd{margin:0;overflow-wrap:anywhere}.letter-rewards{display:grid;gap:9px;margin-bottom:20px}.letter-reward{display:flex;gap:9px;align-items:center;font-size:12px}.reward-icon{width:34px;height:34px;display:grid;place-items:center;background:#f2f3e8;border-radius:8px;flex-shrink:0}.reward-icon img{width:28px;height:28px;object-fit:contain}.reward-name{flex:1;min-width:0;overflow-wrap:anywhere}.letter-reward strong{font-size:12px;font-weight:500;flex-shrink:0}.letter-footer{margin-top:auto;padding:9px;text-align:center;border-radius:8px;background:#f0f2e9;color:#7c8573;font-size:12px}.is-claimed .letter-footer{color:#64815d}
:global(.dark) .solar-notes{background:#18251f;border-color:#35463a;color:#e0e8d9}:global(.dark) .term-letter{background:#202f27;border-color:#40513f}:global(.dark) .term-seal,:global(.dark) .reward-icon,:global(.dark) .letter-footer{background:#2d3e30;color:#c4d2b6}:global(.dark) .term-dates{border-color:#40513f}:global(.dark) .is-claimable{border-color:#85a576}:global(.dark) .term-status{color:#bac9ac}
@media(min-width:1500px){.notes-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:1000px){.notes-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.notes-grid{grid-template-columns:minmax(0,1fr);padding:0 12px 12px;gap:12px}.banner-copy{padding:24px 20px}.notes-banner{min-height:220px}.banner-copy h2{font-size:28px}.notes-heading{padding:16px 12px 12px}.term-letter{padding:16px}.notes-tips{margin:12px}}
/* Use both icons and distinct surfaces so status does not depend on color alone. */
.term-status{display:inline-flex;align-items:center;gap:4px;margin-top:5px;padding:3px 8px;border-radius:6px;font-weight:600}
.is-upcoming{border-top:3px solid #739bca;background:#f7faff}
.is-upcoming .term-status,.is-upcoming .letter-footer{background:#e4efff;color:#305f99}
.is-upcoming .term-seal{border-color:#b4cae3;background:#eaf2fc;color:#416b9c}
.is-ended{border-top:3px solid #a6a69e;background:#f3f3f0}
.is-ended .term-status{background:#e3e3dd;color:#63665e}
.is-ended .term-seal{border-color:#cccec5;background:#e8e9e3;color:#7b7e74}
.is-ended .letter-footer{background:#e5e6df;color:#6c7066}
.is-ended .reward-icon img{filter:saturate(.55)}
:global(.dark) .is-upcoming{border-top-color:#7fa9dc;background:#1e2d3b}
:global(.dark) .is-upcoming .term-status,:global(.dark) .is-upcoming .letter-footer{background:#2b4361;color:#c0daff}
:global(.dark) .is-upcoming .term-seal{background:#2b3e53;color:#c0daff;border-color:#587ba4}
:global(.dark) .is-ended{border-top-color:#7e847c;background:#242b27}
:global(.dark) .is-ended .term-status,:global(.dark) .is-ended .letter-footer{background:#363f38;color:#b6bdb2}
:global(.dark) .is-ended .term-seal{background:#353e36;color:#afb8a8;border-color:#566151}
</style>
