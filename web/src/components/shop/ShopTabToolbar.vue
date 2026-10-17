<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'

type ShopTab = 'seed' | 'pet' | 'decoration' | 'mall' | 'mystery'

defineProps<{
  tab: ShopTab
  ascending: boolean
  loading: boolean
  disabled: boolean
}>()

const emit = defineEmits<{
  (e: 'update:tab', value: ShopTab): void
  (e: 'toggleAscending'): void
  (e: 'refresh'): void
}>()

const L = {
  seed: '\u79CD\u5B50\u5546\u5E97',
  pet: '\u5BA0\u7269\u5546\u5E97',
  decoration: '\u88C5\u626E\u5546\u5E97',
  mall: '\u9053\u5177\u5546\u5E97',
  mystery: '\u795E\u79D8\u5546\u4EBA',
  asc: '\u7B49\u7EA7\u5347\u5E8F',
  desc: '\u7B49\u7EA7\u964D\u5E8F',
  sort: '\u6392\u5E8F',
  refresh: '\u5237\u65B0',
}

const tabs: Array<{ value: ShopTab, label: string }> = [
  { value: 'mall', label: L.mall },
  { value: 'seed', label: L.seed },
  { value: 'pet', label: L.pet },
  { value: 'decoration', label: L.decoration },
  { value: 'mystery', label: L.mystery },
]

function tabClasses(active: boolean) {
  return active
    ? 'is-active'
    : ''
}
</script>

<template>
  <div class="shop-toolbar">
    <div class="shop-tab-scroll">
      <div class="shop-tabs">
        <button
          v-for="item in tabs"
          :key="item.value"
          :aria-pressed="tab === item.value"
          class="min-w-20 shrink-0 rounded-md px-3 text-sm font-medium transition"
          :class="tabClasses(tab === item.value)"
          @click="emit('update:tab', item.value)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <BaseButton
      variant="outline"
      :disabled="tab !== 'seed'"
      class="w-28"
      @click="tab === 'seed' && emit('toggleAscending')"
    >
      {{ tab === 'seed' ? (ascending ? L.asc : L.desc) : L.sort }}
    </BaseButton>
    <BaseButton class="w-24" variant="primary" :loading="loading" :disabled="disabled" @click="emit('refresh')">
      {{ L.refresh }}
    </BaseButton>
  </div>
</template>

<style scoped>
.shop-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.shop-tab-scroll {
  min-width: 0;
  max-width: 100%;
  flex: 1;
  overflow-x: auto;
}
.shop-tabs {
  display: flex;
  gap: 22px;
  min-width: max-content;
  border-bottom: 1px solid var(--surface-border);
}
.shop-tabs > button {
  min-width: 0;
  min-height: 44px;
  padding: 10px 1px 13px;
  border-radius: 0;
  border-bottom: 3px solid transparent;
  color: var(--muted-text);
  font-size: 13px;
}
.shop-tabs > button.is-active {
  border-bottom-color: var(--theme-primary);
  color: var(--theme-primary);
  font-weight: 650;
}
@media (max-width: 1023px) {
  .shop-tab-scroll {
    flex-basis: 100%;
  }
}
@media (max-width: 639px) {
  .shop-tabs {
    gap: 20px;
  }
  .shop-tabs > button {
    font-size: 12px;
  }
}
</style>
