import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { AgentTeamProjectionState } from './projection.js'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TeamId } from './agent-team-types.js'
import {
  applyAgentTeamEvent,
  initAgentTeamProjection,
  viewAgentTeam,
} from './projection.js'

describe('agentTeam historical timeline', () => {
  it('accumulates bounded event history and surfaces it in the timeline', () => {
    const teamId = TeamId('session-lead')
    let state = initAgentTeamProjection()

    state = applyAgentTeamEvent(state, {
      type: 'team/member',
      seq: 1,
      time: 10,
      data: {
        version: 1,
        teamId,
        member: {
          id: SessionId('session-worker-1'),
          name: 'Researcher',
          description: '',
          provider: 'spawn',
          context: 'fresh',
          phase: 'active',
        },
      },
    } as unknown as SessionEvent)

    state = applyAgentTeamEvent(state, {
      type: 'team/task',
      seq: 2,
      time: 20,
      data: {
        version: 1,
        teamId,
        task: {
          id: 'task-1',
          revision: 1,
          subject: 'Research plan',
          description: '',
          status: 'pending',
          blockedBy: [],
          writeScopes: [],
        },
      },
    } as unknown as SessionEvent)

    state = applyAgentTeamEvent(state, {
      type: 'team/message/queued',
      seq: 3,
      time: 30,
      data: {
        version: 1,
        teamId,
        message: {
          id: 'message-1',
          senderId: teamId,
          senderName: 'lead',
          targetId: SessionId('session-worker-1'),
          delivery: 'wakeup',
          content: [{ type: 'text', text: 'start' }],
        },
      },
    } as unknown as SessionEvent)

    state = applyAgentTeamEvent(state, {
      type: 'team/message/delivered',
      seq: 4,
      time: 40,
      data: {
        version: 1,
        teamId,
        messageId: 'message-1',
        targetId: SessionId('session-worker-1'),
      },
    } as unknown as SessionEvent)

    const view = viewAgentTeam(state)
    expect(view).not.toBeNull()
    expect(view?.timelineSummary.totalEvents).toBe(4)
    expect(view?.timelineSummary.messageEvents).toBe(1)
    expect(view?.timelineSummary.coalescedEntries).toBe(1)
    expect(view?.timelineSummary.firstSeq).toBe(1)
    expect(view?.timelineSummary.lastSeq).toBe(4)
    // History-backed timeline preserves event order and metadata; queued +
    // delivered coalesce into one message row, so seqs are [1, 2, 4].
    expect(view?.timeline.map(entry => entry.seq)).toEqual([1, 2, 4])
    expect(view?.timeline.map(entry => entry.time)).toEqual([10, 20, 40])
    const delivered = view?.timeline.find(entry => entry.id === 'team/message/delivered:4')
    expect(delivered?.tone).toBe('good')
    expect(delivered?.count).toBe(2)
    expect(delivered?.title).toContain('message-1')
    const memberEntry = view?.timeline.find(entry => entry.id === 'team/member:1')
    expect(memberEntry?.kind).toBe('member')
    expect(memberEntry?.tone).toBe('good')
  })

  it('falls back to snapshot-derived timeline when history is absent', () => {
    const teamId = TeamId('session-lead')
    let state = initAgentTeamProjection()
    state = applyAgentTeamEvent(state, {
      type: 'team/task',
      seq: 1,
      time: 5,
      data: {
        version: 1,
        teamId,
        task: {
          id: 'task-1',
          revision: 1,
          subject: 'Only task',
          description: '',
          status: 'in_progress',
          ownerId: SessionId('session-worker-1'),
          blockedBy: [],
          writeScopes: [],
        },
      },
    } as unknown as SessionEvent)

    // Simulate a persisted state without history (older schema).
    const legacyState = {
      ...state,
      history: undefined,
    } as unknown as AgentTeamProjectionState
    const view = viewAgentTeam(legacyState)
    expect(view?.timeline.length).toBe(1)
    expect(view?.timeline[0]?.id).toBe('task:task-1')
    expect(view?.timeline[0]?.time).toBeUndefined()

    const next = applyAgentTeamEvent(legacyState, {
      type: 'team/task',
      seq: 2,
      time: 10,
      data: {
        version: 1,
        teamId,
        task: {
          id: 'task-2',
          revision: 1,
          subject: 'Continued task',
          description: '',
          status: 'pending',
          blockedBy: [],
          writeScopes: [],
        },
      },
    } as unknown as SessionEvent)

    expect(next.history).toHaveLength(1)
    expect(next.history[0]?.entityKey).toBe('task:task-2')
  })

  it('coalesces repeated events for the same entity into one entry with a running count', () => {
    const teamId = TeamId('session-lead')
    let state = initAgentTeamProjection()
    const taskId = 'task-1'

    for (let revision = 1; revision <= 3; revision += 1) {
      state = applyAgentTeamEvent(state, {
        type: 'team/task',
        seq: revision,
        time: revision * 10,
        data: {
          version: 1,
          teamId,
          task: {
            id: taskId,
            revision,
            subject: 'Iterating task',
            description: '',
            status: revision === 3 ? 'completed' : 'in_progress',
            ownerId: SessionId('session-worker-1'),
            blockedBy: [],
            writeScopes: [],
          },
        },
      } as unknown as SessionEvent)
    }

    const view = viewAgentTeam(state)
    expect(view?.timeline).toHaveLength(1)
    const entry = view?.timeline[0]
    expect(entry?.id).toBe('team/task:3')
    expect(entry?.count).toBe(3)
    expect(entry?.detail).toContain('completed')
    expect(entry?.tone).toBe('good')
  })

  it('merges message queued and delivered events into a single delivered row', () => {
    const teamId = TeamId('session-lead')
    let state = initAgentTeamProjection()

    state = applyAgentTeamEvent(state, {
      type: 'team/message/queued',
      seq: 1,
      time: 10,
      data: {
        version: 1,
        teamId,
        message: {
          id: 'message-1',
          senderId: teamId,
          senderName: 'lead',
          targetId: SessionId('session-worker-1'),
          delivery: 'wakeup',
          content: [],
        },
      },
    } as unknown as SessionEvent)
    state = applyAgentTeamEvent(state, {
      type: 'team/message/delivered',
      seq: 2,
      time: 20,
      data: {
        version: 1,
        teamId,
        messageId: 'message-1',
        targetId: SessionId('session-worker-1'),
      },
    } as unknown as SessionEvent)

    const view = viewAgentTeam(state)
    expect(view?.timeline).toHaveLength(1)
    const entry = view?.timeline[0]
    expect(entry?.kind).toBe('message')
    expect(entry?.count).toBe(2)
    expect(entry?.detail).toContain('已送达')
    expect(entry?.tone).toBe('good')
  })

  it('coalesces member phase changes to the latest state', () => {
    const teamId = TeamId('session-lead')
    let state = initAgentTeamProjection()

    const memberEvent = (seq: number, phase: 'provisioning' | 'active' | 'failed'): SessionEvent => ({
      type: 'team/member',
      seq,
      time: seq * 10,
      data: {
        version: 1,
        teamId,
        member: {
          id: SessionId('session-worker-1'),
          name: 'Researcher',
          description: '',
          provider: 'spawn',
          context: 'fresh',
          phase,
        },
      },
    } as unknown as SessionEvent)

    state = applyAgentTeamEvent(state, memberEvent(1, 'provisioning'))
    state = applyAgentTeamEvent(state, memberEvent(2, 'active'))
    state = applyAgentTeamEvent(state, memberEvent(3, 'failed'))

    const view = viewAgentTeam(state)
    expect(view?.timeline).toHaveLength(1)
    const entry = view?.timeline[0]
    expect(entry?.count).toBe(3)
    expect(entry?.detail).toContain('failed')
    expect(entry?.tone).toBe('danger')
  })

  it('bounds the retained history window to the limit', () => {
    const teamId = TeamId('session-lead')
    let state = initAgentTeamProjection()

    for (let index = 1; index <= 150; index += 1) {
      state = applyAgentTeamEvent(state, {
        type: 'team/member',
        seq: index,
        time: index,
        data: {
          version: 1,
          teamId,
          member: {
            id: SessionId(`session-worker-${index}`),
            name: `Worker ${index}`,
            description: '',
            provider: 'spawn',
            context: 'fresh',
            phase: 'active',
          },
        },
      } as unknown as SessionEvent)
    }

    expect(state.history.length).toBe(100)
    // Oldest distinct entities are dropped: worker-1 is gone, worker-150 survives.
    expect(state.history.some(entry => entry.entityKey === 'member:session-worker-1')).toBe(false)
    expect(state.history.some(entry => entry.entityKey === 'member:session-worker-150')).toBe(true)
  })
})
