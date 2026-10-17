<script setup lang="ts">
import { ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useModalFocus } from '@/composables/useModalFocus'

const props = defineProps<{ title: string, description: string, icon: string, saving: boolean, disabled?: boolean }>()
const emit = defineEmits<{ cancel: [], save: [] }>()
const surface = ref<HTMLElement | null>(null)
useModalFocus(() => true, surface, () => {
  if (!props.saving)
    emit('cancel')
})
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-gray-950/45 p-3 backdrop-blur-[2px] sm:p-6" @click.self="!saving && emit('cancel')">
      <section ref="surface" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" class="max-h-[94vh] max-w-4xl w-full flex flex-col overflow-hidden border border-gray-200 rounded-lg bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
        <header class="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 dark:border-gray-700 sm:px-6">
          <div class="min-w-0 flex items-start gap-3">
            <span class="inline-grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-gray-100 text-xl dark:bg-gray-700" :class="icon" />
            <div class="min-w-0">
              <h3 class="break-words text-lg text-gray-900 font-semibold dark:text-gray-100">
                {{ title }}
              </h3>
              <p class="mt-1 break-words text-sm text-gray-500">
                {{ description }}
              </p>
            </div>
          </div>
          <button type="button" class="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-700" :disabled="saving" aria-label="关闭" title="关闭" @click="emit('cancel')">
            <span class="i-carbon-close text-xl" />
          </button>
        </header>
        <fieldset :disabled="saving" class="m-0 min-h-0 min-w-0 flex-1 overflow-y-auto border-0 px-5 py-5 sm:px-6">
          <slot />
        </fieldset>
        <footer class="flex justify-end gap-2 border-t bg-gray-50/70 px-5 py-4 dark:border-gray-700 dark:bg-gray-900/20 sm:px-6">
          <BaseButton variant="secondary" size="sm" :disabled="saving" @click="emit('cancel')">
            取消
          </BaseButton>
          <BaseButton size="sm" :loading="saving" :disabled="disabled || saving" @click="emit('save')">
            保存并关闭
          </BaseButton>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
