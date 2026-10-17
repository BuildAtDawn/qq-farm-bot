<script setup lang="ts">
import type { TeaItem } from '@/utils/milk-tea'
import { teaCurrencyImage, teaItemName, teaNumber } from '@/utils/milk-tea'

defineProps<{ item: TeaItem, named?: boolean }>()
</script>

<template>
  <div class="tea-reward" :title="`${teaItemName(item)} ×${teaNumber(item.count)}`">
    <span class="tea-reward-art" :data-rarity="item.rarity">
      <img v-if="teaCurrencyImage(item)" :src="teaCurrencyImage(item)" :alt="teaItemName(item)">
      <span v-else class="i-carbon-gift" aria-hidden="true" />
    </span>
    <span><span v-if="named" class="tea-reward-name">{{ teaItemName(item) }}</span><b class="tea-number">×{{ teaNumber(item.count) }}</b></span>
  </div>
</template>
