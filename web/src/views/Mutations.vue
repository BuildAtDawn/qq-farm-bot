<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import api from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import MutationDetailsTable from '@/components/MutationDetailsTable.vue'
import MutationStatistics from '@/components/MutationStatistics.vue'
import MutationTestCard from '@/components/settings/MutationTestCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useMutationResource } from '@/composables/useMutationResource'
import { useAccountStore } from '@/stores/account'
import { chartPercent } from '@/utils/mutation-charts'

interface Mutation { id: number, name: string }
interface RecordRow {
  id: number
  seedId: number
  seedName: string
  landId: number
  plantedAt: number
  harvestedAt: number | null
  status: string
  mutations: Mutation[] | null
  mutationCount: number | null
  source: string
  testId: string
  round: number | null
  totalStages?: number | null
  currentStage?: number | null
}
interface Statistics {
  completedRecords: number
  mutatedRecords: number
  mutationRate: number | null
  types: (Mutation & { count: number, percentage: number })[]
}
interface StageStatistic {
  plantId: number
  seedName: string
  stage: number
  totalStages: number
  name: string
  eligible: number
  checked: number
  coverage: number
  mutationRate: number | null
  types: (Mutation & { count: number, percentage: number })[]
}
interface Records {
  rows: RecordRow[]
  total: number
  page: number
  pageSize: number
  mutationTypes: Mutation[]
  statistics?: Statistics
  stageStatistics?: StageStatistic[]
  seeds?: { id: number, name: string }[]
  tests?: string[]
}
const account = useAccountStore()
const mutation = ref<string | number>('')
const status = ref<string | number>('')
const page = ref(1)
const view = ref('records')
const seedId = ref<string | number>('')
const testId = ref<string | number>('')
const views = [
  { value: 'records', label: '种植记录' },
  { value: 'stages', label: '阶段明细' },
  { value: 'discoveries', label: '首次发现' },
  { value: 'operations', label: '施肥记录' },
]
const filterOptions = ref<{ seeds: { id: number, name: string }[], tests: string[] }>({ seeds: [], tests: [] })
const exporting = ref(false)
const exportError = ref('')
const clearing = ref(false)
const clearError = ref('')
const clearTarget = ref<{ id: string, name: string } | null>(null)
let accountRevision = 0
const params = () => ({ mutation: mutation.value, status: status.value, page: page.value, pageSize: 50, view: view.value, seedId: seedId.value, testId: testId.value })
const { data, loading, error, refresh, invalidate } = useMutationResource<Records>(() => String(account.currentAccountId || ''), '/api/mutations', params)
const mutationTypes = ref<Mutation[]>([])
watch(data, (value) => {
  if (value) {
    mutationTypes.value = value.mutationTypes
    filterOptions.value = { seeds: value.seeds || [], tests: value.tests || [] }
  }
})
watch(() => account.currentAccountId, () => {
  accountRevision++
  clearTarget.value = null
  clearError.value = ''
  mutationTypes.value = []
  filterOptions.value = { seeds: [], tests: [] }
  seedId.value = ''
  testId.value = ''
  page.value = 1
  exportError.value = ''
}, { flush: 'sync' })
watch([mutation, status, seedId, testId], () => {
  page.value = 1
})
watch(view, () => {
  mutation.value = ''
  page.value = 1
})
const seedOptions = computed(() => [{ value: '', label: '全部作物' }, ...filterOptions.value.seeds.map(item => ({ value: String(item.id), label: item.name }))])
const testOptions = computed(() => [{ value: '', label: '全部测试任务' }, ...filterOptions.value.tests.map(id => ({ value: id, label: id }))])
const mutationOptions = computed(() => [
  { value: '', label: '全部变异' },
  ...(view.value === 'records' || view.value === 'stages' ? [{ value: 'none', label: view.value === 'stages' ? '无新增变异' : '无变异' }] : []),
  ...mutationTypes.value.map(item => ({ value: String(item.id), label: item.name })),
])
const statuses: Record<string, string> = { growing: '生长中', harvesting: '收获待确认', harvested: '已收获', removed: '已铲除', unknown: '未完成' }
const statusOptions = [{ value: '', label: '全部状态' }, ...Object.entries(statuses).map(([value, label]) => ({ value, label }))]
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / 50)))
const statistics = computed(() => data.value?.statistics || null)
const percent = (value: number | null) => value === null ? '—' : `${value.toFixed(2)}%`
const date = (value: number | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
function requestClear() {
  if (!account.currentAccountId || clearing.value)
    return
  clearError.value = ''
  clearTarget.value = {
    id: String(account.currentAccountId),
    name: account.currentAccount?.name || account.currentAccount?.nick || String(account.currentAccountId),
  }
}
function cancelClear() {
  if (!clearing.value)
    clearTarget.value = null
}
async function confirmClear() {
  const target = clearTarget.value
  if (!target || clearing.value || target.id !== String(account.currentAccountId || ''))
    return
  const revision = accountRevision
  clearing.value = true
  clearError.value = ''
  try {
    const response = await api.post('/api/mutations/clear', { confirm: true }, { headers: { 'x-account-id': target.id } })
    if (!response.data?.ok)
      throw new Error(response.data?.error || '清空失败')
    if (revision !== accountRevision)
      return
    clearTarget.value = null
    invalidate()
    data.value = null
    mutationTypes.value = []
    mutation.value = ''
    status.value = ''
    seedId.value = ''
    testId.value = ''
    filterOptions.value = { seeds: [], tests: [] }
    page.value = 1
    await refresh()
  }
  catch (cause: any) {
    if (revision === accountRevision) {
      clearTarget.value = null
      clearError.value = cause.response?.data?.error || cause.message || '清空失败，请重试'
    }
  }
  finally { clearing.value = false }
}
async function download() {
  if (exporting.value || !account.currentAccountId)
    return
  const id = account.currentAccountId
  const exportView = view.value
  const exportParams = { ...params(), page: undefined, pageSize: undefined }
  exporting.value = true
  exportError.value = ''
  try {
    const response = await api.get('/api/mutations/export', {
      headers: { 'x-account-id': id },
      params: exportParams,
      responseType: 'blob',
    })
    if (account.currentAccountId !== id)
      return
    const url = URL.createObjectURL(response.data)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `变异-${exportView}-${id}-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  catch {
    if (account.currentAccountId === id)
      exportError.value = '导出失败，请重试'
  }
  finally { exporting.value = false }
}
</script>

<template>
  <div class="min-w-0 space-y-4">
    <header class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3 dark:border-gray-700">
      <h2 class="flex items-center gap-2 text-base font-semibold">
        <span class="text-primary i-carbon-chemistry" aria-hidden="true" />变异研究
      </h2>
      <div class="flex flex-wrap gap-2">
        <BaseButton variant="outline" :disabled="!account.currentAccountId || loading" title="刷新" aria-label="刷新" @click="refresh">
          <span class="i-carbon-renew" :class="{ 'animate-spin': loading }" />
        </BaseButton>
        <BaseButton variant="secondary" :loading="exporting" :disabled="!account.currentAccountId || clearing" @click="download">
          <span class="i-carbon-download mr-2" />导出 CSV
        </BaseButton>
        <BaseButton variant="danger" :loading="clearing" :disabled="!account.currentAccountId || exporting" title="清空当前账号变异数据" aria-label="清空当前账号变异数据" @click="requestClear">
          <span class="i-carbon-trash-can" />
        </BaseButton>
      </div>
    </header>
    <p v-if="!account.currentAccountId" class="py-12 text-center text-gray-500">
      未选择账号
    </p>
    <template v-else>
      <MutationTestCard :account-id="account.currentAccountId" />
      <MutationStatistics :statistics="statistics" :loading="loading" :error="error" />
      <div class="farm-page-tabs" role="tablist" aria-label="变异数据">
        <button
          v-for="tab in views" :key="tab.value" type="button" role="tab" :aria-selected="view === tab.value"
          class="shrink-0 border-b-2 px-3 py-2 text-sm"
          :class="view === tab.value ? 'border-green-600 text-green-700 dark:text-green-300' : 'border-transparent text-gray-500'"
          @click="view = tab.value"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BaseSelect v-model="seedId" label="作物" :options="seedOptions" />
        <BaseSelect v-model="testId" label="测试任务" :options="testOptions" />
        <BaseSelect v-if="view !== 'operations'" v-model="mutation" label="变异类型" :options="mutationOptions" />
        <BaseSelect v-model="status" label="记录状态" :options="statusOptions" />
      </div>
      <section v-if="view === 'stages' && data?.stageStatistics?.length" class="space-y-2">
        <h2 class="text-sm font-semibold">
          阶段覆盖与首次发现率
        </h2>
        <div class="max-h-80 overflow-auto border-y border-gray-200 dark:border-gray-700">
          <table class="farm-data-table w-full text-left text-xs">
            <thead class="sticky top-0 bg-gray-50 text-gray-500 dark:bg-gray-800">
              <tr>
                <th class="px-3 py-2">
                  作物 / 阶段
                </th><th class="whitespace-nowrap px-3 py-2">
                  已检查 / 应检查
                </th><th class="px-3 py-2">
                  覆盖率
                </th><th class="whitespace-nowrap px-3 py-2">
                  首次发现率
                </th><th class="px-3 py-2">
                  各类型 / 已检查作物
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
              <tr v-for="item in data.stageStatistics" :key="`${item.plantId}:${item.totalStages}:${item.stage}:${item.name}`">
                <td class="min-w-40 px-3 py-2">
                  {{ item.seedName }} · {{ item.stage }}/{{ item.totalStages }} {{ item.name }}
                </td><td class="px-3 py-2 tabular-nums">
                  {{ item.checked }} / {{ item.eligible }}
                </td><td class="px-3 py-2 tabular-nums">
                  {{ percent(item.coverage) }}
                  <meter class="mutation-stage-meter" min="0" max="100" :value="chartPercent(item.coverage)" :aria-label="`${item.seedName} ${item.name} 覆盖率`">
                    {{ percent(item.coverage) }}
                  </meter>
                </td><td class="px-3 py-2 tabular-nums">
                  {{ percent(item.mutationRate) }}
                  <meter v-if="item.mutationRate !== null" class="mutation-stage-meter mutation-stage-meter--discovery" min="0" max="100" :value="chartPercent(item.mutationRate)" :aria-label="`${item.seedName} ${item.name} 首次发现率`">
                    {{ percent(item.mutationRate) }}
                  </meter>
                </td><td class="min-w-40 px-3 py-2">
                  {{ item.types.map(type => `${type.name} ${percent(type.percentage)}`).join('、') || '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <p v-if="clearError || error || exportError" role="alert" class="text-sm text-red-600">
        {{ clearError || error || exportError }}
      </p>
      <div v-if="loading && !data" class="py-12 text-center text-gray-500">
        正在读取变异记录...
      </div>
      <div v-else-if="data && !data.rows.length" class="py-12 text-center text-gray-500">
        暂无符合条件的记录
      </div>
      <MutationDetailsTable v-else-if="data && view !== 'records'" :rows="data.rows" :view="view" />
      <div v-else-if="data" class="overflow-x-auto border-y border-gray-200 dark:border-gray-700">
        <table class="farm-data-table w-full text-left text-sm">
          <thead class="bg-gray-50 text-xs text-gray-500 dark:bg-gray-800">
            <tr>
              <th class="px-3 py-3">
                ID
              </th><th class="px-3 py-3">
                种子 / 土地
              </th>
              <th class="px-3 py-3">
                阶段 / 总阶段
              </th>
              <th class="px-3 py-3">
                种植时间
              </th><th class="px-3 py-3">
                收获时间
              </th>
              <th class="px-3 py-3">
                最终变异
              </th><th class="px-3 py-3">
                状态 / 来源
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
            <tr v-for="row in data.rows" :key="row.id">
              <td class="px-3 py-3 text-gray-500 tabular-nums">
                {{ row.id }}
              </td>
              <td class="min-w-32 px-3 py-3">
                <div class="max-w-48 break-words font-medium">
                  {{ row.seedName }}
                </div>
                <div class="mt-1 text-xs text-gray-500">
                  土地 {{ row.landId }}
                </div>
              </td>
              <td class="whitespace-nowrap px-3 py-3 text-xs tabular-nums">
                {{ row.totalStages ? `${row.currentStage || '?'} / ${row.totalStages}` : '历史或未知' }}
              </td>
              <td class="whitespace-nowrap px-3 py-3 text-xs tabular-nums">
                {{ date(row.plantedAt) }}
              </td>
              <td class="whitespace-nowrap px-3 py-3 text-xs tabular-nums">
                {{ date(row.harvestedAt) }}
              </td>
              <td class="min-w-36 px-3 py-3">
                <span v-if="row.mutationCount === null" class="text-gray-400">未结算</span>
                <span v-else-if="row.mutationCount === 0" class="text-gray-500">无变异</span>
                <template v-else>
                  <div class="flex flex-wrap gap-1.5">
                    <span v-for="item in row.mutations" :key="item.id" class="break-words rounded bg-green-50 px-2 py-0.5 text-xs text-green-700 dark:bg-green-950 dark:text-green-300">{{ item.name }}</span>
                  </div>
                  <span class="mt-1 block text-xs text-gray-500">{{ row.mutationCount }} 种</span>
                </template>
              </td>
              <td class="min-w-24 px-3 py-3">
                <span :class="row.status === 'harvested' ? 'text-green-600' : 'text-gray-500'">{{ statuses[row.status] || row.status }}</span>
                <div class="mt-1 text-xs text-gray-400">
                  {{ row.source === 'test' ? `测试 · 第 ${row.round} 轮` : '系统种植' }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer v-if="data" class="flex items-center justify-between text-sm text-gray-500">
        <span>{{ data.total }} 条 · {{ page }} / {{ pages }}</span>
        <div class="flex gap-2">
          <BaseButton variant="outline" :disabled="loading || page <= 1" title="上一页" aria-label="上一页" @click="page--">
            <span class="i-carbon-chevron-left" />
          </BaseButton>
          <BaseButton variant="outline" :disabled="loading || page >= pages" title="下一页" aria-label="下一页" @click="page++">
            <span class="i-carbon-chevron-right" />
          </BaseButton>
        </div>
      </footer>
    </template>
    <ConfirmModal
      :show="!!clearTarget"
      title="清空变异数据"
      :message="`确定删除账号「${clearTarget?.name || ''}」（ID：${clearTarget?.id || ''}）的全部变异记录吗？此操作不受筛选条件影响，删除后不可恢复。正在生长的记录也会删除，之后的收获不再补录；后续新种植仍会正常记录。`"
      confirm-text="确认清空"
      type="danger"
      :loading="clearing"
      @confirm="confirmClear"
      @cancel="cancelClear"
      @close="cancelClear"
    />
  </div>
</template>

<style scoped>
.mutation-stage-meter {
  display: block;
  width: 90px;
  height: 6px;
  margin-top: 6px;
  appearance: none;
  border: 0;
  border-radius: 3px;
  overflow: hidden;
  background: var(--surface-3);
}
.mutation-stage-meter::-webkit-meter-bar {
  border: 0;
  background: var(--surface-3);
}
.mutation-stage-meter::-webkit-meter-optimum-value {
  background: var(--theme-primary);
}
.mutation-stage-meter::-moz-meter-bar {
  background: var(--theme-primary);
}
.mutation-stage-meter--discovery::-webkit-meter-optimum-value {
  background: #3586a4;
}
.mutation-stage-meter--discovery::-moz-meter-bar {
  background: #3586a4;
}
</style>
