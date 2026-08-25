import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  applyAgentTeamEvent,
  dependencyDepthOf,
  initAgentTeamProjection,
  messageRiskView,
  quickFiltersView,
  taskInsightView,
  timelineMilestonesView,
  timelineSummaryView,
  timelineView,
  viewAgentTeam,
} from './projection.js'
import type {
  AgentTeamMemberLoadView,
  AgentTeamMessageRiskView,
  AgentTeamMessageView,
  AgentTeamTaskView,
} from './contract.js'

function task(id: string, status: AgentTeamTaskView['status'], blockedBy: string[] = [], ownerId?: string): AgentTeamTaskView {
  return {
    id: id as never,
    subject: `Task ${id}`,
    description: '',
    status,
    ownerId: (ownerId ?? null) as never,
    blockedBy: blockedBy.map(blocked => blocked as never),
    writeScopes: [],
    revision: 1,
  }
}

describe('agentTeam dependency depth and intervention ranking', () => {
  it('computes transitive dependency fan-out', () => {
    const tasks = [
      task('task-a', 'pending'),
      task('task-b', 'pending', ['task-a']),
      task('task-c', 'pending', ['task-b']),
    ]
    expect(dependencyDepthOf('task-a', tasks)).toBe(2)
    expect(dependencyDepthOf('task-b', tasks)).toBe(1)
    expect(dependencyDepthOf('task-c', tasks)).toBe(0)
  })

  it('ranks blocked high-fan-out tasks as top intervention', () => {
    const tasks = [
      task('task-a', 'pending'),
      task('task-b', 'pending', ['task-a']),
      task('task-c', 'pending', ['task-b']),
      task('task-done', 'completed'),
    ]
    const memberIds = new Set<string>(['lead'])
    const insights = tasks.map(t => taskInsightView(t, memberIds, dependencyDepthOf(t.id, tasks)))
    const chainHead = insights.find(insight => insight.taskId === 'task-a')
    expect(chainHead?.dependencyDepth).toBe(2)
    const first = insights
      .filter(insight => insight.status !== 'completed')
      .sort((a, b) => b.dependencyDepth - a.dependencyDepth || b.severity.localeCompare(a.severity))[0]
    expect(first?.taskId).toBe('task-a')
  })

  it('projects intervention priorities into the view', () => {
    const teamId = SessionId('session-lead')
    let state = initAgentTeamProjection()
    state = applyAgentTeamEvent(state, {
      type: 'team/task',
      seq: 1,
      time: 1,
      data: {
        version: 1,
        teamId,
        task: {
          id: 'task-a',
          revision: 1,
          subject: 'Chain head',
          description: '',
          status: 'pending',
          blockedBy: [],
          writeScopes: [],
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
          id: 'task-b',
          revision: 1,
          subject: 'Chain tail',
          description: '',
          status: 'pending',
          blockedBy: ['task-a'],
          writeScopes: [],
        },
      },
    } as unknown as SessionEvent)

    const view = viewAgentTeam(state)
    const insightA = view?.taskInsights.find(insight => insight.taskId === 'task-a')
    const insightB = view?.taskInsights.find(insight => insight.taskId === 'task-b')
    expect(insightA?.interventionPriority).toBe(1)
    expect(insightB?.interventionPriority).toBe(2)
    expect(view?.summary.topInterventions[0]).toContain('P1')
    expect(view?.summary.topInterventions[0]).toContain('Chain head')
  })
})

describe('agentTeam message risk, quick filters, and timeline', () => {
  it('classifies message risk by delivery and target health', () => {
    const failedTargets = new Set<string>(['worker-failed'])
    const wakeupUndelivered = messageRiskView({
      id: 'msg-1' as never,
      senderId: SessionId('lead'),
      senderName: 'lead',
      targetId: SessionId('worker-1'),
      delivery: 'wakeup',
      content: [],
      delivered: false,
    }, failedTargets)
    expect(wakeupUndelivered.riskLevel).toBe('high')

    const delivered = messageRiskView({
      id: 'msg-2' as never,
      senderId: SessionId('lead'),
      senderName: 'lead',
      targetId: SessionId('worker-1'),
      delivery: 'quiet',
      content: [],
      delivered: true,
    }, failedTargets)
    expect(delivered.riskLevel).toBe('low')

    const failedTarget = messageRiskView({
      id: 'msg-3' as never,
      senderId: SessionId('lead'),
      senderName: 'lead',
      targetId: SessionId('worker-failed'),
      delivery: 'quiet',
      content: [],
      delivered: true,
    }, failedTargets)
    expect(failedTarget.riskLevel).toBe('high')
  })

  it('derives quick filter counts from current facts', () => {
    const tasks = [
      task('task-a', 'pending'),
      task('task-b', 'pending', ['task-a']),
      task('task-c', 'completed'),
    ]
    const memberIds = new Set<string>([])
    const insights = tasks.map(t => taskInsightView(t, memberIds, dependencyDepthOf(t.id, tasks)))
    const memberLoads: AgentTeamMemberLoadView[] = []
    const messages: AgentTeamMessageView[] = []
    const messageRisks: AgentTeamMessageRiskView[] = []
    const filters = quickFiltersView(tasks, insights, memberLoads, messages, messageRisks)

    const all = filters.taskFilters.find(option => option.key === 'all')
    expect(all?.count).toBe(3)
    const blocked = filters.taskFilters.find(option => option.key === 'blocked')
    expect(blocked?.count).toBe(1)
    const completed = filters.taskFilters.find(option => option.key === 'completed')
    expect(completed?.count).toBe(1)
    const ready = filters.taskFilters.find(option => option.key === 'ready')
    expect(ready?.count).toBe(1)
  })

  it('builds a deterministic timeline with tones', () => {
    const members = [
      { id: SessionId('lead'), name: 'lead', role: 'lead' as const, phase: 'active' as const, sessionId: SessionId('lead') },
      { id: SessionId('worker-1'), name: 'Researcher', role: 'teammate' as const, phase: 'failed' as const, sessionId: SessionId('worker-1') },
    ]
    const tasks = [task('task-a', 'in_progress', [], 'worker-1')]
    const messages = [
      {
        id: 'msg-1' as never,
        senderId: SessionId('lead'),
        senderName: 'lead',
        targetId: SessionId('worker-1'),
        delivery: 'wakeup' as const,
        content: [],
        delivered: false,
      },
    ]
    const timeline = timelineView(members, tasks, messages)
    expect(timeline.length).toBe(3)
    const taskEntry = timeline.find(entry => entry.id === 'task:task-a')
    expect(taskEntry?.tone).toBe('warn')
    const memberEntry = timeline.find(entry => entry.id === 'member:worker-1')
    expect(memberEntry?.tone).toBe('danger')
    const messageEntry = timeline.find(entry => entry.id === 'message:msg-1')
    expect(messageEntry?.tone).toBe('danger')
  })

  it('summarizes coalesced historical timeline windows', () => {
    const summary = timelineSummaryView([
      { id: 'team/member:1', kind: 'member', title: '成员 Researcher', detail: 'phase active', tone: 'good', seq: 1, time: 10 },
      { id: 'team/task:4', kind: 'task', title: '任务 Draft', detail: 'status in_progress', tone: 'warn', seq: 4, time: 40, count: 3 },
      { id: 'team/message:5', kind: 'message', title: '消息 lead → worker-1', detail: '已送达', tone: 'good', seq: 5, time: 50 },
    ])
    expect(summary.totalEvents).toBe(5)
    expect(summary.memberEvents).toBe(1)
    expect(summary.taskEvents).toBe(1)
    expect(summary.messageEvents).toBe(1)
    expect(summary.coalescedEntries).toBe(1)
    expect(summary.firstSeq).toBe(1)
    expect(summary.lastSeq).toBe(5)
    expect(summary.firstTime).toBe(10)
    expect(summary.lastTime).toBe(50)
    expect(summary.latestTitle).toBe('消息 lead → worker-1')
  })

  it('groups rolling milestone windows most-recent-first with tone-ranked headlines', () => {
    const windows = timelineMilestonesView([
      { id: 'e:1', kind: 'member', title: '团队创建', detail: '', tone: 'good', seq: 1, time: 1 },
      { id: 'e:2', kind: 'task', title: '任务 A', detail: '', tone: 'neutral', seq: 2, time: 2 },
      { id: 'e:3', kind: 'task', title: '任务 B', detail: '', tone: 'danger', seq: 3, time: 3, count: 3 },
      { id: 'e:4', kind: 'message', title: '消息 x', detail: '', tone: 'neutral', seq: 4, time: 4 },
      { id: 'e:5', kind: 'task', title: '任务 C', detail: '', tone: 'good', seq: 5, time: 5 },
      { id: 'e:6', kind: 'message', title: '消息 y', detail: '', tone: 'warn', seq: 6, time: 6, count: 2 },
      { id: 'e:7', kind: 'task', title: '任务 D', detail: '', tone: 'neutral', seq: 7, time: 7 },
      { id: 'e:8', kind: 'member', title: '成员加入 Z', detail: '', tone: 'good', seq: 8, time: 8 },
      { id: 'e:9', kind: 'task', title: '任务 E', detail: '', tone: 'neutral', seq: 9, time: 9 },
      { id: 'e:10', kind: 'message', title: '消息 z', detail: '', tone: 'good', seq: 10, time: 10 },
    ])

    expect(windows).toHaveLength(2)
    // Most recent window first: rows 9-10.
    expect(windows[0]?.startSeq).toBe(9)
    expect(windows[0]?.endSeq).toBe(10)
    expect(windows[0]?.entryCount).toBe(2)
    expect(windows[0]?.eventCount).toBe(2)
    expect(windows[0]?.headline).toBe('消息 z')
    // Older window: danger headline wins over good/neutral rows.
    expect(windows[1]?.startSeq).toBe(1)
    expect(windows[1]?.endSeq).toBe(8)
    expect(windows[1]?.entryCount).toBe(8)
    expect(windows[1]?.eventCount).toBe(11)
    expect(windows[1]?.memberEvents).toBe(2)
    expect(windows[1]?.taskEvents).toBe(6)
    expect(windows[1]?.messageEvents).toBe(3)
    expect(windows[1]?.headline).toBe('任务 B')
    expect(windows[1]?.headlineTone).toBe('danger')
  })

  it('returns no milestone windows for an empty timeline', () => {
    expect(timelineMilestonesView([])).toEqual([])
  })

  it('groups milestone windows by wall-clock buckets in time mode', () => {
    const windows = timelineMilestonesView([
      { id: 'e:1', kind: 'member', title: '团队创建', detail: '', tone: 'good', seq: 1, time: 100 },
      { id: 'e:2', kind: 'task', title: '任务 A', detail: '', tone: 'neutral', seq: 2, time: 200 },
      { id: 'e:3', kind: 'message', title: '消息 x', detail: '', tone: 'warn', seq: 3, time: 5100 },
      { id: 'e:4', kind: 'task', title: '任务 B', detail: '', tone: 'danger', seq: 4, time: 5200 },
      { id: 'e:5', kind: 'message', title: '消息 y', detail: '', tone: 'neutral', seq: 5 },
    ], { mode: 'time', windowMs: 1000 })

    expect(windows).toHaveLength(3)
    // Most recent bucket first (times 5100-5200 → bucket 5).
    expect(windows[0]?.startSeq).toBe(3)
    expect(windows[0]?.endSeq).toBe(4)
    expect(windows[0]?.entryCount).toBe(2)
    expect(windows[0]?.headline).toBe('任务 B')
    expect(windows[0]?.headlineTone).toBe('danger')
    // Middle bucket (times 100-200 → bucket 0).
    expect(windows[1]?.startSeq).toBe(1)
    expect(windows[1]?.endSeq).toBe(2)
    expect(windows[1]?.eventCount).toBe(2)
    // Rows without time land in the earliest bucket.
    expect(windows[2]?.entryCount).toBe(1)
    expect(windows[2]?.headline).toBe('消息 y')
  })
})
