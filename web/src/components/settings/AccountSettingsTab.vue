<script setup lang="ts">
import { useNow } from '@vueuse/core'
import AccountModal from '@/components/AccountModal.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { getPlatformClass, getPlatformLabel } from '@/stores/account'
import { getAccountRuntimeStatus, isAccountActive } from '@/utils/account-runtime'

defineProps<{
  accounts: any[]
  accountsLoading: boolean
  currentAccountId: string | number | null | undefined
  userIsAdmin: boolean
  stoppedAccountsCount: number
  isAddAccountDisabled: boolean
  addAccountDisabledReason: string
  isAccountOpsDisabled: boolean
  showModal: boolean
  editingAccount: any
  showDeleteConfirm: boolean
  deleteLoading: boolean
  accountToDelete: any
  showClearStoppedConfirm: boolean
  clearStoppedLoading: boolean
  refreshWxCodesLoading: boolean
  defaultPlanSettingId: string
  defaultPlanApplyingId: string
}>()

const emit = defineEmits<{
  add: []
  clearStopped: []
  refreshWxCodes: []
  select: [account: any]
  toggle: [account: any]
  settings: [account: any]
  setDefaultPlan: [account: any]
  applyDefaultPlan: [account: any]
  edit: [account: any]
  delete: [account: any]
  saved: []
  closeModal: []
  closeDeleteConfirm: []
  confirmDelete: []
  closeClearStoppedConfirm: []
  confirmClearStopped: []
}>()

const now = useNow({ interval: 1000 })

function credentialStatus(acc: any) {
  const invalidColor = 'text-red-600 dark:text-red-400'
  let expiresAt = Number(acc.expires_at)
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    const refreshedAt = Number(acc.wxCredentialRefreshedAt)
    const ttl = Number(acc.expires_in)
    if (!Number.isFinite(refreshedAt) || refreshedAt <= 0)
      return { text: '访问凭证：到期时间未知', color: 'text-gray-500' }
    if (refreshedAt > now.value.getTime())
      return { text: '访问凭证：时间异常', color: invalidColor }
    expiresAt = refreshedAt + (Number.isFinite(ttl) && ttl > 0 ? ttl : 7200) * 1000
  }
  const remaining = expiresAt - now.value.getTime()
  const seconds = Math.max(0, Math.ceil(remaining / 1000))
  const duration = `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds / 60) % 60} 分 ${String(seconds % 60).padStart(2, '0')} 秒`
  const warning = !!acc.wxCredentialRefreshError
  return {
    text: remaining <= 0 ? '访问凭证：已过期'
      : `访问凭证：剩余 ${duration}${remaining <= 45 * 60000 ? ' · 待续期' : ''}`,
    color: remaining <= 0 ? invalidColor : warning || remaining <= 45 * 60000
      ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400',
  }
}

function accountAvatar(acc: any) {
  const direct = String(acc?.avatar || acc?.avatarUrl || acc?.avatar_url || '').trim()
  if (direct)
    return direct
  const qq = String(acc?.uin || acc?.qq || '').trim()
  if (/^\d+$/.test(qq))
    return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`
  return ''
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
        账号管理
      </h3>
      <div class="flex flex-wrap gap-2">
        <BaseButton
          variant="outline"
          size="sm"
          :loading="refreshWxCodesLoading"
          :disabled="accountsLoading || accounts.length === 0"
          @click="emit('refreshWxCodes')"
        >
          <div class="i-carbon-renew mr-2" />
          <span class="hidden sm:inline">{{ userIsAdmin ? '续期全部微信授权' : '续期我的微信授权' }}</span>
          <span class="sm:hidden">授权续期</span>
        </BaseButton>
        <BaseButton
          v-if="userIsAdmin"
          variant="secondary"
          size="sm"
          :disabled="stoppedAccountsCount === 0"
          @click="emit('clearStopped')"
        >
          <div class="i-carbon-trash-can mr-2" />
          <span class="hidden sm:inline">一键清理</span>
          <span class="sm:hidden">清理</span>
          ({{ stoppedAccountsCount }})
        </BaseButton>
        <BaseButton
          variant="primary"
          size="sm"
          :disabled="isAddAccountDisabled"
          :title="addAccountDisabledReason"
          @click="emit('add')"
        >
          <div class="i-carbon-add mr-2" />
          添加账号
        </BaseButton>
      </div>
    </div>

    <div v-if="accountsLoading && accounts.length === 0" class="py-8 text-center text-gray-500">
      <div i-svg-spinners-90-ring-with-bg class="mb-2 inline-block text-2xl" />
      <div>加载中...</div>
    </div>

    <div v-else-if="accounts.length === 0" class="farm-content-card rounded-lg bg-white py-12 text-center shadow dark:bg-gray-800">
      <div i-carbon-user-avatar class="mb-4 inline-block text-4xl text-gray-400" />
      <p class="mb-4 text-gray-500">
        暂无账号
      </p>
      <BaseButton
        variant="text"
        size="sm"
        :disabled="isAddAccountDisabled"
        :title="addAccountDisabledReason"
        @click="emit('add')"
      >
        立即添加
      </BaseButton>
    </div>

    <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-3 sm:grid-cols-2 xl:grid-cols-4">
      <div
        v-for="acc in accounts"
        :key="acc.id"
        class="farm-content-card cursor-pointer border rounded-lg bg-white p-3 shadow transition-all duration-200 dark:bg-gray-800 sm:p-4"
        :class="String(currentAccountId) === String(acc.id)
          ? 'ring-2'
          : 'border-transparent'"
        :style="String(currentAccountId) === String(acc.id)
          ? { borderColor: 'var(--theme-primary)', backgroundColor: 'rgba(var(--theme-primary-rgb, 59, 130, 246), 0.1)' }
          : {}"
        @click="emit('select', acc)"
      >
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div class="min-w-0 flex flex-1 items-center gap-3">
            <div class="h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 sm:h-12 sm:w-12 dark:bg-gray-700">
              <img v-if="accountAvatar(acc)" :src="accountAvatar(acc)" class="h-full w-full object-cover">
              <div v-else class="i-carbon-user text-xl text-gray-400 sm:text-2xl" />
            </div>
            <div class="min-w-0 flex-1">
              <h4 class="truncate text-base font-bold sm:text-lg">
                {{ acc.name || acc.nick || acc.id }}
              </h4>
              <div class="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span
                  v-if="acc.platform"
                  class="rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight"
                  :class="getPlatformClass(acc.platform)"
                >
                  {{ getPlatformLabel(acc.platform) }}
                </span>
              </div>
            </div>
          </div>
          <div class="flex items-center justify-end gap-2 sm:flex-col sm:items-end">
            <BaseButton
              variant="secondary"
              size="sm"
              class="border rounded-full shadow-sm transition-all duration-500 ease-in-out sm:w-20 active:scale-95"
              :class="isAccountActive(acc) ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100 focus:ring-red-500 active:border-red-300 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 dark:focus:ring-red-500 dark:active:border-red-700' : 'border-green-200 bg-green-50 text-green-600 hover:bg-green-100 focus:ring-green-500 active:border-green-300 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30 dark:focus:ring-green-500 dark:active:border-green-700'"
              :disabled="acc.runtimeState === 'stopping' || (!isAccountActive(acc) && isAccountOpsDisabled)"
              :title="!isAccountActive(acc) && isAccountOpsDisabled ? '账号已到期，无法启动账号' : ''"
              @click="emit('toggle', acc)"
            >
              <div v-if="isAccountActive(acc)" class="i-carbon-stop-filled mr-1" />
              <div v-else class="i-carbon-play-filled mr-1" />
              {{ isAccountActive(acc) ? '停止' : '启动' }}
            </BaseButton>
          </div>
        </div>

        <div class="mt-3 min-h-5 flex items-center gap-2 text-xs text-gray-600 tabular-nums dark:text-gray-300" role="status">
          <div v-if="getAccountRuntimeStatus(acc, now.getTime()).busy" class="i-svg-spinners-ring-resize shrink-0" />
          <div v-else class="h-2 w-2 shrink-0 rounded-full" :class="getAccountRuntimeStatus(acc, now.getTime()).color" />
          <span class="min-w-0 break-words">{{ getAccountRuntimeStatus(acc, now.getTime()).text }}</span>
        </div>

        <p v-if="acc.platform === 'wx'" class="mt-3 break-words text-xs tabular-nums" :class="credentialStatus(acc).color">
          {{ credentialStatus(acc).text }}
        </p>

        <div class="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 sm:mt-4 dark:border-gray-700 sm:pt-4">
          <div class="flex flex-1 justify-end gap-1 sm:flex-initial sm:gap-2">
            <BaseButton
              :data-testid="`set-default-plan-${acc.id}`"
              variant="ghost"
              class="group relative min-h-[36px] min-w-[36px] !p-2"
              :loading="defaultPlanSettingId === String(acc.id)"
              :disabled="!!defaultPlanSettingId || !!defaultPlanApplyingId"
              aria-label="设置默认方案"
              title="设置默认方案"
              @click="emit('setDefaultPlan', acc)"
            >
              <div v-if="defaultPlanSettingId !== String(acc.id)" i-carbon-document-export />
              <span class="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity duration-150 -translate-x-1/2 dark:bg-gray-100 dark:text-gray-900 group-focus-visible:opacity-100 group-hover:opacity-100">
                设置默认方案
              </span>
            </BaseButton>
            <BaseButton
              :data-testid="`apply-default-plan-${acc.id}`"
              variant="ghost"
              class="group relative min-h-[36px] min-w-[36px] !p-2"
              :loading="defaultPlanApplyingId === String(acc.id)"
              :disabled="!!defaultPlanSettingId || !!defaultPlanApplyingId"
              aria-label="应用默认方案"
              title="应用默认方案"
              @click="emit('applyDefaultPlan', acc)"
            >
              <div v-if="defaultPlanApplyingId !== String(acc.id)" i-carbon-document-import />
              <span class="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity duration-150 -translate-x-1/2 dark:bg-gray-100 dark:text-gray-900 group-focus-visible:opacity-100 group-hover:opacity-100">
                应用默认方案
              </span>
            </BaseButton>
            <BaseButton
              variant="ghost"
              class="group relative min-h-[36px] min-w-[36px] !p-2"
              aria-label="设置"
              title="设置"
              @click="emit('settings', acc)"
            >
              <div i-carbon-settings />
              <span class="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity duration-150 -translate-x-1/2 dark:bg-gray-100 dark:text-gray-900 group-focus-visible:opacity-100 group-hover:opacity-100">
                设置
              </span>
            </BaseButton>
            <BaseButton
              variant="ghost"
              class="group relative min-h-[36px] min-w-[36px] !p-2"
              aria-label="编辑"
              title="编辑"
              @click="emit('edit', acc)"
            >
              <div i-carbon-edit />
              <span class="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity duration-150 -translate-x-1/2 dark:bg-gray-100 dark:text-gray-900 group-focus-visible:opacity-100 group-hover:opacity-100">
                编辑
              </span>
            </BaseButton>
            <BaseButton
              variant="ghost"
              class="group relative min-h-[36px] min-w-[36px] text-red-500 !p-2 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300"
              aria-label="删除"
              title="删除"
              @click="emit('delete', acc)"
            >
              <div i-carbon-trash-can />
              <span class="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity duration-150 -translate-x-1/2 dark:bg-gray-100 dark:text-gray-900 group-focus-visible:opacity-100 group-hover:opacity-100">
                删除
              </span>
            </BaseButton>
          </div>
        </div>
      </div>
    </div>

    <AccountModal
      :show="showModal"
      :edit-data="editingAccount"
      @close="emit('closeModal')"
      @saved="emit('saved')"
    />

    <ConfirmModal
      :show="showDeleteConfirm"
      :loading="deleteLoading"
      title="删除账号"
      :message="accountToDelete ? `确定要删除账号 ${accountToDelete.name || accountToDelete.id} 吗?` : ''"
      confirm-text="删除"
      type="danger"
      @close="!deleteLoading && emit('closeDeleteConfirm')"
      @cancel="!deleteLoading && emit('closeDeleteConfirm')"
      @confirm="emit('confirmDelete')"
    />

    <ConfirmModal
      :show="showClearStoppedConfirm"
      :loading="clearStoppedLoading"
      title="一键清理已停止账号"
      :message="`确定要清理 ${stoppedAccountsCount} 个已停止的账号吗？此操作不可恢复！`"
      confirm-text="确认清理"
      type="danger"
      @close="!clearStoppedLoading && emit('closeClearStoppedConfirm')"
      @cancel="!clearStoppedLoading && emit('closeClearStoppedConfirm')"
      @confirm="emit('confirmClearStopped')"
    />
  </div>
</template>
