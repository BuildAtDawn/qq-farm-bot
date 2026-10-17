import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import api from '@/api'
import { createScopedRequest } from '@/utils/scoped-request'

export function useMutationResource<T>(
  account: () => string,
  endpoint: string,
  params: () => Record<string, unknown> = () => ({}),
  interval = 2000,
) {
  const data = shallowRef<T | null>(null)
  const loading = ref(false)
  const error = ref('')
  const visibility = useDocumentVisibility()
  let disposed = false
  const key = computed(() => account() ? JSON.stringify([account(), params()]) : '')
  const request = createScopedRequest<T>({
    key: () => key.value,
    fetch: async (signal) => {
      const response = await api.get(endpoint, { headers: { 'x-account-id': account() }, params: params(), signal })
      if (!response.data?.ok)
        throw new Error(response.data?.error || '读取失败')
      return response.data.data
    },
    apply: (value) => {
      data.value = value
      error.value = ''
    },
    error: (cause: any) => { error.value = cause.response?.data?.error || cause.message || '读取失败' },
    loading: (value) => { loading.value = value },
  })
  function refresh() {
    if (!disposed && visibility.value === 'visible')
      return request.run()
    return Promise.resolve()
  }
  watch(key, () => {
    request.invalidate()
    data.value = null
    error.value = ''
    void refresh()
  }, { immediate: true, flush: 'sync' })
  watch(visibility, () => {
    if (visibility.value === 'visible')
      void refresh()
    else
      request.invalidate()
  })
  if (interval > 0)
    useIntervalFn(refresh, interval)
  onUnmounted(() => {
    disposed = true
    request.invalidate()
  })
  return { data, loading, error, refresh, invalidate: request.invalidate }
}
