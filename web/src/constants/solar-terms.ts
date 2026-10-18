import config from '../../../core/src/gameConfig/SolarTerms.json'

// Official table times use Asia/Shanghai, independent of the browser's timezone.
function parseTime(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(value)
  return match ? Date.parse(`${match[1]}T${match[2]!.padStart(2, '0')}:${match[3]}:${match[4]}+08:00`) / 1000 : 0
}

export const SOLAR_QUIZ_WINDOWS = config.terms
  .filter(term => term.question && term.answer?.split(';').length === 4
    && Number.isInteger(term.answer_index) && term.answer_index !== null
    && term.answer_index >= 0 && term.answer_index < 4)
  .map(term => ({ startTime: parseTime(term.open_start), endTime: parseTime(term.open_end) }))

export function isSolarQuizActive(nowMs = Date.now()) {
  const seconds = Math.floor(nowMs / 1000)
  return SOLAR_QUIZ_WINDOWS.some(window => window.startTime > 0 && window.endTime >= window.startTime
    && seconds >= window.startTime && seconds <= window.endTime)
}
