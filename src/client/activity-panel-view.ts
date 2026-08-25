import type {
  AgentTeamMemberLoadView,
  AgentTeamTaskInsightView,
  AgentTeamTaskView,
  AgentTeamView,
} from '../contract.js'

export interface ActivityPanelOverview {
  readonly memberCount: number
  readonly activeTaskCount: number
  readonly blockedTaskCount: number
  readonly healthScore: number
  readonly statusLabel: string
  readonly overview: string
}

export interface ActivityPanelPriorityRow {
  readonly taskId: string
  readonly subject: string
  readonly status: AgentTeamTaskInsightView['status']
  readonly readiness: AgentTeamTaskInsightView['readiness']
  readonly severity: AgentTeamTaskInsightView['severity']
  readonly reasons: readonly string[]
  readonly interventionPriority: number
  readonly dependencyDepth: number
}

export interface ActivityPanelMemberRow extends AgentTeamMemberLoadView {}

export interface ActivityPanelTaskRow {
  readonly taskId: string
  readonly subject: string
  readonly status: AgentTeamTaskView['status']
  readonly category: 'active' | 'blocked'
  readonly ownerId: AgentTeamTaskView['ownerId']
  readonly readiness: AgentTeamTaskInsightView['readiness'] | null
  readonly severity: AgentTeamTaskInsightView['severity'] | null
  readonly reasons: readonly string[]
}

export interface ActivityPanelFallback {
  readonly state: 'healthy'
  readonly message: string
}

export interface ActivityPanelView {
  readonly overview: ActivityPanelOverview
  readonly priorities: readonly ActivityPanelPriorityRow[]
  readonly members: readonly ActivityPanelMemberRow[]
  readonly tasks: readonly ActivityPanelTaskRow[]
  readonly fallback: ActivityPanelFallback | null
}

export function qualifiesForActivityPanel(team: AgentTeamView | null): boolean {
  return team !== null && (team.activeTasks.length > 0 || team.blockedTasks.length > 0)
}

function priorityRankOf(intervention: string): number | null {
  const match = /^P(\d+)\s*·/.exec(intervention)
  return match === null ? null : Number(match[1])
}

function priorityRows(team: AgentTeamView): ActivityPanelPriorityRow[] {
  const byPriority = new Map(team.taskInsights.map(insight => [insight.interventionPriority, insight]))
  const rankedInsights = team.summary.topInterventions.length > 0
    ? team.summary.topInterventions
      .map(priorityRankOf)
      .map(priority => priority === null ? undefined : byPriority.get(priority))
      .filter((insight): insight is AgentTeamTaskInsightView => insight !== undefined)
    : team.taskInsights.filter(insight =>
      insight.status !== 'completed' && insight.status !== 'failed' && insight.status !== 'cancelled',
    )

  return rankedInsights.slice(0, 3).map(insight => ({
    taskId: String(insight.taskId),
    subject: insight.subject,
    status: insight.status,
    readiness: insight.readiness,
    severity: insight.severity,
    reasons: insight.reasons,
    interventionPriority: insight.interventionPriority,
    dependencyDepth: insight.dependencyDepth,
  }))
}

function taskRows(team: AgentTeamView): ActivityPanelTaskRow[] {
  const insights = new Map(team.taskInsights.map(insight => [String(insight.taskId), insight]))
  const rowFor = (task: AgentTeamTaskView, category: ActivityPanelTaskRow['category']): ActivityPanelTaskRow => {
    const insight = insights.get(String(task.id))
    return {
      taskId: String(task.id),
      subject: task.subject,
      status: task.status,
      category,
      ownerId: task.ownerId,
      readiness: insight?.readiness ?? null,
      severity: insight?.severity ?? null,
      reasons: insight?.reasons ?? [],
    }
  }
  return [
    ...team.activeTasks.map(task => rowFor(task, 'active')),
    ...team.blockedTasks.map(task => rowFor(task, 'blocked')),
  ]
}

export function activityPanelView(team: AgentTeamView): ActivityPanelView {
  const priorities = priorityRows(team)
  return {
    overview: {
      memberCount: team.summary.memberCount,
      activeTaskCount: team.summary.inProgressTaskCount,
      blockedTaskCount: team.summary.blockedTaskCount,
      healthScore: team.summary.healthScore,
      statusLabel: team.summary.statusLabel,
      overview: team.summary.overview,
    },
    priorities,
    members: team.memberLoads,
    tasks: taskRows(team),
    fallback: priorities.length === 0
      ? { state: 'healthy', message: team.summary.captainBriefing[0] ?? '当前团队没有明显异常，可以继续保持既有节奏。' }
      : null,
  }
}
