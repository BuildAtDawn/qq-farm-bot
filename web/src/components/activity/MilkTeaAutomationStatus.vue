<script setup lang="ts">
defineProps<{ enabled: boolean | null }>()
</script>

<template>
  <span class="tea-auto-state" :class="enabled === null ? 'tea-auto-state--unknown' : enabled ? 'tea-auto-state--on' : 'tea-auto-state--off'">
    <span v-if="enabled !== null" class="tea-auto-track" aria-hidden="true" />
    {{ enabled === null ? '未读取' : enabled ? '已开启' : '已关闭' }}
  </span>
</template>
