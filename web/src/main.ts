import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { useToastStore } from '@/stores/toast'
import { initializeFarmAppearance } from '@/utils/ui-preferences'
import App from './App.vue'
import router from './router'
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import './style.css'
import './farm-pages.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

// The new farm identity replaces legacy local and server theme palettes.
initializeFarmAppearance(document.documentElement)

// Global Error Handling
const toast = useToastStore()

app.config.errorHandler = (err: any, _instance, info) => {
  console.error('全局 Vue 错误:', err, info)
  const message = err.message || String(err)
  if (message.includes('ResizeObserver loop'))
    return
  toast.error(`应用错误: ${message}`)
}

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  if (reason && typeof reason === 'object' && 'isAxiosError' in reason)
    return

  console.error('Unhandled Rejection:', reason)
  const message = reason?.message || String(reason)
  toast.error(`异步错误: ${message}`)
})

window.onerror = (message, _source, _lineno, _colno, error) => {
  console.error('Global Error:', message, error)
  if (String(message).includes('Script error'))
    return
  toast.error(`系统错误: ${message}`)
}

app.mount('#app')
