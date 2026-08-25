import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {
  AgentTeamMemberLoadView,
  AgentTeamMemberView,
  AgentTeamTaskInsightView,
  AgentTeamTaskView,
  AgentTeamView,
} from '../contract.js'
import { activityPanelView, qualifiesForActivityPanel } from './activity-panel-view.js'

const leadId = SessionId('lead')
const workerId = SessionId('worker')

function task(id: string, status: AgentTeamTaskView['status'], ownerId: AgentTeamTaskView['ownerId'] = workerId): AgentTeamTaskView {
  return {
    id: id as AgentTeamTaskView['id'],
    subject: `Task ${id}`,
    description: `${id} description`,
    status,
    ownerId,
    blockedBy: [],
    writeScopes: [],
    revision: 1,
  }
}

function insight(taskView: AgentTeamTaskView, interventionPriority: number): AgentTeamTaskInsightView {
  return {
    taskId: taskView.id,
    subject: taskView.subject,
    status: taskView.status,
    readiness: taskView.status === 'in_progress' ? 'stalled' : 'blocked',
    reasons: [`${taskView.id} requires attention`],
    severity: 'high',
    ownerId: taskView.ownerId,
    interventionPriority,
    dependencyDepth: 0,
  }
}

function teamView(options: {
  activeTasks?: AgentTeamTaskView[]
  blockedTasks?: AgentTeamTaskView[]
  taskInsights?: AgentTeamTaskInsightView[]
  topInterventions?: string[]
  memberLoads?: AgentTeamMemberLoadView[]
} = {}): AgentTeamView {
  const activeTasks = options.activeTasks ?? []
  const blockedTasks = options.blockedTasks ?? []
  const tasks = [...activeTasks, ...blockedTasks]
  const members: AgentTeamMemberView[] = [
    { id: leadId, name: 'lead', role: 'lead', phase: 'active', sessionId: leadId },
    { id: workerId, name: 'Worker', role: 'teammate', phase: 'active', sessionId: workerId },
  ]
  return {
    teamId: leadId,
    leadMemberId: leadId,
    members,
    tasks,
    messages: [],
    blockedTasks,
    activeTasks,
    pendingTasks: blockedTasks,
    completedTasks: [],
    stalledTasks: activeTasks,
    orphanedTasks: [],
    readyTasks: [],
    taskInsights: options.taskInsights ?? [],
    memberLoads: options.memberLoads ?? [{
      memberId: workerId,
      memberName: 'Worker',
      level: 'focused',
      activeTaskCount: activeTasks.length,
      pendingOwnedTaskCount: blockedTasks.length,
      stalledTaskCount: activeTasks.length,
      orphanedTaskCount: 0,
    }],
    messageRisks: [],
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
      generatedFromTeamId: leadId,
      total: 0,
      highPriorityCount: 0,
      mediumPriorityCount: 0,
      lowPriorityCount: 0,
      commands: [],
    },
    summary: {
      memberCount: 1,
      failedMemberCount: 0,
      taskCount: tasks.length,
      pendingTaskCount: blockedTasks.length,
      inProgressTaskCount: activeTasks.length,
      completedTaskCount: 0,
      blockedTaskCount: blockedTasks.length,
      stalledTaskCount: activeTasks.length,
      orphanedTaskCount: 0,
      readyTaskCount: 0,
      overloadedMemberCount: 0,
      messageCount: 0,
      undeliveredMessageCount: 0,
      wakeupMessageCount: 0,
      highRiskMessageCount: 0,
      healthScore: 100,
      statusLabel: '运行平稳',
      overview: 'Healthy team.',
      alerts: [],
      recommendedActions: [],
      captainBriefing: ['Current team is healthy.'],
      topInterventions: options.topInterventions ?? [],
    },
  }
}

describe('activity panel view selectors', () => {
  it('qualifies only active or blocked teams', () => {
    const completedOnly = teamView()
    const blocked = task('T-blocked', 'pending')
    const active = task('T-active', 'in_progress')

    expect(qualifiesForActivityPanel(null)).toBe(false)
    expect(qualifiesForActivityPanel(completedOnly)).toBe(false)
    expect(qualifiesForActivityPanel(teamView({ blockedTasks: [blocked] }))).toBe(true)
    expect(qualifiesForActivityPanel(teamView({ activeTasks: [active] }))).toBe(true)
  })

  it('keeps existing intervention order and caps it at three', () => {
    const rankedTasks = ['T-4', 'T-3', 'T-2', 'T-1'].map((id, index) => task(id, 'in_progress', index === 3 ? null : workerId))
    const teamWithFourRankedInsights = teamView({
      activeTasks: rankedTasks,
      taskInsights: rankedTasks.map((taskView, index) => insight(taskView, index + 1)),
      topInterventions: rankedTasks.map((taskView, index) => `P${index + 1} · ${taskView.subject}`),
    })

    const view = activityPanelView(teamWithFourRankedInsights)

    expect(view.priorities).toHaveLength(3)
    expect(view.priorities.map(item => item.taskId)).toEqual(['T-4', 'T-3', 'T-2'])
  })

  it('resolves member load and active-or-blocked task rows from projection fields', () => {
    const active = task('T-active', 'in_progress')
    const blocked = task('T-blocked', 'pending')
    const activeInsight = insight(active, 2)
    const blockedInsight = insight(blocked, 1)
    const view = activityPanelView(teamView({
      activeTasks: [active],
      blockedTasks: [blocked],
      taskInsights: [blockedInsight, activeInsight],
      topInterventions: ['P1 · Task T-blocked', 'P2 · Task T-active'],
    }))

    expect(view.overview).toMatchObject({ activeTaskCount: 1, blockedTaskCount: 1, memberCount: 1 })
    expect(view.members).toEqual([expect.objectContaining({ memberId: workerId, level: 'focused', activeTaskCount: 1 })])
    expect(view.tasks).toEqual([
      expect.objectContaining({ taskId: 'T-active', category: 'active', readiness: 'stalled' }),
      expect.objectContaining({ taskId: 'T-blocked', category: 'blocked', readiness: 'blocked' }),
    ])
  })

  it('returns healthy fallback state when no priority item exists', () => {
    const view = activityPanelView(teamView())

    expect(view.priorities).toEqual([])
    expect(view.fallback).toEqual({ state: 'healthy', message: 'Current team is healthy.' })
  })
})
