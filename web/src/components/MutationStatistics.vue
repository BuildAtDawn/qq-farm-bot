<script setup lang="ts">
import type { MutationStatistics } from '@/utils/mutation-charts'
import { computed } from 'vue'
import { mutationChartData } from '@/utils/mutation-charts'

const props = defineProps<{ statistics: MutationStatistics | null, loading: boolean, error: string }>()
const chart = computed(() => props.statistics ? mutationChartData(props.statistics) : null)
const percent = (value: number | null) => value === null ? '—' : `${value.toFixed(2)}%`
</script>

<template>
  <section aria-labelledby="mutation-statistics-title" class="mutation-statistics" :aria-busy="loading">
    <header class="mutation-statistics-heading">
      <h2 id="mutation-statistics-title">
        <span class="i-carbon-chart-ring" aria-hidden="true" />变异概览
      </h2>
      <span>当前作物与任务范围 · 已收获记录</span>
    </header>
    <div v-if="statistics && chart" class="mutation-charts">
      <div class="mutation-outcome">
        <div class="mutation-ring" role="img" :aria-label="chart.hasRate ? `变异率 ${percent(statistics.mutationRate)}，${statistics.mutatedRecords} / ${statistics.completedRecords} 条完整记录发生变异` : '暂无完整记录，变异率不可用'">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="49" fill="none" stroke="var(--surface-3)" stroke-width="10" />
            <circle v-if="chart.hasRate && chart.rate > 0" cx="60" cy="60" r="49" fill="none" stroke="var(--theme-primary)" stroke-width="10" stroke-linecap="round" pathLength="100" :stroke-dasharray="`${chart.rate} 100`" transform="rotate(-90 60 60)" />
          </svg>
          <div class="mutation-ring-label">
            <strong>{{ chart.hasRate ? percent(statistics.mutationRate) : '—' }}</strong><span>变异率</span>
          </div>
        </div>
        <dl class="mutation-counts">
          <div><dt>完整记录</dt><dd>{{ statistics.completedRecords.toLocaleString() }}<small>条</small></dd></div>
          <div class="mutation-count-mutated">
            <dt><i />发生变异</dt><dd>{{ statistics.mutatedRecords.toLocaleString() }}<small>颗</small></dd>
          </div>
          <div class="mutation-count-ordinary">
            <dt><i />无变异</dt><dd>{{ chart.unmutated.toLocaleString() }}<small>颗</small></dd>
          </div>
        </dl>
      </div>
      <div class="mutation-types">
        <div class="mutation-types-heading">
          <h3>变异类型分布</h3><span>作物数 / 占完整记录</span>
        </div>
        <ol v-if="chart.types.length" class="mutation-ranking">
          <li v-for="(item, index) in chart.types" :key="item.id" :style="{ '--chart-color': ['#238452', '#3586a4', '#d49a36', '#c76b80', '#7d78ab'][index % 5] }">
            <div class="mutation-ranking-label">
              <span>{{ item.name }}</span><strong>{{ item.count.toLocaleString() }} <small>颗 · {{ percent(item.percentage) }}</small></strong>
            </div>
            <div class="mutation-bar" aria-hidden="true">
              <span :style="{ width: `${item.width}%` }" />
            </div>
          </li>
        </ol>
        <div v-else class="mutation-chart-empty">
          <span class="i-carbon-sprout" aria-hidden="true" />
          {{ statistics.completedRecords ? '暂无变异记录' : '暂无完整记录' }}
        </div>
        <p v-if="chart.types.length" class="mutation-chart-note">
          同一作物可含多种变异，各类型占比独立计算。
        </p>
      </div>
    </div>
    <p v-else class="mutation-statistics-empty" :role="error ? 'alert' : 'status'">
      <span :class="loading ? 'i-svg-spinners-90-ring-with-bg' : error ? 'i-carbon-warning-alt' : 'i-carbon-chart-ring'" aria-hidden="true" />
      {{ loading ? '正在读取统计...' : error ? '统计读取失败' : '统计暂不可用' }}
    </p>
  </section>
</template>

<style scoped>
.mutation-statistics {
  min-width: 0;
  padding: 20px 0 24px;
  border-block: 1px solid var(--surface-border);
}
.mutation-statistics-heading,
.mutation-types-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.mutation-statistics-heading h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 650;
}
.mutation-statistics-heading > span,
.mutation-types-heading > span {
  color: var(--muted-text);
  font-size: 11px;
}
.mutation-charts {
  display: grid;
  grid-template-columns: minmax(300px, 0.85fr) minmax(0, 1.15fr);
  gap: 30px;
  margin-top: 24px;
}
.mutation-outcome {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
}
.mutation-ring {
  position: relative;
  flex: 0 0 160px;
  width: 160px;
  aspect-ratio: 1;
}
.mutation-ring svg {
  width: 100%;
  height: 100%;
}
.mutation-ring-label {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.mutation-ring-label strong {
  font-size: 24px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.mutation-ring-label span {
  font-size: 11px;
  color: var(--muted-text);
}
.mutation-counts {
  display: grid;
  gap: 15px;
  min-width: 0;
}
.mutation-counts dt {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--muted-text);
}
.mutation-counts dd {
  margin-top: 3px;
  font-size: 20px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.mutation-counts small {
  margin-left: 5px;
  font-size: 10px;
  font-weight: 400;
  color: var(--muted-text);
}
.mutation-counts i {
  width: 7px;
  height: 7px;
  background: var(--surface-border-strong);
  border-radius: 50%;
}
.mutation-count-mutated i {
  background: var(--theme-primary);
}
.mutation-types {
  min-width: 0;
  border-left: 1px solid var(--surface-border);
  padding-left: 30px;
}
.mutation-types-heading h3 {
  font-size: 12px;
  font-weight: 600;
}
.mutation-ranking {
  display: grid;
  gap: 14px;
  margin-top: 18px;
  max-height: 270px;
  overflow-y: auto;
  padding-right: 6px;
}
.mutation-ranking-label {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 12px;
}
.mutation-ranking-label > span {
  overflow-wrap: anywhere;
}
.mutation-ranking-label strong {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.mutation-ranking-label small {
  font-size: 10px;
  font-weight: 400;
  color: var(--muted-text);
}
.mutation-bar {
  height: 7px;
  border-radius: 3px;
  margin-top: 7px;
  overflow: hidden;
  background: var(--surface-3);
}
.mutation-bar > span {
  display: block;
  height: 100%;
  background: var(--chart-color);
  border-radius: inherit;
}
.mutation-chart-note {
  margin-top: 16px;
  font-size: 10px;
  color: var(--muted-text);
}
.mutation-chart-empty,
.mutation-statistics-empty {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  min-height: 130px;
  color: var(--muted-text);
  font-size: 12px;
}
@media (max-width: 1100px) {
  .mutation-charts {
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
  }
  .mutation-types {
    border-left: 0;
    border-top: 1px solid var(--surface-border);
    padding: 20px 0 0;
  }
}
@media (max-width: 639px) {
  .mutation-outcome {
    gap: 20px;
  }
  .mutation-ring {
    flex-basis: 140px;
    width: 140px;
  }
  .mutation-ring-label strong {
    font-size: 21px;
  }
  .mutation-counts dd {
    font-size: 18px;
  }
}
</style>
