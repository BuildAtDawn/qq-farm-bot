<script setup lang="ts">
import { RouterView } from 'vue-router'
import ToastContainer from '@/components/ToastContainer.vue'
</script>

<template>
  <div class="app-root farm-background-enabled h-screen w-screen overflow-hidden" :style="{ color: 'var(--theme-text)' }">
    <RouterView />
    <ToastContainer />
  </div>
</template>

<style>
/* Global styles */
body {
  margin: 0;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'PingFang SC',
    sans-serif;
  line-height: 1.5;
  font-optical-sizing: auto;
  background: var(--app-bg);
  color: var(--theme-text);
  font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
}

/* Farm surfaces stay opaque enough for data while the illustration provides context. */
:root {
  --theme-bg: #edf4e4;
  --theme-text: #203d31;
  --theme-primary: #238452;
  --theme-secondary: #216c43;
  --theme-gradient: linear-gradient(135deg, #40975c, #238452);
  --app-bg: #edf3e5;
  --surface-1: #ffffff;
  --surface-2: #f4f7f5;
  --surface-3: #e8efea;
  --surface-border: #dfe7e2;
  --surface-border-strong: #c9d7ce;
  --surface-shadow: 0 12px 32px rgb(45 70 31 / 7%);
  --surface-shadow-soft: 0 4px 18px rgb(45 70 31 / 4%);
  --muted-text: #586b62;
  --input-bg: #ffffff;
  --farm-radius: 8px;
  --farm-accent: #f9c75a;
  --farm-sidebar: #fffef8;
  --farm-header: rgb(255 254 248 / 95%);
  --farm-scene: url('/backgrounds/farm-day.webp');
  --farm-scene-overlay: linear-gradient(180deg, rgb(237 246 232 / 66%), rgb(237 246 232 / 92%));
  --farm-hero-overlay: linear-gradient(90deg, #edf7e6 0%, rgb(237 247 230 / 93%) 28%, rgb(237 247 230 / 10%) 78%);
}

.app-root {
  position: relative;
  isolation: isolate;
  background: var(--app-bg);
}

.app-root::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    var(--farm-scene-overlay),
    var(--farm-scene) center / cover;
  opacity: 0;
}

.farm-background-enabled::before {
  opacity: 1;
}

/* Neutral page surfaces share the new identity; activity-specific colors stay local. */
.bg-white {
  background-color: var(--surface-1) !important;
}
.bg-gray-50 {
  background-color: var(--surface-2) !important;
}

.ui-card,
.ui-card-elevated {
  border: 1px solid var(--surface-border);
  border-radius: var(--farm-radius);
  background: var(--surface-1);
  box-shadow: var(--surface-shadow-soft);
}
.ui-card-elevated {
  box-shadow: var(--surface-shadow);
}
.ui-subtle-panel {
  border: 1px solid var(--surface-border);
  background: var(--surface-2);
}
.glass-panel {
  border: 1px solid var(--surface-border);
  background: var(--surface-1);
  box-shadow: var(--surface-shadow-soft);
}
.metric-card {
  position: relative;
  overflow: hidden;
}

@media (max-width: 639px) {
  :root {
    --farm-scene: url('/backgrounds/farm-day-mobile.webp');
  }
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  .app-root::before {
    background:
      linear-gradient(rgb(237 246 232 / 94%), rgb(237 246 232 / 94%)),
      var(--farm-scene) center / cover;
  }
}

/* Use CSS variables for theme colors */
.btn-primary {
  background: var(--theme-gradient);
  border-color: var(--theme-primary);
}

.btn-primary:hover {
  background: var(--theme-secondary);
}

.text-primary {
  color: var(--theme-primary);
}

.bg-primary {
  background-color: var(--theme-primary);
}

.border-primary {
  border-color: var(--theme-primary);
}

.bg-gradient-primary {
  background: var(--theme-gradient);
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--theme-primary) 50%, #94a3b8);
  border-radius: 999px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--theme-secondary);
  opacity: 0.8;
}
</style>
