<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import DecorationGoodsCard from '@/components/shop/DecorationGoodsCard.vue'
import MallGoodsCard from '@/components/shop/MallGoodsCard.vue'
import MysteryGoodsCard from '@/components/shop/MysteryGoodsCard.vue'
import PetGoodsCard from '@/components/shop/PetGoodsCard.vue'
import PurchaseQuantityModal from '@/components/shop/PurchaseQuantityModal.vue'
import SeedGoodsCard from '@/components/shop/SeedGoodsCard.vue'
import ShopAccountHeader from '@/components/shop/ShopAccountHeader.vue'
import ShopEmptyState from '@/components/shop/ShopEmptyState.vue'
import ShopTabToolbar from '@/components/shop/ShopTabToolbar.vue'
import { createShopAvailability } from '@/composables/shop/useShopAvailability'
import { useAccountStore } from '@/stores/account'
import { useShopStore } from '@/stores/shop'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { formatCouponAmount, formatCurrencyAmountByLabel } from '@/utils/number-format'
import { groupMallGoods } from '@/utils/shop-presentation'

const accountStore = useAccountStore()
const shopStore = useShopStore()
const statusStore = useStatusStore()
const toast = useToastStore()
const route = useRoute()
const router = useRouter()

const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { status } = storeToRefs(statusStore)
const {
  seeds,
  pets,
  decorations,
  mallGoods,
  mysteryOffer,
  mysteryHistory,
  loading,
  petLoading,
  decorationLoading,
  mallLoading,
  mysteryLoading,
  error,
  petError,
  decorationError,
  mallError,
  mysteryError,
  userGoldBean,
  userDiamond,
} = storeToRefs(shopStore)

const tab = ref<'seed' | 'pet' | 'decoration' | 'mall' | 'mystery'>('mall')
const ascending = ref(true)
const FERTILIZER_MALL_GOODS_IDS = new Set([1002, 1003])
const SHOP_TABS = new Set(['seed', 'pet', 'decoration', 'mall', 'mystery'])
const mysteryAutoBuyEnabled = ref(false)
const nowSeconds = ref(Math.floor(Date.now() / 1000))
let mallExpiryTimer: ReturnType<typeof setInterval> | undefined

const showConfirm = ref(false)
const confirmTitle = ref('确认购买')
const confirmMessage = ref('')
const confirmLoading = ref(false)
const pendingAction = ref<null | (() => Promise<void>)>(null)
const quantityModal = ref({
  show: false,
  item: null as any,
  mode: 'shop' as 'shop' | 'mall',
  currencyLabel: '',
  balance: 0,
  maxQuantity: 99,
})

const currentLevel = computed(() => status.value?.status?.level || 0)
const currentGold = computed(() => status.value?.status?.gold || 0)
const currentCoupon = computed(() => status.value?.status?.coupon || 0)
const isAnyLoading = computed(() => loading.value || petLoading.value || decorationLoading.value || mallLoading.value || mysteryLoading.value)
const mysteryBalance = computed(() => {
  if (mysteryOffer.value?.currencyId === 1002)
    return currentCoupon.value
  if (mysteryOffer.value?.currencyId === 1005)
    return userGoldBean.value
  return currentGold.value
})
const mysteryHistorySummary = computed(() => {
  const currencyTotals = new Map<string, number>()
  for (const record of mysteryHistory.value) {
    currencyTotals.set(record.currencyName, (currencyTotals.get(record.currencyName) || 0) + record.price)
  }
  return [...currencyTotals.entries()].map(([name, amount]) => `${formatCurrencyAmountByLabel(amount, name)} ${name}`).join('、')
})

function formatHistoryTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}
const {
  canAffordGoods,
  canAffordDecoration,
  canAffordMall,
  getSeedHint,
  getPetHint,
  getDecorationHint,
  getMallHint,
  getSeedStatusLabel,
  getPetStatusLabel,
  getDecorationStatusLabel,
  getMallStatusLabel,
} = createShopAvailability({
  currentLevel: () => currentLevel.value,
  currentGold: () => currentGold.value,
  currentCoupon: () => currentCoupon.value,
  currentDiamond: () => userDiamond.value,
  userGoldBean: () => userGoldBean.value,
})

const sortedSeeds = computed(() => {
  return [...seeds.value].sort((a, b) => ascending.value ? a.seedLevel - b.seedLevel : b.seedLevel - a.seedLevel)
})
const visibleMallGoods = computed(() => mallGoods.value.filter(item => !item.endTime || nowSeconds.value <= item.endTime))

const mallGroups = computed(() => {
  const grouped = groupMallGoods(visibleMallGoods.value, canAffordMall)
  return [
    { key: 'available', title: '可购买', items: grouped.available },
    { key: 'unavailable', title: '暂不可购买', items: grouped.unavailable },
  ]
})

const activeError = computed(() => {
  if (tab.value === 'seed')
    return error.value
  if (tab.value === 'pet')
    return petError.value
  if (tab.value === 'decoration')
    return decorationError.value
  if (tab.value === 'mall')
    return mallError.value
  return mysteryError.value
})
const activeIsEmpty = computed(() => {
  if (tab.value === 'seed')
    return sortedSeeds.value.length === 0
  if (tab.value === 'pet')
    return pets.value.length === 0
  if (tab.value === 'decoration')
    return decorations.value.length === 0
  if (tab.value === 'mall')
    return visibleMallGoods.value.length === 0
  return !mysteryOffer.value?.active
})
const activeEmptyMessage = computed(() => {
  switch (tab.value) {
    case 'seed':
      return '暂无种子商品，先刷新商城数据。'
    case 'pet':
      return '暂无宠物商品。'
    case 'decoration':
      return '暂无装扮商品。'
    case 'mall':
      return '暂无道具商品。'
    case 'mystery':
      return '神秘商人暂未出现，请稍后刷新看看。'
  }
  return '暂无商品。'
})

function openConfirm(title: string, message: string, action: () => Promise<void>) {
  confirmTitle.value = title
  confirmMessage.value = message
  pendingAction.value = action
  showConfirm.value = true
}

async function runConfirmedAction() {
  if (!pendingAction.value)
    return
  confirmLoading.value = true
  try {
    await pendingAction.value()
    showConfirm.value = false
  }
  finally {
    confirmLoading.value = false
    pendingAction.value = null
  }
}

function closeConfirm() {
  if (confirmLoading.value)
    return
  showConfirm.value = false
  pendingAction.value = null
}

function closeQuantityModal() {
  if (confirmLoading.value)
    return
  quantityModal.value.show = false
  quantityModal.value.item = null
}

async function refreshAll() {
  if (!currentAccountId.value)
    return
  await shopStore.refreshAll(currentAccountId.value)
}

async function refreshMysteryAutoBuyStatus() {
  if (!currentAccountId.value) {
    mysteryAutoBuyEnabled.value = false
    return
  }
  const requestedAccountId = String(currentAccountId.value)
  try {
    const { data } = await api.get('/api/settings', {
      headers: { 'x-account-id': requestedAccountId },
    })
    if (String(currentAccountId.value || '') !== requestedAccountId)
      return
    mysteryAutoBuyEnabled.value = data?.data?.automation?.mystery_shop_auto_buy === true
  }
  catch {
    if (String(currentAccountId.value || '') === requestedAccountId)
      mysteryAutoBuyEnabled.value = false
  }
}

function openMysteryAutoBuySettings() {
  router.push({ path: '/settings', query: { tab: 'automation' } })
}

function syncTabFromRouteQuery() {
  const queryTab = String(route.query.tab || '')
  if (SHOP_TABS.has(queryTab))
    tab.value = queryTab as typeof tab.value
}

async function buyGoods(item: any, quantity = 1) {
  if (!currentAccountId.value)
    return
  const result = await shopStore.buyGoods(currentAccountId.value, item.id, quantity, item.price)
  if (result?.ok) {
    toast.success(`已购买 ${item.name} x${quantity}`)
    await refreshAll()
  }
  else {
    toast.error(result?.error || '购买失败')
  }
}

async function buyMallGoods(item: any, quantity = 1) {
  if (!currentAccountId.value)
    return
  const result = await shopStore.buyMallGoods(currentAccountId.value, item.goodsId, quantity)
  if (result?.ok) {
    toast.success(`已购买 ${item.name} x${quantity}`)
    await refreshAll()
  }
  else {
    toast.error(result?.error || '购买失败')
  }
}

async function buyMysteryGoods(item: any) {
  if (!currentAccountId.value)
    return
  const result = await shopStore.buyMysteryShopGoods(currentAccountId.value, item.npcId)
  if (result?.ok) {
    const count = Number(result.data?.reward?.count || item.itemCount || 0)
    toast.success(`已从神秘商人处购买 ${item.itemName} x${count}`)
    await shopStore.fetchMysteryShop(currentAccountId.value)
    await shopStore.fetchMysteryHistory(currentAccountId.value)
  }
  else {
    toast.error(result?.error || '购买失败')
  }
}

function confirmBuyMysteryGoods(item: any) {
  openConfirm(
    '确认购买神秘商品',
    `确定购买 ${item.itemName} x${item.itemCount} 吗？
价格：${formatCurrencyAmountByLabel(item.price || 0, item.currencyName)} ${item.currencyName}
购买完成后神秘商人将离开。`,
    () => buyMysteryGoods(item),
  )
}

async function abandonMysteryMerchant() {
  if (!currentAccountId.value)
    return
  const result = await shopStore.abandonMysteryShop(currentAccountId.value)
  if (result?.ok) {
    toast.success('已请离神秘商人')
    await shopStore.fetchMysteryShop(currentAccountId.value)
  }
  else {
    toast.error(result?.error || '请离失败')
  }
}

function confirmAbandonMysteryMerchant() {
  openConfirm(
    '请离神秘商人',
    '确定请离当前神秘商人吗？请离后本次商品将无法购买。',
    abandonMysteryMerchant,
  )
}

function getShopMaxQuantity(item: any, balance: number) {
  const price = Number(item?.price || 0)
  const byBalance = price > 0 ? Math.floor(Number(balance || 0) / price) : 99
  const limitCount = Number(item?.limitCount || 0)
  const boughtNum = Number(item?.boughtNum || 0)
  const byLimit = limitCount > 0 ? Math.max(0, limitCount - boughtNum) : 99
  return Math.max(1, Math.min(99, byBalance, byLimit))
}

function openQuantityModal(item: any, mode: 'shop' | 'mall', currencyLabel: string, balance: number) {
  quantityModal.value = {
    show: true,
    item,
    mode,
    currencyLabel,
    balance,
    maxQuantity: getShopMaxQuantity(item, balance),
  }
}

async function runQuantityPurchase(quantity: number) {
  const target = quantityModal.value.item
  if (!target)
    return
  confirmLoading.value = true
  try {
    if (quantityModal.value.mode === 'mall')
      await buyMallGoods(target, quantity)
    else
      await buyGoods(target, quantity)
    closeQuantityModal()
  }
  finally {
    confirmLoading.value = false
  }
}

function confirmBuySeedGoods(item: any) {
  openQuantityModal(item, 'shop', '金币', currentGold.value)
}

function confirmBuyGoods(item: any, currencyLabel: string) {
  openConfirm(
    '确认购买',
    `确定购买 ${item.name} 吗？
价格：${formatCurrencyAmountByLabel(item.price || 0, currencyLabel)} ${currencyLabel}`,
    () => buyGoods(item),
  )
}

function confirmBuyMallGoods(item: any) {
  if (FERTILIZER_MALL_GOODS_IDS.has(Number(item.goodsId))) {
    openQuantityModal(item, 'mall', '点券', currentCoupon.value)
    return
  }

  const currencyName = item.currencyName || '点券'
  const priceText = item.isFree ? '免费' : `${formatCouponAmount(item.price || 0)} ${currencyName}`
  openConfirm(
    '确认购买',
    `确定购买 ${item.name} 吗？
价格：${priceText}`,
    () => buyMallGoods(item),
  )
}

watch(currentAccountId, () => {
  shopStore.clearShopData()
  refreshAll()
  refreshMysteryAutoBuyStatus()
})

watch(
  () => route.query.tab,
  () => syncTabFromRouteQuery(),
)

onMounted(() => {
  syncTabFromRouteQuery()
  refreshAll()
  refreshMysteryAutoBuyStatus()
  mallExpiryTimer = setInterval(() => {
    nowSeconds.value = Math.floor(Date.now() / 1000)
  }, 1000)
})

onUnmounted(() => {
  if (mallExpiryTimer)
    clearInterval(mallExpiryTimer)
})
</script>

<template>
  <section class="shop-page space-y-4">
    <div class="shop-body">
      <div class="shop-intro">
        <ShopAccountHeader
          :account-name="currentAccount?.name"
          :level="currentLevel"
          :gold="currentGold"
          :coupon="currentCoupon"
          :diamond="userDiamond"
          :gold-bean="userGoldBean"
        />

        <ShopTabToolbar
          v-model:tab="tab"
          :ascending="ascending"
          :loading="isAnyLoading"
          :disabled="!currentAccountId"
          @toggle-ascending="ascending = !ascending"
          @refresh="refreshAll"
        />
      </div>

      <div v-if="!currentAccountId" class="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
        请先选择账号，再查看商城。
      </div>

      <div v-else-if="isAnyLoading && activeIsEmpty" class="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
        正在加载当前分区商品...
      </div>

      <div v-else-if="activeError && activeIsEmpty" class="rounded-lg bg-red-50 p-8 text-center text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
        {{ activeError }}
      </div>

      <div v-else-if="tab === 'seed'" class="space-y-4">
        <div v-if="error" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {{ error }}
        </div>
        <ShopEmptyState v-if="!sortedSeeds.length" :message="activeEmptyMessage" />
        <div class="shop-product-grid">
          <SeedGoodsCard
            v-for="item in sortedSeeds"
            :key="item.id"
            :item="item"
            :current-level="currentLevel"
            :can-afford="canAffordGoods(item)"
            :status-label="getSeedStatusLabel(item)"
            :hint="getSeedHint(item)"
            @buy="confirmBuySeedGoods"
          />
        </div>
      </div>

      <div v-else-if="tab === 'pet'" class="space-y-4">
        <div v-if="petError" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {{ petError }}
        </div>
        <ShopEmptyState v-if="!pets.length" :message="activeEmptyMessage" />
        <div class="shop-product-grid">
          <PetGoodsCard
            v-for="item in pets"
            :key="item.id"
            :item="item"
            :current-level="currentLevel"
            :can-afford="canAffordGoods(item)"
            :status-label="getPetStatusLabel(item)"
            :hint="getPetHint(item)"
            @buy="confirmBuyGoods"
          />
        </div>
      </div>

      <div v-else-if="tab === 'decoration'" class="space-y-4">
        <div v-if="decorationError" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {{ decorationError }}
        </div>
        <ShopEmptyState v-if="!decorations.length" :message="activeEmptyMessage" />
        <div class="shop-product-grid">
          <DecorationGoodsCard
            v-for="item in decorations"
            :key="item.id"
            :item="item"
            :can-afford="canAffordDecoration(item)"
            :status-label="getDecorationStatusLabel(item)"
            :hint="getDecorationHint(item)"
            @buy="confirmBuyGoods($event, '金豆豆')"
          />
        </div>
      </div>

      <div v-else-if="tab === 'mall'" class="space-y-4">
        <div v-if="mallError" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {{ mallError }}
        </div>
        <ShopEmptyState v-if="!visibleMallGoods.length" :message="activeEmptyMessage" />
        <template v-if="visibleMallGoods.length">
          <section v-for="group in mallGroups" :key="group.key" class="shop-goods-section" :class="`shop-goods-section--${group.key}`" :aria-label="group.title">
            <div class="shop-group-heading">
              <h2>{{ group.title }} <span>{{ group.items.length }}</span></h2><p>{{ group.key === 'available' ? '当前符合购买条件' : '购买条件与不可购买原因见商品卡片' }}</p>
            </div>
            <div class="shop-product-grid">
              <MallGoodsCard
                v-for="item in group.items"
                :key="item.goodsId"
                :item="item"
                :can-afford="canAffordMall(item)"
                :status-label="getMallStatusLabel(item)"
                :hint="getMallHint(item)"
                @buy="confirmBuyMallGoods"
              />
            </div>
            <div v-if="!group.items.length" class="shop-group-empty">
              {{ group.key === 'available' ? '当前没有可购买的道具' : '当前商品均可购买' }}
            </div>
          </section>
        </template>
      </div>

      <div v-else class="space-y-4">
        <div class="flex items-center justify-between gap-3 border border-gray-200 rounded-xl bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/30">
          <div class="min-w-0 flex items-center gap-2 text-sm">
            <span :class="mysteryAutoBuyEnabled ? 'i-carbon-checkmark-filled text-green-500' : 'i-carbon-pause-filled text-gray-400'" />
            <span class="text-gray-700 dark:text-gray-200">
              神秘商人自动购买{{ mysteryAutoBuyEnabled ? '已开启' : '未开启' }}
            </span>
          </div>
          <button class="shrink-0 text-sm text-blue-600 font-medium dark:text-blue-400 hover:underline" type="button" @click="openMysteryAutoBuySettings">
            前往设置
          </button>
        </div>
        <div v-if="mysteryError" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {{ mysteryError }}
        </div>
        <ShopEmptyState v-if="!mysteryOffer?.active" :message="activeEmptyMessage" />
        <MysteryGoodsCard
          v-else
          :offer="mysteryOffer"
          :balance="mysteryBalance"
          :loading="confirmLoading"
          @buy="confirmBuyMysteryGoods"
          @abandon="confirmAbandonMysteryMerchant"
        />
        <div class="overflow-hidden border border-gray-200 rounded-xl dark:border-gray-700">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/30">
            <div>
              <h3 class="text-sm text-gray-900 font-semibold dark:text-gray-100">
                购买历史
              </h3>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                共 {{ mysteryHistory.length }} 次<span v-if="mysteryHistorySummary">，累计花费 {{ mysteryHistorySummary }}</span>
              </p>
            </div>
            <span class="text-xs text-gray-400">保留最近 100 条</span>
          </div>
          <div v-if="!mysteryHistory.length" class="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            暂无购买记录，手动和自动购买都会记录在这里。
          </div>
          <div v-else class="divide-y divide-gray-100 dark:divide-gray-700">
            <div v-for="record in mysteryHistory" :key="record.id" class="flex items-center gap-3 px-4 py-3">
              <img v-if="record.itemImage" :src="record.itemImage" :alt="record.itemName" class="h-10 w-10 shrink-0 object-contain">
              <div v-else class="i-carbon-gift h-10 w-10 shrink-0 text-gray-300" />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm text-gray-800 font-medium dark:text-gray-100">
                  {{ record.itemName }} x{{ record.itemCount }}
                </div>
                <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {{ formatHistoryTime(record.purchasedAt) }} · {{ record.source === 'auto' ? '自动购买' : '手动购买' }}
                </div>
              </div>
              <div class="shrink-0 text-right">
                <div class="text-sm text-gray-700 font-medium dark:text-gray-200">
                  {{ formatCurrencyAmountByLabel(record.price, record.currencyName) }} {{ record.currencyName }}
                </div>
                <div v-if="record.discount" class="mt-1 text-xs text-orange-500">
                  {{ record.discount / 10 }} 折
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="showConfirm"
      :title="confirmTitle"
      :message="confirmMessage"
      :loading="confirmLoading"
      @confirm="runConfirmedAction"
      @close="closeConfirm"
      @cancel="closeConfirm"
    />
    <PurchaseQuantityModal
      :show="quantityModal.show"
      :item-name="quantityModal.item?.name || ''"
      :unit-price="Number(quantityModal.item?.price || 0)"
      :currency-label="quantityModal.currencyLabel"
      :balance="quantityModal.balance"
      :max-quantity="quantityModal.maxQuantity"
      :loading="confirmLoading"
      :is-free="!!quantityModal.item?.isFree"
      @confirm="runQuantityPurchase"
      @close="closeQuantityModal"
      @cancel="closeQuantityModal"
    />
  </section>
</template>

<style scoped>
.shop-body {
  min-width: 0;
}
.shop-intro {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-bottom: 22px;
}
.shop-product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(205px, 1fr));
  gap: 14px;
  align-items: stretch;
}
.shop-goods-section + .shop-goods-section {
  margin-top: 24px;
}
.shop-group-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 14px;
}
.shop-group-heading h2 {
  font-size: 15px;
  font-weight: 650;
}
.shop-group-heading h2 span {
  margin-left: 6px;
  padding: 2px 7px;
  border-radius: 20px;
  background: #e7efdf;
  color: var(--theme-primary);
  font-size: 10px;
}
.shop-group-heading p {
  color: var(--muted-text);
  font-size: 11px;
}
.shop-group-empty {
  padding: 18px;
  border: 1px dashed var(--surface-border);
  border-radius: 12px;
  color: var(--muted-text);
  font-size: 12px;
}
.shop-goods-section--unavailable :deep(.farm-product) {
  background: var(--surface-2);
}
@media (max-width: 639px) {
  .shop-product-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .shop-group-heading p {
    font-size: 10px;
  }
}
</style>
