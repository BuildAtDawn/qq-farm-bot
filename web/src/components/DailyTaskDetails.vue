<script setup lang="ts">
interface DailyTask {
  id: number
  desc: string
  progress: number
  totalProgress: number
  isClaimed: boolean
  isUnlocked: boolean
  isCompleted: boolean
  canClaim: boolean
  rewardSummary?: string
}

defineProps<{
  tasks: DailyTask[]
  error?: string
}>()

function statusText(task: DailyTask) {
  if (task.isClaimed)
    return '已领取'
  if (!task.isUnlocked)
    return '未解锁'
  if (task.canClaim)
    return '待领取'
  return task.isCompleted ? '已完成' : '进行中'
}

function progressPercent(task: DailyTask) {
  if (task.isClaimed)
    return 100
  return Math.min(100, Math.max(0, task.progress / task.totalProgress * 100))
}
</script>

<template>
  <section aria-label="每日任务详情" aria-live="polite">
    <h4 class="mb-3 text-sm text-gray-700 font-medium dark:text-gray-300">
      每日任务详情
    </h4>
    <p v-if="error" class="py-4 text-center text-sm text-amber-600 dark:text-amber-400">
      {{ error }}
    </p>
    <p v-else-if="!tasks.length" class="py-4 text-center text-sm text-gray-400">
      暂无每日任务详情
    </p>
    <ul v-else class="space-y-4">
      <li v-for="task in tasks" :key="task.id" class="min-w-0">
        <div class="flex items-start justify-between gap-3 text-sm">
          <span class="min-w-0 break-words text-gray-700 dark:text-gray-300">{{ task.desc }}</span>
          <span class="shrink-0 text-xs" :class="task.isClaimed || task.isCompleted ? 'text-green-500' : 'text-gray-500'">
            {{ statusText(task) }}
          </span>
        </div>
        <div class="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <span v-if="task.isClaimed">进度：已完成</span>
          <span v-else-if="task.totalProgress > 0">进度：{{ task.progress }}/{{ task.totalProgress }}</span>
          <span v-else>进度：{{ task.progress }}</span>
          <span v-if="task.rewardSummary" class="min-w-0 break-words">奖励：{{ task.rewardSummary }}</span>
        </div>
        <div
          v-if="task.totalProgress > 0"
          role="progressbar"
          :aria-label="task.desc"
          :aria-valuenow="progressPercent(task)"
          :aria-valuemin="0"
          :aria-valuemax="100"
          class="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700"
        >
          <div class="h-full rounded-full bg-green-500 transition-all" :style="{ width: `${progressPercent(task)}%` }" />
        </div>
      </li>
    </ul>
  </section>
</template>
