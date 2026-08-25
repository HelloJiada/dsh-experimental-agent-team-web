import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  applyAgentTeamEvent,
  initAgentTeamProjection,
  viewAgentTeam,
} from '../src/projection.js'

describe('agentTeam projection', () => {
  it('returns null when the session has no Team records', () => {
    expect(viewAgentTeam(initAgentTeamProjection())).toBeNull()
  })

  it('projects members, tasks, and mailbox rows from folded state', () => {
    const view = viewAgentTeam({
      teamId: 'root' as never,
      hasTeamEvents: true,
      members: {
        child: { id: 'child' as never, name: 'alice', description: '', provider: 'test', context: 'fresh', phase: 'active' },
      },
      tasks: {
        'task-2': {
          id: 'task-2' as never, revision: 2, subject: 'Ship plugin', description: 'Build it',
          status: 'in_progress', ownerId: 'child' as never, blockedBy: ['task-1' as never], writeScopes: ['packages/experimental'],
        },
        'task-1': {
          id: 'task-1' as never, revision: 1, subject: 'Spec', description: 'Write it',
          status: 'pending', blockedBy: [], writeScopes: [],
        },
        'task-3': {
          id: 'task-3' as never, revision: 1, subject: 'Deleted', description: 'drop',
          status: 'deleted', blockedBy: [], writeScopes: [],
        },
      },
      messages: {
        'msg-1': {
          id: 'msg-1' as never, senderId: 'root' as never, senderName: 'lead', targetId: 'child' as never,
          delivery: 'wakeup', content: [{ type: 'text', text: 'hello' }],
        },
      },
      delivered: { 'msg-1': true },
      history: [],
    })

    expect(view).not.toBeNull()
    expect(view?.teamId).toBe('root')
    expect(view?.members.map(member => member.role)).toEqual(['lead', 'teammate'])
    expect(view?.tasks.map(task => task.id)).toEqual(['task-2', 'task-1'])
    expect(view?.tasks[0]?.ownerId).toBe('child')
    expect(view?.messages[0]?.delivered).toBe(true)
    expect(view?.messages[0]?.content).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('ignores non-Team events', () => {
    const state = initAgentTeamProjection()
    const next = applyAgentTeamEvent(state, {
      type: 'user/message',
      seq: 1,
      time: 1,
      data: { content: [], source: { kind: 'user' }, role: 'user' },
    } as SessionEvent)
    expect(next).toBe(state)
  })
})
