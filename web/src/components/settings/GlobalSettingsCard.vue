<script setup lang="ts">
defineProps<{
  title: string
  icon: string
}>()
</script>

<template>
  <article class="farm-content-card min-w-0 overflow-hidden border border-gray-200 rounded-lg bg-white dark:border-gray-700 dark:bg-gray-800">
    <header class="flex items-center gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-700">
      <span class="inline-grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gray-100 text-xl text-gray-600 dark:bg-gray-700 dark:text-gray-300" :class="icon" aria-hidden="true" />
      <h4 class="min-w-0 break-words text-sm text-gray-900 font-semibold dark:text-gray-100">
        {{ title }}
      </h4>
    </header>
    <div class="min-w-0 p-5">
      <slot />
    </div>
  </article>
</template>
