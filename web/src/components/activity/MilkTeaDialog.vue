<script setup lang="ts">
import { ref, useId } from 'vue'
import { useModalFocus } from '@/composables/useModalFocus'

const props = defineProps<{ title: string, busy?: boolean, wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const surface = ref<HTMLElement | null>(null)
const id = useId()
function close() {
  if (!props.busy)
    emit('close')
}
useModalFocus(() => true, surface, close)
</script>

<template>
  <Teleport to="body">
    <div class="milk-dialog-shade" @click.self="close">
      <section ref="surface" class="milk-dialog" :class="{ 'milk-dialog--wide': wide }" role="dialog" aria-modal="true" :aria-labelledby="`${id}-title`" :aria-busy="busy" tabindex="-1">
        <header class="tea-dialog-header">
          <h2 :id="`${id}-title`">
            {{ title }}
          </h2>
          <button type="button" class="tea-icon-button" :disabled="busy" aria-label="关闭弹窗" title="关闭" @click="close">
            <span class="i-carbon-close" aria-hidden="true" />
          </button>
        </header>
        <div class="tea-dialog-content">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="tea-dialog-footer">
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Teleport>
</template>
