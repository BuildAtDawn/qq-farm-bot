import type { RipenAllPreview, RipenAllStepResult } from '@/stores/farm'

export function fertilizerHours(seconds: number) {
  return (Math.max(0, seconds) / 3600).toLocaleString('zh-CN', { maximumFractionDigits: 3 })
}

export async function runRipenAll(options: {
  preview: RipenAllPreview
  cancelled: () => boolean
  step: (token: string, cursor: number) => Promise<RipenAllStepResult>
  onProgress: (result: RipenAllStepResult) => void
}) {
  if (!options.preview.sufficient || !options.preview.targetCount || Date.now() >= options.preview.expiresAt)
    throw new Error('预览已失效、没有可催熟作物或化肥不足，请重新预览')
  let cursor = 0
  for (let index = 0; index < options.preview.actionCount; index++) {
    if (options.cancelled())
      return false
    const result = await options.step(options.preview.token, cursor)
    if (options.cancelled())
      return false
    if (!result.success || result.cursor !== cursor + 1)
      throw new Error('催熟进度异常，已停止')
    cursor = result.cursor
    options.onProgress(result)
    if (result.stopped)
      throw new Error(result.stopped)
    if (result.done)
      return result
  }
  throw new Error('作物尚未全部成熟，请重新预览')
}
