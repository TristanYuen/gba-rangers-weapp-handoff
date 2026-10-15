import { describe, expect, it } from 'vitest'
import { beijingDate, beijingPeriod, formatBeijingTime } from '@/utils/date'

describe('北京时间格式化', () => {
  it('将 UTC 时间统一转换为 UTC+8', () => {
    expect(formatBeijingTime('2026-08-01T00:15:30.000Z', { seconds: true })).toBe('2026-08-01 08:15:30')
    expect(formatBeijingTime('2026-07-31T18:30:00.000Z', { short: true })).toBe('08-01 02:30')
  })

  it('北京时间日期和月份不会受运行环境时区影响', () => {
    expect(beijingDate('2026-07-31T18:30:00.000Z')).toBe('2026-08-01')
    expect(beijingPeriod('2026-07-31T18:30:00.000Z')).toBe('2026-08')
  })
})
