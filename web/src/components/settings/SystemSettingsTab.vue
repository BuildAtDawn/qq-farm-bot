<script setup lang="ts">
import type { AutoCodeRefreshConfig } from '@/stores/setting'
import { onMounted, watch } from 'vue'
import AccessCodeSettings from '@/components/settings/AccessCodeSettings.vue'
import AutoCodeRefreshCard from '@/components/settings/AutoCodeRefreshCard.vue'
import GlobalSettingsCard from '@/components/settings/GlobalSettingsCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useSystemSettings } from '@/composables/settings/useSystemSettings'

const { form, loading, saving, loaded, error, saved, validationError, load, save } = useSystemSettings()
watch(form, () => {
  saved.value = false
}, { deep: true, flush: 'sync' })
onMounted(load)

async function saveKeepalive(config: AutoCodeRefreshConfig) {
  if (loading.value || saving.value || !loaded.value)
    return false
  const previous = form.value.autoCodeRefresh
  form.value.autoCodeRefresh = config
  const success = await save()
  if (!success)
    form.value.autoCodeRefresh = previous
  return success
}
</script>

<template>
  <section class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
        全局设置
      </h3>
      <BaseButton size="sm" :loading="saving" :disabled="loading || !loaded || !!validationError" @click="save">
        <span class="i-carbon-save mr-2" aria-hidden="true" />
        保存全局设置
      </BaseButton>
    </div>

    <div v-if="loading" class="flex items-center gap-2 py-6 text-sm text-gray-500">
      <span class="i-svg-spinners-ring-resize" aria-hidden="true" />
      正在读取全局设置
    </div>
    <template v-else>
      <div v-if="error" role="alert" class="flex flex-wrap items-center gap-3 text-sm text-red-600 dark:text-red-400">
        <span>{{ error }}</span>
        <BaseButton v-if="!loaded" size="sm" variant="secondary" @click="load">
          <span class="i-carbon-renew mr-2" aria-hidden="true" />
          重试
        </BaseButton>
      </div>
      <div v-if="loaded" class="grid grid-cols-1 min-w-0 items-start gap-5 lg:grid-cols-2">
        <div class="min-w-0 space-y-5">
          <AccessCodeSettings />
          <GlobalSettingsCard title="通知跳转地址" icon="i-carbon-link">
            <BaseInput v-model="form.publicWebOrigin" label="公网地址前缀" placeholder="https://123.com" :disabled="saving" />
          </GlobalSettingsCard>
        </div>
        <div class="min-w-0 space-y-5">
          <AutoCodeRefreshCard
            v-model:config="form.autoCodeRefresh"
            :loading="loading" :saving="saving" :save-config="saveKeepalive"
          />
          <GlobalSettingsCard title="后台有机肥循环间隔" icon="i-carbon-time">
            <div class="grid grid-cols-1 min-w-0 gap-4 sm:grid-cols-2">
              <BaseInput
                v-model.number="form.organicFertilizerDelayMinMs"
                label="间隔下限（毫秒）"
                aria-label="有机肥循环间隔下限（毫秒）"
                type="number" :min="0" :max="60000" :step="1" :disabled="saving"
              />
              <BaseInput
                v-model.number="form.organicFertilizerDelayMaxMs"
                label="间隔上限（毫秒）"
                aria-label="有机肥循环间隔上限（毫秒）"
                type="number" :min="0" :max="60000" :step="1" :disabled="saving"
              />
            </div>
          </GlobalSettingsCard>
        </div>
      </div>
      <div v-if="loaded" aria-live="polite">
        <p v-if="validationError" role="alert" class="text-sm text-red-600 dark:text-red-400">
          {{ validationError }}
        </p>
        <p v-else-if="saved" role="status" class="text-sm text-green-600 dark:text-green-400">
          全局设置已保存并生效
        </p>
      </div>
    </template>
  </section>
</template>
