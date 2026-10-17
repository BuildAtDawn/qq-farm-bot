<script setup lang="ts">
import { ref } from 'vue'
import api from '@/api'
import GlobalSettingsCard from '@/components/settings/GlobalSettingsCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { redirectToCodeLogin } from '@/utils/admin-auth'

const code = ref('')
const confirmation = ref('')
const saving = ref(false)
const error = ref('')
const saved = ref(false)

async function save() {
  if (saving.value)
    return
  error.value = ''
  saved.value = false
  if (!code.value.trim() || code.value.length > 128) {
    error.value = '访问 Code 必须为 1～128 个字符，且不能全为空格'
    return
  }
  if (code.value !== confirmation.value) {
    error.value = '两次输入的访问 Code 不一致'
    return
  }
  saving.value = true
  try {
    const { data } = await api.put('/api/admin/access-code', { code: code.value })
    if (!data?.ok)
      throw new Error(data?.error || '访问 Code 保存失败')
    code.value = ''
    confirmation.value = ''
    if (data.data?.changed)
      redirectToCodeLogin()
    else
      saved.value = true
  }
  catch (cause: any) {
    error.value = cause.response?.data?.error || cause.message || '访问 Code 保存失败'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <GlobalSettingsCard title="访问 Code" icon="i-carbon-locked">
    <form class="space-y-4" :aria-busy="saving" @submit.prevent="save">
      <BaseInput v-model="code" label="新访问 Code" type="password" autocomplete="new-password" :maxlength="128" :disabled="saving" />
      <BaseInput v-model="confirmation" label="确认访问 Code" type="password" autocomplete="new-password" :maxlength="128" :disabled="saving" />
      <p class="text-xs text-gray-500 dark:text-gray-400">
        变更后所有已登录会话立即失效，需要使用新 Code 重新登录。
      </p>
      <p v-if="error" role="alert" class="text-sm text-red-600">
        {{ error }}
      </p>
      <p v-if="saved" role="status" class="text-sm text-green-600">
        与当前 Code 相同，无需变更。
      </p>
      <div class="flex justify-end border-t border-gray-100 pt-4 dark:border-gray-700">
        <BaseButton type="submit" size="sm" :loading="saving" :disabled="saving">
          <span class="i-carbon-save mr-2" aria-hidden="true" />修改访问 Code
        </BaseButton>
      </div>
    </form>
  </GlobalSettingsCard>
</template>
