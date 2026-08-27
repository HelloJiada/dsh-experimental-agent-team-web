import { describe, expect, it } from 'vitest'
import { formatDuration } from '../src/duration.ts'

describe('formatDuration — 面板耗时格式化', () => {
  it('不足 1 分钟显示 <1m', () => {
    expect(formatDuration(0)).toBe('<1m')
    expect(formatDuration(999)).toBe('<1m')
    expect(formatDuration(59_000)).toBe('<1m')
  })

  it('不足 1 小时显示 Nm', () => {
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(12 * 60_000)).toBe('12m')
    expect(formatDuration(59 * 60_000 + 42_000)).toBe('59m')
  })

  it('达到 1 小时显示 Xh YYm(分钟两位补零)', () => {
    expect(formatDuration(60 * 60_000)).toBe('1h 00m')
    expect(formatDuration(65 * 60_000)).toBe('1h 05m')
    expect(formatDuration(2 * 60 * 60_000 + 7 * 60_000)).toBe('2h 07m')
  })

  it('非法/负数输入安全回退', () => {
    expect(formatDuration(-1)).toBe('0m')
    expect(formatDuration(Number.NaN)).toBe('0m')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0m')
  })
})
