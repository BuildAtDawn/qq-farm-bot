<script setup lang="ts">
import { ref } from 'vue'
import BagPanel from '@/components/BagPanel.vue'
import FarmPanel from '@/components/FarmPanel.vue'
import Illustrated from '@/views/Illustrated.vue'
import PersonalAccountOverview from '@/components/PersonalAccountOverview.vue'
import Pet from '@/views/Pet.vue'
import TaskPanel from '@/components/TaskPanel.vue'
import FarmPageHeader from '@/components/ui/FarmPageHeader.vue'

type PersonalTab = 'farm' | 'bag' | 'pet' | 'illustrated' | 'task'

const currentTab = ref<PersonalTab>('farm')
const tabComponents: Record<PersonalTab, any> = {
  farm: FarmPanel,
  bag: BagPanel,
  pet: Pet,
  illustrated: Illustrated,
  task: TaskPanel,
}
const tabs: { key: PersonalTab, label: string, icon: string }[] = [
  { key: 'farm', label: '我的农场', icon: 'i-carbon-sprout' },
  { key: 'bag', label: '我的背包', icon: 'i-carbon-box' },
  { key: 'pet', label: '宠物小屋', icon: 'i-fa-solid-paw' },
  { key: 'illustrated', label: '收藏图鉴', icon: 'i-carbon-book' },
  { key: 'task', label: '我的任务', icon: 'i-carbon-task' },
]
</script>

<template>
  <div class="personal-page">
    <FarmPageHeader title="我的农场" description="照看作物，整理背包，收下每一份成长。" icon="i-carbon-sprout" />
    <PersonalAccountOverview />
    <div class="personal-tabs" role="tablist" aria-label="个人板块">
      <button
        v-for="tab in tabs" :key="tab.key"
        class="personal-tab" role="tab"
        :class="{ 'is-active': currentTab === tab.key }"
        :aria-selected="currentTab === tab.key"
        @click="currentTab = tab.key"
      >
        <div class="flex items-center gap-1.5">
          <div :class="tab.icon" class="text-lg" />
          <span>{{ tab.label }}</span>
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
        <component :is="tabComponents[currentTab]" />
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
  /* 手机端 5 个 Tab 等分一行：不横向滚动、不超出框 */
  .personal-tabs {
    gap: 0;
    overflow-x: visible;
  }
  .personal-tab {
    flex: 1 1 0;
    min-width: 0;
    justify-content: center;
    min-height: 40px;
    padding: 8px 0 10px;
    font-size: 11px;
  }
  .personal-tab > div {
    gap: 3px;
  }
  .personal-tab .text-lg {
    width: 14px;
    height: 14px;
  }
}
</style>
