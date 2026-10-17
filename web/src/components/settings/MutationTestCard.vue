<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useMutationResource } from '@/composables/useMutationResource'
import { useAccountStore } from '@/stores/account'

interface TestState {
  id?: string
  enabled: boolean
  status: string
  phase?: string
  seedId: number | null
  seedName?: string
  target: number
  delayMs: number
  planted: number
  harvested: number
  round: number
  fertilizerRound?: number
  reason: string
}
interface Seed { seedId: number, name: string, count: number, image?: string }
const props = defineProps<{ accountId: string | number | null | undefined }>()
const emit = defineEmits<{ active: [value: boolean] }>()
const accountStore = useAccountStore()
const id = () => String(props.accountId || '')
const open = ref(false)
const pending = ref(false)
const commandError = ref('')
const seedId = ref<string | number>('')
const target = ref<string | number>(1)
const delayMs = ref<string | number>(200)
const { data: state, error, loading, refresh, invalidate } = useMutationResource<TestState>(id, '/api/mutation-test')
interface Settings { automation?: { farm?: boolean, fertilizer?: string, land_upgrade?: boolean, fertilizer_2x2_ripen?: boolean } }
const { data: settings, error: settingsError, loading: settingsLoading } = useMutationResource<Settings>(
  () => open.value && !state.value?.enabled ? id() : '',
  '/api/settings',
  () => ({}),
  5000,
)
const conflict = computed(() => {
  const automation = settings.value?.automation
  return !automation || !!automation.farm || (automation.fertilizer ?? 'none') !== 'none'
    || !!automation.land_upgrade || !!automation.fertilizer_2x2_ripen
})
const seedAccount = () => open.value && !state.value?.enabled && accountStore.currentAccount?.running ? id() : ''
const { data: seeds, error: seedError, loading: seedsLoading, refresh: refreshSeeds } = useMutationResource<Seed[]>(seedAccount, '/api/mutation-test/seeds', undefined, 0)
const options = computed(() => (seeds.value || []).map(seed => ({ value: seed.seedId, label: `${seed.name} × ${seed.count}` })))
const selectedSeed = computed(() => seeds.value?.find(seed => seed.seedId === Number(seedId.value)))
const statuses: Record<string, string> = { idle: '未开启', starting: '检查中', running: '运行中', stopping: '停止中', stopped: '已停止', failed: '已终止', completed: '已完成' }
const phases: Record<string, string> = { checking: '校验土地与背包', planting: '种植', normal: '普通肥', organic: '有机肥', harvesting: '务农与收获' }
const valid = computed(() => Number.isInteger(Number(target.value)) && Number(target.value) >= 1 && Number(target.value) <= 3000
  && Number(target.value) <= (selectedSeed.value?.count || 0)
  && Number.isInteger(Number(delayMs.value)) && Number(delayMs.value) >= 0 && Number(delayMs.value) <= 60000)
const startDisabled = computed(() => pending.value || loading.value || !state.value || !!error.value || !!seedError.value
  || settingsLoading.value || !!settingsError.value || conflict.value
  || !accountStore.currentAccount?.running || seedsLoading.value || !valid.value)
let generation = 0
let disposed = false
watch(() => props.accountId, () => {
  generation++
  open.value = false
  seedId.value = ''
  target.value = 1
  delayMs.value = 200
  pending.value = false
  commandError.value = ''
  emit('active', false)
}, { flush: 'sync' })
watch(() => state.value?.enabled, value => emit('active', !!value))
function configure() {
  seedId.value = state.value?.seedId || ''
  target.value = state.value?.target || 1
  delayMs.value = state.value?.delayMs ?? 200
  commandError.value = ''
  open.value = true
}
async function command(action: 'start' | 'stop') {
  if (pending.value || !id() || (action === 'start' && startDisabled.value))
    return
  const accountId = id()
  const version = generation
  pending.value = true
  commandError.value = ''
  invalidate()
  try {
    const response = await api.post(`/api/mutation-test/${action}`, action === 'start'
      ? { seedId: Number(seedId.value), target: Number(target.value), delayMs: Number(delayMs.value) }
      : {}, { headers: { 'x-account-id': accountId }, timeout: 60000 })
    if (!response.data?.ok)
      throw new Error(response.data?.error || '操作失败')
    if (!disposed && version === generation && accountId === id()) {
      invalidate()
      state.value = response.data.data
      await refresh()
    }
  }
  catch (cause: any) {
    if (!disposed && version === generation && accountId === id()) {
      commandError.value = cause.response?.data?.error || cause.message || '操作失败'
      await refresh()
    }
  }
  finally {
    if (version === generation)
      pending.value = false
  }
}
onUnmounted(() => {
  disposed = true
  generation++
})
</script>

<template>
  <section class="mutation-test-panel" aria-label="变异测试">
    <div class="mutation-test-heading">
      <img src="/game-config/resource-icons/illustrated-mutant.png" alt="" class="h-10 w-10 shrink-0 object-contain">
      <div class="min-w-0">
        <h3 class="font-semibold">
          变异测试
        </h3>
        <span class="text-xs" :class="state?.enabled ? 'text-green-600' : 'text-gray-500'">{{ state ? statuses[state.status] : loading ? '加载中' : '读取失败' }}</span>
      </div>
    </div>
    <div class="mutation-test-metrics text-sm tabular-nums">
      <div class="min-w-0">
        <span class="block text-xs text-gray-500">测试作物</span><strong class="block break-words">{{ state?.seedName || '未配置' }}</strong>
      </div>
      <div><span class="block text-xs text-gray-500">已种植</span><strong>{{ state?.planted ?? '—' }} / {{ state?.target ?? '—' }}</strong></div>
      <div><span class="block text-xs text-gray-500">已收获</span><strong>{{ state?.harvested ?? '—' }}</strong></div>
    </div>
    <div class="mutation-test-actions">
      <BaseButton v-if="state?.enabled" variant="danger" size="sm" :loading="pending" :disabled="state.status === 'stopping'" @click="command('stop')">
        <span class="i-carbon-stop-filled mr-1" />停止
      </BaseButton>
      <BaseButton variant="secondary" size="sm" :disabled="!id() || pending || loading || !state || !!error" @click="configure">
        <span class="i-carbon-settings-adjust mr-1" />{{ state?.enabled ? '查看任务' : '配置并开启' }}
      </BaseButton>
    </div>
    <p class="mutation-test-note mutation-test-summary">
      开启后会自动种植、施肥催熟并收获，消耗背包种子、普通肥和有机肥；达到目标后结束，不保证获得变异。
    </p>
    <p v-if="state?.enabled" class="mutation-test-note text-xs text-green-700 dark:text-green-400">
      第 {{ state.round }} 轮 · {{ phases[state.phase || ''] }}<span v-if="state.phase === 'organic'"> · 第 {{ state.fertilizerRound }} 遍</span>
    </p>
    <p v-if="error || commandError || state?.reason" role="status" class="mutation-test-note break-words text-xs text-amber-700 dark:text-amber-400">
      {{ error || commandError || state?.reason }}
    </p>
    <Teleport to="body">
      <div v-if="open" class="mutation-test-overlay fixed inset-0 z-50 grid place-items-center bg-black/40" @click.self="open = false">
        <section role="dialog" aria-modal="true" aria-labelledby="mutation-test-title" aria-describedby="mutation-test-consumption" class="mutation-test-dialog shadow-xl">
          <header class="mutation-test-dialog-header flex items-center justify-between gap-3">
            <h3 id="mutation-test-title" class="text-lg font-semibold">
              变异测试配置
            </h3>
            <button class="grid h-8 w-8 place-items-center rounded hover:bg-gray-100 dark:hover:bg-gray-700" title="关闭" aria-label="关闭" @click="open = false">
              <span class="i-carbon-close" />
            </button>
          </header>
          <div class="mutation-test-dialog-body">
            <section class="mutation-test-guide" aria-labelledby="mutation-test-flow-title">
              <h4 id="mutation-test-flow-title" class="flex items-center gap-2 text-sm font-semibold">
                <span class="text-primary i-carbon-flow" aria-hidden="true" />开启后自动执行
              </h4>
              <ol class="mutation-test-flow">
                <li><strong>种植</strong><span>使用所选背包种子，按土地编号分批种植。</span></li>
                <li><strong>施肥催熟</strong><span>先对仍可施普通肥的未成熟作物施一次普通肥，再多轮使用有机肥，直到成熟。</span></li>
                <li><strong>收获与记录</strong><span>按需浇水、除草、除虫后收获，记录变异结果；清理本轮枯死作物，再开始下一轮，直到达到目标。</span></li>
              </ol>
              <p id="mutation-test-consumption" class="mutation-test-consumption">
                <span class="i-carbon-warning shrink-0" aria-hidden="true" />
                <span>会实际消耗种子、普通肥和有机肥，有机肥可能连续使用多轮。测试任务不会自动购买种子或化肥，变异结果以游戏实际返回为准，不保证获得变异。</span>
              </p>
            </section>
            <div v-if="state?.enabled" class="space-y-4">
              <p class="break-words font-medium">
                {{ state.seedName }}
              </p>
              <div class="grid grid-cols-2 gap-4 text-sm">
                <div>已种植 {{ state.planted }} / {{ state.target }}</div>
                <div>已收获 {{ state.harvested }}</div>
              </div>
              <progress :value="state.planted" :max="state.target" class="h-2 w-full accent-green-600" />
              <p class="text-sm text-gray-500">
                第 {{ state.round }} 轮 · {{ phases[state.phase || ''] }} · {{ statuses[state.status] }}
              </p>
              <p class="mutation-test-help">
                关闭弹窗或离开页面不会停止后台任务。点击停止后，会等待当前已发出的操作返回，再停止后续操作；已消耗的资源不会退回，未收获作物会保留。
              </p>
              <BaseButton variant="danger" :loading="pending" :disabled="state.status === 'stopping'" @click="command('stop')">
                <span class="i-carbon-stop-filled mr-2" />停止测试
              </BaseButton>
            </div>
            <form v-else class="space-y-4" @submit.prevent="command('start')">
              <div class="mutation-test-prerequisites">
                <h4 class="text-sm font-semibold">
                  开启条件
                </h4>
                <ul>
                  <li>账号已启动并在线，所有已解锁土地均为空地。</li>
                  <li>关闭「种植与收获」「土地与施肥」中的自动种植收获、施肥、土地升级及 2x2 催熟。</li>
                  <li>仅支持可种植的单格、单季背包种子，库存须覆盖目标测试株数。</li>
                </ul>
              </div>
              <div class="flex items-end gap-2">
                <BaseSelect v-model="seedId" class="min-w-0 flex-1" label="背包种子" :options="options" :disabled="pending || seedsLoading" />
                <BaseButton variant="outline" :disabled="pending || seedsLoading || !seedAccount()" title="刷新背包" aria-label="刷新背包" @click="refreshSeeds">
                  <span class="i-carbon-renew" />
                </BaseButton>
              </div>
              <div v-if="selectedSeed" class="flex items-center gap-2 text-sm text-gray-500">
                <img v-if="selectedSeed.image" :src="selectedSeed.image" alt="" class="h-8 w-8 object-contain">
                <span>库存 {{ selectedSeed.count }} 颗</span>
              </div>
              <div class="mutation-test-fields">
                <BaseInput v-model="target" type="number" label="目标测试株数" hint="1–3000 株，每种植 1 株消耗 1 颗种子；不是执行轮数。" :min="1" :max="3000" :step="1" :disabled="pending" />
                <BaseInput v-model="delayMs" type="number" label="土地操作间隔 (ms)" hint="0–60000 毫秒，同一批种植或施肥时，相邻地块操作的等待时间。" :min="0" :max="60000" :step="1" :disabled="pending" />
              </div>
              <p class="mutation-test-help">
                种子不足、施肥失败、断线、土地状态异常或施肥未推进生长时，任务会终止并显示原因。账号或程序停止后，任务不会自动恢复。
              </p>
              <p v-if="Number(target) > (selectedSeed?.count ?? 3000)" class="text-sm text-red-600">
                目标次数超过背包库存
              </p>
              <p v-if="settingsLoading && !settings" role="status" class="text-sm text-gray-500">
                正在检查自动化配置
              </p>
              <p v-else-if="!settingsError && conflict" class="text-sm text-amber-700 dark:text-amber-400">
                种植收获或土地施肥尚未关闭
              </p>
              <p v-if="!accountStore.currentAccount?.running" class="text-sm text-amber-700">
                账号未启动
              </p>
              <p v-if="!seedsLoading && seeds && !seeds.length" class="text-sm text-gray-500">
                背包没有可测试的单格单季种子
              </p>
              <div class="mutation-test-start">
                <p class="mutation-test-help">
                  开启即执行上述流程。关闭弹窗或离开页面不会停止任务，可随时点击「停止」。
                </p>
                <BaseButton type="submit" :loading="pending" :disabled="startDisabled">
                  <span class="i-carbon-play-filled mr-2" />保存并开启
                </BaseButton>
              </div>
            </form>
            <p v-if="error || seedError || settingsError || commandError || state?.reason" role="alert" class="mt-4 break-words text-sm text-amber-700 dark:text-amber-400">
              {{ commandError || error || seedError || settingsError || state?.reason }}
            </p>
          </div>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.mutation-test-panel {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(0, 2fr) auto;
  align-items: center;
  gap: 16px 24px;
  padding: 16px 0;
  border-bottom: 1px solid var(--surface-border);
}
.mutation-test-heading,
.mutation-test-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mutation-test-metrics {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.mutation-test-note {
  grid-column: 1 / -1;
}
.mutation-test-summary,
.mutation-test-help {
  color: var(--muted-text);
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.mutation-test-overlay {
  padding: 16px;
}
.mutation-test-dialog {
  display: flex;
  flex-direction: column;
  width: min(100%, 640px);
  min-width: 0;
  max-height: min(90vh, 860px);
  max-height: min(90dvh, 860px);
  overflow: hidden;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  background: var(--surface-1);
}
.mutation-test-dialog-header {
  flex-shrink: 0;
  padding: 16px 20px;
  border-bottom: 1px solid var(--surface-border);
}
.mutation-test-dialog-body {
  min-height: 0;
  padding: 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.mutation-test-guide {
  margin-bottom: 20px;
}
.mutation-test-flow {
  display: grid;
  gap: 12px;
  margin: 14px 0;
  padding-left: 20px;
  list-style: decimal;
  font-size: 13px;
  line-height: 1.7;
}
.mutation-test-flow li::marker {
  color: var(--theme-primary);
  font-weight: 600;
}
.mutation-test-flow strong {
  display: block;
}
.mutation-test-flow li > span {
  color: var(--muted-text);
}
.mutation-test-consumption {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  border-left: 3px solid #b7791f;
  background: var(--surface-2);
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.mutation-test-consumption > span:first-child {
  margin-top: 3px;
  color: #b7791f;
  font-size: 16px;
}
.mutation-test-prerequisites ul {
  margin-top: 8px;
  padding-left: 18px;
  list-style: disc;
  color: var(--muted-text);
  font-size: 12px;
  line-height: 1.8;
}
.mutation-test-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.mutation-test-start {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--surface-border);
}
.mutation-test-start > button {
  flex-shrink: 0;
}
@media (max-width: 540px) {
  .mutation-test-overlay {
    padding: 10px;
  }
  .mutation-test-dialog {
    max-height: calc(100vh - 20px);
    max-height: calc(100dvh - 20px);
  }
  .mutation-test-dialog-header,
  .mutation-test-dialog-body {
    padding: 16px;
  }
  .mutation-test-fields {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .mutation-test-start {
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
  }
}
@media (max-width: 900px) {
  .mutation-test-panel {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .mutation-test-metrics {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .mutation-test-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}
@media (max-width: 420px) {
  .mutation-test-panel {
    grid-template-columns: minmax(0, 1fr);
  }
  .mutation-test-actions {
    justify-content: flex-start;
  }
}
</style>
