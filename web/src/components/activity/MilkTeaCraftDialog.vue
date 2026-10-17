<script setup lang="ts">
import type { TeaState } from '@/utils/milk-tea'
import { computed, ref, watch } from 'vue'
import { teaFruits, teaFruitUids, teaImage, teaNumber, teaPhase } from '@/utils/milk-tea'
import MilkTeaDialog from './MilkTeaDialog.vue'

const props = defineProps<{ state: TeaState, busy: boolean, loading: boolean, error: string, now: number, initialUids?: string[] }>()
const emit = defineEmits<{ close: [], craft: [params: { fruitUids: string[] }] }>()
const recipes = computed(() => [...(props.state.recipes || [])].filter(recipe => teaFruitUids([recipe]).length > 0).sort((a, b) => Number(a.recipe_id) - Number(b.recipe_id)))
const available = computed(() => teaFruitUids(recipes.value))
const selected = ref<string[]>(props.initialUids?.length ? [...props.initialUids] : [...available.value])
const allSelected = computed(() => available.value.length > 0 && available.value.every(uid => selected.value.includes(uid)))
const blocked = computed(() => props.busy || props.loading || teaPhase(props.state, props.now) !== 'business')
watch(available, (uids) => {
  selected.value = selected.value.filter(uid => uids.includes(uid))
}, { immediate: true })
function toggle(uid: string) {
  if (!blocked.value)
    selected.value = selected.value.includes(uid) ? selected.value.filter(item => item !== uid) : [...selected.value, uid]
}
function submit() {
  if (blocked.value)
    return
  const uids = [...new Set(selected.value)].filter(uid => available.value.includes(uid))
  if (uids.length)
    emit('craft', { fruitUids: uids })
}
</script>

<template>
  <MilkTeaDialog title="选材制作" :busy="busy" :wide="recipes.length > 1" @close="emit('close')">
    <p v-if="error" class="tea-error" role="alert">
      {{ error }}
    </p>
    <div class="tea-craft-grid">
      <article v-for="recipe in recipes" :key="String(recipe.recipe_id)" class="tea-material-recipe">
        <header class="tea-material-summary">
          <img :src="recipe.config?.image || teaImage('img_s4TeaUI_tea')" :alt="recipe.recipe_name">
          <div>
            <h3>{{ recipe.recipe_name }}</h3>
            <p>{{ teaNumber(recipe.token_price) }} 券 / 杯</p>
          </div>
        </header>
        <div class="tea-fruit-list">
          <label v-for="fruit in teaFruits(recipe)" :key="fruit.uid" class="tea-fruit-choice" :title="`UID ${fruit.uid}`">
            <input type="checkbox" :checked="selected.includes(String(fruit.uid))" :disabled="blocked" :aria-label="`${fruit.name || recipe.recipe_name}，${fruit.count} 枚`" @change="toggle(String(fruit.uid))">
            <img v-if="fruit.image" :src="fruit.image" :alt="fruit.name || ''">
            <span><b>{{ fruit.name || '果实批次' }}</b><small>×{{ teaNumber(fruit.count) }}</small></span>
          </label>
        </div>
      </article>
    </div>
    <p v-if="!recipes.length" class="tea-inline-state">
      暂无可用材料
    </p>
    <p class="tea-rule-note">
      消耗已选批次的果实；实际产量由服务端结算。
    </p>
    <template #footer>
      <label class="tea-check"><input type="checkbox" :checked="allSelected" :indeterminate="selected.length > 0 && !allSelected" :disabled="blocked || !available.length" @change="selected = allSelected ? [] : [...available]">全选可用材料</label>
      <span class="tea-muted">已选 {{ selected.length }} 批</span>
      <button type="button" class="tea-button tea-button--primary" :disabled="blocked || !selected.length" @click="submit">
        {{ busy ? '制作中…' : '确认消耗并制作' }}
      </button>
    </template>
  </MilkTeaDialog>
</template>
