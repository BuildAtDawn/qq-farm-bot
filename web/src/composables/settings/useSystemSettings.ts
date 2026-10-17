import { computed, ref } from 'vue'
import api from '@/api'
import type { AutoCodeRefreshConfig } from '@/stores/setting'

const defaultKeepalive = (): AutoCodeRefreshConfig => ({ enabled: false, intervalMinutes: 60, offlineEnabled: false, offlineDelaySeconds: 60 })

export interface SystemSettings {
  organicFertilizerDelayMinMs: number | string
  organicFertilizerDelayMaxMs: number | string
  publicWebOrigin: string
  autoCodeRefresh: AutoCodeRefreshConfig
}

export function useSystemSettings() {
  const form = ref<SystemSettings>({
    organicFertilizerDelayMinMs: 200,
    organicFertilizerDelayMaxMs: 300,
    publicWebOrigin: '',
    autoCodeRefresh: defaultKeepalive(),
  })
  const loading = ref(false)
  const saving = ref(false)
  const loaded = ref(false)
  const error = ref('')
  const saved = ref(false)
  const validationError = computed(() => {
    const min = form.value.organicFertilizerDelayMinMs
    const max = form.value.organicFertilizerDelayMaxMs
    if (![min, max].every(value => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 60000))
      return '施肥间隔必须是 0～60000 毫秒的整数'
    if (Number(min) > Number(max))
      return '施肥间隔下限不能大于上限'
    const refresh = form.value.autoCodeRefresh
    if (refresh && (!Number.isInteger(refresh.intervalMinutes) || refresh.intervalMinutes < 1 || refresh.intervalMinutes > 1440
      || !Number.isInteger(refresh.offlineDelaySeconds) || refresh.offlineDelaySeconds < 1 || refresh.offlineDelaySeconds > 86400))
      return '账号保活设置无效：重登间隔为 1～1440 分钟，掉线等待为 1～86400 秒'
    const text = form.value.publicWebOrigin?.trim() || ''
    if (text) {
      try {
        const url = new URL(text)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
          return '公网地址前缀仅允许 HTTP/HTTPS 域名，不包含路径、参数或账号密码'
      }
      catch {
        return '公网地址前缀必须是 HTTP/HTTPS 域名'
      }
    }
    return ''
  })

  async function load() {
    if (loading.value || saving.value)
      return
    loading.value = true
    error.value = ''
    saved.value = false
    try {
      const { data } = await api.get('/api/admin/system-settings')
      if (!data?.ok || !data.data)
        throw new Error(data?.error || '系统设置读取失败')
      form.value = { publicWebOrigin: '', autoCodeRefresh: defaultKeepalive(), ...data.data }
      loaded.value = true
    }
    catch (cause: any) {
      loaded.value = false
      error.value = cause.response?.data?.error || cause.message || '系统设置读取失败'
    }
    finally {
      loading.value = false
    }
  }

  async function save() {
    if (!loaded.value || loading.value || saving.value || validationError.value)
      return false
    saving.value = true
    error.value = ''
    saved.value = false
    try {
      const { data } = await api.post('/api/admin/system-settings', { ...form.value })
      if (!data?.ok || !data.data)
        throw new Error(data?.error || '系统设置保存失败')
      form.value = { publicWebOrigin: '', autoCodeRefresh: defaultKeepalive(), ...data.data }
      saved.value = true
      return true
    }
    catch (cause: any) {
      error.value = cause.response?.data?.error || cause.message || '系统设置保存失败'
      return false
    }
    finally {
      saving.value = false
    }
  }

  return { form, loading, saving, loaded, error, saved, validationError, load, save }
}
