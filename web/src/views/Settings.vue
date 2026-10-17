<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/api'
import AdminSystemPanel from '@/components/admin/AdminSystemPanel.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import AccountFeatureSettings from '@/components/settings/AccountFeatureSettings.vue'
import AccountSettingsTab from '@/components/settings/AccountSettingsTab.vue'
import DeviceProtocolCard from '@/components/settings/DeviceProtocolCard.vue'
import FriendMonitorCard from '@/components/settings/FriendMonitorCard.vue'
import OfflineReminderCard from '@/components/settings/OfflineReminderCard.vue'
import SystemSettingsTab from '@/components/settings/SystemSettingsTab.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import FarmPageHeader from '@/components/ui/FarmPageHeader.vue'
import { useAccountSettings } from '@/composables/settings/useAccountSettings'
import { useAutomationSettings } from '@/composables/settings/useAutomationSettings'
import { useStrategySettings } from '@/composables/settings/useStrategySettings'
import { useUserSettings } from '@/composables/settings/useUserSettings'
import { useAdminSystemConfig } from '@/composables/useAdminSystemConfig'
import { createDefaultFriendMonitor, useSettingStore } from '@/stores/setting'

const settingStore = useSettingStore()
const route = useRoute()

type SettingsTabKey = 'account' | 'account-config' | 'notification' | 'system' | 'system-settings'

const SETTINGS_TAB_KEYS: SettingsTabKey[] = ['account', 'account-config', 'notification', 'system', 'system-settings']
const LEGACY_SETTINGS_TABS: Record<string, SettingsTabKey> = {
  'strategy': 'account-config',
  'automation': 'account-config',
  'default-plan': 'account-config',
  'user': 'notification',
  'capture': 'system',
}

function getInitialSettingsTab(): SettingsTabKey {
  const requested = String(route.query.tab || '')
  if (LEGACY_SETTINGS_TABS[requested])
    return LEGACY_SETTINGS_TABS[requested]
  if (SETTINGS_TAB_KEYS.includes(requested as SettingsTabKey))
    return requested as SettingsTabKey
  const saved = localStorage.getItem('settings-active-tab')
  if (saved && LEGACY_SETTINGS_TABS[saved])
    return LEGACY_SETTINGS_TABS[saved]
  return SETTINGS_TAB_KEYS.includes(saved as SettingsTabKey)
    ? saved as SettingsTabKey
    : 'account'
}

const activeTab = ref<SettingsTabKey>(getInitialSettingsTab())
const settingsTabsNav = ref<HTMLElement | null>(null)

async function scrollActiveTabIntoView() {
  await nextTick()
  const button = settingsTabsNav.value?.querySelector<HTMLElement>(`[data-settings-tab="${activeTab.value}"]`)
  button?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
}

watch(activeTab, (newTab) => {
  localStorage.setItem('settings-active-tab', newTab)
  void scrollActiveTabIntoView()
})

const tabs = [
  { key: 'account', label: '账号管理', icon: 'i-carbon-user-settings' },
  { key: 'account-config', label: '账号设置', icon: 'i-carbon-settings-adjust' },
  { key: 'notification', label: '通知设置', icon: 'i-carbon-notification' },
  { key: 'system-settings', label: '全局设置', icon: 'i-carbon-settings' },
  { key: 'system', label: '连接与设备', icon: 'i-carbon-settings-services' },
] as const

const modalVisible = ref(false)
const defaultPlanSettingId = ref('')
const defaultPlanApplyingId = ref('')
const defaultPlanConfirmation = ref<{
  action: 'set' | 'apply'
  account: any
} | null>(null)
const defaultPlanConfirmationVisible = computed(() => !!defaultPlanConfirmation.value)
const defaultPlanConfirmationTitle = computed(() =>
  defaultPlanConfirmation.value?.action === 'set' ? '设置默认方案' : '应用默认方案',
)
const defaultPlanConfirmationMessage = computed(() => {
  const pending = defaultPlanConfirmation.value
  if (!pending)
    return ''
  const accountName = pending.account?.name || pending.account?.id
  return pending.action === 'set'
    ? `确定将 ${accountName} 的当前配置设置为默认方案吗？这会覆盖此前保存的默认方案。`
    : `确定将默认方案应用到 ${accountName} 吗？这会覆盖该账号当前的相关配置。`
})
const modalConfig = ref({
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  isAlert: true,
})

function showAlert(message: string, type: 'primary' | 'danger' = 'primary') {
  modalConfig.value = {
    title: type === 'danger' ? '错误' : '提示',
    message,
    type,
    isAlert: true,
  }
  modalVisible.value = true
}

const {
  systemConfigSaving,
  captureConfigSaving,
  captureConfigTesting,
  localSystemConfig,
  defaultSystemConfig,
  localCaptureConfig,
  platformOptions,
  osOptions,
  loadCaptureConfig,
  handleTestCaptureConfig,
  loadSystemConfig,
  handleResetSystemConfig,
} = useAdminSystemConfig({ showAlert })

const {
  offlineSaving,
  offlineTesting,
  deviceProtocolLoading,
  deviceProtocolSaving,
  deviceProtocolPresetOptions,
  selectedDevicePreset,
  deviceProtocolForm,
  localOffline,
  fillRandomDeviceMac,
  fillRandomDeviceId,
  fillRandomImei,
  applyDevicePreset,
  fetchDeviceProtocol,
  syncLocalOfflineSettings,
  handleSaveOffline,
  handleTestOffline,
} = useUserSettings(showAlert)

const {
  accounts,
  accountsLoading,
  currentAccountId,
  currentAccountName,
  userIsAdmin,
  showModal,
  showDeleteConfirm,
  deleteLoading,
  editingAccount,
  accountToDelete,
  showClearStoppedConfirm,
  clearStoppedLoading,
  refreshWxCodesLoading,
  stoppedAccountsCount,
  isAddAccountDisabled,
  addAccountDisabledReason,
  isAccountOpsDisabled,
  fetchAccounts,
  selectFirstAccountIfNeeded,
  openAddModal,
  openEditModal,
  handleDelete,
  confirmDelete,
  toggleAccount,
  refreshWxCodesNow,
  handleSaved,
  selectAccount,
  openClearStoppedConfirm,
  confirmClearStopped,
} = useAccountSettings(showAlert)

const {
  localAutomationSettings,
  fertilizerLandTypeOptions,
  fertilizerOptions,
  syncLocalAutomationSettings,
} = useAutomationSettings({
  currentAccountId,
  showAlert,
})

const {
  settingsLoading,
  localStrategySettings,
  plantingStrategyOptions,
  bagFallbackStrategyOptions,
  strategyPreviewLabel,
  loadStrategyData,
  resetStrategyState,
} = useStrategySettings({
  currentAccountId,
  getAutomationSettings: () => localAutomationSettings.value,
  showAlert,
})

const accountSettingsSaving = ref(false)
const localFriendMonitor = ref(createDefaultFriendMonitor())
watch(() => settingStore.settings.friendMonitor, (value) => {
  localFriendMonitor.value = JSON.parse(JSON.stringify(value))
}, { deep: true })
const systemSettingsSaving = ref(false)
const anySystemSaving = computed(() => systemSettingsSaving.value || systemConfigSaving.value || captureConfigSaving.value || deviceProtocolSaving.value)

function buildCurrentAccountConfig() {
  return {
    ...settingStore.settings,
    ...localStrategySettings.value,
    ...localAutomationSettings.value,
    friendMonitor: localFriendMonitor.value,
  }
}

async function saveCurrentAccountSettings(_module?: string, quiet = false, overrides: Partial<ReturnType<typeof buildCurrentAccountConfig>> = {}) {
  if (!currentAccountId.value || accountSettingsSaving.value)
    return false
  accountSettingsSaving.value = true
  try {
    const result = await settingStore.saveSettings(String(currentAccountId.value), { ...buildCurrentAccountConfig(), ...overrides })
    if (!result.ok)
      throw new Error(result.error || '保存失败')
    if (!quiet)
      showAlert('账号设置已保存')
    return true
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '账号设置保存失败', 'danger')
    return false
  }
  finally {
    accountSettingsSaving.value = false
  }
}

async function saveFriendMonitorSettings(config: typeof localFriendMonitor.value) {
  return saveCurrentAccountSettings(undefined, false, { friendMonitor: config })
}

function openAccountSettings(account: any) {
  selectAccount(account)
  activeTab.value = 'account-config'
}

async function saveSystemSettings() {
  if (anySystemSaving.value)
    return
  systemSettingsSaving.value = true
  try {
    const devicePayload = {
      enabled: !!deviceProtocolForm.value.enabled,
      userAgent: String(deviceProtocolForm.value.userAgent || '').trim(),
      deviceBrand: String(deviceProtocolForm.value.deviceBrand || '').trim(),
      deviceModel: String(deviceProtocolForm.value.deviceModel || '').trim(),
      deviceMac: String(deviceProtocolForm.value.deviceMac || '').trim(),
      deviceId: String(deviceProtocolForm.value.deviceId || '').trim(),
      imei: String(deviceProtocolForm.value.imei || '').trim(),
    }
    const [systemResult, captureResult, deviceResult] = await Promise.all([
      api.post('/api/admin/system-config', { ...localSystemConfig.value, confirmed: true }),
      api.post('/api/admin/capture-config', { ...localCaptureConfig.value, confirmed: true }),
      api.post('/api/user/device-protocol', devicePayload),
    ])
    if (!systemResult.data?.ok || !captureResult.data?.ok || !deviceResult.data?.ok)
      throw new Error('部分系统配置保存失败')
    await Promise.all([loadSystemConfig(), loadCaptureConfig(), fetchDeviceProtocol()])
    showAlert('系统配置已统一保存并生效')
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '系统配置保存失败', 'danger')
  }
  finally {
    systemSettingsSaving.value = false
  }
}

async function applyDefaultPlan(account: any) {
  if (!account?.id || defaultPlanSettingId.value || defaultPlanApplyingId.value)
    return
  const accountId = String(account.id)
  defaultPlanApplyingId.value = accountId
  try {
    const { data } = await api.post('/api/settings/default-plan/apply', {}, {
      headers: { 'x-account-id': accountId },
    })
    if (!data?.ok)
      throw new Error(data?.error || '应用失败')
    if (String(currentAccountId.value || '') === accountId) {
      settingStore.clearSettingsState()
      resetStrategyState()
      await loadStrategyData()
      syncLocalAutomationSettings()
    }
    showAlert(`已将默认方案应用到 ${account.name || account.id}`)
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '应用默认方案失败', 'danger')
  }
  finally {
    defaultPlanApplyingId.value = ''
  }
}

async function setDefaultPlan(account: any) {
  if (!account?.id || defaultPlanSettingId.value || defaultPlanApplyingId.value)
    return
  const accountId = String(account.id)
  defaultPlanSettingId.value = accountId
  try {
    const { data } = await api.post('/api/settings/default-plan/import', {}, {
      headers: { 'x-account-id': accountId },
    })
    if (!data?.ok)
      throw new Error(data?.error || '设置失败')
    showAlert(`已将 ${account.name || account.id} 的配置设置为默认方案`)
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '设置默认方案失败', 'danger')
  }
  finally {
    defaultPlanSettingId.value = ''
  }
}

function requestDefaultPlanConfirmation(action: 'set' | 'apply', account: any) {
  if (!account?.id || defaultPlanSettingId.value || defaultPlanApplyingId.value)
    return
  defaultPlanConfirmation.value = { action, account }
}

function closeDefaultPlanConfirmation() {
  defaultPlanConfirmation.value = null
}

function confirmDefaultPlanOperation() {
  const pending = defaultPlanConfirmation.value
  if (!pending)
    return
  closeDefaultPlanConfirmation()
  if (pending.action === 'set')
    void setDefaultPlan(pending.account)
  else
    void applyDefaultPlan(pending.account)
}

watch(currentAccountId, async () => {
  settingStore.clearSettingsState()
  resetStrategyState()
  if (currentAccountId.value) {
    await loadStrategyData()
    syncLocalAutomationSettings()
    syncLocalOfflineSettings()
  }
})

onMounted(async () => {
  await Promise.all([loadSystemConfig(), loadCaptureConfig()])
  await fetchAccounts()
  await fetchDeviceProtocol()
  selectFirstAccountIfNeeded()
  if (currentAccountId.value) {
    await loadStrategyData()
    syncLocalAutomationSettings()
    syncLocalOfflineSettings()
  }
  await scrollActiveTabIntoView()
})
</script>

<template>
  <div class="settings-page space-y-5">
    <FarmPageHeader scene title="设置" description="账号、通知与运行配置" icon="i-carbon-settings" />

    <div class="settings-workspace">
      <aside class="settings-navigation">
        <div class="settings-navigation-label">
          账号与偏好
        </div>
        <nav ref="settingsTabsNav" class="settings-categories" aria-label="设置分类">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :data-settings-tab="tab.key"
            class="settings-category"
            :aria-pressed="activeTab === tab.key"
            @click="activeTab = tab.key"
          >
            <div :class="tab.icon" />
            {{ tab.label }}
          </button>
        </nav>
      </aside>

      <div class="settings-body">
        <!-- 账号管理 -->
        <AccountSettingsTab
          v-if="activeTab === 'account'"
          :accounts="accounts"
          :accounts-loading="accountsLoading"
          :current-account-id="currentAccountId"
          :user-is-admin="userIsAdmin"
          :stopped-accounts-count="stoppedAccountsCount"
          :is-add-account-disabled="isAddAccountDisabled"
          :add-account-disabled-reason="addAccountDisabledReason"
          :is-account-ops-disabled="isAccountOpsDisabled"
          :show-modal="showModal"
          :editing-account="editingAccount"
          :show-delete-confirm="showDeleteConfirm"
          :delete-loading="deleteLoading"
          :account-to-delete="accountToDelete"
          :show-clear-stopped-confirm="showClearStoppedConfirm"
          :clear-stopped-loading="clearStoppedLoading"
          :refresh-wx-codes-loading="refreshWxCodesLoading"
          :default-plan-setting-id="defaultPlanSettingId"
          :default-plan-applying-id="defaultPlanApplyingId"
          @add="openAddModal"
          @clear-stopped="openClearStoppedConfirm"
          @refresh-wx-codes="refreshWxCodesNow"
          @select="selectAccount"
          @toggle="toggleAccount"
          @settings="openAccountSettings"
          @set-default-plan="requestDefaultPlanConfirmation('set', $event)"
          @apply-default-plan="requestDefaultPlanConfirmation('apply', $event)"
          @edit="openEditModal"
          @delete="handleDelete"
          @saved="handleSaved"
          @close-modal="showModal = false"
          @close-delete-confirm="showDeleteConfirm = false"
          @confirm-delete="confirmDelete"
          @close-clear-stopped-confirm="showClearStoppedConfirm = false"
          @confirm-clear-stopped="confirmClearStopped"
        />

        <div v-else-if="activeTab === 'account-config'" class="space-y-4">
          <AccountFeatureSettings
            v-model:strategy="localStrategySettings"
            v-model:automation="localAutomationSettings"
            :current-account-name="currentAccountName"
            :current-account-id="currentAccountId"
            :loading="settingsLoading"
            :saving="accountSettingsSaving"
            :planting-strategy-options="plantingStrategyOptions"
            :bag-fallback-strategy-options="bagFallbackStrategyOptions"
            :strategy-preview-label="strategyPreviewLabel"
            :fertilizer-land-type-options="fertilizerLandTypeOptions"
            :fertilizer-options="fertilizerOptions"
            @save="saveCurrentAccountSettings"
          >
            <FriendMonitorCard v-model:config="localFriendMonitor" :account-id="currentAccountId" :loading="settingsLoading" :saving="accountSettingsSaving" :save-config="saveFriendMonitorSettings" />
          </AccountFeatureSettings>
        </div>

        <div v-else-if="activeTab === 'notification'" class="space-y-4">
          <div class="notification-settings-toolbar">
            <div>
              <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
                通知设置
              </h3>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                通知渠道与事件
              </p>
            </div>
            <BaseButton size="sm" :loading="offlineSaving" :disabled="offlineTesting" @click="handleSaveOffline">
              <span class="i-carbon-save mr-1.5" aria-hidden="true" />保存通知设置
            </BaseButton>
          </div>
          <OfflineReminderCard
            v-model:config="localOffline"
            :saving="offlineSaving"
            :testing="offlineTesting"
            :show-save="false"
            @test="handleTestOffline"
          />
        </div>

        <template v-else-if="activeTab === 'system-settings'">
          <SystemSettingsTab v-if="userIsAdmin" />
          <p v-else class="py-6 text-sm text-gray-500 dark:text-gray-400">
            仅管理员可修改全局设置
          </p>
        </template>

        <div v-else-if="activeTab === 'system'" class="space-y-5">
          <div class="sticky top-0 z-10 flex items-center justify-between border border-gray-200 rounded-xl bg-white/95 p-4 shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-800/95">
            <div>
              <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
                连接与设备
              </h3>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                统一管理连接参数、设备协议和抓包服务。
              </p>
            </div>
            <BaseButton size="sm" :loading="anySystemSaving" @click="saveSystemSettings">
              保存连接配置
            </BaseButton>
          </div>

          <AdminSystemPanel
            v-model:local-system-config="localSystemConfig"
            v-model:local-capture-config="localCaptureConfig"
            section="system"
            :show-heading="false"
            :show-save="false"
            :default-system-config="defaultSystemConfig"
            :platform-options="platformOptions"
            :os-options="osOptions"
            :system-config-saving="systemConfigSaving"
            :capture-config-saving="captureConfigSaving"
            :capture-config-testing="captureConfigTesting"
            @reset-system="handleResetSystemConfig"
            @test-capture="handleTestCaptureConfig"
          />

          <DeviceProtocolCard
            v-model:form="deviceProtocolForm"
            v-model:selected-preset="selectedDevicePreset"
            :loading="deviceProtocolLoading"
            :saving="deviceProtocolSaving"
            :preset-options="deviceProtocolPresetOptions"
            :show-save="false"
            @apply-preset="applyDevicePreset"
            @random-mac="fillRandomDeviceMac"
            @random-device-id="fillRandomDeviceId"
            @random-imei="fillRandomImei"
          />

          <AdminSystemPanel
            v-model:local-system-config="localSystemConfig"
            v-model:local-capture-config="localCaptureConfig"
            section="capture"
            :show-heading="false"
            :show-save="false"
            :default-system-config="defaultSystemConfig"
            :platform-options="platformOptions"
            :os-options="osOptions"
            :system-config-saving="systemConfigSaving"
            :capture-config-saving="captureConfigSaving"
            :capture-config-testing="captureConfigTesting"
            @test-capture="handleTestCaptureConfig"
          />
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="defaultPlanConfirmationVisible"
      :title="defaultPlanConfirmationTitle"
      :message="defaultPlanConfirmationMessage"
      type="danger"
      confirm-text="确认执行"
      @confirm="confirmDefaultPlanOperation"
      @close="closeDefaultPlanConfirmation"
      @cancel="closeDefaultPlanConfirmation"
    />

    <ConfirmModal
      :show="modalVisible"
      :title="modalConfig.title"
      :message="modalConfig.message"
      :type="modalConfig.type"
      :is-alert="modalConfig.isAlert"
      confirm-text="知道了"
      @confirm="modalVisible = false"
      @close="modalVisible = false"
      @cancel="modalVisible = false"
    />
  </div>
</template>

<style scoped>
.notification-settings-toolbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0 12px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--surface-1);
}
.notification-settings-toolbar h3 {
  font-size: 16px;
}
.settings-workspace {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.settings-navigation {
  padding: 12px 8px;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  background: var(--surface-1);
}
.settings-navigation-label {
  padding: 3px 12px 10px;
  color: var(--muted-text);
  font-size: 12px;
  letter-spacing: 0;
}
.settings-categories {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.settings-category {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  text-align: left;
  color: var(--muted-text);
  font-size: 13px;
}
.settings-category > div {
  font-size: 18px;
  flex-shrink: 0;
}
.settings-category:hover {
  background: var(--surface-2);
  color: var(--theme-primary);
}
.settings-category[aria-pressed='true'] {
  background: #edf3e4;
  border-color: #e0e9d4;
  color: var(--theme-primary);
  font-weight: 650;
}
.settings-body {
  min-width: 0;
}
.settings-body :deep(.rounded-lg.bg-white),
.settings-body :deep(.rounded-xl.bg-white) {
  border-color: var(--surface-border);
  border-radius: 8px;
  background: var(--surface-1);
  box-shadow: var(--surface-shadow-soft);
}
@media (max-width: 1100px) {
  .settings-workspace {
    grid-template-columns: 160px minmax(0, 1fr);
    gap: 16px;
  }
}
@media (max-width: 767px) {
  .settings-workspace {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  .settings-navigation {
    padding: 7px;
  }
  .settings-navigation-label {
    display: none;
  }
  .settings-categories {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 4px;
    overflow-x: auto;
  }
  .settings-category {
    flex-shrink: 0;
    flex: 1 0 auto;
    min-height: 40px;
    justify-content: center;
    gap: 6px;
    padding: 8px 10px;
    white-space: nowrap;
  }
}
</style>
