<script setup lang="ts">
import type { Account } from '@/stores/account'
import { computed } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { formatCouponAmount, formatGoldAmount, formatGoldBeanAmount } from '@/utils/number-format'

const props = withDefaults(defineProps<{
  status: any
  currentStatusReady: boolean
  currentAccount: Account | null | undefined
  dashboardItems: any[]
  illustratedLevels: { crop: number, mutant: number }
  localUptime: number
  compact?: boolean
  strip?: boolean
  statusError?: string
  statusLoading?: boolean
}>(), { compact: false })
const emit = defineEmits<{ retry: [] }>()
const currentAccountDisconnected = computed(() => props.currentStatusReady && !props.status?.connection?.connected)

const displayName = computed(() => {
  const account = props.currentAccount
  const gameName = props.currentStatusReady ? props.status?.status?.name : ''

  if (gameName) {
    if (account?.name)
      return `${gameName} (${account.name})`
    return gameName
  }

  if (currentAccountDisconnected.value) {
    if (account) {
      if (account.name && account.nick)
        return `${account.nick} (${account.name})`
      return account.name || account.nick || '未登录'
    }
    return '未登录'
  }

  if (account) {
    if (account.name && account.nick)
      return `${account.nick} (${account.name})`
    return account.name || account.nick || '未命名'
  }

  return '未命名'
})

const expRate = computed(() => {
  const gain = props.status?.sessionExpGained || 0
  const uptime = props.status?.uptime || 0
  if (!uptime)
    return '0/小时'
  const rate = gain / (uptime / 3600)
  return `${Math.floor(rate)}/小时`
})

const timeToLevel = computed(() => {
  const gain = props.status?.sessionExpGained || 0
  const uptime = props.status?.uptime || 0
  const current = props.status?.levelProgress?.current || 0
  const needed = props.status?.levelProgress?.needed || 0

  if (!needed || !uptime || gain <= 0)
    return ''

  const ratePerHour = gain / (uptime / 3600)
  if (ratePerHour <= 0)
    return ''

  const expNeeded = Math.max(0, needed - current)
  const minsToLevel = expNeeded / (ratePerHour / 60)

  if (minsToLevel < 60)
    return `约 ${Math.ceil(minsToLevel)} 分钟后升级`
  return `约 ${(minsToLevel / 60).toFixed(1)} 小时后升级`
})

const fertilizerNormal = computed(() => props.dashboardItems.find((item: any) => Number(item.id) === 1011))
const fertilizerOrganic = computed(() => props.dashboardItems.find((item: any) => Number(item.id) === 1012))

function formatBucketTime(item: any) {
  if (!item)
    return '0.0h'
  if (item.hoursText)
    return item.hoursText.replace('小时', 'h')
  return `${(Number(item.count || 0) / 3600).toFixed(1)}h`
}

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

function getExpPercent(progress: any) {
  if (!progress || !progress.needed)
    return 0
  return Math.min(100, Math.max(0, (progress.current / progress.needed) * 100))
}
</script>

<template>
  <section class="account-overview" :class="{ 'account-overview--compact': compact }" aria-label="账号与庄园资产" :aria-busy="!!currentAccount && !currentStatusReady && !statusError">
    <div v-if="!currentAccount" class="ui-card farm-state-panel">
      <span class="i-carbon-user-follow" aria-hidden="true" />
      <strong>开启你的庄园日常</strong>
      <p class="text-sm">
        从右上角添加账号，或在设置中管理已有账号。
      </p>
      <RouterLink to="/settings?tab=account" class="text-primary text-sm font-semibold">
        管理账号 →
      </RouterLink>
    </div>
    <div v-else-if="statusError" class="ui-card farm-state-panel" role="status">
      <span class="i-carbon-warning-alt text-amber-700" aria-hidden="true" />
      <strong>庄园状态暂时无法读取</strong>
      <p class="max-w-full break-words text-sm">
        {{ statusError }}
      </p>
      <BaseButton variant="secondary" size="sm" :loading="statusLoading" @click="emit('retry')">
        重新同步
      </BaseButton>
    </div>
    <div v-else-if="!currentStatusReady" class="overview-loading ui-card" role="status">
      <span class="text-primary i-svg-spinners-ring-resize text-xl" aria-hidden="true" />
      <div><strong>正在同步庄园</strong><p>等待当前账号状态</p></div>
    </div>
    <div v-else-if="currentAccountDisconnected" class="ui-card farm-state-panel">
      <span class="i-carbon-connection-signal-off" aria-hidden="true" />
      <strong>{{ displayName }} · 账号未连接</strong>
      <p class="text-sm">
        启动账号后，资产与成长数据会在这里更新。
      </p>
      <RouterLink to="/settings?tab=account" class="text-primary text-sm font-semibold">
        查看账号状态 →
      </RouterLink>
    </div>
    <div v-else-if="strip" class="personal-resource-strip">
      <div class="personal-resource-metrics">
        <div class="personal-resource personal-resource-level">
          <div><span>等级与成长</span><strong>Lv.{{ status?.status?.level || 0 }}</strong></div>
          <div class="personal-resource-exp">
            <small>{{ status?.levelProgress?.current || 0 }} / {{ status?.levelProgress?.needed || '—' }}</small><div class="overview-progress" role="progressbar" aria-label="账号成长进度" :aria-valuenow="getExpPercent(status?.levelProgress)" :aria-valuemin="0" :aria-valuemax="100">
              <span :style="{ width: `${getExpPercent(status?.levelProgress)}%` }" />
            </div>
          </div>
        </div>
        <div class="personal-resource">
          <img src="/game-config/resource-icons/gold.png" alt=""><div><span>金币</span><strong>{{ formatGoldAmount(status?.status?.gold || 0) }}</strong></div>
        </div>
        <div class="personal-resource">
          <img src="/game-config/resource-icons/coupon.png" alt=""><div><span>点券</span><strong>{{ formatCouponAmount(status?.status?.coupon || 0) }}</strong></div>
        </div>
        <div class="personal-resource">
          <img src="/game-config/resource-icons/fertilizer-normal.png" alt=""><div><span>普通化肥</span><strong>{{ formatBucketTime(fertilizerNormal) }}</strong></div>
        </div>
        <div class="personal-resource">
          <img src="/game-config/resource-icons/fertilizer-organic.png" alt=""><div><span>有机化肥</span><strong>{{ formatBucketTime(fertilizerOrganic) }}</strong></div>
        </div>
      </div>
      <details class="personal-resource-details">
        <summary><span class="personal-resource-account" :title="displayName">{{ displayName }}</span><span class="personal-resource-connection"><span class="h-1.5 w-1.5 rounded-full bg-green-600" />在线 · {{ formatDuration(localUptime) }}</span><span class="personal-resource-expand">资产与成长详情 <span class="i-carbon-chevron-down" aria-hidden="true" /></span></summary>
        <div class="personal-resource-more">
          <div><span>经验效率</span><strong>{{ expRate }}</strong><small>{{ timeToLevel || '持续成长中' }}</small></div>
          <div><span>钻石</span><strong>{{ formatCouponAmount(status?.status?.diamond || 0) }}</strong></div>
          <div><span>金豆</span><strong>{{ formatGoldBeanAmount(status?.status?.goldBean || 0) }}</strong></div>
          <div v-if="(status?.sessionGoldGained || 0) !== 0">
            <span>本次运行金币</span><strong>{{ status.sessionGoldGained > 0 ? '+' : '' }}{{ formatGoldAmount(status.sessionGoldGained) }}</strong>
          </div>
          <div v-if="(status?.sessionCouponGained || 0) !== 0">
            <span>本次运行点券</span><strong>{{ status.sessionCouponGained > 0 ? '+' : '' }}{{ formatCouponAmount(status.sessionCouponGained) }}</strong>
          </div>
          <div><span>作物图鉴</span><strong>Lv.{{ illustratedLevels.crop }}</strong></div>
          <div><span>超变图鉴</span><strong>Lv.{{ illustratedLevels.mutant }}</strong></div>
          <RouterLink to="/illustrated" class="text-primary personal-resource-collection">
            查看我的收藏 <span class="i-carbon-arrow-up-right" aria-hidden="true" />
          </RouterLink>
        </div>
      </details>
    </div>
    <div v-else class="overview-grid">
      <article class="ui-card overview-card overview-account">
        <div class="overview-label">
          <span class="flex items-center gap-1.5"><span class="i-carbon-user-avatar" aria-hidden="true" />当前账号</span><span class="overview-level">Lv.{{ status?.status?.level || 0 }}</span>
        </div>
        <h3 class="overview-name" :title="displayName">
          {{ displayName }}
        </h3>
        <div class="overview-exp-label">
          <span>成长进度</span><span>{{ status?.levelProgress?.current || 0 }} / {{ status?.levelProgress?.needed || '—' }}</span>
        </div>
        <div class="overview-progress" role="progressbar" aria-label="账号成长进度" :aria-valuenow="getExpPercent(status?.levelProgress)" :aria-valuemin="0" :aria-valuemax="100">
          <span :style="{ width: `${getExpPercent(status?.levelProgress)}%` }" />
        </div>
        <div class="overview-foot">
          <span>{{ expRate }}</span><span>{{ timeToLevel || '持续成长中' }}</span>
        </div>
      </article>
      <article class="ui-card overview-card">
        <div class="overview-label">
          <span>庄园资产</span><img src="/game-config/resource-icons/gold.png" alt="" class="overview-item-icon">
        </div>
        <div class="overview-main-value">
          {{ formatGoldAmount(status?.status?.gold || 0) }}<small>金币</small>
        </div>
        <div v-if="(status?.sessionGoldGained || 0) !== 0" class="overview-session" :class="status.sessionGoldGained > 0 ? 'text-green-700' : 'text-red-600'">
          本次运行 {{ status.sessionGoldGained > 0 ? '+' : '' }}{{ formatGoldAmount(status.sessionGoldGained) }}
        </div>
        <div class="overview-currencies">
          <div><img src="/game-config/resource-icons/coupon.png" alt="点券"><span>{{ formatCouponAmount(status?.status?.coupon || 0) }}</span><small>点券</small></div>
          <div><img src="/game-config/resource-icons/diamond.png" alt="钻石"><span>{{ formatCouponAmount(status?.status?.diamond || 0) }}</span><small>钻石</small></div>
          <div><img src="/game-config/resource-icons/gold-bean.png" alt="金豆"><span>{{ formatGoldBeanAmount(status?.status?.goldBean || 0) }}</span><small>金豆</small></div>
        </div>
        <div v-if="(status?.sessionCouponGained || 0) !== 0" class="overview-session" :class="status.sessionCouponGained > 0 ? 'text-green-700' : 'text-red-600'">
          本次点券 {{ status.sessionCouponGained > 0 ? '+' : '' }}{{ formatCouponAmount(status.sessionCouponGained) }}
        </div>
      </article>
      <article class="ui-card overview-card">
        <div class="overview-label">
          <span>化肥库存</span><img src="/game-config/resource-icons/fertilizer-normal.png" alt="" class="overview-item-icon">
        </div>
        <div class="overview-split">
          <div>
            <div class="overview-main-value">
              {{ formatBucketTime(fertilizerNormal) }}
            </div><span>普通化肥</span>
          </div>
          <div>
            <div class="overview-main-value">
              {{ formatBucketTime(fertilizerOrganic) }}
            </div><span>有机化肥</span>
          </div>
        </div>
        <div class="overview-foot">
          <span class="flex items-center gap-1.5"><span class="h-1.5 w-1.5 rounded-full bg-green-600" />账号在线</span><span class="tabular-nums">{{ formatDuration(localUptime) }}</span>
        </div>
      </article>
      <article class="ui-card overview-card">
        <div class="overview-label">
          <span>收藏与成长</span><span class="text-primary i-carbon-book text-lg" aria-hidden="true" />
        </div>
        <div class="overview-books">
          <div><img src="/game-config/resource-icons/illustrated-crop.png" alt=""><span>作物图鉴</span><strong>Lv.{{ illustratedLevels.crop }}</strong></div>
          <div><img src="/game-config/resource-icons/illustrated-mutant.png" alt=""><span>超变图鉴</span><strong>Lv.{{ illustratedLevels.mutant }}</strong></div>
        </div>
        <RouterLink to="/illustrated" class="overview-foot text-primary">
          查看我的收藏 <span aria-hidden="true">↗</span>
        </RouterLink>
      </article>
    </div>
  </section>
</template>

<style scoped>
.account-overview {
  flex-shrink: 0;
  min-width: 0;
}
.overview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.overview-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 20px;
}
.overview-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 24px;
  font-size: 12px;
  color: var(--muted-text);
}
.overview-item-icon {
  width: 26px;
  height: 26px;
  object-fit: contain;
}
.overview-level {
  padding: 4px 7px;
  border-radius: 6px;
  background: var(--surface-3);
  color: var(--theme-primary);
  font-size: 11px;
  white-space: nowrap;
}
.overview-name {
  overflow: hidden;
  margin: 12px 0 14px;
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.overview-exp-label {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px;
  font-size: 12px;
  color: var(--muted-text);
}
.overview-progress {
  height: 5px;
  overflow: hidden;
  margin: 8px 0 12px;
  border-radius: 8px;
  background: var(--surface-3);
}
.overview-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #7caa50;
  transition: width 250ms;
}
.overview-main-value {
  margin: 10px 0 9px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.overview-main-value small {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0;
  color: var(--muted-text);
}
.overview-session {
  margin-bottom: 8px;
  font-size: 12px;
}
.overview-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: auto;
  padding-top: 6px;
  color: var(--muted-text);
  font-size: 12px;
}
.overview-currencies {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: auto;
  padding-top: 9px;
  border-top: 1px solid var(--surface-border);
}
.overview-currencies div {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
}
.overview-currencies img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}
.overview-currencies span {
  overflow-wrap: anywhere;
}
.overview-currencies small {
  width: 100%;
  color: var(--muted-text);
  font-size: 12px;
  font-weight: 400;
}
.overview-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 20px;
}
.overview-split > div > span {
  font-size: 12px;
  color: var(--muted-text);
}
.overview-books {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 16px 0;
}
.overview-books > div {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.overview-books img {
  width: 24px;
  height: 24px;
  object-fit: contain;
}
.overview-books strong {
  margin-left: auto;
  font-size: 15px;
}
.overview-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  min-height: 150px;
  padding: 24px;
  font-size: 14px;
}
.overview-loading p {
  margin-top: 7px;
  font-size: 12px;
  color: var(--muted-text);
}
.account-overview--compact .overview-card {
  padding: 12px 14px;
}
.account-overview--compact .overview-grid {
  gap: 12px;
}
.account-overview--compact .overview-name {
  margin: 6px 0 8px;
  font-size: 17px;
}
.account-overview--compact .overview-main-value {
  margin: 6px 0;
  font-size: 23px;
}
.account-overview--compact .overview-progress {
  margin: 6px 0 8px;
  height: 4px;
}
.account-overview--compact .overview-split {
  gap: 8px;
  margin-bottom: 8px;
}
.account-overview--compact .overview-books {
  gap: 8px;
  margin: 8px 0;
}
.account-overview--compact .overview-currencies {
  padding-top: 6px;
}
.account-overview--compact .overview-item-icon {
  width: 22px;
  height: 22px;
}
@media (min-width: 1280px) {
  .overview-grid {
    grid-template-columns: 1.15fr 1.15fr 1fr 1fr;
  }
}
@media (max-width: 639px) {
  .overview-grid {
    gap: 10px;
  }
  .overview-card,
  .account-overview--compact .overview-card {
    padding: 12px;
  }
  .overview-name {
    font-size: 17px;
    margin-block: 12px;
  }
  .overview-main-value {
    font-size: 21px;
  }
  .overview-label {
    font-size: 12px;
  }
  .overview-currencies {
    grid-template-columns: 1fr;
    gap: 5px;
  }
  .overview-currencies small {
    width: auto;
    margin-left: auto;
  }
  .overview-split {
    gap: 6px;
  }
  .overview-split .overview-main-value {
    font-size: 17px;
  }
  .account-overview--compact .overview-grid {
    gap: 8px;
  }
  .account-overview--compact .overview-main-value {
    font-size: 20px;
  }
  .account-overview--compact .overview-split .overview-main-value {
    font-size: 18px;
  }
  .account-overview--compact .overview-currencies {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
  }
  .account-overview--compact .overview-currencies div {
    gap: 3px;
    font-size: 12px;
  }
  .account-overview--compact .overview-currencies small {
    margin-left: 0;
  }
}
.personal-resource-strip {
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  background: var(--surface-1);
  overflow: hidden;
}
.personal-resource-metrics {
  display: grid;
  grid-template-columns: 1.3fr repeat(4, minmax(0, 1fr));
  padding: 15px 8px;
}
.personal-resource {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-right: 1px solid var(--surface-border);
}
.personal-resource:last-child {
  border: 0;
}
.personal-resource img {
  width: 29px;
  height: 29px;
  object-fit: contain;
  flex-shrink: 0;
}
.personal-resource > div {
  min-width: 0;
}
.personal-resource span,
.personal-resource small {
  display: block;
  color: var(--muted-text);
  font-size: 12px;
}
.personal-resource strong {
  display: block;
  margin-top: 3px;
  font-size: 18px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.personal-resource-level {
  align-items: stretch;
  flex-direction: column;
  gap: 3px;
}
.personal-resource-level > div:first-child {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.personal-resource-level strong {
  margin: 0;
  font-size: 16px;
}
.personal-resource-exp .overview-progress {
  margin: 4px 0 0;
  height: 3px;
}
.personal-resource-details {
  border-top: 1px solid var(--surface-border);
  padding: 0 20px;
}
.personal-resource-details summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 16px;
  padding: 9px 0;
  list-style: none;
  cursor: pointer;
  font-size: 12px;
}
.personal-resource-details summary::-webkit-details-marker {
  display: none;
}
.personal-resource-account {
  max-width: 35%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.personal-resource-connection {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--muted-text);
  font-variant-numeric: tabular-nums;
}
.personal-resource-expand {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  color: var(--theme-primary);
}
.personal-resource-details[open] .personal-resource-expand > span {
  transform: rotate(180deg);
}
.personal-resource-more {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 16px;
  padding: 14px 0 18px;
  border-top: 1px solid var(--surface-border);
}
.personal-resource-more > div {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.personal-resource-more span,
.personal-resource-more small {
  color: var(--muted-text);
  font-size: 12px;
}
.personal-resource-more strong {
  font-size: 13px;
  font-weight: 600;
}
.personal-resource-collection {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
@media (max-width: 1100px) {
  .personal-resource {
    padding-inline: 10px;
    gap: 6px;
  }
  .personal-resource strong {
    font-size: 16px;
  }
  .personal-resource img {
    width: 24px;
    height: 24px;
  }
}
@media (max-width: 639px) {
  .personal-resource-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 0 14px;
  }
  .personal-resource {
    padding: 11px 4px;
    border: 0;
    border-top: 1px solid var(--surface-border);
  }
  .personal-resource-level {
    grid-column: 1 / -1;
    border-top: 0;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
  .personal-resource-level > div:first-child {
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
  }
  .personal-resource-exp {
    width: 45%;
  }
  .personal-resource:last-child {
    border-top: 1px solid var(--surface-border);
  }
  .personal-resource-details {
    padding-inline: 14px;
  }
  .personal-resource-account {
    max-width: 45%;
  }
  .personal-resource-connection {
    margin-left: auto;
  }
  .personal-resource-expand {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
