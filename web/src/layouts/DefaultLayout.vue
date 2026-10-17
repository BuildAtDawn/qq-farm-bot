<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import MysteryMerchantBanner from '@/components/shop/MysteryMerchantBanner.vue'
import Sidebar from '@/components/Sidebar.vue'
import TopAccountMenu from '@/components/TopAccountMenu.vue'
import { menuGroups, menuPath, menuRoutes, visibleMenuRoutes } from '@/router/menu'
import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { logoutAdmin } from '@/utils/admin-auth'

const appStore = useAppStore()
const userStore = useUserStore()
const route = useRoute()
const { sidebarOpen } = storeToRefs(appStore)
const desktop = useMediaQuery('(min-width: 1024px)')
const loggingOut = ref(false)
let drawerTrigger: HTMLElement | null = null
const currentMenu = computed(() => menuRoutes.find(item => menuPath(item) === route.path))
const currentGroup = computed(() => menuGroups.find(group => group.key === currentMenu.value?.group)?.label || '我的庄园')
const mobileItems = computed(() => visibleMenuRoutes(userStore.isAdmin).filter(item => item.mobileLabel))
const moreActive = computed(() => !mobileItems.value.some(item => menuPath(item) === route.path))

watch(sidebarOpen, async (open) => {
  if (open && !desktop.value) {
    drawerTrigger = document.activeElement as HTMLElement | null
  }
  else if (!open && !desktop.value) {
    await nextTick()
    drawerTrigger?.focus()
  }
})

onMounted(() => {
  appStore.fetchLoginPageConfig()
})

async function logout() {
  if (loggingOut.value)
    return
  loggingOut.value = true
  try {
    await logoutAdmin()
  }
  catch {
    useToastStore().error('退出失败，请重试')
  }
  finally {
    loggingOut.value = false
  }
}
</script>

<template>
  <div class="farm-shell">
    <a href="#farm-page-content" class="farm-skip-link">跳到页面内容</a>
    <button v-if="sidebarOpen && !desktop" type="button" class="farm-drawer-overlay" tabindex="-1" aria-label="关闭导航" @click="appStore.closeSidebar" />
    <Sidebar />
    <div class="farm-workspace" :inert="sidebarOpen && !desktop">
      <header class="farm-topbar">
        <div class="min-w-0 flex items-center gap-2">
          <button type="button" aria-label="打开导航" :aria-expanded="sidebarOpen" aria-controls="farm-sidebar" class="farm-icon-button lg:hidden" @click="appStore.openSidebar">
            <span class="i-carbon-menu" aria-hidden="true" />
          </button>
          <div class="farm-breadcrumb">
            <span class="hidden sm:inline">{{ currentGroup }}</span><span class="hidden opacity-40 sm:inline" aria-hidden="true">/</span>
            <strong>{{ currentMenu?.navLabel || currentMenu?.label || '农场' }}</strong>
          </div>
        </div>
        <div class="farm-topbar-actions">
          <TopAccountMenu />
          <button class="farm-icon-button" type="button" title="退出验证" aria-label="退出验证" :disabled="loggingOut" @click="logout">
            <span :class="loggingOut ? 'i-svg-spinners-ring-resize' : 'i-carbon-logout'" aria-hidden="true" />
          </button>
        </div>
      </header>
      <MysteryMerchantBanner />
      <main id="farm-page-content" class="farm-page-content" tabindex="-1">
        <RouterView v-slot="{ Component, route: pageRoute }">
          <component :is="Component" :key="pageRoute.path" class="farm-page" />
        </RouterView>
      </main>
      <nav class="farm-mobile-nav" aria-label="快捷导航">
        <RouterLink v-for="item in mobileItems" :key="item.name" :to="menuPath(item)" :class="{ 'is-active': route.path === menuPath(item) }" :aria-current="route.path === menuPath(item) ? 'page' : undefined">
          <span :class="item.icon" aria-hidden="true" /><span>{{ item.mobileLabel }}</span>
        </RouterLink>
        <button type="button" :class="{ 'is-active': moreActive }" :aria-expanded="sidebarOpen" aria-controls="farm-sidebar" @click="appStore.openSidebar">
          <span class="i-carbon-overflow-menu-horizontal" aria-hidden="true" /><span>更多</span>
        </button>
      </nav>
    </div>
  </div>
</template>

<style scoped>
.farm-shell {
  display: flex;
  width: 100%;
  height: 100dvh;
  overflow: hidden;
}
.farm-workspace {
  display: flex;
  flex: 1;
  min-width: 0;
  height: 100%;
  flex-direction: column;
}
.farm-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 76px;
  padding: 12px 30px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--surface-border);
  background: var(--farm-header);
  position: relative;
  z-index: 30;
}
.farm-breadcrumb {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  font-size: 12px;
  color: var(--muted-text);
}
.farm-breadcrumb strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--theme-text);
  font-size: 14px;
  font-weight: 650;
}
.farm-topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.farm-page-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px 30px 30px;
  scroll-padding-top: 16px;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
.farm-page-content:focus {
  outline: none;
}
.farm-mobile-nav {
  display: none;
}
.farm-drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgb(14 29 20 / 48%);
}
.farm-skip-link {
  position: fixed;
  top: -100px;
  left: 16px;
  z-index: 80;
  padding: 12px 18px;
  border-radius: 10px;
  background: var(--surface-1);
  color: var(--theme-primary);
}
.farm-skip-link:focus {
  top: 10px;
}
@media (min-width: 1800px) {
  .farm-page-content {
    padding-inline: max(30px, calc((100vw - 1850px) / 2));
  }
}
@media (max-width: 1023px) {
  .farm-topbar {
    min-height: 66px;
    padding: 8px 16px;
    gap: 4px;
  }
  .farm-page-content {
    padding: 18px 18px 24px;
  }
  .farm-mobile-nav {
    display: flex;
    flex-shrink: 0;
    justify-content: space-around;
    gap: 4px;
    padding: 7px 8px calc(7px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--surface-border);
    background: var(--farm-sidebar);
  }
  .farm-mobile-nav a,
  .farm-mobile-nav button {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 0;
    min-height: 48px;
    padding: 4px;
    border-radius: 8px;
    font-size: 12px;
    color: var(--muted-text);
  }
  .farm-mobile-nav a > span:first-child,
  .farm-mobile-nav button > span:first-child {
    font-size: 21px;
  }
  .farm-mobile-nav .is-active {
    color: var(--theme-primary);
    background: color-mix(in srgb, var(--theme-primary) 9%, var(--surface-1));
    font-weight: 650;
  }
}
@media (max-width: 639px) {
  .farm-topbar {
    padding-inline: 10px;
  }
  .farm-topbar-actions {
    gap: 2px;
  }
  .farm-breadcrumb strong {
    max-width: 84px;
    font-size: 13px;
  }
  .farm-page-content {
    padding: 14px 12px 20px;
  }
}
</style>
