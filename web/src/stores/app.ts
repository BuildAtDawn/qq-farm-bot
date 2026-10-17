import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import api from '@/api'
import { FARM_BRAND } from '@/utils/branding'
import { readUiPreference, UI_PREFERENCES, writeUiPreference } from '@/utils/ui-preferences'

export interface LoginPageConfig {
  logoUrl: string
  title: string
  loginSubtitle: string
  registerSubtitle: string
  purchaseUrl: string
  qqGroupUrl: string
}

const defaultLoginPageConfig: LoginPageConfig = {
  logoUrl: '',
  title: 'QQ农场智能助手',
  loginSubtitle: '欢迎回来，开启智慧农耕之旅',
  registerSubtitle: '创建账号，开启智慧农耕之旅',
  purchaseUrl: '',
  qqGroupUrl: '',
}

export const useAppStore = defineStore('app', () => {
  const sidebarOpen = ref(false)
  const compactDashboard = ref(readUiPreference(UI_PREFERENCES.compactDashboard, false))
  const loginPageConfig = ref<LoginPageConfig>({ ...defaultLoginPageConfig })
  const brandTitle = computed(() => {
    const configured = loginPageConfig.value.title
    return !configured || configured === 'QQ农场智能助手' ? FARM_BRAND.name : configured
  })
  let loginPageConfigPromise: Promise<void> | null = null

  watch(compactDashboard, value => writeUiPreference(UI_PREFERENCES.compactDashboard, value))
  watch(brandTitle, title => document.title = title, { immediate: true })

  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value
  }

  function closeSidebar() {
    sidebarOpen.value = false
  }

  function openSidebar() {
    sidebarOpen.value = true
  }

  async function fetchLoginPageConfig() {
    if (loginPageConfigPromise)
      return loginPageConfigPromise

    loginPageConfigPromise = api.get('/api/public/login-links').then((res) => {
      if (res.data?.ok && res.data.data) {
        loginPageConfig.value = { ...defaultLoginPageConfig, ...res.data.data }
      }
    }).catch(() => {
      // 保留默认品牌，页面仍可正常使用。
    }).finally(() => {
      loginPageConfigPromise = null
    })
    return loginPageConfigPromise
  }

  return {
    sidebarOpen,
    compactDashboard,
    loginPageConfig,
    brandTitle,
    toggleSidebar,
    closeSidebar,
    openSidebar,
    fetchLoginPageConfig,
  }
})
