<script setup lang="ts">
import type { TeaGoods, TeaState } from '@/utils/milk-tea'
import { computed, ref } from 'vue'
import { teaBalance, teaCurrencyImage, teaGoodsReason, teaNumber, teaPhase } from '@/utils/milk-tea'

const props = defineProps<{ state: TeaState, now: number, blocked: boolean }>()
const emit = defineEmits<{ open: [kind: string] }>()
const filter = ref('all')
const query = ref('')
const filters = [{ key: 'all', label: '全部' }, { key: 'seed', label: '种子' }, { key: 'other', label: '装扮与道具' }]
const phase = computed(() => teaPhase(props.state, props.now))
const goods = computed(() => (props.state.goods || []).filter(good => (filter.value === 'all' || (filter.value === 'seed' ? good.category_tag === 'seed' : good.category_tag !== 'seed')) && `${good.name} ${good.desc || ''}`.includes(query.value.trim())))
const groups = computed(() => [
  { title: '可兑换', goods: goods.value.filter(good => !teaGoodsReason(good, phase.value)) },
  { title: '暂不可兑换', goods: goods.value.filter(good => !!teaGoodsReason(good, phase.value)) },
])
function limit(good: TeaGoods) {
  return ({ 1: '每日', 2: '每周', 4: '永久' } as Record<string, string>)[String(good.restriction_type)] || '活动'
}
</script>

<template>
  <div class="tea-panel">
    <div class="tea-balances">
      <span v-for="id in ['1041', '1001', '1004']" :key="id"><img :src="teaCurrencyImage({ id })" :alt="({ 1041: '奶茶券', 1001: '金币', 1004: '钻石' } as Record<string, string>)[id]"><b class="tea-number">{{ teaNumber(teaBalance(state, id)) }}</b></span>
      <span>店铺等级 <b class="tea-number">{{ state.shop ? `Lv.${state.shop.level}` : '未开业' }}</b></span>
    </div>
    <div class="tea-filterbar">
      <div class="tea-filters" role="group" aria-label="兑换分类">
        <button v-for="option in filters" :key="option.key" type="button" :aria-pressed="filter === option.key" @click="filter = option.key">
          {{ option.label }}
        </button>
      </div>
      <label class="tea-search"><span class="i-carbon-search" aria-hidden="true" /><input v-model="query" type="search" placeholder="搜索活动商品" aria-label="搜索活动商品"></label>
    </div>
    <template v-for="group in groups" :key="group.title">
      <template v-if="group.goods.length">
        <header class="tea-heading tea-goods-heading">
          <div><h3>{{ group.title }}</h3><small>{{ group.goods.length }} 件</small></div>
        </header>
        <div class="tea-goods-list">
          <article v-for="good in group.goods" :key="String(good.id)" class="tea-goods" :class="{ 'tea-goods--unavailable': teaGoodsReason(good, phase) }">
            <div class="tea-product">
              <img v-if="good.items[0]?.image || good.items[0]?.imageUrl" :src="good.items[0].image || good.items[0].imageUrl" :alt="good.name">
              <span v-else class="tea-art-fallback"><span class="i-carbon-gift" aria-hidden="true" /></span>
              <div><b>{{ good.name }}</b><span class="tea-badge">{{ good.category_tag === 'seed' ? '种子' : '装扮与道具' }}</span></div>
            </div>
            <p class="tea-product-limit">
              {{ limit(good) }}限购<small>剩余 {{ teaNumber(good.remaining) }} / {{ teaNumber(good.purchase_limit) }}</small>
            </p>
            <div class="tea-product-prices">
              <span v-for="cost in good.costs" :key="String(cost.id)" class="tea-price"><img v-if="teaCurrencyImage(cost)" :src="teaCurrencyImage(cost)" :alt="cost.name"><span v-else>{{ cost.name }}</span><b class="tea-number">{{ teaNumber(cost.count) }}</b></span>
            </div>
            <button type="button" class="tea-button" :disabled="blocked || !!teaGoodsReason(good, phase)" @click="emit('open', `goods:${good.id}`)">
              <span :class="teaGoodsReason(good, phase) ? 'i-carbon-locked' : 'i-carbon-shopping-cart'" aria-hidden="true" />{{ teaGoodsReason(good, phase) || '兑换' }}
            </button>
          </article>
        </div>
      </template>
    </template>
    <div v-if="!goods.length" class="tea-state">
      <span class="i-carbon-search" aria-hidden="true" /><h3>{{ state.goods?.length ? '没有匹配的商品' : '暂无兑换商品' }}</h3>
      <button v-if="query || filter !== 'all'" type="button" class="tea-button" @click="query = ''; filter = 'all'">
        清空筛选
      </button>
    </div>
  </div>
</template>
