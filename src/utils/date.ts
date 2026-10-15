const weekdayLabels = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'] as const

export const weekdayOf = (date: string): string => {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return ''
  const weekday = new Date(year, month - 1, day).getDay()
  return weekdayLabels[weekday] ?? ''
}

export const matchDateLabel = (date: string): string => {
  const weekday = weekdayOf(date)
  return weekday ? `${date} ${weekday}` : date
}

const pad = (value: number) => String(value).padStart(2, '0')
const beijingDateObject = (value: string | number | Date = new Date()): Date | null => {
  const parsed = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(parsed.getTime())) return null
  return new Date(parsed.getTime() + 8 * 60 * 60 * 1000)
}

export const beijingDate = (value: string | number | Date = new Date()): string => {
  const date = beijingDateObject(value)
  if (!date) return ''
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export const beijingPeriod = (value: string | number | Date = new Date()): string =>
  beijingDate(value).slice(0, 7)

export const formatBeijingTime = (
  value: string | number | Date,
  options: { seconds?: boolean; short?: boolean } = {}
): string => {
  const date = beijingDateObject(value)
  if (!date) return '时间待补'
  const datePart = options.short
    ? `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    : `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  const timePart = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}${options.seconds ? `:${pad(date.getUTCSeconds())}` : ''}`
  return `${datePart} ${timePart}`
}
