import { describe, expect, it } from 'vitest'
import type { AgentTeamView } from './contract.js'
import { commandPlanView, suggestCommands } from './commands.js'

function riskView(): AgentTeamView {
  return {
    teamId: 'lead' as never,
    leadMemberId: 'lead' as never,
    members: [
      { id: 'lead' as never, name: 'lead', role: 'lead', phase: 'active', sessionId: 'lead' as never },
      { id: 'worker-1' as never, name: 'Alice', role: 'teammate', phase: 'failed', sessionId: 'worker-1' as never },
    ],
    tasks: [],
    messages: [],
    blockedTasks: [],
    activeTasks: [],
    pendingTasks: [],
    completedTasks: [],
    stalledTasks: [],
    orphanedTasks: [],
    readyTasks: [],
    taskInsights: [
      { taskId: 'task-orphan' as never, subject: 'Lost task', status: 'pending', readiness: 'orphaned', reasons: ['owner 不可见'], severity: 'high', ownerId: 'ghost' as never, interventionPriority: 1, dependencyDepth: 0 },
      { taskId: 'task-ready' as never, subject: 'Ready task', status: 'pending', readiness: 'ready', reasons: [], severity: 'medium', ownerId: null, interventionPriority: 2, dependencyDepth: 0 },
      { taskId: 'task-stalled' as never, subject: 'Stalled task', status: 'in_progress', readiness: 'stalled', reasons: [], severity: 'medium', ownerId: null, interventionPriority: 3, dependencyDepth: 0 },
      { taskId: 'task-blocked' as never, subject: 'Blocked task', status: 'pending', readiness: 'blocked', reasons: ['依赖未完成'], severity: 'high', ownerId: null, interventionPriority: 4, dependencyDepth: 0 },
    ],
    memberLoads: [
      { memberId: 'worker-1' as never, memberName: 'Alice', level: 'overloaded', activeTaskCount: 3, pendingOwnedTaskCount: 1, stalledTaskCount: 0, orphanedTaskCount: 1 },
    ],
    messageRisks: [
      { messageId: 'msg-1' as never, senderName: 'lead', targetId: 'worker-1' as never, delivery: 'wakeup', delivered: false, riskLevel: 'high', reasons: ['目标成员 failed'] },
    ],
    quickFilters: { taskFilters: [], memberFilters: [], messageFilters: [] },
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
      memberCount: 1,
      failedMemberCount: 1,
      taskCount: 4,
      pendingTaskCount: 3,
      inProgressTaskCount: 1,
      completedTaskCount: 0,
      blockedTaskCount: 1,
      stalledTaskCount: 1,
      orphanedTaskCount: 1,
      readyTaskCount: 1,
      overloadedMemberCount: 1,
      messageCount: 1,
      undeliveredMessageCount: 1,
      wakeupMessageCount: 1,
      highRiskMessageCount: 1,
      healthScore: 10,
      statusLabel: '需要立即干预',
      overview: '',
      alerts: [],
      recommendedActions: [],
      captainBriefing: [],
      topInterventions: [],
    },
  }
}

describe('agentTeam command bridge', () => {
  it('derives command suggestions from committed facts', () => {
    const commands = suggestCommands(riskView())
    const kinds = new Set(commands.map(command => command.kind))
    expect(kinds.has('task:reassign')).toBe(true) // orphaned + overloaded rebalance
    expect(kinds.has('task:claim')).toBe(true) // stalled without owner
    expect(kinds.has('task:unblock')).toBe(true) // blocked
    expect(kinds.has('member:restart')).toBe(true) // failed member
    expect(kinds.has('message:redeliver')).toBe(true) // high-risk undelivered
  })

  it('sorts high priority commands first', () => {
    const commands = suggestCommands(riskView())
    expect(commands[0]?.priority).toBe('high')
    const high = commands.filter(command => command.priority === 'high')
    const medium = commands.filter(command => command.priority === 'medium')
    for (const command of high) {
      expect(command.kind).toMatch(/task:reassign|task:unblock|member:restart|message:redeliver/)
    }
    expect(medium.length).toBeGreaterThan(0)
  })

  it('carries concrete target ids for an executor', () => {
    const commands = suggestCommands(riskView())
    const unblock = commands.find(command => command.kind === 'task:unblock')
    expect(unblock?.targetId).toBe('task-blocked')
    const restart = commands.find(command => command.kind === 'member:restart')
    expect(restart?.targetId).toBe('worker-1')
    const redeliver = commands.find(command => command.kind === 'message:redeliver')
    expect(redeliver?.targetId).toBe('worker-1')
  })

  it('wraps suggestions into a stable host-consumable plan envelope', () => {
    const view = riskView()
    const plan = commandPlanView(view)
    const commands = suggestCommands(view)
    expect(plan.version).toBe(1)
    expect(plan.generatedFromTeamId).toBe('lead')
    expect(plan.total).toBe(commands.length)
    expect(plan.commands).toEqual(commands)
    expect(plan.highPriorityCount).toBe(commands.filter(command => command.priority === 'high').length)
    expect(plan.mediumPriorityCount).toBe(commands.filter(command => command.priority === 'medium').length)
    expect(plan.lowPriorityCount).toBe(commands.filter(command => command.priority === 'low').length)
    // JSON-serializable so a host tool layer can consume it directly.
    const parsed = JSON.parse(JSON.stringify(plan)) as typeof plan
    expect(parsed.total).toBe(plan.total)
    expect(parsed.commands[0]?.targetId).toBeDefined()
  })

  it('produces an empty plan when there is nothing actionable', () => {
    const view = riskView()
    // No failed members, no insights, no loads, no high-risk messages.
    const quiet = {
      ...view,
      members: [view.members[0]!],
      memberLoads: [],
      messageRisks: [],
      taskInsights: [],
    }
    const plan = commandPlanView(quiet)
    expect(plan.total).toBe(0)
    expect(plan.highPriorityCount).toBe(0)
    expect(plan.commands).toEqual([])
  })
})
