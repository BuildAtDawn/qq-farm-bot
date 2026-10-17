<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

defineProps<{
  title: string
  description: string
  icon: string
  enabled: boolean
  disabled: boolean
  status: string
  tags: string[]
}>()
const emit = defineEmits<{ toggle: [enabled: boolean], configure: [] }>()
</script>

<template>
  <article class="farm-content-card group min-h-[184px] min-w-0 flex flex-col border border-gray-200 rounded-lg bg-white p-4 transition dark:border-gray-700 hover:border-[var(--theme-primary)] dark:bg-gray-800 hover:shadow-sm">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex items-center gap-3">
        <span class="inline-grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gray-100 text-xl dark:bg-gray-700" :class="icon" />
        <div class="min-w-0">
          <h4 class="break-words text-gray-900 font-semibold dark:text-gray-100">
            {{ title }}
          </h4>
          <p class="mt-0.5 break-words text-xs text-gray-500">
            {{ description }}
          </p>
        </div>
      </div>
      <BaseSwitch :aria-label="title" :model-value="enabled" :disabled="disabled" @update:model-value="emit('toggle', !!$event)" />
    </div>
    <div class="mt-4 min-h-[56px] flex flex-wrap content-start gap-2">
      <span v-for="tag in tags" :key="tag" class="max-w-full break-words rounded-md bg-gray-50 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">{{ tag }}</span>
    </div>
    <div class="mt-auto flex items-center justify-between gap-3 pt-4">
      <span class="min-w-0 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <span class="h-2 w-2 shrink-0 rounded-full" :class="enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'" />
        {{ status }}
      </span>
      <BaseButton variant="secondary" size="sm" :disabled="disabled" @click="emit('configure')">
        配置
      </BaseButton>
    </div>
  </article>
</template>
