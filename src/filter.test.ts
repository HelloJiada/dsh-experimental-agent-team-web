import { describe, expect, it } from 'vitest'
import type { AgentTeamView } from './contract.js'
import {
  defaultAgentTeamFilterState,
  filterAgentTeam,
} from './filter.js'

function baseView(): AgentTeamView {
  return {
    teamId: 'lead' as never,
    leadMemberId: 'lead' as never,
    members: [
      { id: 'lead' as never, name: 'lead', role: 'lead', phase: 'active', sessionId: 'lead' as never },
      { id: 'worker-1' as never, name: 'Alice', role: 'teammate', phase: 'active', sessionId: 'worker-1' as never },
      { id: 'worker-2' as never, name: 'Bob', role: 'teammate', phase: 'failed', sessionId: 'worker-2' as never },
    ],
    tasks: [
      { id: 'task-a' as never, subject: 'Spec API', description: '', status: 'pending', ownerId: null, blockedBy: [], writeScopes: [], revision: 1 },
      { id: 'task-b' as never, subject: 'Implement API', description: '', status: 'pending', ownerId: null, blockedBy: ['task-a' as never], writeScopes: [], revision: 1 },
      { id: 'task-c' as never, subject: 'Ship docs', description: '', status: 'in_progress', ownerId: 'worker-1' as never, blockedBy: [], writeScopes: [], revision: 2 },
      { id: 'task-d' as never, subject: 'Done work', description: '', status: 'completed', ownerId: 'worker-1' as never, blockedBy: [], writeScopes: [], revision: 3 },
    ],
    messages: [
      { id: 'msg-1' as never, senderId: 'lead' as never, senderName: 'lead', targetId: 'worker-1' as never, delivery: 'wakeup', content: [], delivered: false },
      { id: 'msg-2' as never, senderId: 'lead' as never, senderName: 'lead', targetId: 'worker-2' as never, delivery: 'quiet', content: [], delivered: true },
    ],
    blockedTasks: [],
    activeTasks: [],
    pendingTasks: [],
    completedTasks: [],
    stalledTasks: [],
    orphanedTasks: [],
    readyTasks: [],
    taskInsights: [
      { taskId: 'task-a' as never, subject: 'Spec API', status: 'pending', readiness: 'ready', reasons: [], severity: 'medium', ownerId: null, interventionPriority: 1, dependencyDepth: 1 },
      { taskId: 'task-b' as never, subject: 'Implement API', status: 'pending', readiness: 'blocked', reasons: [], severity: 'high', ownerId: null, interventionPriority: 2, dependencyDepth: 0 },
      { taskId: 'task-c' as never, subject: 'Ship docs', status: 'in_progress', readiness: 'stalled', reasons: [], severity: 'medium', ownerId: 'worker-1' as never, interventionPriority: 3, dependencyDepth: 0 },
      { taskId: 'task-d' as never, subject: 'Done work', status: 'completed', readiness: 'ready', reasons: [], severity: 'low', ownerId: 'worker-1' as never, interventionPriority: 0, dependencyDepth: 0 },
    ],
    memberLoads: [
      { memberId: 'worker-1' as never, memberName: 'Alice', level: 'stretched', activeTaskCount: 1, pendingOwnedTaskCount: 0, stalledTaskCount: 1, orphanedTaskCount: 0 },
      { memberId: 'worker-2' as never, memberName: 'Bob', level: 'idle', activeTaskCount: 0, pendingOwnedTaskCount: 0, stalledTaskCount: 0, orphanedTaskCount: 0 },
    ],
    messageRisks: [
      { messageId: 'msg-1' as never, senderName: 'lead', targetId: 'worker-1' as never, delivery: 'wakeup', delivered: false, riskLevel: 'high', reasons: [] },
      { messageId: 'msg-2' as never, senderName: 'lead', targetId: 'worker-2' as never, delivery: 'quiet', delivered: true, riskLevel: 'low', reasons: [] },
    ],
    quickFilters: {
      taskFilters: [],
      memberFilters: [],
      messageFilters: [],
    },
    timeline: [],
    timelineSummary: {
      totalEvents: 0,
      memberEvents: 0,
      taskEvents: 0,
      messageEvents: 0,
      coalescedEntries: 0,
      firstSeq: null,
      lastSeq: null,
      firstTime: null,
      lastTime: null,
      latestTitle: null,
    },
    timelineMilestones: [],
    dependencyDag: { nodes: [], edges: [], levels: 0 },
    commandPlan: {
      version: 1,
      generatedFromTeamId: 'lead' as never,
      total: 0,
      highPriorityCount: 0,
      mediumPriorityCount: 0,
      lowPriorityCount: 0,
      commands: [],
    },
    summary: {
      memberCount: 2,
      failedMemberCount: 1,
      taskCount: 4,
      pendingTaskCount: 2,
      inProgressTaskCount: 1,
      completedTaskCount: 1,
      blockedTaskCount: 1,
      stalledTaskCount: 1,
      orphanedTaskCount: 0,
      readyTaskCount: 1,
      overloadedMemberCount: 0,
      messageCount: 2,
      undeliveredMessageCount: 1,
      wakeupMessageCount: 1,
      highRiskMessageCount: 1,
      healthScore: 60,
      statusLabel: '存在风险',
      overview: '',
      alerts: [],
      recommendedActions: [],
      captainBriefing: [],
      topInterventions: [],
    },
  }
}

describe('agentTeam interactive filter engine', () => {
  it('returns everything under the default filter state', () => {
    const filtered = filterAgentTeam(baseView(), defaultAgentTeamFilterState())
    expect(filtered.tasks).toHaveLength(4)
    expect(filtered.members).toHaveLength(3)
    expect(filtered.messages).toHaveLength(2)
    expect(filtered.displayedCount).toBe(9)
  })

  it('filters tasks by readiness', () => {
    const state = { ...defaultAgentTeamFilterState(), taskFilter: 'blocked' as const }
    const filtered = filterAgentTeam(baseView(), state)
    expect(filtered.tasks.map(task => task.id)).toEqual(['task-b'])
    expect(filtered.taskInsights.map(insight => insight.taskId)).toEqual(['task-b'])
  })

  it('filters tasks by subject query', () => {
    const state = { ...defaultAgentTeamFilterState(), taskQuery: 'API' }
    const filtered = filterAgentTeam(baseView(), state)
    expect(filtered.tasks.map(task => task.id)).toEqual(['task-a', 'task-b'])
  })

  it('filters members by load level and excludes lead when narrowed', () => {
    const state = { ...defaultAgentTeamFilterState(), memberFilter: 'stretched' as const }
    const filtered = filterAgentTeam(baseView(), state)
    expect(filtered.members.map(member => member.name)).toEqual(['Alice'])
    expect(filtered.memberLoads.map(load => load.memberName)).toEqual(['Alice'])
  })

  it('filters members by name query', () => {
    const state = { ...defaultAgentTeamFilterState(), memberQuery: 'bob' }
    const filtered = filterAgentTeam(baseView(), state)
    expect(filtered.members.map(member => member.name)).toEqual(['Bob'])
  })

  it('filters messages by risk and delivery', () => {
    const highRisk = { ...defaultAgentTeamFilterState(), messageFilter: 'high_risk' as const }
    expect(filterAgentTeam(baseView(), highRisk).messages.map(message => message.id)).toEqual(['msg-1'])

    const undelivered = { ...defaultAgentTeamFilterState(), messageFilter: 'undelivered' as const }
    const filtered = filterAgentTeam(baseView(), undelivered)
    expect(filtered.messages.map(message => message.id)).toEqual(['msg-1'])
    expect(filtered.messageRisks.map(risk => risk.messageId)).toEqual(['msg-1'])
  })
})
