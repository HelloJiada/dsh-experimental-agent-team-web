import { describe, expect, it } from 'vitest'
import {
  deliverableKey,
  mainChainTaskBudget,
  maintenanceDependencyPath,
  taskImpact,
  teamGoal,
  workflowMode,
} from './state.ts'
import { taskReviewPassed } from './state.ts'
import type { TeamState, TeamTask } from './types.ts'

function task(id: string, overrides: Partial<TeamTask> = {}): TeamTask {
  return {
    id,
    subject: id,
    status: 'pending',
    dependencies: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function team(overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: 'team',
    id: 'team',
    captainSessionId: 'captain',
    createdAt: 1,
    members: [],
    tasks: [],
    taskSeq: 0,
    ...overrides,
  }
}

describe('workflow guardrail state helpers', () => {
  it('keeps legacy team JSON readable through deterministic fallbacks', () => {
    const legacy = team({ description: 'legacy goal' })
    expect(teamGoal(legacy)).toBe('legacy goal')
    expect(workflowMode(legacy)).toBe('decision')
    expect(mainChainTaskBudget(legacy)).toBe(3)
    expect(taskImpact(task('legacy'))).toBe('blocks-execution')
  })

  it('normalizes exact deliverables including root files', () => {
    expect(deliverableKey('README.md')).toBe('readme.md')
    expect(deliverableKey('./README.md')).toBe('readme.md')
    expect(deliverableKey('docs/../README.md')).toBeUndefined()
    expect(deliverableKey('/README.md')).toBeUndefined()
  })

  it('finds a transitive maintenance dependency for main-chain work', () => {
    const tasks = [
      task('t1', { impact: 'maintenance' }),
      task('t2', { dependencies: ['t1'] }),
      task('t3', { dependencies: ['t2'] }),
    ]
    expect(maintenanceDependencyPath(tasks, ['t3'])).toEqual(['t3', 't2', 't1'])
    expect(maintenanceDependencyPath([task('t1')], ['t1'])).toBeUndefined()
  })

  it('accepts legacy review passes but rejects stale attempt or contract passes', () => {
    const legacy = task('legacy', { review: { reviewerName: 'reviewer', verdict: 'pass', reviewedAt: 1 } })
    expect(taskReviewPassed(legacy)).toBe(true)

    const current = task('current', {
      attempt: 2,
      contractRevision: 3,
      review: { reviewerName: 'reviewer', verdict: 'pass', reviewedAt: 1, attempt: 1, contractRevision: 3 },
    })
    expect(taskReviewPassed(current)).toBe(false)
    current.review = { reviewerName: 'reviewer', verdict: 'pass', reviewedAt: 2, attempt: 2, contractRevision: 3 }
    expect(taskReviewPassed(current)).toBe(true)
  })
})
