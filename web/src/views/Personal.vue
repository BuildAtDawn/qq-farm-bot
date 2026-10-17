<script setup lang="ts">
import { ref } from 'vue'
import BagPanel from '@/components/BagPanel.vue'
import FarmPanel from '@/components/FarmPanel.vue'
import PersonalAccountOverview from '@/components/PersonalAccountOverview.vue'
import TaskPanel from '@/components/TaskPanel.vue'
import FarmPageHeader from '@/components/ui/FarmPageHeader.vue'

const currentTab = ref<'farm' | 'bag' | 'task'>('farm')
</script>

<template>
  <div class="personal-page">
    <FarmPageHeader title="我的农场" description="照看作物，整理背包，收下每一份成长。" icon="i-carbon-sprout" />
    <PersonalAccountOverview />
    <div class="personal-tabs" role="tablist" aria-label="个人板块">
      <button
        class="personal-tab" role="tab"
        :class="{ 'is-active': currentTab === 'farm' }"
        :aria-selected="currentTab === 'farm'"
        @click="currentTab = 'farm'"
      >
        <div class="flex items-center space-x-2">
          <div class="i-carbon-sprout text-lg" />
          <span>我的农场</span>
        </div>
      </button>
      <button
        class="personal-tab" role="tab"
        :class="{ 'is-active': currentTab === 'bag' }"
        :aria-selected="currentTab === 'bag'"
        @click="currentTab = 'bag'"
      >
        <div class="flex items-center space-x-2">
          <div class="i-carbon-box text-lg" />
          <span>我的背包</span>
        </div>
      </button>
      <button
        class="personal-tab" role="tab"
        :class="{ 'is-active': currentTab === 'task' }"
        :aria-selected="currentTab === 'task'"
        @click="currentTab = 'task'"
      >
        <div class="flex items-center space-x-2">
          <div class="i-carbon-task text-lg" />
          <span>我的任务</span>
        </div>
      </button>
    </div>

    <div class="personal-content">
      <Transition
        mode="out-in"
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="transform opacity-0 scale-95"
        enter-to-class="transform opacity-100 scale-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="transform opacity-100 scale-100"
        leave-to-class="transform opacity-0 scale-95"
      >
        <component :is="currentTab === 'farm' ? FarmPanel : currentTab === 'bag' ? BagPanel : TaskPanel" />
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.personal-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.personal-tabs {
  display: flex;
  gap: 26px;
  border-bottom: 1px solid var(--surface-border);
  overflow-x: auto;
}
.personal-tab {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 10px 1px 13px;
  border-bottom: 3px solid transparent;
  font-size: 13px;
  color: var(--muted-text);
}
.personal-tab:hover {
  color: var(--theme-primary);
}
.personal-tab.is-active {
  color: var(--theme-primary);
  border-bottom-color: var(--theme-primary);
  font-weight: 650;
}
.personal-content {
  min-width: 0;
  padding-bottom: 16px;
}
@media (max-width: 639px) {
  .personal-page {
    gap: 14px;
  }
  .personal-tabs {
    gap: 20px;
  }
  .personal-tab {
    font-size: 12px;
  }
}
</style>
