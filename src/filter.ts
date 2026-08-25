import type {
  AgentTeamMemberLoadView,
  AgentTeamMemberView,
  AgentTeamMessageRiskView,
  AgentTeamMessageView,
  AgentTeamTaskInsightView,
  AgentTeamTaskView,
  AgentTeamView,
} from './contract.js'

export type AgentTeamTaskFilterKey =
  | 'all'
  | 'in_progress'
  | 'ready'
  | 'blocked'
  | 'stalled'
  | 'orphaned'
  | 'failed'
  | 'cancelled'
  | 'completed'

export type AgentTeamMemberFilterKey =
  | 'all'
  | 'overloaded'
  | 'stretched'
  | 'focused'
  | 'idle'

export type AgentTeamMessageFilterKey =
  | 'all'
  | 'undelivered'
  | 'high_risk'
  | 'wakeup'
  | 'quiet'
  | 'delivered'

export interface AgentTeamFilterState {
  readonly taskFilter: AgentTeamTaskFilterKey
  readonly taskQuery: string
  readonly memberFilter: AgentTeamMemberFilterKey
  readonly memberQuery: string
  readonly messageFilter: AgentTeamMessageFilterKey
}

export function defaultAgentTeamFilterState(): AgentTeamFilterState {
  return {
    taskFilter: 'all',
    taskQuery: '',
    memberFilter: 'all',
    memberQuery: '',
    messageFilter: 'all',
  }
}

export interface AgentTeamFilteredView {
  readonly tasks: AgentTeamTaskView[]
  readonly taskInsights: AgentTeamTaskInsightView[]
  readonly members: AgentTeamMemberView[]
  readonly memberLoads: AgentTeamMemberLoadView[]
  readonly messages: AgentTeamMessageView[]
  readonly messageRisks: AgentTeamMessageRiskView[]
  readonly displayedCount: number
}

export function filterAgentTeam(
  view: AgentTeamView,
  state: AgentTeamFilterState,
): AgentTeamFilteredView {
  const readinessByTaskId = new Map(view.taskInsights.map(insight => [insight.taskId, insight.readiness]))
  const riskByMessageId = new Map(view.messageRisks.map(risk => [risk.messageId, risk.riskLevel]))
  const loadByMemberId = new Map(view.memberLoads.map(load => [load.memberId, load.level]))

  const taskQuery = state.taskQuery.trim().toLowerCase()
  const memberQuery = state.memberQuery.trim().toLowerCase()

  const tasks = view.tasks.filter((task) => {
    if (taskQuery !== '' && !task.subject.toLowerCase().includes(taskQuery)) return false
    const readiness = readinessByTaskId.get(task.id)
    switch (state.taskFilter) {
      case 'all':
        return true
      case 'in_progress':
        return task.status === 'in_progress'
      case 'completed':
        return task.status === 'completed'
      case 'ready':
        return readiness === 'ready' && task.status === 'pending'
      case 'blocked':
        return readiness === 'blocked'
      case 'stalled':
        return readiness === 'stalled'
      case 'orphaned':
        return readiness === 'orphaned'
      case 'failed':
        return readiness === 'failed'
      case 'cancelled':
        return readiness === 'cancelled'
    }
  })
  const taskIds = new Set(tasks.map(task => task.id))
  const taskInsights = view.taskInsights.filter(insight => taskIds.has(insight.taskId))

  const members = view.members.filter((member) => {
    if (memberQuery !== '' && !member.name.toLowerCase().includes(memberQuery)) return false
    if (state.memberFilter === 'all') return true
    if (member.role === 'lead') return false
    return loadByMemberId.get(member.id) === state.memberFilter
  })
  const memberIds = new Set(members.map(member => member.id))
  const memberLoads = view.memberLoads.filter((load) => {
    if (!memberIds.has(load.memberId)) return false
    if (memberQuery !== '' && !load.memberName.toLowerCase().includes(memberQuery)) return false
    if (state.memberFilter === 'all') return true
    return load.level === state.memberFilter
  })

  const messages = view.messages.filter((message) => {
    const risk = riskByMessageId.get(message.id)
    switch (state.messageFilter) {
      case 'all':
        return true
      case 'undelivered':
        return !message.delivered
      case 'delivered':
        return message.delivered
      case 'wakeup':
        return message.delivery === 'wakeup'
      case 'quiet':
        return message.delivery === 'quiet'
      case 'high_risk':
        return risk === 'high'
    }
  })
  const messageIds = new Set(messages.map(message => message.id))
  const messageRisks = view.messageRisks.filter(risk => messageIds.has(risk.messageId))

  return {
    tasks,
    taskInsights,
    members,
    memberLoads,
    messages,
    messageRisks,
    displayedCount: tasks.length + members.length + messages.length,
  }
}
