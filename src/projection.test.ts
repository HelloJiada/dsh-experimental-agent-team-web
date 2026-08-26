import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TeamId } from './agent-team-types.js'
import {
  applyAgentTeamEvent,
  initAgentTeamProjection,
  viewAgentTeam,
} from './projection.js'

describe('agentTeam projection intelligence view', () => {
  it('builds grouped task sections and actionable summary', () => {
    const teamId = TeamId('session-lead')
    let state = initAgentTeamProjection()

    state = applyAgentTeamEvent(state, {
      type: 'team/member',
      seq: 1,
      time: 1,
      data: {
        version: 1,
        teamId,
        member: {
          id: SessionId('session-worker-1'),
          name: 'Researcher',
          description: 'does research',
          provider: 'spawn',
          context: 'fresh',
          phase: 'failed',
        },
      },
    } as unknown as SessionEvent)

    state = applyAgentTeamEvent(state, {
      type: 'team/task',
      seq: 2,
      time: 2,
      data: {
        version: 1,
        teamId,
        task: {
          id: 'task-blocked',
          revision: 1,
          subject: 'Blocked task',
          description: 'waits on dependency',
          status: 'pending',
          blockedBy: ['task-ready'],
          writeScopes: [],
        },
      },
    } as unknown as SessionEvent)

    state = applyAgentTeamEvent(state, {
      type: 'team/task',
      seq: 3,
      time: 3,
      data: {
        version: 1,
        teamId,
        task: {
          id: 'task-ready',
          revision: 2,
          subject: 'Ready task',
          description: 'can be claimed',
          status: 'pending',
          blockedBy: [],
          writeScopes: ['docs'],
        },
      },
    } as unknown as SessionEvent)

    state = applyAgentTeamEvent(state, {
      type: 'team/task',
      seq: 4,
      time: 4,
      data: {
        version: 1,
        teamId,
        task: {
          id: 'task-active',
          revision: 3,
          subject: 'Active task',
          description: 'currently executing',
          status: 'in_progress',
          ownerId: SessionId('session-worker-1'),
          blockedBy: [],
          writeScopes: ['src'],
        },
      },
    } as unknown as SessionEvent)

    state = applyAgentTeamEvent(state, {
      type: 'team/task',
      seq: 5,
      time: 5,
      data: {
        version: 1,
        teamId,
        task: {
          id: 'task-done',
          revision: 4,
          subject: 'Done task',
          description: 'finished',
          status: 'completed',
          ownerId: SessionId('session-worker-1'),
          blockedBy: [],
          writeScopes: [],
        },
      },
    } as unknown as SessionEvent)

    state = applyAgentTeamEvent(state, {
      type: 'team/message/queued',
      seq: 6,
      time: 6,
      data: {
        version: 1,
        teamId,
        message: {
          id: 'message-1',
          senderId: teamId,
          senderName: 'lead',
          targetId: SessionId('session-worker-1'),
          delivery: 'wakeup',
          content: [{ type: 'text', text: 'please continue' }],
        },
      },
    } as unknown as SessionEvent)

    const view = viewAgentTeam(state)
    expect(view).not.toBeNull()
    expect(view?.blockedTasks.map(task => task.id)).toEqual(['task-blocked'])
    expect(view?.activeTasks.map(task => task.id)).toEqual(['task-active'])
    expect(view?.pendingTasks.map(task => task.id)).toEqual(['task-blocked', 'task-ready'])
    expect(view?.completedTasks.map(task => task.id)).toEqual(['task-done'])
    expect(view?.readyTasks.map(task => task.id)).toEqual(['task-ready'])
    expect(view?.stalledTasks.map(task => task.id)).toEqual(['task-active'])
    expect(view?.summary.failedMemberCount).toBe(1)
    expect(view?.summary.blockedTaskCount).toBe(1)
    expect(view?.summary.stalledTaskCount).toBe(1)
    expect(view?.summary.undeliveredMessageCount).toBe(1)
    expect(view?.summary.healthScore).toBeLessThan(100)
    expect(view?.summary.alerts.join(' ')).toContain('未送达')
    expect(view?.summary.captainBriefing.join(' ')).toContain('stalled')
    expect(view?.summary.recommendedActions.length).toBeGreaterThan(0)
  })

  it('detects orphaned tasks and overloaded members', () => {
    const teamId = TeamId('session-lead')
    let state = initAgentTeamProjection()
    const workerId = SessionId('session-worker-2')

    state = applyAgentTeamEvent(state, {
      type: 'team/member',
      seq: 1,
      time: 1,
      data: {
        version: 1,
        teamId,
        member: {
          id: workerId,
          name: 'Builder',
          description: 'implements tasks',
          provider: 'spawn',
          context: 'fresh',
          phase: 'active',
        },
      },
    } as unknown as SessionEvent)

    state = applyAgentTeamEvent(state, {
      type: 'team/task',
      seq: 2,
      time: 2,
      data: {
        version: 1,
        teamId,
        task: {
          id: 'task-a',
          revision: 1,
          subject: 'Task A',
          description: 'active one',
          status: 'in_progress',
          ownerId: workerId,
          blockedBy: [],
          writeScopes: [],
        },
      },
    } as unknown as SessionEvent)

    state = applyAgentTeamEvent(state, {
      type: 'team/task',
      seq: 3,
      time: 3,
      data: {
        version: 1,
        teamId,
        task: {
          id: 'task-b',
          revision: 1,
          subject: 'Task B',
          description: 'active two',
          status: 'in_progress',
          ownerId: workerId,
          blockedBy: [],
          writeScopes: [],
        },
      },
    } as unknown as SessionEvent)

    state = applyAgentTeamEvent(state, {
      type: 'team/task',
      seq: 4,
      time: 4,
      data: {
        version: 1,
        teamId,
        task: {
          id: 'task-c',
          revision: 1,
          subject: 'Task C',
          description: 'active three',
          status: 'in_progress',
          ownerId: workerId,
          blockedBy: [],
          writeScopes: [],
        },
      },
    } as unknown as SessionEvent)

    state = applyAgentTeamEvent(state, {
      type: 'team/task',
      seq: 5,
      time: 5,
      data: {
        version: 1,
        teamId,
        task: {
          id: 'task-lost',
          revision: 1,
          subject: 'Lost task',
          description: 'missing owner',
          status: 'pending',
          ownerId: SessionId('missing-worker'),
          blockedBy: [],
          writeScopes: [],
        },
      },
    } as unknown as SessionEvent)

    const view = viewAgentTeam(state)
    expect(view?.orphanedTasks.map(task => task.id)).toEqual(['task-lost'])
    expect(view?.summary.orphanedTaskCount).toBe(1)
    expect(view?.memberLoads[0]?.level).toBe('overloaded')
    expect(view?.summary.alerts.join(' ')).toContain('orphaned')
  })

  it('returns healthy guidance when no alerts are present', () => {
    const teamId = TeamId('session-lead')
    let state = initAgentTeamProjection()

    state = applyAgentTeamEvent(state, {
      type: 'team/member',
      seq: 1,
      time: 1,
      data: {
        version: 1,
        teamId,
        member: {
          id: SessionId('session-worker-3'),
          name: 'Builder',
          description: 'implements tasks',
          provider: 'spawn',
          context: 'fresh',
          phase: 'active',
        },
      },
    } as unknown as SessionEvent)

    state = applyAgentTeamEvent(state, {
      type: 'team/task',
      seq: 2,
      time: 2,
      data: {
        version: 1,
        teamId,
        task: {
          id: 'task-ok',
          revision: 1,
          subject: 'Healthy task',
          description: 'done already',
          status: 'completed',
          ownerId: SessionId('session-worker-3'),
          blockedBy: [],
          writeScopes: [],
        },
      },
    } as unknown as SessionEvent)

    const view = viewAgentTeam(state)
    expect(view?.summary.healthScore).toBe(100)
    expect(view?.summary.statusLabel).toBe('运行平稳')
    expect(view?.summary.alerts).toEqual([])
    expect(view?.summary.captainBriefing).toEqual([
      '当前团队没有明显异常，可以继续保持既有节奏。',
    ])
    expect(view?.summary.recommendedActions).toEqual([
      '继续保持当前节奏，重点关注新阻塞和新失败事件。',
    ])
  })
})
