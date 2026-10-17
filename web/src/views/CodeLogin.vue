<script setup lang="ts">
import axios from 'axios'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { verifyAdminCode } from '@/utils/admin-auth'
import { safeAuthRedirect } from '@/utils/auth-redirect'
import { FARM_BRAND } from '@/utils/branding'

const route = useRoute()
const version = __APP_VERSION__
const router = useRouter()
const appStore = useAppStore()
const code = ref('')
const visible = ref(false)
const submitting = ref(false)
const error = ref('')
const retrySeconds = ref(0)
const codeInput = ref<HTMLInputElement | null>(null)
const title = computed(() => appStore.brandTitle)
const setupRequired = ref(false)
const statusLoading = ref(true)
const statusReady = ref(false)
const confirmation = ref('')
const notice = ref('')
const farmerIcons = Array.from({ length: 20 }, (_, index) => `/images/farmers/farmer-${String(index + 1).padStart(2, '0')}.webp`)
const farmerIconIndex = ref(Math.floor(Math.random() * farmerIcons.length))
let retryTimer: ReturnType<typeof setInterval> | undefined
let farmerIconTimer: ReturnType<typeof setInterval> | undefined

async function loadAuthStatus() {
  statusLoading.value = true
  statusReady.value = false
  error.value = ''
  try {
    const { data } = await axios.get('/api/auth/status', { timeout: 10000 })
    if (!data?.ok || typeof data.data?.setupRequired !== 'boolean')
      throw new Error('Invalid status')
    setupRequired.value = data.data.setupRequired
    statusReady.value = true
  }
  catch {
    error.value = '无法读取访问验证状态，请重试'
  }
  finally {
    statusLoading.value = false
  }
}

function startRetryCountdown(seconds: number) {
  if (retryTimer)
    clearInterval(retryTimer)
  const deadline = Date.now() + seconds * 1000
  retrySeconds.value = seconds
  retryTimer = setInterval(() => {
    retrySeconds.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    if (!retrySeconds.value)
      clearInterval(retryTimer)
  }, 1000)
}

async function submit() {
  if (submitting.value || retrySeconds.value || !statusReady.value || statusLoading.value)
    return
  if (!code.value.trim()) {
    error.value = '请输入 Code'
    codeInput.value?.focus()
    return
  }
  if (setupRequired.value && code.value !== confirmation.value) {
    error.value = '两次输入的访问 Code 不一致'
    return
  }
  submitting.value = true
  error.value = ''
  try {
    if (setupRequired.value) {
      const { data } = await axios.post('/api/auth/setup', { code: code.value }, { timeout: 10000 })
      if (!data?.ok)
        throw new Error('Setup failed')
      code.value = ''
      confirmation.value = ''
      setupRequired.value = false
      notice.value = '访问 Code 已设置，请使用新 Code 登录'
      codeInput.value?.focus()
      return
    }
    await verifyAdminCode(code.value)
    code.value = ''
    await router.replace(safeAuthRedirect(route.query.redirect))
  }
  catch (cause) {
    if (axios.isAxiosError(cause)) {
      if (cause.response?.status === 409) {
        code.value = ''
        confirmation.value = ''
        await loadAuthStatus()
        error.value = setupRequired.value ? '请先设置访问 Code' : '访问 Code 已设置，请登录'
      }
      else if (cause.response?.status === 400) {
        error.value = cause.response.data?.error || '访问 Code 无效'
      }
      else if (cause.response?.status === 429) {
        const retryAfter = Number(cause.response.headers['retry-after'])
        startRetryCountdown(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 60)
        error.value = '验证次数过多，请稍后再试'
      }
      else if (cause.response?.status === 401) {
        error.value = 'Code 不正确，请重新输入'
        codeInput.value?.focus()
        codeInput.value?.select()
      }
      else {
        error.value = cause.response ? '验证暂时不可用，请稍后重试' : '无法连接服务器，请稍后重试'
      }
    }
    else {
      error.value = '验证失败，请重试'
    }
  }
  finally {
    submitting.value = false
  }
}

onMounted(() => {
  for (const src of farmerIcons) {
    const image = new Image()
    image.src = src
  }
  farmerIconTimer = setInterval(() => {
    const offset = 1 + Math.floor(Math.random() * (farmerIcons.length - 1))
    farmerIconIndex.value = (farmerIconIndex.value + offset) % farmerIcons.length
  }, 3000)
  appStore.fetchLoginPageConfig()
  loadAuthStatus()
  codeInput.value?.focus()
})

onBeforeUnmount(() => {
  if (farmerIconTimer)
    clearInterval(farmerIconTimer)
  if (retryTimer)
    clearInterval(retryTimer)
  code.value = ''
  confirmation.value = ''
})
</script>

<template>
  <main class="code-login">
    <section class="code-login-scene" aria-label="智慧农场，科技助农">
      <p class="farm-eyebrow">
        <span class="i-carbon-sprout text-lg" aria-hidden="true" />{{ FARM_BRAND.tagline }}
      </p>
      <h2>{{ FARM_BRAND.headlineLead }}<br>{{ FARM_BRAND.headlineTail }}</h2>
      <p class="code-login-intro">
        {{ FARM_BRAND.description }}
      </p>
      <span class="code-login-scene-caption">{{ FARM_BRAND.caption }}</span>
    </section>
    <div class="code-login-content">
      <header class="code-login-brand">
        <img :key="farmerIconIndex" class="code-login-farmer" :src="farmerIcons[farmerIconIndex]" alt="" width="56" height="56">
        <div>
          <h1>{{ title }}</h1><p class="code-login-subtitle">
            {{ FARM_BRAND.welcome }}
          </p>
        </div>
      </header>

      <form class="code-login-form" :aria-busy="submitting" @submit.prevent="submit">
        <div class="code-login-heading">
          <span class="i-carbon-locked" aria-hidden="true" />
          <h2>{{ setupRequired ? '设置访问 Code' : '访问验证' }}</h2>
        </div>
        <p v-if="setupRequired" class="mb-4 text-sm text-gray-600 dark:text-gray-300" role="status">
          尚未设置访问 Code，请先设置。
        </p>
        <p v-if="notice" class="mb-4 text-sm text-green-600" role="status">
          {{ notice }}
        </p>
        <label for="access-code">访问 Code</label>
        <div class="code-login-input">
          <input
            id="access-code"
            ref="codeInput"
            v-model="code"
            name="code"
            :type="visible ? 'text' : 'password'"
            placeholder="输入访问 Code"
            :autocomplete="setupRequired ? 'new-password' : 'current-password'"
            autocapitalize="off"
            :spellcheck="false"
            maxlength="128"
            :disabled="submitting || statusLoading || !statusReady"
            :aria-invalid="!!error"
            aria-describedby="code-error"
            @input="error = ''"
          >
          <button
            type="button"
            :title="visible ? '隐藏 Code' : '显示 Code'"
            :aria-label="visible ? '隐藏 Code' : '显示 Code'"
            :aria-pressed="visible"
            @click="visible = !visible"
          >
            <span :class="visible ? 'i-carbon-view-off' : 'i-carbon-view'" aria-hidden="true" />
          </button>
        </div>
        <template v-if="setupRequired">
          <label for="confirm-code" class="mt-4">确认访问 Code</label>
          <div class="code-login-input">
            <input id="confirm-code" v-model="confirmation" :type="visible ? 'text' : 'password'" autocomplete="new-password" maxlength="128" :disabled="submitting" placeholder="再次输入访问 Code" @input="error = ''">
          </div>
        </template>
        <div id="code-error" class="code-login-error" role="status" aria-live="polite">
          {{ error }}
        </div>
        <button v-if="!statusReady && !statusLoading" type="button" class="mb-3" @click="loadAuthStatus">
          重试
        </button>
        <button class="code-login-submit" type="submit" :disabled="submitting || retrySeconds > 0 || statusLoading || !statusReady">
          <span v-if="submitting" class="i-svg-spinners-ring-resize" aria-hidden="true" />
          <span>{{ statusLoading ? '正在读取' : submitting ? '正在提交' : retrySeconds ? `${retrySeconds} 秒后重试` : setupRequired ? '设置访问 Code' : '验证并进入' }}</span>
          <span v-if="!submitting && !retrySeconds" class="i-carbon-arrow-right" aria-hidden="true" />
        </button>
      </form>
      <footer>SMART FARM <span>v{{ version }}</span></footer>
    </div>
  </main>
</template>

<style scoped>
.code-login {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(340px, 420px);
  align-items: center;
  gap: clamp(30px, 6vw, 120px);
  height: 100%;
  min-height: 100dvh;
  overflow-y: auto;
  padding: 70px max(32px, calc((100vw - 1260px) / 2));
}
.code-login-scene {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  padding-block: 40px;
}
.code-login-scene h2 {
  margin: 25px 0;
  font-size: 56px;
  font-weight: 750;
  letter-spacing: 0;
  line-height: 1.22;
}
.code-login-intro {
  font-size: 15px;
  line-height: 2;
  color: #4e694b;
}
.code-login-scene-caption {
  margin-top: 72px;
  color: #4e694b;
  font-size: 11px;
  letter-spacing: 0;
}
.code-login-content {
  width: 100%;
  min-width: 0;
  padding: 36px;
  border: 1px solid var(--surface-border);
  border-radius: 26px;
  background: var(--surface-1);
  box-shadow: var(--surface-shadow);
}
.code-login-brand {
  display: flex;
  align-items: center;
  gap: 13px;
  margin-bottom: 30px;
}
.code-login-brand img {
  width: 56px;
  height: 56px;
  flex: none;
}
.code-login-farmer {
  border-radius: 8px;
  object-fit: cover;
  animation: farmer-hop 450ms ease-out;
}
@keyframes farmer-hop {
  0%, 100% { transform: translateY(0); }
  40% { transform: translateY(-7px) rotate(-4deg); }
  70% { transform: translateY(1px) rotate(2deg); }
}
@media (prefers-reduced-motion: reduce) {
  .code-login-farmer {
    animation: none;
  }
}
h1 {
  font-size: 19px;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}
.code-login-subtitle {
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted-text);
  line-height: 1.7;
}
.code-login-form {
  padding-top: 26px;
  border-top: 1px solid var(--surface-border);
}
.code-login-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
}
.code-login-heading span {
  font-size: 20px;
  color: var(--theme-primary);
}
.code-login-heading h2 {
  font-size: 17px;
  font-weight: 650;
}
label {
  display: block;
  margin-bottom: 9px;
  font-size: 13px;
  font-weight: 600;
}
.code-login-input {
  display: flex;
  min-height: 50px;
  overflow: hidden;
  border: 1px solid var(--surface-border-strong);
  border-radius: 12px;
  background: var(--input-bg);
}
.code-login-input:focus-within {
  border-color: var(--theme-primary);
  box-shadow: 0 0 0 3px rgb(35 132 82 / 12%);
}
.code-login-input input {
  flex: 1;
  width: 100%;
  min-width: 0;
  padding: 12px 14px;
  border: 0;
  background: transparent;
  color: var(--theme-text);
  font-size: 16px;
  outline: none;
}
.code-login-input input::-ms-reveal {
  display: none;
}
.code-login-input button {
  display: grid;
  flex: none;
  width: 48px;
  min-height: 48px;
  place-items: center;
  color: var(--muted-text);
  font-size: 20px;
}
button:focus-visible {
  outline: 2px solid var(--theme-primary);
  outline-offset: -3px;
}
.code-login-error {
  min-height: 44px;
  padding: 10px 0;
  color: #bf3b3b;
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.code-login-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  min-height: 48px;
  padding: 12px 16px;
  border: 1px solid #216c43;
  border-bottom-width: 3px;
  border-radius: 12px;
  background: var(--theme-primary);
  color: white;
  font-size: 14px;
  font-weight: 650;
  transition: background 150ms;
}
.code-login-submit:hover {
  background: var(--theme-secondary);
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  margin-top: 28px;
  color: var(--muted-text);
  font-size: 12px;
  letter-spacing: 0.5px;
}
@media (max-width: 820px) {
  .code-login {
    grid-template-columns: minmax(0, 420px);
    justify-content: center;
    gap: 25px;
    padding: 64px 20px 32px;
  }
  .code-login-scene {
    padding-block: 0;
  }
  .code-login-scene h2 {
    font-size: 34px;
    margin: 15px 0 0;
    letter-spacing: 0;
  }
  .code-login-intro,
  .code-login-scene-caption {
    display: none;
  }
  .code-login-content {
    padding: 28px 24px;
    border-radius: 22px;
  }
}
</style>
