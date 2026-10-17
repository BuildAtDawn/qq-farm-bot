import axios from 'axios'
import { ref } from 'vue'
import { codeLoginLocation } from './auth-redirect'

export const adminAuthenticated = ref(false)
let sessionPromise: Promise<boolean> | null = null
let authenticationVersion = 0

// Remove credentials left behind by the former anonymous login flow.
localStorage.removeItem('admin_token')
localStorage.removeItem('user_info')

export function clearAdminAuthentication() {
  authenticationVersion++
  adminAuthenticated.value = false
  localStorage.removeItem('admin_token')
  localStorage.removeItem('user_info')
}

export function redirectToCodeLogin() {
  clearAdminAuthentication()
  if (window.location.pathname !== '/login') {
    const original = window.location.pathname + window.location.search + window.location.hash
    window.location.replace(codeLoginLocation(original))
  }
}

export async function ensureAdminSession(): Promise<boolean> {
  if (!sessionPromise) {
    const version = authenticationVersion
    sessionPromise = axios.get('/api/auth/validate', { timeout: 6000 })
      .then(({ data }) => {
        if (version !== authenticationVersion)
          return adminAuthenticated.value
        adminAuthenticated.value = data?.ok === true && data?.data?.valid === true
        return adminAuthenticated.value
      })
      .catch(() => {
        if (version === authenticationVersion)
          clearAdminAuthentication()
        return false
      })
      .finally(() => { sessionPromise = null })
  }
  return sessionPromise
}

export async function verifyAdminCode(code: string) {
  const { data } = await axios.post('/api/login', { code }, { timeout: 10000 })
  if (data?.ok !== true)
    throw new Error(data?.error || '验证失败')
  authenticationVersion++
  adminAuthenticated.value = true
}

export async function logoutAdmin() {
  try {
    await axios.post('/api/logout', {}, { timeout: 10000 })
  }
  catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 401)
      throw error
  }
  redirectToCodeLogin()
}
