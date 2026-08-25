import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  applyAgentTeamEvent,
  initAgentTeamProjection,
  viewAgentTeam,
} from '../projection.js'
import { activityPanelView, qualifiesForActivityPanel } from './activity-panel-view.js'

const teamId = SessionId('activity-panel-lead')
const workerId = SessionId('activity-panel-worker')

type FixtureTask = {
  readonly id: string
  readonly status: 'pending' | 'in_progress' | 'completed'
  readonly blockedBy?: readonly string[]
  readonly ownerId?: typeof workerId
}

function projectedTeam(tasks: readonly FixtureTask[], includeWorker = false) {
  let state = initAgentTeamProjection()
  let seq = 1

  if (includeWorker) {
    state = applyAgentTeamEvent(state, {
      type: 'team/member',
      seq: seq++,
      time: seq,
      data: {
        version: 1,
        teamId,
        member: {
          id: workerId,
          name: 'Worker',
          description: 'works on team tasks',
          provider: 'spawn',
          context: 'fresh',
          phase: 'active',
        },
      },
    } as unknown as SessionEvent)
  }

  for (const task of tasks) {
    state = applyAgentTeamEvent(state, {
      type: 'team/task',
      seq: seq++,
      time: seq,
      data: {
        version: 1,
        teamId,
        task: {
          id: task.id,
          revision: 1,
          subject: `Task ${task.id}`,
          description: `${task.id} description`,
          status: task.status,
          ownerId: task.ownerId,
          blockedBy: [...(task.blockedBy ?? [])],
          writeScopes: [],
        },
      },
    } as unknown as SessionEvent)
  }

  const view = viewAgentTeam(state)
  if (view === null) throw new Error('expected projection to produce a team view')
  return view
}

describe('activity panel view selectors', () => {
  it('qualifies only active or blocked teams', () => {
    const withOnlyCompletedTasks = projectedTeam([{ id: 'T-done', status: 'completed', ownerId: workerId }], true)
    const withBlockedTask = projectedTeam([{ id: 'T-blocked', status: 'pending', blockedBy: ['T-dependency'] }])
    const withInProgressTask = projectedTeam([{ id: 'T-active', status: 'in_progress', ownerId: workerId }], true)

    expect(qualifiesForActivityPanel(null)).toBe(false)
    expect(qualifiesForActivityPanel(withOnlyCompletedTasks)).toBe(false)
    expect(qualifiesForActivityPanel(withBlockedTask)).toBe(true)
    expect(qualifiesForActivityPanel(withInProgressTask)).toBe(true)
  })

  it('keeps existing intervention order and caps it at three', () => {
    const teamWithFourRankedInsights = projectedTeam([
      { id: 'T-4', status: 'pending' },
      { id: 'T-3', status: 'pending', blockedBy: ['T-4'] },
      { id: 'T-2', status: 'pending', blockedBy: ['T-3'] },
      { id: 'T-1', status: 'pending', blockedBy: ['T-2'] },
    ])

    const view = activityPanelView(teamWithFourRankedInsights)

    expect(teamWithFourRankedInsights.summary.topInterventions).toHaveLength(4)
    expect(view.priorities).toHaveLength(3)
    expect(view.priorities.map(item => item.taskId)).toEqual(['T-4', 'T-3', 'T-2'])
  })

  it('resolves member load and active-or-blocked task rows from projection output', () => {
    const team = projectedTeam([
      { id: 'T-active', status: 'in_progress', ownerId: workerId },
      { id: 'T-blocked', status: 'pending', blockedBy: ['T-dependency'] },
    ], true)
    const view = activityPanelView(team)

    expect(view.overview).toMatchObject({ activeTaskCount: 1, blockedTaskCount: 1, memberCount: 1 })
    expect(view.members).toEqual([expect.objectContaining({ memberId: workerId, level: 'stretched', activeTaskCount: 1 })])
    expect(view.tasks).toEqual([
      expect.objectContaining({ taskId: 'T-active', category: 'active', readiness: 'stalled' }),
      expect.objectContaining({ taskId: 'T-blocked', category: 'blocked', readiness: 'blocked' }),
    ])
  })

  it('returns healthy fallback state when projection has no priority item', () => {
    const team = projectedTeam([{ id: 'T-done', status: 'completed', ownerId: workerId }], true)
    const view = activityPanelView(team)

    expect(view.priorities).toEqual([])
    expect(view.fallback).toEqual({ state: 'healthy', message: team.summary.captainBriefing[0] })
  })
})
