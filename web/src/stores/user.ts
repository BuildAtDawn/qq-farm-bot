import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'
import { adminAuthenticated } from '@/utils/admin-auth'

interface AdminUser {
  username: 'admin'
  role: 'admin'
  card: null
  accountLimit: number
  avatar?: string
}

export const useUserStore = defineStore('user', () => {
  const userInfo = ref<AdminUser | null>(null)
  const isLoggedIn = computed(() => adminAuthenticated.value)
  const isAdmin = computed(() => true)
  const isSuperAdmin = computed(() => false)
  const username = computed(() => 'admin')
  const avatar = computed(() => userInfo.value?.avatar || '')
  const accountLimit = computed(() => Number.MAX_SAFE_INTEGER)
  const isExpired = computed(() => false)

  async function fetchUserInfo() {
    try {
      const { data } = await api.get('/api/user/me')
      if (data?.ok) {
        userInfo.value = {
          username: 'admin',
          role: 'admin',
          card: null,
          accountLimit: Number.MAX_SAFE_INTEGER,
          avatar: data.data.avatar,
        }
      }
      return data
    }
    catch {
      return { ok: false }
    }
  }

  return {
    userInfo,
    isLoggedIn,
    isAdmin,
    isSuperAdmin,
    username,
    avatar,
    accountLimit,
    isExpired,
    fetchUserInfo,
  }
})
