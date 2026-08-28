/**
 * 改进 4 客户端测试:任务中间态徽标条件与双语本地化键。
 * 与 task-review.test.ts 同构:纯函数 + locales 键完整性。
 */
import { describe, expect, it } from 'vitest'
import type { ActivityTask } from './activity-monitor.ts'
import {
  taskAwaitingInput,
  taskBlockedByReview,
  taskIntermediateFlag,
} from './task-intermediate.ts'
import { en, zh } from './locales.ts'

function task(overrides: Partial<ActivityTask>): ActivityTask {
  return {
    id: 't1',
    subject: '任务',
    status: 'in_progress',
    state: 'running',
    assignee: '技术员',
    dependencies: [],
    depth: 0,
    ...overrides,
  }
}

describe('taskBlockedByReview — 「待复核」徽标条件', () => {
  it('显式置位且非终结 → 显示徽标', () => {
    expect(taskBlockedByReview(task({ blockedByReview: true }))).toBe(true)
  })

  it('未置位 / 显式 false → 不显示', () => {
    expect(taskBlockedByReview(task({}))).toBe(false)
    expect(taskBlockedByReview(task({ blockedByReview: false }))).toBe(false)
  })

  it('终结状态即使残留标记也不显示(兜底脏数据)', () => {
    expect(taskBlockedByReview(task({ status: 'completed', blockedByReview: true }))).toBe(false)
    expect(taskBlockedByReview(task({ status: 'failed', blockedByReview: true }))).toBe(false)
    expect(taskBlockedByReview(task({ status: 'cancelled', blockedByReview: true }))).toBe(false)
  })

  it('与派生 reviewRequired 正交:仅门禁适用不显示「待复核」', () => {
    expect(taskBlockedByReview(task({ reviewRequired: true }))).toBe(false)
  })
})

describe('taskAwaitingInput — 「待输入」徽标条件', () => {
  it('显式置位 → 显示徽标', () => {
    expect(taskAwaitingInput(task({ awaitingInput: true }))).toBe(true)
  })

  it('未置位 → 不显示', () => {
    expect(taskAwaitingInput(task({}))).toBe(false)
    expect(taskAwaitingInput(task({ awaitingInput: false }))).toBe(false)
  })
})

describe('taskIntermediateFlag — 行级中间态单一来源', () => {
  it('待复核优先于待输入', () => {
    expect(taskIntermediateFlag(task({ blockedByReview: true, awaitingInput: true }))).toBe('blockedReview')
  })

  it('分别命中 / 均未命中', () => {
    expect(taskIntermediateFlag(task({ blockedByReview: true }))).toBe('blockedReview')
    expect(taskIntermediateFlag(task({ awaitingInput: true }))).toBe('awaitingInput')
    expect(taskIntermediateFlag(task({}))).toBeUndefined()
  })
})

describe('task.intermediate.* 本地化键(zh + en)', () => {
  it('四个键在 zh/en 中齐全', () => {
    expect(zh['task.intermediate.blockedReview']).toBe('待复核')
    expect(zh['task.intermediate.awaitingInput']).toBe('待输入')
    expect(zh['task.intermediate.blockedReviewDetail']).toContain('待政委复核')
    expect(zh['task.intermediate.awaitingInputDetail']).toContain('待')
    expect(en['task.intermediate.blockedReview']).toBe('Awaiting review')
    expect(en['task.intermediate.awaitingInput']).toBe('Awaiting input')
    expect(en['task.intermediate.blockedReviewDetail']).toContain('commissar')
    expect(en['task.intermediate.awaitingInputDetail']).toContain('input')
  })
})
