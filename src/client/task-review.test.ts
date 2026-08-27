import { describe, expect, it } from 'vitest'
import type { ActivityTask } from './activity-monitor.ts'
import { taskReviewPending, taskReviewState } from './task-review.ts'
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

const passedReview = { reviewerName: '政委', verdict: 'pass' as const, reviewedAt: 1 }
const rejectedReview = { reviewerName: '政委', verdict: 'reject' as const, comment: '补充测试用例', reviewedAt: 1 }

describe('taskReviewPending — 待复核徽标条件（reviewRequired && review?.verdict !== "pass"）', () => {
  it('门禁任务且尚无复核记录 → 显示徽标', () => {
    expect(taskReviewPending(task({ reviewRequired: true }))).toBe(true)
  })

  it('门禁任务被驳回（verdict=reject）→ 仍在等待复核，显示徽标', () => {
    expect(taskReviewPending(task({ reviewRequired: true, review: rejectedReview }))).toBe(true)
  })

  it('门禁任务已通过（verdict=pass）→ 不显示徽标', () => {
    expect(taskReviewPending(task({ reviewRequired: true, review: passedReview }))).toBe(false)
  })

  it('非门禁任务 → 不显示徽标', () => {
    expect(taskReviewPending(task({}))).toBe(false)
    expect(taskReviewPending(task({ reviewRequired: false }))).toBe(false)
  })

  it('已完成任务 → 不显示徽标', () => {
    expect(taskReviewPending(task({ status: 'completed', reviewRequired: true }))).toBe(false)
  })
})

describe('taskReviewState — 复核展示态', () => {
  it('无门禁 → null（不渲染复核行）', () => {
    expect(taskReviewState(task({}))).toBeNull()
  })

  it('待复核 / 已通过 / 已驳回', () => {
    expect(taskReviewState(task({ reviewRequired: true }))).toBe('pending')
    expect(taskReviewState(task({ reviewRequired: true, review: passedReview }))).toBe('passed')
    expect(taskReviewState(task({ reviewRequired: true, review: rejectedReview }))).toBe('rejected')
  })

  it('快照派生语义：通过后 reviewRequired 为 false、review 保留 → 仍显示已复核', () => {
    expect(taskReviewState(task({ review: passedReview }))).toBe('passed')
  })
})

describe('task.review.* 本地化键（zh + en）', () => {
  it('三个键在 zh/en 中齐全且参数名匹配渲染调用', () => {
    expect(zh['task.review.pending']).toBe('待政委复核')
    expect(zh['task.review.passed']).toContain('{reviewer}')
    expect(zh['task.review.rejected']).toContain('{comment}')
    expect(en['task.review.pending']).toBe('Awaiting commissar review')
    expect(en['task.review.passed']).toContain('{reviewer}')
    expect(en['task.review.rejected']).toContain('{comment}')
  })
})
