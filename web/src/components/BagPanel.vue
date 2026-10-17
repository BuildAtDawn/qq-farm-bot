<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { getSeedLockUids, isBagItemLocked } from '@/utils/bag-lock'
import { fertilizerUsePreview, formatFertilizerHours } from '@/utils/fertilizer-preview'
import { formatCurrencyAmountByLabel, formatGoldAmount, formatGoldBeanAmount } from '@/utils/number-format'

const accountStore = useAccountStore()
const bagStore = useBagStore()
const statusStore = useStatusStore()
const toastStore = useToastStore()

const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { items, loading: bagLoading, originalItems } = storeToRefs(bagStore)
const { status, loading: statusLoading, error: statusError, realtimeConnected, currentStatusReady } = storeToRefs(statusStore)

const imageErrors = ref<Record<string | number, boolean>>({})
const bagLoaded = ref(false)

const CATEGORY_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '果实', value: 'fruit' },
  { label: '种子', value: 'seed' },
  { label: '道具', value: 'tool' },
  { label: '其他', value: 'other' },
] as const

type CategoryValue = typeof CATEGORY_OPTIONS[number]['value']

const selectedCategory = ref<CategoryValue>('seed')

function itemImage(item: any) {
  return item?.image || (Number(item?.id) === 6001 ? '/activity/wish-sign/firework.png' : '')
}

function itemType(item: any) {
  return Number(item?.itemType) || (Number(item?.id) === 6001 ? 23 : 0)
}

function getItemCategory(item: any): CategoryValue {
  if (item?.category === 'seed')
    return 'seed'
  if (item?.category === 'fruit')
    return 'fruit'
  const type = itemType(item)
  if (type === 17 || type === 6)
    return 'fruit'
  if (type === 5)
    return 'seed'
  if (type === 11 || Number(item?.id) === 6001)
    return 'tool'
  return 'other'
}

const filteredItems = computed(() => {
  if (selectedCategory.value === 'all')
    return items.value
  return items.value.filter((item: any) => getItemCategory(item) === selectedCategory.value)
})

const categoryCounts = computed(() => {
  const counts: Record<CategoryValue, number> = { all: items.value.length, fruit: 0, seed: 0, tool: 0, other: 0 }
  for (const item of items.value) {
    const cat = getItemCategory(item)
    counts[cat]++
  }
  return counts
})

const confirmModal = ref({
  show: false,
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  loading: false,
  action: '' as 'sell' | 'use' | 'batchSell',
  item: null as any,
  selectedItems: [] as any[],
})

const confirmationAccountId = ref('')
const operationPending = ref(false)
const fertilizerDialog = ref({ show: false, item: null as any, accountId: '', loading: false, submitting: false, count: 0, error: '' })
let fertilizerPreviewSequence = 0
let disposed = false
const fertilizerPreview = computed(() => fertilizerUsePreview(
  fertilizerDialog.value.item,
  bagStore.fertilizerContainers,
  originalItems.value,
  fertilizerDialog.value.count,
))

function isFertilizerRefill(item: any) {
  return !!item?.fertilizerRefill || ['fertilizer', 'fertilizerpro'].includes(item?.interactionType)
}

function closeFertilizerDialog() {
  if (fertilizerDialog.value.submitting)
    return
  fertilizerPreviewSequence++
  fertilizerDialog.value.show = false
}

async function refreshFertilizerPreview(initial = false) {
  const dialog = fertilizerDialog.value
  const sequence = ++fertilizerPreviewSequence
  dialog.loading = true
  dialog.error = ''
  try {
    await bagStore.fetchBag(dialog.accountId, true)
    if (disposed || sequence !== fertilizerPreviewSequence || dialog.accountId !== currentAccountId.value || !dialog.show)
      return
    if (bagStore.loadedAccountId !== dialog.accountId || bagStore.error)
      throw new Error(bagStore.error || '背包读取失败，请重新读取')
    const latest = items.value.find(row => Number(row.id) === Number(dialog.item.id))
    if (!latest?.fertilizerRefill)
      throw new Error('未读取到可用化肥及容量数据，请确认后端已更新后重试')
    dialog.item = latest
    const maxCount = fertilizerPreview.value?.maxCount || 0
    dialog.count = initial || dialog.count < 1 ? maxCount : Math.min(Math.max(0, Math.floor(dialog.count)), maxCount)
  }
  catch (error: any) {
    if (!disposed && sequence === fertilizerPreviewSequence && dialog.accountId === currentAccountId.value)
      dialog.error = error.message || '预览读取失败'
  }
  finally {
    if (sequence === fertilizerPreviewSequence)
      dialog.loading = false
  }
}

async function confirmFertilizerUse() {
  const dialog = fertilizerDialog.value
  const accountId = dialog.accountId
  if (!dialog.show || disposed || !accountId || accountId !== currentAccountId.value || dialog.loading
    || dialog.submitting || operationPending.value || dialog.error || !fertilizerPreview.value?.valid) {
    return
  }
  operationPending.value = true
  dialog.submitting = true
  try {
    const result = await bagStore.useItem(accountId, Number(dialog.item.id), dialog.count, 0)
    if (disposed || accountId !== currentAccountId.value)
      return
    if (!result.ok)
      throw new Error(result.error || '使用失败')
    toastStore.success(result.data?.message || `已使用 ${dialog.item.name} ×${dialog.count}`)
    dialog.show = false
    await bagStore.fetchBag(accountId, true)
  }
  catch (error: any) {
    if (!disposed && accountId === currentAccountId.value) {
      await refreshFertilizerPreview()
      dialog.error = error.response?.data?.error || error.message || '使用失败，请重新确认预览'
    }
  }
  finally {
    dialog.submitting = false
    operationPending.value = false
  }
}
const batchAction = ref<'sell' | 'lock' | 'unlock'>('sell')
const batchMode = ref(false)
const selectedForBatch = ref<Set<number>>(new Set())
const batchSellResult = ref<{ gold: number, goldBean: number } | null>(null)

const selectedSellableCount = computed(() => {
  return selectedForBatch.value.size
})

function getPriceClass(item: any) {
  const priceId = Number(item?.priceId || 0)
  if (priceId === 1005)
    return 'text-amber-400 dark:text-amber-300'
  if (priceId === 1002)
    return 'text-sky-400 dark:text-sky-300'
  return 'text-gray-400'
}

function canSell(item: any) {
  const itemType = Number(item?.itemType || 0)
  return !item?.locked && (Boolean(item?.sellable) || itemType === 17 || itemType === 6)
}

function canBatchSell(item: any) {
  return canSell(item) && Number(item.count || 0) > 0
}

function canUse(item: any) {
  return !item?.locked && (Boolean(item?.usable) || itemType(item) === 11 || Number(item?.id) === 6001)
}

function canChangeSeedLock(item: any, locked: boolean) {
  return getItemCategory(item) === 'seed'
    && getSeedLockUids(originalItems.value, [Number(item.id)], locked).length > 0
}

function canSelectForBatch(item: any) {
  return batchAction.value === 'sell' ? canBatchSell(item) : canChangeSeedLock(item, batchAction.value === 'lock')
}

async function handleSeedLockClick(locked: boolean, item?: any) {
  const accountId = currentAccountId.value
  if (operationPending.value || bagLoading.value || !accountId)
    return
  const seeds = item ? [item] : filteredItems.value.filter(seed => selectedForBatch.value.has(Number(seed.id)))
  const eligible = seeds.filter(seed => canChangeSeedLock(seed, locked))
  const uids = getSeedLockUids(originalItems.value, eligible.map(seed => Number(seed.id)), locked)
  if (!uids.length) {
    toastStore.warning('请先选择可操作的种子')
    return
  }
  operationPending.value = true
  try {
    const res = await bagStore.setItemsLocked(accountId, uids, locked)
    if (currentAccountId.value !== accountId)
      return
    if (!res.ok) {
      toastStore.error(res.error || '操作失败')
      return
    }
    toastStore.success(`已${locked ? '上锁' : '解锁'} ${res.data?.changed ?? uids.length} 项种子库存`)
    selectedForBatch.value.clear()
    batchMode.value = false
    await bagStore.fetchBag(accountId, true)
  }
  catch (error: any) {
    if (currentAccountId.value === accountId)
      toastStore.error(`操作失败: ${error.message || '未知错误'}`)
  }
  finally {
    operationPending.value = false
  }
}

function handleSellClick(item: any) {
  if (operationPending.value)
    return
  confirmationAccountId.value = currentAccountId.value
  if (batchMode.value) {
    const isSelected = selectedForBatch.value.has(Number(item.id))
    if (isSelected) {
      selectedForBatch.value.delete(Number(item.id))
    }
    else {
      selectedForBatch.value.add(Number(item.id))
    }
    return
  }
  const totalPrice = (Number(item.count) || 0) * (Number(item.price) || 0)
  const priceUnit = item.priceUnit || '金'
  const messages = [
    `确定要出售全部${item.name || `物品${item.id}`}吗?`,
    `数量：${item.count || 0}`,
  ]
  if (totalPrice > 0) {
    messages.push(`售出总金币：${formatCurrencyAmountByLabel(totalPrice, priceUnit)}${priceUnit}`)
  }
  confirmModal.value = {
    show: true,
    title: '确认出售',
    message: messages.join('\n'),
    type: 'danger',
    loading: false,
    action: 'sell',
    item,
    selectedItems: [],
  }
}

async function handleUseClick(item: any) {
  if (operationPending.value || fertilizerDialog.value.show)
    return
  if (isFertilizerRefill(item)) {
    if (!currentAccountId.value)
      return
    fertilizerDialog.value = { show: true, item, accountId: currentAccountId.value, loading: false, submitting: false, count: 0, error: '' }
    await refreshFertilizerPreview(true)
    return
  }
  confirmationAccountId.value = currentAccountId.value
  const count = Number(item.id) === 6001 ? 1 : Number(item.count || 1)
  confirmModal.value = {
    show: true,
    title: '确认使用',
    message: `确定要使用${Number(item.id) === 6001 ? '一枚' : '全部'} ${item.name || `物品${item.id}`} 吗?\n数量：${count}`,
    type: 'primary',
    loading: false,
    action: 'use',
    item,
    selectedItems: [],
  }
}

async function handleConfirm() {
  const { action, item, selectedItems } = confirmModal.value
  const accountId = confirmationAccountId.value
  if (!accountId || accountId !== currentAccountId.value || operationPending.value)
    return

  operationPending.value = true
  confirmModal.value.loading = true
  try {
    if (action === 'sell' && item) {
      const sellItems = originalItems.value
        .filter((it: any) => !isBagItemLocked(it) && Number(it.id) === Number(item.id))
        .map((it: any) => ({ id: it.id, count: it.count, uid: it.uid || 0 }))

      if (sellItems.length === 0) {
        toastStore.error('未找到可出售的物品')
        return
      }

      const res = await bagStore.sellItems(accountId, sellItems)
      if (res.ok) {
        toastStore.success(`已出售 ${item.name || `物品${item.id}`}`)
        await bagStore.fetchBag(accountId)
      }
      else {
        toastStore.error(`出售失败: ${res.error || '未知错误'}`)
      }
    }
    else if (action === 'batchSell' && selectedItems) {
      const itemsToSell = originalItems.value
        .filter((it: any) => !isBagItemLocked(it) && selectedItems.some((si: any) => Number(si.id) === Number(it.id)))
        .map((it: any) => ({ id: it.id, count: it.count, uid: it.uid || 0 }))

      if (itemsToSell.length === 0) {
        toastStore.error('未找到可出售的物品')
        return
      }

      const res = await bagStore.sellItems(accountId, itemsToSell)
      if (res.ok) {
        let totalGold = 0
        let totalGoldBean = 0
        for (const si of selectedItems) {
          const fi = filteredItems.value.find((f: any) => Number(f.id) === Number(si.id))
          if (fi) {
            const price = Number(fi.price) || 0
            const count = Number(fi.count) || 0
            const priceId = Number(fi.priceId) || 0
            if (priceId === 1005) {
              totalGoldBean += price * count
            }
            else {
              totalGold += price * count
            }
          }
        }
        batchSellResult.value = { gold: totalGold, goldBean: totalGoldBean }
        toastStore.success(`已批量出售 ${selectedItems.length} 种物品，获得 ${formatGoldAmount(totalGold)} 金币, ${formatGoldBeanAmount(totalGoldBean)} 金豆豆`)
        selectedForBatch.value.clear()
        batchMode.value = false
        await bagStore.fetchBag(accountId)
      }
      else {
        toastStore.error(`批量出售失败: ${res.error || '未知错误'}`)
      }
    }
    else if (action === 'use' && item) {
      const sourceItem = originalItems.value.find((it: any) => Number(it.id) === Number(item.id))
      const res = await bagStore.useItem(
        accountId,
        Number(item.id),
        Number(item.id) === 6001 ? 1 : Number(item.count || 1),
        Number(sourceItem?.uid || 0),
      )
      if (res.ok) {
        toastStore.success(res.data?.message || `已使用 ${item.name || `物品${item.id}`}`)
        await bagStore.fetchBag(accountId)
      }
      else {
        toastStore.error(`使用失败: ${res.error || '未知错误'}`)
      }
    }
  }
  catch (e: any) {
    toastStore.error(`操作失败: ${e.message || '未知错误'}`)
  }
  finally {
    operationPending.value = false
    confirmModal.value.loading = false
    confirmModal.value.show = false
  }
}

function handleCancel() {
  confirmModal.value.show = false
}

function toggleBatchMode(action: 'sell' | 'lock' | 'unlock' = 'sell') {
  batchMode.value = !batchMode.value || batchAction.value !== action
  batchAction.value = action
  selectedForBatch.value.clear()
  if (!batchMode.value) {
    selectedForBatch.value.clear()
    batchSellResult.value = null
  }
}

function selectAllSellable() {
  selectedForBatch.value.clear()
  for (const item of filteredItems.value) {
    if (canSelectForBatch(item)) {
      selectedForBatch.value.add(Number(item.id))
    }
  }
}

function handleBatchSellClick() {
  confirmationAccountId.value = currentAccountId.value
  const sellableItems = filteredItems.value.filter((item: any) => canBatchSell(item))
  if (sellableItems.length === 0) {
    toastStore.warning('没有可批量出售的物品')
    return
  }
  const selectedList = Array.from(selectedForBatch.value)
  if (selectedList.length === 0) {
    toastStore.warning('请先选择要出售的物品')
    return
  }

  const itemsToSell = originalItems.value
    .filter((it: any) => selectedList.includes(Number(it.id)))
    .map((it: any) => ({ id: it.id, count: it.count, uid: it.uid || 0 }))

  let totalGold = 0
  let totalGoldBean = 0
  for (const it of itemsToSell) {
    const item = filteredItems.value.find((f: any) => Number(f.id) === Number(it.id))
    if (item) {
      const price = Number(item.price) || 0
      const count = Number(item.count) || 0
      const priceId = Number(item.priceId) || 0
      if (priceId === 1005) {
        totalGoldBean += price * count
      }
      else {
        totalGold += price * count
      }
    }
  }

  const messages = [
    `确定要批量出售选中的 ${selectedList.length} 种物品吗?`,
  ]
  if (totalGold > 0) {
    messages.push(`金币：${formatGoldAmount(totalGold)}`)
  }
  if (totalGoldBean > 0) {
    messages.push(`金豆豆：${formatGoldBeanAmount(totalGoldBean)}`)
  }

  confirmModal.value = {
    show: true,
    title: '批量出售',
    message: messages.join('\n'),
    type: 'danger',
    loading: false,
    action: 'batchSell',
    item: null,
    selectedItems: itemsToSell,
  }
}

async function loadBag() {
  if (!currentAccountId.value)
    return

  const acc = currentAccount.value
  if (!acc)
    return

  try {
    if (!realtimeConnected.value)
      await statusStore.fetchStatus(currentAccountId.value)

    if (acc.running)
      await bagStore.fetchBag(currentAccountId.value)
  }
  finally {
    bagLoaded.value = true
  }

  imageErrors.value = {}
}

const showInitialLoading = computed(() =>
  !bagLoaded.value && (bagLoading.value || statusLoading.value),
)

watch(currentAccountId, (newId, oldId) => {
  if (oldId !== undefined && newId !== oldId) {
    confirmationAccountId.value = ''
    confirmModal.value.show = false
    fertilizerPreviewSequence++
    fertilizerDialog.value.show = false
    selectedForBatch.value.clear()
    batchMode.value = false
    bagLoaded.value = false
    bagStore.clearBag()
    statusStore.clearAccountScopedData()
  }
  loadBag()
}, { immediate: true })

watch(selectedCategory, () => {
  batchMode.value = false
  selectedForBatch.value.clear()
})

watch(() => currentAccount.value?.running, () => {
  loadBag()
})

useIntervalFn(loadBag, 60000)
onUnmounted(() => {
  disposed = true
  fertilizerPreviewSequence++
})
</script>

<template>
  <div class="space-y-4">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="flex items-center gap-2 text-2xl font-bold">
        <div class="i-carbon-inventory-management" />
        背包
      </h2>
      <div v-if="items.length" class="text-sm text-gray-500">
        共 {{ items.length }} 种物品
      </div>
    </div>

    <div v-if="showInitialLoading" class="flex justify-center py-12">
      <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
    </div>

    <div v-else-if="!currentAccountId" class="farm-content-card rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      请选择账号后查看背包
    </div>

    <div v-else-if="statusError && items.length === 0" class="border border-red-200 rounded-lg bg-red-50 p-8 text-center text-red-500 shadow dark:border-red-800 dark:bg-red-900/20">
      <div class="mb-2 text-lg font-bold">
        获取数据失败
      </div>
      <div class="text-sm">
        {{ statusError }}
      </div>
    </div>

    <div v-else-if="currentStatusReady && !status?.connection?.connected && items.length === 0" class="farm-content-card flex flex-col items-center justify-center gap-4 rounded-lg bg-white p-12 text-center text-gray-500 shadow dark:bg-gray-800">
      <div class="i-carbon-connection-signal-off text-4xl text-gray-400" />
      <div>
        <div class="text-lg text-gray-700 font-medium dark:text-gray-300">
          账号未登录
        </div>
        <div class="mt-1 text-sm text-gray-400">
          请先运行账号或检查网络连接
        </div>
      </div>
    </div>

    <div v-else-if="items.length === 0" class="farm-content-card rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      无可展示物品
    </div>

    <div v-else>
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <button
          v-for="cat in CATEGORY_OPTIONS"
          :key="cat.value"
          class="rounded-lg px-3 py-1.5 text-sm font-medium transition"
          :class="selectedCategory === cat.value
            ? 'bg-blue-500 text-white dark:bg-blue-600'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
          @click="selectedCategory = cat.value"
        >
          {{ cat.label }}
          <span class="ml-1 text-xs opacity-70">({{ categoryCounts[cat.value] || 0 }})</span>
        </button>

        <div class="flex-1" />

        <template v-if="selectedCategory === 'fruit' || selectedCategory === 'all'">
          <button
            class="rounded-lg px-3 py-1.5 text-sm font-medium transition"
            :class="batchMode && batchAction === 'sell'
              ? 'bg-orange-500 text-white dark:bg-orange-600'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
            @click="toggleBatchMode('sell')"
          >
            <div v-if="batchMode && batchAction === 'sell'" class="i-carbon-close mr-1 inline-block" />
            {{ batchMode && batchAction === 'sell' ? '取消批量' : '批量出售' }}
          </button>
        </template>
        <template v-if="selectedCategory === 'seed' || selectedCategory === 'all'">
          <button
            v-for="mode in (['lock', 'unlock'] as const)"
            :key="mode"
            class="rounded-lg px-3 py-1.5 text-sm font-medium transition"
            :class="batchMode && batchAction === mode ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'"
            :disabled="operationPending"
            @click="toggleBatchMode(mode)"
          >
            {{ batchMode && batchAction === mode ? '取消批量' : mode === 'lock' ? '批量上锁' : '批量解锁' }}
          </button>
        </template>
        <template v-if="batchMode">
          <button class="rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white" :disabled="operationPending" @click="selectAllSellable">
            全选
          </button>
          <button
            class="rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            :disabled="selectedSellableCount === 0 || operationPending"
            @click="batchAction === 'sell' ? handleBatchSellClick() : handleSeedLockClick(batchAction === 'lock')"
          >
            {{ batchAction === 'sell' ? '出售' : batchAction === 'lock' ? '上锁' : '解锁' }} ({{ selectedSellableCount }})
          </button>
        </template>
      </div>

      <div class="grid grid-cols-2 gap-4 lg:grid-cols-5 md:grid-cols-4 sm:grid-cols-3 xl:grid-cols-6">
        <div
          v-for="item in filteredItems"
          :key="item.id"
          class="farm-content-card group relative flex flex-col items-center border rounded-lg bg-white p-3 transition dark:border-gray-700 dark:bg-gray-800 hover:shadow-md"
          :class="{
            'ring-2 ring-orange-500 dark:ring-orange-400': batchMode && selectedForBatch.has(Number(item.id)),
            'opacity-50': batchMode && canSelectForBatch(item) && !selectedForBatch.has(Number(item.id)),
          }"
          @click="batchMode && canSelectForBatch(item) && handleSellClick(item)"
        >
          <div class="absolute left-2 top-2 text-xs text-gray-400 font-mono">
            #{{ item.id }}
          </div>

          <div class="absolute right-1 top-1 flex gap-1">
            <template v-if="!batchMode">
              <button
                v-for="locked in [true, false]"
                v-show="canChangeSeedLock(item, locked)"
                :key="String(locked)"
                class="rounded bg-blue-500 px-1.5 py-0.5 text-[10px] text-white transition hover:bg-blue-600 disabled:opacity-40"
                :disabled="operationPending || bagLoading"
                @click.stop="handleSeedLockClick(locked, item)"
              >
                {{ locked ? '上锁' : '解锁' }}
              </button>
              <button
                v-if="canSell(item)"
                class="rounded bg-red-500 px-1.5 py-0.5 text-[10px] text-white opacity-70 transition dark:bg-red-600 hover:opacity-100"
                title="出售全部"
                @click.stop="handleSellClick(item)"
              >
                售
              </button>
              <button
                v-if="canUse(item)"
                class="rounded bg-green-500 px-1.5 py-0.5 text-[10px] text-white opacity-70 transition dark:bg-green-600 hover:opacity-100"
                :title="isFertilizerRefill(item) ? '选择数量并预览容量' : Number(item.id) === 6001 ? '使用一枚' : '使用全部'"
                :disabled="operationPending"
                @click.stop="handleUseClick(item)"
              >
                用
              </button>
            </template>
            <div
              v-else-if="canSelectForBatch(item)"
              class="h-5 w-5 flex items-center justify-center border-2 rounded transition"
              :class="selectedForBatch.has(Number(item.id))
                ? 'border-orange-500 bg-orange-500 text-white'
                : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-700'"
            >
              <div v-if="selectedForBatch.has(Number(item.id))" class="i-carbon-checkmark text-xs" />
            </div>
          </div>

          <div
            class="thumb-wrap mb-2 mt-6 h-16 w-16 flex items-center justify-center rounded-full bg-gray-50 dark:bg-gray-700/50"
            :data-fallback="(item.name || '物').slice(0, 1)"
          >
            <img
              v-if="itemImage(item) && !imageErrors[item.id]"
              :src="itemImage(item)"
              :alt="item.name"
              class="max-h-full max-w-full object-contain"
              loading="lazy"
              @error="imageErrors[item.id] = true"
            >
            <div v-else class="text-2xl text-gray-400 font-bold uppercase">
              {{ (item.name || '物').slice(0, 1) }}
            </div>
          </div>

          <div class="mb-1 w-full flex items-center justify-center gap-1 px-2 text-center text-sm font-bold" :title="item.name">
            <span class="truncate">{{ item.name || `物品${item.id}` }}</span>
            <span
              v-if="getItemCategory(item) === 'seed' && Number(item.plantSize) === 2"
              class="shrink-0 border border-emerald-300 rounded bg-emerald-50 px-1 py-0.5 text-[10px] text-emerald-700 font-semibold leading-none dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
              title="四格作物，占用 2×2 土地"
            >
              &lt;2x2&gt;
            </span>
          </div>

          <div class="mb-2 flex flex-col items-center gap-0.5 text-xs text-gray-400">
            <span v-if="item.uid">UID: {{ item.uid }}</span>
            <span>
              类型: {{ itemType(item) }}
              <span v-if="getItemCategory(item) === 'seed' && Number(item.rarity) >= 2"> · 稀有</span>
              <span v-else-if="item.level > 0"> · Lv{{ item.level }}</span>
              <span v-if="item.price > 0" :class="getPriceClass(item)"> · {{ item.price }}{{ item.priceUnit || '金' }}</span>
            </span>
          </div>

          <div v-if="Number(item.lockedCount) > 0" class="mb-2 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <span class="i-carbon-locked" />
            {{ item.locked ? '已锁定' : `已锁定 ${item.lockedCount}` }}
          </div>

          <div class="mt-auto font-medium" :class="item.hoursText ? 'text-blue-500' : 'text-gray-600 dark:text-gray-300'">
            {{ item.hoursText || `x${item.count || 0}` }}
          </div>
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="fertilizerDialog.show"
      title="化肥使用预览"
      confirm-text="确认使用"
      :loading="fertilizerDialog.submitting"
      :confirm-disabled="fertilizerDialog.loading || !!fertilizerDialog.error || !fertilizerPreview?.valid"
      @confirm="confirmFertilizerUse"
      @close="closeFertilizerDialog"
      @cancel="closeFertilizerDialog"
    >
      <div class="fertilizer-preview">
        <p class="fertilizer-preview-item">
          {{ fertilizerDialog.item?.name }}
        </p>
        <div v-if="fertilizerDialog.loading" class="fertilizer-preview-loading" role="status">
          <span class="i-svg-spinners-90-ring-with-bg" aria-hidden="true" />正在读取容量与库存
        </div>
        <template v-else-if="fertilizerPreview?.ready">
          <div class="fertilizer-preview-pool">
            <span>{{ fertilizerPreview.label }}容器</span><span>上限 999 h</span>
          </div>
          <dl class="fertilizer-preview-values">
            <div><dt>当前容量</dt><dd>{{ formatFertilizerHours(fertilizerPreview.currentSeconds) }}</dd></div>
            <div>
              <dt>预计增加</dt><dd class="text-primary">
                +{{ formatFertilizerHours(fertilizerPreview.addedSeconds) }}
              </dd>
            </div>
            <div><dt>使用后</dt><dd>{{ formatFertilizerHours(fertilizerPreview.afterSeconds) }}</dd></div>
          </dl>
          <div class="fertilizer-preview-meter" role="meter" aria-label="预计使用后的化肥容量" :aria-valuenow="Math.min(fertilizerPreview.capacitySeconds, fertilizerPreview.afterSeconds)" :aria-valuemin="0" :aria-valuemax="fertilizerPreview.capacitySeconds">
            <span :style="{ width: `${Math.min(100, fertilizerPreview.currentSeconds / fertilizerPreview.capacitySeconds * 100)}%` }" />
            <i :style="{ width: `${fertilizerPreview.addedSeconds / fertilizerPreview.capacitySeconds * 100}%` }" />
          </div>
          <div class="fertilizer-quantity-heading">
            <label for="fertilizer-use-quantity">使用数量</label>
            <button type="button" :disabled="!fertilizerPreview.maxCount || fertilizerDialog.submitting" @click="fertilizerDialog.count = fertilizerPreview.maxCount">
              最大 {{ fertilizerPreview.maxCount }}
            </button>
          </div>
          <div class="fertilizer-quantity">
            <button type="button" title="减少一个" aria-label="减少一个" :disabled="fertilizerDialog.count <= 1 || fertilizerDialog.submitting" @click="fertilizerDialog.count = Math.max(1, fertilizerDialog.count - 1)">
              <span class="i-carbon-subtract" aria-hidden="true" />
            </button>
            <input id="fertilizer-use-quantity" v-model.number="fertilizerDialog.count" type="number" inputmode="numeric" min="1" :max="fertilizerPreview.maxCount" step="1" :disabled="fertilizerDialog.submitting || !fertilizerPreview.maxCount" :aria-invalid="!fertilizerPreview.valid">
            <button type="button" title="增加一个" aria-label="增加一个" :disabled="fertilizerDialog.count >= fertilizerPreview.maxCount || fertilizerDialog.submitting" @click="fertilizerDialog.count = Math.min(fertilizerPreview.maxCount, Number(fertilizerDialog.count) + 1)">
              <span class="i-carbon-add" aria-hidden="true" />
            </button>
          </div>
          <p class="fertilizer-preview-unit">
            每个增加 {{ formatFertilizerHours(fertilizerPreview.secondsPerItem) }}
          </p>
        </template>
        <div v-if="fertilizerDialog.error || (!fertilizerDialog.loading && fertilizerPreview?.error)" class="fertilizer-preview-error" role="alert">
          <p>{{ fertilizerDialog.error || fertilizerPreview?.error }}</p>
          <button type="button" :disabled="fertilizerDialog.loading || fertilizerDialog.submitting" @click="refreshFertilizerPreview()">
            重新读取
          </button>
        </div>
      </div>
    </ConfirmModal>

    <ConfirmModal
      :show="confirmModal.show"
      :title="confirmModal.title"
      :message="confirmModal.message"
      :type="confirmModal.type"
      :loading="confirmModal.loading"
      :confirm-text="confirmModal.action === 'sell' ? '确认出售' : confirmModal.action === 'batchSell' ? '确认出售' : '确认使用'"
      @confirm="handleConfirm"
      @close="handleCancel"
      @cancel="handleCancel"
    />
  </div>
</template>

<style scoped>
.fertilizer-preview {
  text-align: left;
  white-space: normal;
  font-size: 13px;
}
.fertilizer-preview-item {
  color: var(--theme-text);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.fertilizer-preview-pool,
.fertilizer-quantity-heading {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}
.fertilizer-preview-pool > span:last-child,
.fertilizer-preview-unit {
  color: var(--muted-text);
  font-size: 12px;
}
.fertilizer-preview-values {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 12px 0;
}
.fertilizer-preview-values dt {
  font-size: 12px;
}
.fertilizer-preview-values dd {
  margin: 4px 0 0;
  font-size: 17px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.fertilizer-preview-meter {
  display: flex;
  height: 7px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--surface-3);
}
.fertilizer-preview-meter span {
  background: var(--theme-primary);
}
.fertilizer-preview-meter i {
  background: #73b8cc;
}
.fertilizer-quantity-heading button,
.fertilizer-preview-error button {
  color: var(--theme-primary);
  min-height: 36px;
}
.fertilizer-quantity {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 40px;
  gap: 8px;
  margin: 4px 0 8px;
}
.fertilizer-quantity button,
.fertilizer-quantity input {
  display: grid;
  place-items: center;
  width: 100%;
  min-width: 0;
  min-height: 40px;
  border: 1px solid var(--surface-border-strong);
  border-radius: 6px;
  background: var(--surface-1);
  text-align: center;
  color: var(--theme-text);
}
.fertilizer-quantity button:disabled {
  opacity: 0.4;
}
.fertilizer-preview-error {
  margin-top: 12px;
  color: #b64c39;
}
.fertilizer-preview-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 120px;
}
.thumb-wrap.fallback img {
  display: none;
}

.thumb-wrap.fallback::after {
  content: attr(data-fallback);
  font-size: 1.5rem;
  font-weight: bold;
  color: #9ca3af;
  text-transform: uppercase;
}
</style>
