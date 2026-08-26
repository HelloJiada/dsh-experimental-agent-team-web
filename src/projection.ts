import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionId as brandSessionId } from '@deepseek-ai/dsh-session'
import type {
  TeamMemberSnapshot,
  TeamMessageSnapshot,
  TeamTaskSnapshot,
} from './agent-team-types.js'
import type {
  AgentTeamMemberLoadView,
  AgentTeamMemberView,
  AgentTeamMessageRiskView,
  AgentTeamMessageView,
  AgentTeamQuickFiltersView,
  AgentTeamSummaryView,
  AgentTeamTaskInsightView,
  AgentTeamTaskView,
  AgentTeamTimelineEntryView,
  AgentTeamTimelineSummaryView,
  AgentTeamView,
} from './contract.js'
import {
  applyUpstreamEvent,
  isUpstreamTeamEventType,
  upstreamHistoryEntryOf,
} from './upstream.js'
import { timelineMilestonesView } from './timeline-milestones.js'
export { timelineMilestonesView } from './timeline-milestones.js'
import { commandPlanView } from './commands.js'
import { AGENT_TEAM_COMMAND_KINDS } from './commands.js'
export { commandPlanView } from './commands.js'
import { dependencyDagView } from './dependency-dag.js'
export { dependencyDagView } from './dependency-dag.js'

/** One committed Team event, retained as a bounded timeline history entry. */
export interface AgentTeamHistoryEntry {
  readonly id: string
  readonly seq: number
  readonly time: number
  readonly kind: 'member' | 'task' | 'message'
  readonly type: string
  readonly title: string
  readonly detail: string
  readonly tone: 'neutral' | 'good' | 'warn' | 'danger'
  /** Stable entity key (member/task/message id) used for coalescing. */
  readonly entityKey?: string
  /** Number of committed events coalesced into this entry. */
  readonly count?: number
}

export interface AgentTeamProjectionState {
  readonly teamId: SessionId | null
  readonly captainSessionId?: SessionId | null
  readonly hasTeamEvents: boolean
  readonly members: Record<string, TeamMemberSnapshot>
  readonly tasks: Record<string, TeamTaskSnapshot>
  readonly messages: Record<string, TeamMessageSnapshot>
  readonly delivered: Record<string, true>
  readonly history: AgentTeamHistoryEntry[]
}

const memberStateSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  provider: z.string(),
  context: z.enum(['fresh', 'fork']),
  phase: z.enum(['provisioning', 'active', 'failed']),
  error: z.string().optional(),
}).strict()

const taskStateSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().positive(),
  subject: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'deleted']),
  ownerId: z.string().min(1).optional(),
  blockedBy: z.array(z.string().min(1)),
  writeScopes: z.array(z.string()),
}).strict()

const contentBlockSchema = z.object({ type: z.string().min(1) }).passthrough()

const historyEntrySchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  time: z.number().int().nonnegative(),
  kind: z.enum(['member', 'task', 'message']),
  type: z.string().min(1),
  title: z.string(),
  detail: z.string(),
  tone: z.enum(['neutral', 'good', 'warn', 'danger']),
  entityKey: z.string().optional(),
  count: z.number().int().positive().optional(),
}).strict()

const messageStateSchema = z.object({
  id: z.string().min(1),
  senderId: z.string().min(1),
  senderName: z.string(),
  targetId: z.string().min(1),
  delivery: z.enum(['quiet', 'wakeup']),
  content: z.array(contentBlockSchema),
}).strict()

const stateSchema = z.object({
  teamId: z.string().min(1).nullable(),
  captainSessionId: z.string().min(1).nullable().optional(),
  hasTeamEvents: z.boolean(),
  members: z.record(z.string(), memberStateSchema),
  tasks: z.record(z.string(), taskStateSchema),
  messages: z.record(z.string(), messageStateSchema),
  delivered: z.record(z.string(), z.literal(true)),
  history: z.array(historyEntrySchema).optional(),
}).strict() as unknown as z.ZodType<AgentTeamProjectionState>

export function initAgentTeamProjection(): AgentTeamProjectionState {
  return {
    teamId: null,
    captainSessionId: null,
    hasTeamEvents: false,
    members: {},
    tasks: {},
    messages: {},
    delivered: {},
    history: [],
  }
}

function isTeamEventType(type: string): boolean {
  return isUpstreamTeamEventType(type)
    || type === 'team/member'
    || type === 'team/task'
    || type === 'team/message/queued'
    || type === 'team/message/delivered'
}

function teamIdOf(state: AgentTeamProjectionState, event: SessionEvent): SessionId | null {
  const data = event.data as { readonly teamId?: string }
  if (data.teamId !== undefined) return brandSessionId(data.teamId)
  return state.teamId
}

function sameTeamOrUnset(state: AgentTeamProjectionState, teamId: SessionId): boolean {
  return state.teamId === null || state.teamId === teamId
}

const HISTORY_LIMIT = 100

function historyEntryOf(event: SessionEvent): AgentTeamHistoryEntry | null {
  if (isUpstreamTeamEventType(event.type)) return upstreamHistoryEntryOf(event)
  const seq = event.seq
  const time = typeof event.time === 'number' ? event.time : 0
  switch (event.type) {
    case 'team/member': {
      const member = (event.data as { readonly member: TeamMemberSnapshot }).member
      const tone: AgentTeamHistoryEntry['tone'] =
        member.phase === 'failed' ? 'danger'
          : member.phase === 'provisioning' ? 'warn'
            : 'good'
      return {
        id: `team/member:${seq}`,
        seq,
        time,
        kind: 'member',
        type: event.type,
        title: `成员 ${member.name}`,
        detail: `phase ${member.phase}`,
        tone,
        entityKey: `member:${String(member.id)}`,
        count: 1,
      }
    }
    case 'team/task': {
      const task = (event.data as { readonly task: TeamTaskSnapshot }).task
      const tone: AgentTeamHistoryEntry['tone'] =
        task.status === 'completed' ? 'good'
          : task.status === 'in_progress' ? 'warn'
            : task.blockedBy.length > 0 ? 'danger'
              : 'neutral'
      return {
        id: `team/task:${seq}`,
        seq,
        time,
        kind: 'task',
        type: event.type,
        title: `任务 ${task.subject}`,
        detail: `status ${task.status} · rev ${task.revision}`,
        tone,
        entityKey: `task:${String(task.id)}`,
        count: 1,
      }
    }
    case 'team/message/queued': {
      const message = (event.data as { readonly message: TeamMessageSnapshot }).message
      return {
        id: `team/message/queued:${seq}`,
        seq,
        time,
        kind: 'message',
        type: event.type,
        title: `消息 ${message.senderName} → ${message.targetId}`,
        detail: `已入队（${message.delivery}）`,
        tone: message.delivery === 'wakeup' ? 'warn' : 'neutral',
        entityKey: `message:${String(message.id)}`,
        count: 1,
      }
    }
    case 'team/message/delivered': {
      const data = event.data as { readonly messageId: string; readonly targetId: string }
      return {
        id: `team/message/delivered:${seq}`,
        seq,
        time,
        kind: 'message',
        type: event.type,
        title: `消息 ${data.messageId}`,
        detail: `已送达（target ${data.targetId}）`,
        tone: 'good',
        entityKey: `message:${String(data.messageId)}`,
        count: 1,
      }
    }
    default:
      return null
  }
}

/**
 * Appends a history entry, coalescing with the most recent entry for the same
 * entity (member/task/message id) so repeated events for one entity collapse
 * into a single timeline row carrying a running count. The retained window is
 * bounded by HISTORY_LIMIT (oldest distinct entities are dropped first).
 */
function appendHistory(state: AgentTeamProjectionState, event: SessionEvent): AgentTeamProjectionState {
  const entry = historyEntryOf(event)
  if (entry === null) return state
  const history = [...state.history]
  const entityKey = entry.entityKey ?? entry.id

  let mergeIndex = -1
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const existing = history[index]
    if ((existing.entityKey ?? existing.id) === entityKey) {
      mergeIndex = index
      break
    }
  }

  if (mergeIndex >= 0) {
    const previous = history[mergeIndex]!
    history[mergeIndex] = {
      ...entry,
      count: (previous.count ?? 1) + 1,
    }
  } else {
    history.push(entry)
  }

  return { ...state, history: history.slice(-HISTORY_LIMIT) }
}

export function applyAgentTeamEvent(
  state: AgentTeamProjectionState,
  event: SessionEvent,
): AgentTeamProjectionState {
  if (!isTeamEventType(event.type)) return state
  const teamId = teamIdOf(state, event)
  if (teamId === null || !sameTeamOrUnset(state, teamId)) return state

  if (isUpstreamTeamEventType(event.type)) {
    const next = applyUpstreamEvent(state, event)
    return next === null ? state : appendHistory(next, event)
  }

  switch (event.type) {
    case 'team/member': {
      const member = (event.data as { readonly member: TeamMemberSnapshot }).member
      return appendHistory({
        ...state,
        teamId,
        hasTeamEvents: true,
        members: { ...state.members, [member.id]: member },
      }, event)
    }
    case 'team/task': {
      const task = (event.data as { readonly task: TeamTaskSnapshot }).task
      return appendHistory({
        ...state,
        teamId,
        hasTeamEvents: true,
        tasks: { ...state.tasks, [task.id]: task },
      }, event)
    }
    case 'team/message/queued': {
      const message = (event.data as { readonly message: TeamMessageSnapshot }).message
      return appendHistory({
        ...state,
        teamId,
        hasTeamEvents: true,
        messages: { ...state.messages, [message.id]: message },
      }, event)
    }
    case 'team/message/delivered': {
      const messageId = String((event.data as { readonly messageId: string }).messageId)
      return appendHistory({
        ...state,
        teamId,
        hasTeamEvents: true,
        delivered: { ...state.delivered, [messageId]: true },
      }, event)
    }
    default:
      return state
  }
}

function memberComparator(left: AgentTeamMemberView, right: AgentTeamMemberView): number {
  if (left.role !== right.role) return left.role === 'lead' ? -1 : 1
  return left.name.localeCompare(right.name)
}

function taskRank(status: AgentTeamTaskView['status']): number {
  switch (status) {
    case 'in_progress':
      return 0
    case 'pending':
      return 1
    case 'completed':
      return 2
    case 'failed':
      return 3
    case 'cancelled':
      return 4
  }
}

function memberView(member: TeamMemberSnapshot): AgentTeamMemberView {
  return {
    id: member.id,
    name: member.name,
    role: 'teammate',
    phase: member.phase,
    sessionId: member.id,
  }
}

function taskView(task: TeamTaskSnapshot): AgentTeamTaskView {
  if (task.status === 'deleted') throw new Error('deleted tasks must be filtered before view conversion')
  return {
    id: task.id,
    subject: task.subject,
    description: task.description,
    status: task.status,
    ownerId: task.ownerId ?? null,
    blockedBy: [...task.blockedBy],
    writeScopes: [...task.writeScopes],
    revision: task.revision,
  }
}

function messageView(message: TeamMessageSnapshot, deliveredIds: ReadonlySet<string>): AgentTeamMessageView {
  return {
    id: message.id,
    senderId: message.senderId,
    senderName: message.senderName,
    targetId: message.targetId,
    delivery: message.delivery,
    content: [...message.content],
    delivered: deliveredIds.has(message.id),
  }
}

/** Count of tasks that transitively depend on the given task (risk propagation fan-out). */
export function dependencyDepthOf(
  taskId: string,
  tasks: readonly AgentTeamTaskView[],
): number {
  const dependents = new Map<string, string[]>()
  for (const task of tasks) {
    for (const dep of task.blockedBy) {
      const list = dependents.get(dep) ?? []
      list.push(task.id)
      dependents.set(dep, list)
    }
  }
  const seen = new Set<string>()
  const stack = [...(dependents.get(taskId) ?? [])]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined || seen.has(current)) continue
    seen.add(current)
    for (const downstream of dependents.get(current) ?? []) stack.push(downstream)
  }
  return seen.size
}

export function taskInsightView(
  task: AgentTeamTaskView,
  memberIds: ReadonlySet<string>,
  dependencyDepth: number,
): AgentTeamTaskInsightView {
  const reasons: string[] = []
  let readiness: AgentTeamTaskInsightView['readiness'] = 'ready'
  let severity: AgentTeamTaskInsightView['severity'] = 'low'

  if (task.status === 'completed') {
    reasons.push('任务已完成。')
    return {
      taskId: task.id,
      subject: task.subject,
      status: task.status,
      readiness,
      reasons,
      severity,
      ownerId: task.ownerId,
      dependencyDepth,
      interventionPriority: 0,
    }
  }

  if (task.status === 'failed') {
    reasons.push('任务已失败（terminal）。')
    return {
      taskId: task.id,
      subject: task.subject,
      status: task.status,
      readiness: 'failed',
      reasons,
      severity: 'low',
      ownerId: task.ownerId,
      dependencyDepth,
      interventionPriority: 0,
    }
  }

  if (task.status === 'cancelled') {
    reasons.push('任务已取消（terminal）。')
    return {
      taskId: task.id,
      subject: task.subject,
      status: task.status,
      readiness: 'cancelled',
      reasons,
      severity: 'low',
      ownerId: task.ownerId,
      dependencyDepth,
      interventionPriority: 0,
    }
  }

  if (task.status === 'pending' && task.blockedBy.length > 0) {
    readiness = 'blocked'
    severity = 'high'
    reasons.push(`依赖未完成：${task.blockedBy.join(', ')}。`)
  }

  if (task.ownerId !== null && !memberIds.has(task.ownerId)) {
    readiness = 'orphaned'
    severity = 'high'
    reasons.push('任务 owner 在当前成员快照中不存在。')
  }

  if (task.status === 'in_progress' && task.ownerId === null) {
    readiness = 'stalled'
    severity = 'high'
    reasons.push('任务处于进行中，但没有声明 owner。')
  }

  if (task.status === 'in_progress' && task.ownerId !== null && memberIds.has(task.ownerId)) {
    readiness = 'stalled'
    severity = 'medium'
    reasons.push('任务处于进行中，但还没有证据表明它已经完成或解除占用。')
  }

  if (task.status === 'pending' && task.blockedBy.length === 0 && task.ownerId === null) {
    readiness = 'ready'
    severity = 'medium'
    reasons.push('任务已 ready，但尚未声明 owner。')
  }

  if (task.status === 'pending' && task.blockedBy.length === 0 && task.ownerId !== null && memberIds.has(task.ownerId)) {
    readiness = 'stalled'
    severity = 'medium'
    reasons.push('任务已具备执行条件，但仍停留在 pending。')
  }

  if (dependencyDepth > 0) {
    reasons.push(`当前有 ${dependencyDepth} 个下游任务依赖它，解除它可释放整条链路。`)
  }

  if (reasons.length === 0) {
    reasons.push('当前没有明显异常。')
  }

  return {
    taskId: task.id,
    subject: task.subject,
    status: task.status,
    readiness,
    reasons,
    severity,
    ownerId: task.ownerId,
    dependencyDepth,
    interventionPriority: 0,
  }
}

function severityRank(severity: AgentTeamTaskInsightView['severity']): number {
  switch (severity) {
    case 'high':
      return 0
    case 'medium':
      return 1
    case 'low':
      return 2
  }
}

function interventionScore(insight: AgentTeamTaskInsightView): number {
  const severityWeight: Record<AgentTeamTaskInsightView['severity'], number> = {
    high: 100,
    medium: 40,
    low: 0,
  }
  const readinessWeight: Record<AgentTeamTaskInsightView['readiness'], number> = {
    blocked: 30,
    orphaned: 30,
    stalled: 25,
    ready: 10,
    failed: 0,
    cancelled: 0,
  }
  // Leverage-first ranking: unblocking a chain head releases the most downstream work.
  const depthBonus = Math.min(insight.dependencyDepth * 100, 500)
  return depthBonus + severityWeight[insight.severity] + readinessWeight[insight.readiness]
}

function memberLoadViews(
  members: readonly AgentTeamMemberView[],
  tasks: readonly AgentTeamTaskView[],
  insights: readonly AgentTeamTaskInsightView[],
): AgentTeamMemberLoadView[] {
  const teammateMembers = members.filter(member => member.role === 'teammate')
  return teammateMembers.map((member) => {
    const ownedTasks = tasks.filter(task => task.ownerId === member.id)
    const activeTaskCount = ownedTasks.filter(task => task.status === 'in_progress').length
    const pendingOwnedTaskCount = ownedTasks.filter(task => task.status === 'pending').length
    const stalledTaskCount = insights.filter(insight => insight.ownerId === member.id && insight.readiness === 'stalled').length
    const orphanedTaskCount = insights.filter(insight => insight.ownerId === member.id && insight.readiness === 'orphaned').length

    let level: AgentTeamMemberLoadView['level'] = 'idle'
    if (activeTaskCount >= 3 || ownedTasks.length >= 4) level = 'overloaded'
    else if (activeTaskCount >= 2 || ownedTasks.length >= 3 || stalledTaskCount > 0) level = 'stretched'
    else if (ownedTasks.length > 0) level = 'focused'

    return {
      memberId: member.id,
      memberName: member.name,
      level,
      activeTaskCount,
      pendingOwnedTaskCount,
      stalledTaskCount,
      orphanedTaskCount,
    }
  }).sort((left, right) => {
    const rank = { overloaded: 0, stretched: 1, focused: 2, idle: 3 }
    return rank[left.level] - rank[right.level] || left.memberName.localeCompare(right.memberName)
  })
}

export function messageRiskView(
  message: AgentTeamMessageView,
  failedTargets: ReadonlySet<string>,
): AgentTeamMessageRiskView {
  const reasons: string[] = []
  let riskLevel: AgentTeamMessageRiskView['riskLevel'] = 'low'

  if (!message.delivered) {
    if (message.delivery === 'wakeup') {
      riskLevel = 'high'
      reasons.push('wakeup 消息尚未送达，目标可能无法被及时唤醒。')
    } else {
      // Quiet delivery is best-effort: the message is durably recorded and
      // read lazily, so an undelivered quiet message is not an urgent risk.
      reasons.push('quiet 消息已记录到邮箱，等待目标读取。')
    }
  }

  if (failedTargets.has(String(message.targetId))) {
    riskLevel = 'high'
    reasons.push('目标成员处于 failed 状态，消息可能无法被处理。')
  }

  if (reasons.length === 0) {
    reasons.push('消息已送达，风险较低。')
  }

  return {
    messageId: message.id,
    senderName: message.senderName,
    targetId: message.targetId,
    delivery: message.delivery,
    delivered: message.delivered,
    riskLevel,
    reasons,
  }
}

function riskRank(riskLevel: AgentTeamMessageRiskView['riskLevel']): number {
  switch (riskLevel) {
    case 'high':
      return 0
    case 'medium':
      return 1
    case 'low':
      return 2
  }
}

export function quickFiltersView(
  tasks: readonly AgentTeamTaskView[],
  insights: readonly AgentTeamTaskInsightView[],
  memberLoads: readonly AgentTeamMemberLoadView[],
  messages: readonly AgentTeamMessageView[],
  messageRisks: readonly AgentTeamMessageRiskView[],
): AgentTeamQuickFiltersView {
  const blockedCount = insights.filter(insight => insight.readiness === 'blocked').length
  const stalledCount = insights.filter(insight => insight.readiness === 'stalled').length
  const orphanedCount = insights.filter(insight => insight.readiness === 'orphaned').length
  const readyCount = insights.filter(insight => insight.readiness === 'ready' && insight.status === 'pending').length
  const inProgressCount = tasks.filter(task => task.status === 'in_progress').length
  const completedCount = tasks.filter(task => task.status === 'completed').length

  const levelCounts: Record<AgentTeamMemberLoadView['level'], number> = {
    idle: 0,
    focused: 0,
    stretched: 0,
    overloaded: 0,
  }
  for (const load of memberLoads) levelCounts[load.level] += 1

  const highRiskMessageCount = messageRisks.filter(risk => risk.riskLevel === 'high').length
  const undeliveredCount = messages.filter(message => !message.delivered).length
  const wakeupCount = messages.filter(message => message.delivery === 'wakeup').length
  const quietCount = messages.filter(message => message.delivery === 'quiet').length
  const deliveredCount = messages.filter(message => message.delivered).length
  const failedTaskCount = insights.filter(insight => insight.readiness === 'failed').length
  const cancelledTaskCount = insights.filter(insight => insight.readiness === 'cancelled').length

  return {
    taskFilters: [
      { key: 'all', label: '全部任务', count: tasks.length },
      { key: 'in_progress', label: '进行中', count: inProgressCount },
      { key: 'ready', label: 'Ready', count: readyCount },
      { key: 'blocked', label: 'Blocked', count: blockedCount },
      { key: 'stalled', label: 'Stalled', count: stalledCount },
      { key: 'orphaned', label: 'Orphaned', count: orphanedCount },
      { key: 'failed', label: 'Failed', count: failedTaskCount },
      { key: 'cancelled', label: 'Cancelled', count: cancelledTaskCount },
      { key: 'completed', label: '已完成', count: completedCount },
    ],
    memberFilters: [
      { key: 'all', label: '全部成员', count: memberLoads.length },
      { key: 'overloaded', label: 'Overloaded', count: levelCounts.overloaded },
      { key: 'stretched', label: 'Stretched', count: levelCounts.stretched },
      { key: 'focused', label: 'Focused', count: levelCounts.focused },
      { key: 'idle', label: 'Idle', count: levelCounts.idle },
    ],
    messageFilters: [
      { key: 'all', label: '全部消息', count: messages.length },
      { key: 'undelivered', label: '待送达', count: undeliveredCount },
      { key: 'high_risk', label: '高风险', count: highRiskMessageCount },
      { key: 'wakeup', label: 'Wakeup', count: wakeupCount },
      { key: 'quiet', label: 'Quiet', count: quietCount },
      { key: 'delivered', label: '已送达', count: deliveredCount },
    ],
  }
}

export function timelineView(
  members: readonly AgentTeamMemberView[],
  tasks: readonly AgentTeamTaskView[],
  messages: readonly AgentTeamMessageView[],
  history: readonly AgentTeamHistoryEntry[] = [],
): AgentTeamTimelineEntryView[] {
  if (history.length > 0) {
    return [...history]
      .sort((left, right) => left.seq - right.seq)
      .map(entry => ({
        id: entry.id,
        kind: entry.kind,
        title: entry.title,
        detail: entry.detail,
        tone: entry.tone,
        time: entry.time,
        seq: entry.seq,
        count: entry.count,
      }))
  }

  const entries: AgentTeamTimelineEntryView[] = []

  for (const member of members) {
    if (member.role === 'lead') continue
    const tone: AgentTeamTimelineEntryView['tone'] =
      member.phase === 'failed' ? 'danger'
        : member.phase === 'provisioning' ? 'warn'
          : 'good'
    entries.push({
      id: `member:${member.id}`,
      kind: 'member',
      title: `成员 ${member.name}`,
      detail: `phase ${member.phase}`,
      tone,
    })
  }

  for (const task of tasks) {
    const tone: AgentTeamTimelineEntryView['tone'] =
      task.status === 'completed' ? 'good'
        : task.status === 'in_progress' ? 'warn'
          : task.blockedBy.length > 0 ? 'danger'
            : 'neutral'
    entries.push({
      id: `task:${task.id}`,
      kind: 'task',
      title: `任务 ${task.subject}`,
      detail: `status ${task.status}`,
      tone,
    })
  }

  for (const message of messages) {
    entries.push({
      id: `message:${message.id}`,
      kind: 'message',
      title: `消息 ${message.senderName} → ${message.targetId}`,
      detail: message.delivered ? '已送达' : '待送达',
      tone: message.delivered ? 'good' : 'danger',
    })
  }

  const kindRank: Record<AgentTeamTimelineEntryView['kind'], number> = {
    task: 0,
    member: 1,
    message: 2,
  }
  return entries.sort((left, right) => kindRank[left.kind] - kindRank[right.kind] || left.id.localeCompare(right.id))
}

export function timelineSummaryView(timeline: readonly AgentTeamTimelineEntryView[]): AgentTeamTimelineSummaryView {
  if (timeline.length === 0) {
    return {
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
    }
  }

  const memberEvents = timeline.filter(entry => entry.kind === 'member').length
  const taskEvents = timeline.filter(entry => entry.kind === 'task').length
  const messageEvents = timeline.filter(entry => entry.kind === 'message').length
  const totalEvents = timeline.reduce((sum, entry) => sum + (entry.count ?? 1), 0)
  const coalescedEntries = timeline.filter(entry => (entry.count ?? 1) > 1).length
  const withSeq = timeline.filter((entry): entry is AgentTeamTimelineEntryView & { seq: number } => entry.seq !== undefined)
  const withTime = timeline.filter((entry): entry is AgentTeamTimelineEntryView & { time: number } => entry.time !== undefined)
  const latest = timeline[timeline.length - 1] ?? null

  return {
    totalEvents,
    memberEvents,
    taskEvents,
    messageEvents,
    coalescedEntries,
    firstSeq: withSeq[0]?.seq ?? null,
    lastSeq: withSeq[withSeq.length - 1]?.seq ?? null,
    firstTime: withTime[0]?.time ?? null,
    lastTime: withTime[withTime.length - 1]?.time ?? null,
    latestTitle: latest?.title ?? null,
  }
}

function summaryView(
  members: readonly AgentTeamMemberView[],
  tasks: readonly AgentTeamTaskView[],
  messages: readonly AgentTeamMessageView[],
  insights: readonly AgentTeamTaskInsightView[],
  memberLoads: readonly AgentTeamMemberLoadView[],
  messageRisks: readonly AgentTeamMessageRiskView[],
): AgentTeamSummaryView {
  const teammateMembers = members.filter(member => member.role !== 'lead')
  const failedMembers = teammateMembers.filter(member => member.phase === 'failed')
  const pendingTasks = tasks.filter(task => task.status === 'pending')
  const inProgressTasks = tasks.filter(task => task.status === 'in_progress')
  const completedTasks = tasks.filter(task => task.status === 'completed')
  const blockedTasks = insights.filter(task => task.readiness === 'blocked')
  const stalledTasks = insights.filter(task => task.readiness === 'stalled')
  const orphanedTasks = insights.filter(task => task.readiness === 'orphaned')
  const readyTasks = insights.filter(task => task.readiness === 'ready' && task.status === 'pending')
  const undeliveredMessages = messages.filter(message => !message.delivered)
  const wakeupMessages = messages.filter(message => message.delivery === 'wakeup')
  const overloadedMembers = memberLoads.filter(load => load.level === 'overloaded')
  const stretchedMembers = memberLoads.filter(load => load.level === 'stretched')
  const highRiskMessages = messageRisks.filter(risk => risk.riskLevel === 'high')
  const actionableInsights = insights
    .filter(insight => insight.status !== 'completed' && insight.status !== 'failed' && insight.status !== 'cancelled')
    .sort((left, right) => left.interventionPriority - right.interventionPriority)
  const topInterventions = actionableInsights.slice(0, 5).map((insight) => {
    const rankLabel = insight.interventionPriority > 0 ? `P${insight.interventionPriority}` : 'P-'
    return `${rankLabel} · ${insight.subject}（${insight.readiness}，依赖 ${insight.dependencyDepth} 下游）`
  })
  const alerts: string[] = []
  const recommendedActions: string[] = []
  const captainBriefing: string[] = []

  let healthScore = 100
  if (failedMembers.length > 0) {
    healthScore -= Math.min(45, failedMembers.length * 25)
    alerts.push(`${failedMembers.length} 个成员处于 failed 状态，团队执行面存在明显风险。`)
    recommendedActions.push('优先检查 failed 成员对应的任务归属，并决定重试、替换还是由 Captain 接管。')
    captainBriefing.push(`失败成员 ${failedMembers.map(member => member.name).join('、')} 需要优先处置。`)
  }
  if (blockedTasks.length > 0) {
    healthScore -= Math.min(20, blockedTasks.length * 8)
    alerts.push(`${blockedTasks.length} 个任务被依赖阻塞，吞吐正在下降。`)
    recommendedActions.push('优先解除阻塞链最前面的依赖任务，避免更多待处理任务继续堆积。')
    captainBriefing.push(`当前有 ${blockedTasks.length} 个阻塞任务，需要检查依赖链。`)
  }
  if (stalledTasks.length > 0) {
    healthScore -= Math.min(20, stalledTasks.length * 8)
    alerts.push(`${stalledTasks.length} 个任务出现 stalled 信号，说明 ready work 未有效推进。`)
    recommendedActions.push('重新确认 stalled 任务的 owner 和状态是否一致，必要时重新派单或催办。')
    captainBriefing.push(`存在 ${stalledTasks.length} 个 stalled 任务，建议立即核查执行责任。`)
  }
  if (orphanedTasks.length > 0) {
    healthScore -= Math.min(25, orphanedTasks.length * 10)
    alerts.push(`${orphanedTasks.length} 个任务处于 orphaned 状态，owner 关联已失效。`)
    recommendedActions.push('尽快为 orphaned 任务重新绑定可见成员，避免任务长时间悬空。')
    captainBriefing.push(`有 ${orphanedTasks.length} 个 orphaned 任务，需尽快重新归属。`)
  }
  if (undeliveredMessages.length > 0) {
    healthScore -= Math.min(15, undeliveredMessages.length * 5)
    alerts.push(`${undeliveredMessages.length} 条消息仍未送达，团队协作上下文可能不一致。`)
    recommendedActions.push('检查未送达消息的目标成员是否仍可用，并评估是否需要重发或改由 Captain 广播。')
  }
  if (highRiskMessages.length > 0) {
    healthScore -= Math.min(10, highRiskMessages.length * 4)
    captainBriefing.push(`有 ${highRiskMessages.length} 条高风险消息需要优先处理。`)
  }
  if (overloadedMembers.length > 0) {
    healthScore -= Math.min(15, overloadedMembers.length * 7)
    alerts.push(`${overloadedMembers.length} 名成员负载过高，团队存在局部过载。`)
    recommendedActions.push('把过载成员的一部分 ready work 转移给空闲或负载更低的成员。')
  }
  if (inProgressTasks.length > 0 && teammateMembers.length === 0) {
    healthScore -= 10
    alerts.push('存在进行中任务，但没有可见 teammate 成员记录。')
    recommendedActions.push('确认当前 Team 是否只由 Captain 执行，或是否缺失成员生命周期事件。')
  }
  if (pendingTasks.length > 0 && inProgressTasks.length === 0) {
    healthScore -= 8
    alerts.push('存在待处理任务，但当前没有任何任务处于进行中。')
    recommendedActions.push('为 ready 任务分配 owner，或确认调度器是否没有唤醒可执行成员。')
  }
  if (readyTasks.length > 0) {
    captainBriefing.push(`当前有 ${readyTasks.length} 个 ready 任务可以尽快推进。`)
  }
  if (stretchedMembers.length > 0) {
    captainBriefing.push(`成员 ${stretchedMembers.map(member => member.memberName).join('、')} 已接近负载上限。`)
  }
  if (topInterventions.length > 0) {
    captainBriefing.push(`建议优先干预：${topInterventions[0] ?? ''}`)
  }
  if (recommendedActions.length === 0) {
    recommendedActions.push('继续保持当前节奏，重点关注新阻塞和新失败事件。')
  }
  if (captainBriefing.length === 0) {
    captainBriefing.push('当前团队没有明显异常，可以继续保持既有节奏。')
  }

  if (healthScore < 0) healthScore = 0

  let statusLabel = '运行平稳'
  if (healthScore < 50) statusLabel = '需要立即干预'
  else if (healthScore < 80) statusLabel = '存在风险'

  const overviewParts = [
    `共有 ${teammateMembers.length} 名 teammate`,
    `${tasks.length} 个任务（${inProgressTasks.length} 进行中 / ${pendingTasks.length} 待处理 / ${completedTasks.length} 已完成）`,
    `${messages.length} 条团队消息`,
  ]
  if (failedMembers.length > 0) overviewParts.push(`${failedMembers.length} 名成员失败`)
  if (blockedTasks.length > 0) overviewParts.push(`${blockedTasks.length} 个任务阻塞`)
  if (stalledTasks.length > 0) overviewParts.push(`${stalledTasks.length} 个任务 stalled`)
  if (orphanedTasks.length > 0) overviewParts.push(`${orphanedTasks.length} 个任务 orphaned`)
  if (undeliveredMessages.length > 0) overviewParts.push(`${undeliveredMessages.length} 条消息待送达`)

  return {
    memberCount: teammateMembers.length,
    failedMemberCount: failedMembers.length,
    taskCount: tasks.length,
    pendingTaskCount: pendingTasks.length,
    inProgressTaskCount: inProgressTasks.length,
    completedTaskCount: completedTasks.length,
    blockedTaskCount: blockedTasks.length,
    stalledTaskCount: stalledTasks.length,
    orphanedTaskCount: orphanedTasks.length,
    readyTaskCount: readyTasks.length,
    overloadedMemberCount: overloadedMembers.length,
    messageCount: messages.length,
    undeliveredMessageCount: undeliveredMessages.length,
    wakeupMessageCount: wakeupMessages.length,
    highRiskMessageCount: highRiskMessages.length,
    healthScore,
    statusLabel,
    overview: overviewParts.join('，') + '。',
    alerts,
    recommendedActions,
    captainBriefing,
    topInterventions,
  }
}

export function viewAgentTeam(state: AgentTeamProjectionState): AgentTeamView | null {
  if (!state.hasTeamEvents || state.teamId === null) return null
  const deliveredIds = new Set(Object.keys(state.delivered))
  const lead: AgentTeamMemberView = {
    id: state.teamId,
    name: 'lead',
    role: 'lead',
    phase: 'active',
    sessionId: state.teamId,
  }
  const members = [
    lead,
    ...Object.values(state.members).filter(member => member.id !== state.teamId).map(memberView),
  ].sort(memberComparator)
  const tasks = Object.values(state.tasks)
    .filter((task): task is TeamTaskSnapshot & { status: 'pending' | 'in_progress' | 'completed' } => task.status !== 'deleted')
    .map(taskView)
    .sort((left, right) => taskRank(left.status) - taskRank(right.status) || left.id.localeCompare(right.id))
  const messages = Object.values(state.messages)
    .map(message => messageView(message, deliveredIds))
    .sort((left, right) => left.id.localeCompare(right.id))
  const memberIds = new Set(members.map(member => String(member.id)))
  const taskInsights = tasks
    .map(task => taskInsightView(task, memberIds, dependencyDepthOf(task.id, tasks)))
    .sort((left, right) => severityRank(left.severity) - severityRank(right.severity) || left.taskId.localeCompare(right.taskId))
  const prioritizedInsights = [...taskInsights]
    .sort((left, right) => interventionScore(right) - interventionScore(left))
  const priorityByTaskId = new Map(prioritizedInsights.map((insight, index) => [insight.taskId, index + 1]))
  const rankedInsights = taskInsights.map(insight => ({
    ...insight,
    interventionPriority: priorityByTaskId.get(insight.taskId) ?? 0,
  }))
  const blockedTasks = tasks.filter(task => rankedInsights.some(insight => insight.taskId === task.id && insight.readiness === 'blocked'))
  const activeTasks = tasks.filter(task => task.status === 'in_progress')
  const pendingTasks = tasks.filter(task => task.status === 'pending')
  const completedTasks = tasks.filter(task => task.status === 'completed')
  const stalledTasks = tasks.filter(task => rankedInsights.some(insight => insight.taskId === task.id && insight.readiness === 'stalled'))
  const orphanedTasks = tasks.filter(task => rankedInsights.some(insight => insight.taskId === task.id && insight.readiness === 'orphaned'))
  const readyTasks = tasks.filter(task => rankedInsights.some(insight => insight.taskId === task.id && insight.readiness === 'ready' && task.status === 'pending'))
  const memberLoads = memberLoadViews(members, tasks, rankedInsights)
  const failedTargetIds = new Set(
    members
      .filter(member => member.role === 'teammate' && member.phase === 'failed')
      .map(member => String(member.id)),
  )
  const messageRisks = messages
    .map(message => messageRiskView(message, failedTargetIds))
    .sort((left, right) => riskRank(left.riskLevel) - riskRank(right.riskLevel) || left.messageId.localeCompare(right.messageId))
  const quickFilters = quickFiltersView(tasks, rankedInsights, memberLoads, messages, messageRisks)
  const timeline = timelineView(members, tasks, messages, state.history ?? [])
  const timelineSummary = timelineSummaryView(timeline)
  const timelineMilestones = timelineMilestonesView(timeline)
  const memberNames = new Map<string, string>(
    members.map(member => [String(member.id), member.name]),
  )
  const dependencyDag = dependencyDagView(tasks, memberNames)
  const summary = summaryView(members, tasks, messages, rankedInsights, memberLoads, messageRisks)
  const commandPlan = commandPlanView({
    teamId: state.teamId,
    members,
    taskInsights: rankedInsights,
    memberLoads,
    messageRisks,
  })
  return {
    teamId: state.teamId,
    leadMemberId: state.teamId,
    members,
    tasks,
    messages,
    blockedTasks,
    activeTasks,
    pendingTasks,
    completedTasks,
    stalledTasks,
    orphanedTasks,
    readyTasks,
    taskInsights: rankedInsights,
    memberLoads,
    messageRisks,
    quickFilters,
    timeline,
    timelineSummary,
    timelineMilestones,
    dependencyDag,
    commandPlan,
    summary,
  }
}

const memberViewSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  role: z.enum(['lead', 'teammate']),
  phase: z.enum(['provisioning', 'active', 'failed']),
  sessionId: z.string().min(1),
}).strict()

const taskViewSchema = z.object({
  id: z.string().min(1),
  subject: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']),
  ownerId: z.string().min(1).nullable(),
  blockedBy: z.array(z.string().min(1)),
  writeScopes: z.array(z.string()),
  revision: z.number().int().positive(),
}).strict()

const taskInsightViewSchema = z.object({
  taskId: z.string().min(1),
  subject: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']),
  readiness: z.enum(['ready', 'blocked', 'orphaned', 'stalled', 'failed', 'cancelled']),
  reasons: z.array(z.string()),
  severity: z.enum(['low', 'medium', 'high']),
  ownerId: z.string().min(1).nullable(),
  dependencyDepth: z.number().int().nonnegative(),
  interventionPriority: z.number().int().nonnegative(),
}).strict()

const memberLoadViewSchema = z.object({
  memberId: z.string().min(1),
  memberName: z.string(),
  level: z.enum(['idle', 'focused', 'stretched', 'overloaded']),
  activeTaskCount: z.number().int().nonnegative(),
  pendingOwnedTaskCount: z.number().int().nonnegative(),
  stalledTaskCount: z.number().int().nonnegative(),
  orphanedTaskCount: z.number().int().nonnegative(),
}).strict()

const messageViewSchema = z.object({
  id: z.string().min(1),
  senderId: z.string().min(1),
  senderName: z.string(),
  targetId: z.string().min(1),
  delivery: z.enum(['quiet', 'wakeup']),
  content: z.array(contentBlockSchema),
  delivered: z.boolean(),
}).strict()

const messageRiskViewSchema = z.object({
  messageId: z.string().min(1),
  senderName: z.string(),
  targetId: z.string().min(1),
  delivery: z.enum(['quiet', 'wakeup']),
  delivered: z.boolean(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  reasons: z.array(z.string()),
}).strict()

const filterOptionSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  count: z.number().int().nonnegative(),
}).strict()

const quickFiltersViewSchema = z.object({
  taskFilters: z.array(filterOptionSchema),
  memberFilters: z.array(filterOptionSchema),
  messageFilters: z.array(filterOptionSchema),
}).strict()

const timelineEntryViewSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['member', 'task', 'message']),
  title: z.string(),
  detail: z.string(),
  tone: z.enum(['neutral', 'good', 'warn', 'danger']),
  time: z.number().int().nonnegative().optional(),
  seq: z.number().int().nonnegative().optional(),
  count: z.number().int().positive().optional(),
}).strict()

const timelineSummaryViewSchema = z.object({
  totalEvents: z.number().int().nonnegative(),
  memberEvents: z.number().int().nonnegative(),
  taskEvents: z.number().int().nonnegative(),
  messageEvents: z.number().int().nonnegative(),
  coalescedEntries: z.number().int().nonnegative(),
  firstSeq: z.number().int().nonnegative().nullable(),
  lastSeq: z.number().int().nonnegative().nullable(),
  firstTime: z.number().int().nonnegative().nullable(),
  lastTime: z.number().int().nonnegative().nullable(),
  latestTitle: z.string().nullable(),
}).strict()

const timelineMilestoneWindowViewSchema = z.object({
  windowId: z.string().min(1),
  startSeq: z.number().int().nonnegative().nullable(),
  endSeq: z.number().int().nonnegative().nullable(),
  entryCount: z.number().int().positive(),
  eventCount: z.number().int().positive(),
  memberEvents: z.number().int().nonnegative(),
  taskEvents: z.number().int().nonnegative(),
  messageEvents: z.number().int().nonnegative(),
  headline: z.string().min(1),
  headlineTone: z.enum(['neutral', 'good', 'warn', 'danger']),
}).strict()

const commandSuggestionViewSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(AGENT_TEAM_COMMAND_KINDS),
  label: z.string(),
  targetId: z.string().min(1),
  targetLabel: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
  rationale: z.string(),
}).strict()

const commandPlanViewSchema = z.object({
  version: z.literal(1),
  generatedFromTeamId: z.string().min(1),
  total: z.number().int().nonnegative(),
  highPriorityCount: z.number().int().nonnegative(),
  mediumPriorityCount: z.number().int().nonnegative(),
  lowPriorityCount: z.number().int().nonnegative(),
  commands: z.array(commandSuggestionViewSchema),
}).strict()

const dagNodeViewSchema = z.object({
  id: z.string().min(1),
  subject: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']),
  tone: z.enum(['neutral', 'good', 'warn', 'danger']),
  ownerName: z.string().nullable(),
  level: z.number().int().nonnegative(),
  position: z.number().int().nonnegative(),
  dependencyDepth: z.number().int().nonnegative(),
}).strict()

const dagEdgeViewSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
}).strict()

const dagViewSchema = z.object({
  nodes: z.array(dagNodeViewSchema),
  edges: z.array(dagEdgeViewSchema),
  levels: z.number().int().nonnegative(),
}).strict()

const summaryViewSchema = z.object({
  memberCount: z.number().int().nonnegative(),
  failedMemberCount: z.number().int().nonnegative(),
  taskCount: z.number().int().nonnegative(),
  pendingTaskCount: z.number().int().nonnegative(),
  inProgressTaskCount: z.number().int().nonnegative(),
  completedTaskCount: z.number().int().nonnegative(),
  blockedTaskCount: z.number().int().nonnegative(),
  stalledTaskCount: z.number().int().nonnegative(),
  orphanedTaskCount: z.number().int().nonnegative(),
  readyTaskCount: z.number().int().nonnegative(),
  overloadedMemberCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  undeliveredMessageCount: z.number().int().nonnegative(),
  wakeupMessageCount: z.number().int().nonnegative(),
  highRiskMessageCount: z.number().int().nonnegative(),
  healthScore: z.number().int().min(0).max(100),
  statusLabel: z.string(),
  overview: z.string(),
  alerts: z.array(z.string()),
  recommendedActions: z.array(z.string()),
  captainBriefing: z.array(z.string()),
  topInterventions: z.array(z.string()),
}).strict()

const viewSchema = z.object({
  teamId: z.string().min(1),
  leadMemberId: z.string().min(1),
  members: z.array(memberViewSchema),
  tasks: z.array(taskViewSchema),
  messages: z.array(messageViewSchema),
  blockedTasks: z.array(taskViewSchema),
  activeTasks: z.array(taskViewSchema),
  pendingTasks: z.array(taskViewSchema),
  completedTasks: z.array(taskViewSchema),
  stalledTasks: z.array(taskViewSchema),
  orphanedTasks: z.array(taskViewSchema),
  readyTasks: z.array(taskViewSchema),
  taskInsights: z.array(taskInsightViewSchema),
  memberLoads: z.array(memberLoadViewSchema),
  messageRisks: z.array(messageRiskViewSchema),
  quickFilters: quickFiltersViewSchema,
  timeline: z.array(timelineEntryViewSchema),
  timelineSummary: timelineSummaryViewSchema,
  timelineMilestones: z.array(timelineMilestoneWindowViewSchema),
  dependencyDag: dagViewSchema,
  commandPlan: commandPlanViewSchema,
  summary: summaryViewSchema,
}).strict().nullable() as z.ZodType<AgentTeamView | null>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    agentTeam: AgentTeamProjectionState
  }
}

export const agentTeamProjectionDefinition = {
  key: 'agentTeam',
  stateSchema,
  init: initAgentTeamProjection,
  apply: applyAgentTeamEvent,
  wire: {
    viewSchema,
    view: viewAgentTeam,
  },
  stateVersion: 2,
} satisfies ProjectionDefinition<'agentTeam', AgentTeamProjectionState>
