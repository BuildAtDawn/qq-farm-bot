<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ view: string, rows: any[] }>()
const date = (value: number | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
const stage = (value: number | null, total: number | null) => value && total ? `${value}/${total}` : '未知'
const names = (items: any[]) => items?.length ? items.map(item => item.name).join('、') : '无'
const sources: Record<string, string> = {
  planting: '种植',
  lands: '土地刷新',
  fertilizer_before: '施肥前',
  fertilizer_after: '施肥后',
  harvest_before: '收获前',
}
const quality: Record<string, string> = {
  known: '完整',
  after_missing: '缺少施肥后快照',
  before_missing: '缺少施肥前快照',
  stage_unknown: '阶段不明',
}
const columns = computed<Array<{ label: string, value: (row: any) => string | number }>>(() => {
  if (props.view === 'stages') {
    return [
      { label: '阶段', value: r => `${stage(r.stage, r.totalStages)} · ${r.name}` },
      { label: '检查状态', value: r => r.checked ? '已检查' : '未检查' },
      { label: '阶段开始 / 首次观察', value: r => `${date(r.serverEnteredAt)}\n${date(r.firstObservedAt)}` },
      { label: '本阶段首次发现', value: r => r.checked ? names(r.newMutations) : '未知' },
      { label: '本阶段观察到', value: r => r.checked ? names(r.observedMutations) : '未知' },
      { label: '观测来源', value: r => r.sources.map((s: string) => sources[s] || s).join('、') || '—' },
    ]
  }
  if (props.view === 'discoveries') {
    return [
      { label: '变异', value: r => `${r.name} (#${r.mutationId})` },
      { label: '首次发现阶段', value: r => stage(r.stage, r.totalStages) },
      { label: '首次发现时间', value: r => date(r.firstObservedAt) },
      { label: '服务端变异时间', value: r => date(r.serverMutationAt) },
      { label: '天气 ID', value: r => r.weatherId ?? '—' },
      { label: '来源', value: r => sources[r.source] || r.source },
    ]
  }
  return [
    { label: '肥料', value: r => r.fertilizerId === 1011 ? '普通肥' : r.fertilizerId === 1012 ? '有机肥' : `#${r.fertilizerId}` },
    { label: '施肥前 → 后', value: r => `${stage(r.beforeStage, r.totalStages)} → ${stage(r.afterStage, r.totalStages)}` },
    { label: '请求 / 响应时间', value: r => `${date(r.requestedAt)}\n${date(r.finishedAt)}` },
    { label: '实际消耗', value: r => r.consumedSeconds === null ? '未知' : `${r.consumedSeconds} 秒` },
    { label: '结果', value: r => r.status === 'success' ? '施肥成功' : r.status === 'not_sent' ? '请求未发送' : '结果未确认' },
    { label: '数据质量', value: r => `${quality[r.quality] || r.quality}${r.error ? `\n${r.error}` : ''}` },
  ]
})
</script>

<template>
  <div class="overflow-x-auto border-y border-gray-200 dark:border-gray-700">
    <table class="w-full text-left text-sm">
      <thead class="bg-gray-50 text-xs text-gray-500 dark:bg-gray-800">
        <tr>
          <th class="whitespace-nowrap px-3 py-3">
            种植 ID
          </th>
          <th class="px-3 py-3">
            作物 / 土地
          </th>
          <th v-for="column in columns" :key="column.label" class="whitespace-nowrap px-3 py-3">
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
        <tr v-for="row in rows" :key="row.id">
          <td class="px-3 py-3 tabular-nums">
            {{ row.recordId }}
          </td>
          <td class="min-w-36 px-3 py-3">
            <div class="max-w-48 break-words font-medium">
              {{ row.seedName }}
            </div>
            <div class="text-xs text-gray-500">
              #{{ row.plantId }} · 土地 {{ row.landId }}
            </div>
          </td>
          <td v-for="column in columns" :key="column.label" class="min-w-28 whitespace-pre-line break-words px-3 py-3 text-xs">
            {{ column.value(row) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
