<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  icon?: string
  scene?: boolean
}>()
</script>

<template>
  <header class="farm-page-header" :class="{ 'farm-page-header--scene': scene }">
    <div class="farm-page-header-copy">
      <span v-if="icon" class="farm-page-header-icon" aria-hidden="true"><span :class="icon" /></span>
      <div class="min-w-0">
        <h1>{{ title }}</h1><p v-if="description">
          {{ description }}
        </p>
      </div>
    </div>
    <div v-if="$slots.default" class="farm-page-header-actions">
      <slot />
    </div>
  </header>
</template>

<style scoped>
.farm-page-header {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}
.farm-page-header-copy {
  display: flex;
  align-items: center;
  gap: 13px;
  min-width: 0;
}
.farm-page-header-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border: 1px solid #dce8ca;
  border-radius: 8px;
  background: #eaf2da;
  color: var(--theme-primary);
  font-size: 23px;
}
.farm-page-header h1 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.farm-page-header p {
  margin-top: 5px;
  font-size: 12px;
  color: var(--muted-text);
  overflow-wrap: anywhere;
}
.farm-page-header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
@media (max-width: 639px) {
  .farm-page-header {
    gap: 12px;
  }
  .farm-page-header h1 {
    font-size: 21px;
  }
  .farm-page-header-icon {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    font-size: 21px;
  }
  .farm-page-header p {
    font-size: 12px;
    line-height: 1.6;
  }
}
.farm-page-header--scene {
  min-height: 92px;
  padding: 16px 22px;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  background: var(--surface-2);
  isolation: isolate;
}
.farm-background-enabled .farm-page-header--scene {
  background:
    linear-gradient(90deg, #fffef6f5, #fffef6d9 42%, #fffef624 85%),
    url('/backgrounds/farm-market.webp') center 55% / cover;
}
.farm-page-header--scene .farm-page-header-icon {
  display: none;
}
.farm-page-header--scene p {
  color: #596e52;
}
@media (max-width: 639px) {
  .farm-page-header--scene {
    min-height: 80px;
    padding: 14px 16px;
    border-radius: 8px;
  }
  .farm-page-header--scene .farm-page-header-actions {
    width: 100%;
  }
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  .farm-background-enabled .farm-page-header--scene {
    background:
      linear-gradient(90deg, #fffef6fa, #fffef6e6),
      url('/backgrounds/farm-market.webp') center 55% / cover;
  }
}
</style>
