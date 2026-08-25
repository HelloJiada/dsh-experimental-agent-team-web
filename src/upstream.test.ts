import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  applyAgentTeamEvent,
  initAgentTeamProjection,
  viewAgentTeam,
} from './projection.js'

function event(type: string, seq: number, data: Record<string, unknown>): SessionEvent {
  return {
    type,
    seq,
    time: seq,
    data,
  } as unknown as SessionEvent
}

describe('agentTeam upstream (agent-teams/*) adapter', () => {
  it('opens a team via team-created', () => {
    let state = initAgentTeamProjection()
    state = applyAgentTeamEvent(state, event('agent-teams/team-created', 1, {
      teamId: 'team-docs',
      captainSessionId: 'session-lead',
      name: 'Docs Crew',
    }))
    expect(state.teamId).toEqual(SessionId('team-docs'))
    expect(state.hasTeamEvents).toBe(true)
  })

  it('adds and removes members', () => {
    let state = initAgentTeamProjection()
    state = applyAgentTeamEvent(state, event('agent-teams/team-created', 1, {
      teamId: 'team-docs',
      captainSessionId: 'session-lead',
      name: 'Docs Crew',
    }))
    state = applyAgentTeamEvent(state, event('agent-teams/member-added', 2, {
      teamId: 'team-docs',
      memberId: 'session-worker-1',
      name: 'Researcher',
      role: 'research',
    }))
    expect(state.members['session-worker-1']?.name).toBe('Researcher')
    expect(state.members['session-worker-1']?.description).toBe('research')
    expect(state.members['session-worker-1']?.phase).toBe('active')

    state = applyAgentTeamEvent(state, event('agent-teams/member-removed', 3, {
      teamId: 'team-docs',
      memberId: 'session-worker-1',
    }))
    expect(state.members['session-worker-1']).toBeUndefined()
  })

  it('maps upstream task statuses and resolves assignee names', () => {
    let state = initAgentTeamProjection()
    state = applyAgentTeamEvent(state, event('agent-teams/team-created', 1, {
      teamId: 'team-docs',
      captainSessionId: 'session-lead',
      name: 'Docs Crew',
    }))
    state = applyAgentTeamEvent(state, event('agent-teams/member-added', 2, {
      teamId: 'team-docs',
      memberId: 'session-worker-1',
      name: 'Researcher',
    }))

    state = applyAgentTeamEvent(state, event('agent-teams/task-created', 3, {
      teamId: 'team-docs',
      taskId: 't1',
      subject: 'Spec API',
      dependencies: [],
      assignee: 'Researcher',
    }))
    expect(state.tasks['t1']?.status).toBe('pending')
    expect(state.tasks['t1']?.ownerId).toEqual(SessionId('session-worker-1'))
    expect(state.tasks['t1']?.revision).toBe(1)

    // claimed -> pending with owner; revision increments
    state = applyAgentTeamEvent(state, event('agent-teams/task-updated', 4, {
      teamId: 'team-docs',
      taskId: 't1',
      status: 'claimed',
      assignee: 'Researcher',
    }))
    expect(state.tasks['t1']?.status).toBe('pending')
    expect(state.tasks['t1']?.revision).toBe(2)

    state = applyAgentTeamEvent(state, event('agent-teams/task-updated', 5, {
      teamId: 'team-docs',
      taskId: 't1',
      status: 'failed',
    }))
    expect(state.tasks['t1']?.status).toBe('failed')
    expect(state.tasks['t1']?.revision).toBe(3)
  })

  it('folds upstream events into the view with terminal readiness', () => {
    let state = initAgentTeamProjection()
    state = applyAgentTeamEvent(state, event('agent-teams/team-created', 1, {
      teamId: 'team-docs',
      captainSessionId: 'session-lead',
      name: 'Docs Crew',
    }))
    state = applyAgentTeamEvent(state, event('agent-teams/task-created', 2, {
      teamId: 'team-docs',
      taskId: 't1',
      subject: 'Will fail',
      dependencies: [],
    }))
    state = applyAgentTeamEvent(state, event('agent-teams/task-updated', 3, {
      teamId: 'team-docs',
      taskId: 't1',
      status: 'failed',
    }))
    state = applyAgentTeamEvent(state, event('agent-teams/task-created', 4, {
      teamId: 'team-docs',
      taskId: 't2',
      subject: 'Will cancel',
      dependencies: [],
    }))
    state = applyAgentTeamEvent(state, event('agent-teams/task-updated', 5, {
      teamId: 'team-docs',
      taskId: 't2',
      status: 'cancelled',
    }))

    const view = viewAgentTeam(state)
    const failed = view?.taskInsights.find(insight => insight.taskId === 't1')
    const cancelled = view?.taskInsights.find(insight => insight.taskId === 't2')
    expect(failed?.readiness).toBe('failed')
    expect(failed?.status).toBe('failed')
    expect(cancelled?.readiness).toBe('cancelled')
    expect(cancelled?.status).toBe('cancelled')
    // Terminal work is not actionable.
    expect(view?.summary.topInterventions.join(' ')).not.toContain('Will fail')
    expect(view?.summary.topInterventions.join(' ')).not.toContain('Will cancel')
  })

  it('records upstream mailbox messages with name resolution', () => {
    let state = initAgentTeamProjection()
    state = applyAgentTeamEvent(state, event('agent-teams/team-created', 1, {
      teamId: 'team-docs',
      captainSessionId: 'session-lead',
      name: 'Docs Crew',
    }))
    state = applyAgentTeamEvent(state, event('agent-teams/member-added', 2, {
      teamId: 'team-docs',
      memberId: 'session-worker-1',
      name: 'Researcher',
    }))
    state = applyAgentTeamEvent(state, event('agent-teams/message-sent', 3, {
      teamId: 'team-docs',
      messageId: 'm1',
      from: 'captain',
      to: 'Researcher',
      content: 'please research',
      ts: 100,
    }))

    const message = state.messages['m1']
    expect(message?.senderId).toEqual(SessionId('team-docs'))
    expect(message?.targetId).toEqual(SessionId('session-worker-1'))
    expect(message?.senderName).toBe('captain')
    expect(message?.delivery).toBe('quiet')
    expect(message?.content).toEqual([{ type: 'text', text: 'please research' }])
  })

  it('surfaces team deletion in the timeline history', () => {
    let state = initAgentTeamProjection()
    state = applyAgentTeamEvent(state, event('agent-teams/team-created', 1, {
      teamId: 'team-docs',
      captainSessionId: 'session-lead',
      name: 'Docs Crew',
    }))
    state = applyAgentTeamEvent(state, event('agent-teams/team-deleted', 2, {
      teamId: 'team-docs',
    }))

    const view = viewAgentTeam(state)
    const deleted = view?.timeline.find(entry => entry.id === 'agent-teams/team-deleted:2')
    expect(deleted?.title).toBe('团队已删除')
    expect(deleted?.tone).toBe('danger')
    expect(view?.timelineSummary.totalEvents).toBe(2)
    expect(view?.timelineSummary.latestTitle).toBe('团队已删除')
  })
})
