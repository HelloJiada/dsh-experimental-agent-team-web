/**
 * 融合智能分析层 —— 我们原创的 AgentTeam 分析设计,适配到磁盘快照数据源。
 *
 * 消费 `TeamActivitySnapshot`(磁盘为真源 + 实时成员活动),推导:
 * 健康分 / P1-P3 优先干预 / 成员负载 / 消息风险 / 时间线里程碑 / 命令建议。
 * 纯函数、只读、JSON 可序列化,供活动面板与宿主消费层使用。
 *
 * @module agent-team-web/intelligence
 */

import type { TeamActivitySnapshot } from './snapshot.ts'
import { ESTIMATE_LEVEL_RANGES, type EstimateLevel } from './types.ts'
import { formatDuration } from './duration.ts'
import { taskTimingState } from './retro.ts'

/** 预估展示文本:等级优先,其次内部毫秒,再其次"未预估"。 */
function estimateLabel(task: TeamActivitySnapshot['tasks'][number]): string {
  if (task.estimateLevel !== undefined) {
    return `${task.estimateLevel}(${ESTIMATE_LEVEL_RANGES[task.estimateLevel as EstimateLevel].label})`
  }
  if (task.estimatedMs !== undefined) return formatDuration(task.estimatedMs)
  return '未预估'
}

/** 任务就绪度(旧投影内核的 readiness 词汇,适配新内核)。 */
export type TeamTaskReadiness = 'blocked' | 'stalled' | 'ready' | 'orphaned' | 'failed' | 'cancelled' | 'completed'

/** 严重度 / 负载档位 / 风险档位 / 命令优先级。 */
export type TeamSeverity = 'high' | 'medium' | 'low'
export type TeamLoadLevel = 'overloaded' | 'stretched' | 'focused' | 'idle'
export type TeamRiskLevel = 'high' | 'medium' | 'low'
export type TeamCommandPriority = 'high' | 'medium' | 'low'
export type TeamCommandKind =
  | 'task:claim' | 'task:reassign' | 'task:unblock'
  | 'member:restart' | 'message:redeliver' | 'message:broadcast'

/** 单任务洞察:就绪度 + 严重度 + 原因 + 干预优先级。 */
export interface TeamTaskInsight {
  readonly taskId: string
  readonly subject: string
  readonly status: string
  readonly readiness: TeamTaskReadiness
  readonly severity: TeamSeverity
  readonly reasons: readonly string[]
  readonly assignee: string | null
  readonly dependencyDepth: number
  /** 1..n 按 interventionScore 排序;terminal 任务为 0。 */
  readonly interventionPriority: number
}

/** 成员负载:进行中/待处理/停滞/悬空 四段计数 + 档位。 */
export interface TeamMemberLoad {
  readonly memberId: string
  readonly memberName: string
  readonly activeTaskCount: number
  readonly pendingOwnedTaskCount: number
  readonly stalledTaskCount: number
  readonly orphanedTaskCount: number
  readonly level: TeamLoadLevel
}

/** 消息风险:来自队长收件箱 + 成员不可用性。 */
export interface TeamMessageRisk {
  readonly from: string
  readonly content: string
  readonly riskLevel: TeamRiskLevel
  readonly reasons: readonly string[]
}

/** 团队健康:加权扣分 + 状态标签 + 概览 + 告警 + 建议动作。 */
export interface TeamHealthView {
  readonly score: number
  readonly statusLabel: string
  readonly overview: string
  readonly alerts: readonly string[]
  readonly recommendedActions: readonly string[]
}

/** 时间线里程碑(轻量派生:最新已完成/进行中任务)。 */
export interface TeamMilestoneView {
  readonly latestTitle: string | null
  readonly completedTaskCount: number
  readonly runningTaskCount: number
}

/** 命令建议(只读桥,供宿主执行层消费)。 */
export interface TeamCommandSuggestion {
  readonly id: string
  readonly kind: TeamCommandKind
  readonly label: string
  readonly targetId: string
  readonly targetLabel: string
  readonly priority: TeamCommandPriority
  readonly rationale: string
}

/** 命令计划信封。 */
export interface TeamCommandPlan {
  readonly version: 1
  readonly total: number
  readonly highPriorityCount: number
  readonly mediumPriorityCount: number
  readonly lowPriorityCount: number
  readonly commands: readonly TeamCommandSuggestion[]
}

/** 融合分析层的完整输出。 */
export interface TeamIntelligence {
  readonly health: TeamHealthView
  readonly priorities: readonly TeamTaskInsight[]
  readonly memberLoads: readonly TeamMemberLoad[]
  readonly messageRisks: readonly TeamMessageRisk[]
  readonly milestones: TeamMilestoneView
  readonly commandPlan: TeamCommandPlan
}

const severityRank: Record<TeamSeverity, number> = { high: 0, medium: 1, low: 2 }
const readinessRank: Record<TeamTaskReadiness, number> = {
  blocked: 0, orphaned: 1, stalled: 2, ready: 3, failed: 4, cancelled: 5, completed: 6,
}

function taskInsight(
  snapshot: TeamActivitySnapshot,
  task: TeamActivitySnapshot['tasks'][number],
  memberNames: ReadonlySet<string>,
): TeamTaskInsight {
  const reasons: string[] = []
  let readiness: TeamTaskReadiness = 'ready'
  let severity: TeamSeverity = 'low'
  const assignee = task.assignee === '' ? null : task.assignee

  if (task.status === 'completed') {
    const reasons = ['任务已完成。']
    if (task.retro !== undefined && task.retro.overran) {
      reasons.push(`任务超时完成:实际 ${formatDuration(task.retro.actualMs)} vs 预估 ${task.retro.estimatedMs !== undefined ? formatDuration(task.retro.estimatedMs) : '未预估'},已生成复盘(原因:${task.retro.cause})。`)
    }
    return { taskId: task.id, subject: task.subject, status: task.status, readiness: 'completed', severity: 'low', reasons, assignee, dependencyDepth: task.depth, interventionPriority: 0 }
  }
  if (task.status === 'failed') {
    return { taskId: task.id, subject: task.subject, status: task.status, readiness: 'failed', severity: 'low', reasons: ['任务已失败（terminal）。'], assignee, dependencyDepth: task.depth, interventionPriority: 0 }
  }
  if (task.status === 'cancelled') {
    return { taskId: task.id, subject: task.subject, status: task.status, readiness: 'cancelled', severity: 'low', reasons: ['任务已取消（terminal）。'], assignee, dependencyDepth: task.depth, interventionPriority: 0 }
  }

  if (task.state === 'blocked') {
    readiness = 'blocked'
    severity = 'high'
    reasons.push(`依赖未完成：${task.dependencies.join(', ') || '前置任务'}。`)
  }

  if (assignee !== null && !memberNames.has(assignee)) {
    readiness = 'orphaned'
    severity = 'high'
    reasons.push('任务 owner 在当前成员快照中不存在。')
  }

  if (task.status === 'in_progress' && assignee === null) {
    readiness = 'stalled'
    severity = 'high'
    reasons.push('任务处于进行中，但没有声明 owner。')
  } else if (task.status === 'in_progress' && assignee !== null && memberNames.has(assignee)) {
    readiness = 'stalled'
    severity = 'medium'
    reasons.push('任务处于进行中，但还没有证据表明它已经完成或解除占用。')
  }

  // 自成长超时提示:进行中任务实际/已用耗时超过预估预算即警示(与面板同一
  // 阈值:>预算 黄,>预算 1.5 倍 红;等级 L 无上限时回落内部毫秒)。
  if (task.status === 'in_progress' && task.claimedAt !== undefined) {
    const elapsed = Date.now() - task.claimedAt
    const timing = taskTimingState(task.estimateLevel, task.estimatedMs, elapsed)
    if (timing === 'over') {
      severity = 'high'
      reasons.push(`任务严重超时:已用 ${formatDuration(elapsed)},超过预估预算的 1.5 倍,建议介入或重新评估工作量。`)
    } else if (timing === 'warn') {
      severity = severity === 'high' ? 'high' : 'medium'
      reasons.push(`任务超出预估预算:已用 ${formatDuration(elapsed)},预估 ${estimateLabel(task)}。`)
    }
  }

  if (task.status === 'pending' && task.state !== 'blocked' && assignee === null) {
    readiness = 'ready'
    severity = 'medium'
    reasons.push('任务已 ready，但尚未声明 owner。')
  } else if (task.status === 'pending' && task.state !== 'blocked' && assignee !== null && memberNames.has(assignee)) {
    readiness = 'stalled'
    severity = 'medium'
    reasons.push('任务已具备执行条件，但仍停留在 pending。')
  }

  if (task.depth > 0) {
    reasons.push(`当前有 ${task.depth} 个下游任务依赖它，解除它可释放整条链路。`)
  }
  if (reasons.length === 0) reasons.push('当前没有明显异常。')

  return { taskId: task.id, subject: task.subject, status: task.status, readiness, severity, reasons, assignee, dependencyDepth: task.depth, interventionPriority: 0 }
}

function interventionScore(insight: TeamTaskInsight): number {
  const severityWeight: Record<TeamSeverity, number> = { high: 100, medium: 40, low: 0 }
  const readinessWeight: Record<TeamTaskReadiness, number> = {
    blocked: 30, orphaned: 30, stalled: 25, ready: 10, failed: 0, cancelled: 0, completed: 0,
  }
  const depthBonus = Math.min(insight.dependencyDepth * 100, 500)
  return depthBonus + severityWeight[insight.severity] + readinessWeight[insight.readiness]
}

function memberLoads(
  snapshot: TeamActivitySnapshot,
  insights: readonly TeamTaskInsight[],
): TeamMemberLoad[] {
  const members = snapshot.members.filter(member => member.role !== 'captain')
  return members.map((member) => {
    const owned = snapshot.tasks.filter(task => task.assignee === member.name)
    const activeTaskCount = owned.filter(task => task.status === 'in_progress').length
    const pendingOwnedTaskCount = owned.filter(task => task.status === 'pending').length
    const stalledTaskCount = insights.filter(insight => insight.assignee === member.name && insight.readiness === 'stalled').length
    const orphanedTaskCount = insights.filter(insight => insight.assignee === member.name && insight.readiness === 'orphaned').length

    let level: TeamLoadLevel = 'idle'
    if (activeTaskCount >= 3 || owned.length >= 4) level = 'overloaded'
    else if (activeTaskCount >= 2 || owned.length >= 3 || stalledTaskCount > 0) level = 'stretched'
    else if (owned.length > 0) level = 'focused'

    return { memberId: member.id, memberName: member.name, activeTaskCount, pendingOwnedTaskCount, stalledTaskCount, orphanedTaskCount, level }
  }).sort((left, right) => {
    const rank: Record<TeamLoadLevel, number> = { overloaded: 0, stretched: 1, focused: 2, idle: 3 }
    return rank[left.level] - rank[right.level] || left.memberName.localeCompare(right.memberName)
  })
}

function messageRisks(
  snapshot: TeamActivitySnapshot,
  removedMembers: ReadonlySet<string>,
): TeamMessageRisk[] {
  return snapshot.captainInbox.map((message) => {
    const reasons: string[] = []
    let riskLevel: TeamRiskLevel = 'low'
    if (removedMembers.has(message.from)) {
      riskLevel = 'high'
      reasons.push('发送方成员已被移除，消息可能无法被处理。')
    } else if (snapshot.members.some(member => member.name === message.from && member.unread > 0)) {
      riskLevel = 'medium'
      reasons.push('目标成员存在未读消息。')
    }
    if (reasons.length === 0) reasons.push('消息风险较低。')
    return { from: message.from, content: message.content, riskLevel, reasons }
  })
}

function healthView(
  snapshot: TeamActivitySnapshot,
  insights: readonly TeamTaskInsight[],
  loads: readonly TeamMemberLoad[],
  risks: readonly TeamMessageRisk[],
  removedMembers: ReadonlySet<string>,
): TeamHealthView {
  const teammateCount = snapshot.members.filter(member => member.role !== 'captain').length
  const tasks = snapshot.tasks
  const inProgress = tasks.filter(task => task.status === 'in_progress')
  const pending = tasks.filter(task => task.status === 'pending')
  const completed = tasks.filter(task => task.status === 'completed')
  const blocked = insights.filter(insight => insight.readiness === 'blocked')
  const stalled = insights.filter(insight => insight.readiness === 'stalled')
  const orphaned = insights.filter(insight => insight.readiness === 'orphaned')
  const ready = insights.filter(insight => insight.readiness === 'ready' && insight.status === 'pending')
  const overloaded = loads.filter(load => load.level === 'overloaded')
  const stretched = loads.filter(load => load.level === 'stretched')
  const highRisk = risks.filter(risk => risk.riskLevel === 'high')
  // 自成长复盘洞察:进行中超预算任务(>预估预算)与已完成超预算任务数。
  const overBudgetTasks = tasks.filter(task => task.status === 'in_progress'
    && task.claimedAt !== undefined
    && taskTimingState(task.estimateLevel, task.estimatedMs, Date.now() - task.claimedAt) !== 'ok')
  const overranCompleted = tasks.filter(task =>
    task.status === 'completed' && task.retro?.overran === true)

  const alerts: string[] = []
  const recommendedActions: string[] = []

  let score = 100
  if (removedMembers.size > 0) {
    score -= Math.min(45, removedMembers.size * 25)
    alerts.push(`${removedMembers.size} 个成员已被移除，团队执行面存在明显风险。`)
    recommendedActions.push('优先检查被移除成员对应的任务归属，并决定重试、替换还是由 Captain 接管。')
  }
  if (blocked.length > 0) {
    score -= Math.min(20, blocked.length * 8)
    alerts.push(`${blocked.length} 个任务被依赖阻塞，吞吐正在下降。`)
    recommendedActions.push('优先解除阻塞链最前面的依赖任务，避免更多待处理任务继续堆积。')
  }
  if (stalled.length > 0) {
    score -= Math.min(20, stalled.length * 8)
    alerts.push(`${stalled.length} 个任务出现 stalled 信号，说明 ready work 未有效推进。`)
    recommendedActions.push('重新确认 stalled 任务的 owner 和状态是否一致，必要时重新派单或催办。')
  }
  if (orphaned.length > 0) {
    score -= Math.min(25, orphaned.length * 10)
    alerts.push(`${orphaned.length} 个任务处于 orphaned 状态，owner 关联已失效。`)
    recommendedActions.push('尽快为 orphaned 任务重新绑定可见成员，避免任务长时间悬空。')
  }
  if (snapshot.captainInbox.length > 0) {
    score -= Math.min(15, snapshot.captainInbox.length * 5)
  }
  if (highRisk.length > 0) {
    score -= Math.min(10, highRisk.length * 4)
  }
  if (overloaded.length > 0) {
    score -= Math.min(15, overloaded.length * 7)
    alerts.push(`${overloaded.length} 名成员负载过高，团队存在局部过载。`)
    recommendedActions.push('把过载成员的一部分 ready work 转移给空闲或负载更低的成员。')
  }
  if (overBudgetTasks.length > 0) {
    score -= Math.min(20, overBudgetTasks.length * 8)
    alerts.push(`${overBudgetTasks.length} 个进行中任务超出预估预算(超时运行),执行节奏偏离预估。`)
    recommendedActions.push('对超预算任务重新评估工作量:可拆解、加人协助或由队长接管,避免长期占用成员。')
  }
  if (overranCompleted.length > 0) {
    score -= Math.min(12, overranCompleted.length * 5)
    alerts.push(`${overranCompleted.length} 个已完成任务超时(复盘已生成),预估普遍偏低。`)
    recommendedActions.push('派单前用 agent_teams_best_practices 查看经验库与校准统计,按角色×等级历史实际耗时上调预估。')
  }
  if (inProgress.length > 0 && teammateCount === 0) {
    score -= 10
    alerts.push('存在进行中任务，但没有可见 teammate 成员记录。')
  }
  if (pending.length > 0 && inProgress.length === 0) {
    score -= 8
    alerts.push('存在待处理任务，但当前没有任何任务处于进行中。')
    recommendedActions.push('为 ready 任务分配 owner，或确认调度器是否没有唤醒可执行成员。')
  }
  if (score < 0) score = 0

  let statusLabel = '运行平稳'
  if (score < 50) statusLabel = '需要立即干预'
  else if (score < 80) statusLabel = '存在风险'

  const overviewParts = [
    `共有 ${teammateCount} 名 teammate`,
    `${tasks.length} 个任务（${inProgress.length} 进行中 / ${pending.length} 待处理 / ${completed.length} 已完成）`,
    `${snapshot.messageCount} 条团队消息`,
  ]
  if (removedMembers.size > 0) overviewParts.push(`${removedMembers.size} 名成员被移除`)
  if (blocked.length > 0) overviewParts.push(`${blocked.length} 个任务阻塞`)
  if (stalled.length > 0) overviewParts.push(`${stalled.length} 个任务 stalled`)
  if (orphaned.length > 0) overviewParts.push(`${orphaned.length} 个任务 orphaned`)
  if (overBudgetTasks.length > 0) overviewParts.push(`${overBudgetTasks.length} 个任务超时运行`)
  if (overranCompleted.length > 0) overviewParts.push(`${overranCompleted.length} 个任务超时完成`)
  if (snapshot.captainInbox.length > 0) overviewParts.push(`${snapshot.captainInbox.length} 条消息待送达`)

  if (recommendedActions.length === 0) recommendedActions.push('继续保持当前节奏，重点关注新阻塞和新失败事件。')

  return {
    score,
    statusLabel,
    overview: overviewParts.join('，') + '。',
    alerts,
    recommendedActions,
  }
}

function milestoneView(snapshot: TeamActivitySnapshot): TeamMilestoneView {
  const completed = snapshot.tasks.filter(task => task.status === 'completed')
  const running = snapshot.tasks.filter(task => task.status === 'in_progress')
  const latest = [...completed, ...running].sort((a, b) => a.id.localeCompare(b.id)).at(-1) ?? null
  return {
    latestTitle: latest?.subject ?? null,
    completedTaskCount: completed.length,
    runningTaskCount: running.length,
  }
}

function commandPlan(
  snapshot: TeamActivitySnapshot,
  insights: readonly TeamTaskInsight[],
  loads: readonly TeamMemberLoad[],
  risks: readonly TeamMessageRisk[],
  removedMembers: ReadonlySet<string>,
): TeamCommandPlan {
  const commands: TeamCommandSuggestion[] = []
  const memberNames = new Set(snapshot.members.map(member => member.name))

  for (const insight of insights) {
    if (insight.status === 'completed' || insight.status === 'failed' || insight.status === 'cancelled') continue
    const targetId = insight.taskId
    if (insight.readiness === 'orphaned') {
      commands.push({ id: `cmd:reassign:${targetId}`, kind: 'task:reassign', label: `重新分配任务「${insight.subject}」`, targetId, targetLabel: insight.subject, priority: 'high', rationale: `任务 owner（${insight.assignee ?? '未知'}）在成员快照中不可见，需要重新归属。` })
    } else if (insight.readiness === 'stalled' && insight.assignee === null) {
      commands.push({ id: `cmd:claim:${targetId}`, kind: 'task:claim', label: `认领任务「${insight.subject}」`, targetId, targetLabel: insight.subject, priority: 'medium', rationale: '任务已具备执行条件但无 owner，建议 Captain 认领或指派。' })
    } else if (insight.readiness === 'blocked') {
      commands.push({ id: `cmd:unblock:${targetId}`, kind: 'task:unblock', label: `解除任务「${insight.subject}」阻塞`, targetId, targetLabel: insight.subject, priority: 'high', rationale: `任务被依赖阻塞：${insight.reasons[0] ?? '前置任务未完成'}，需优先推进前置依赖。` })
    }
  }

  for (const member of snapshot.members) {
    if (member.role !== 'captain' && removedMembers.has(member.name)) {
      commands.push({ id: `cmd:restart:${member.id}`, kind: 'member:restart', label: `重启成员「${member.name}」`, targetId: member.id, targetLabel: member.name, priority: 'high', rationale: '成员已被移除，需要重启、替换或由 Captain 接管其任务。' })
    }
  }

  for (const risk of risks) {
    if (risk.riskLevel !== 'high') continue
    const target = risk.from
    if (removedMembers.has(target) || !memberNames.has(target)) {
      commands.push({ id: `cmd:broadcast:${target}`, kind: 'message:broadcast', label: `广播消息（目标 ${target} 不可达）`, targetId: target, targetLabel: risk.content.slice(0, 24), priority: 'medium', rationale: risk.reasons[0] ?? '目标成员状态异常，建议改为广播。' })
    } else {
      commands.push({ id: `cmd:redeliver:${target}`, kind: 'message:redeliver', label: `重发高风险消息 → ${target}`, targetId: target, targetLabel: risk.content.slice(0, 24), priority: 'high', rationale: risk.reasons[0] ?? '高风险消息尚未送达。' })
    }
  }

  for (const load of loads) {
    if (load.level !== 'overloaded') continue
    commands.push({ id: `cmd:rebalance:${load.memberId}`, kind: 'task:reassign', label: `为成员「${load.memberName}」转移负载`, targetId: load.memberId, targetLabel: load.memberName, priority: 'medium', rationale: '成员负载过高，建议把部分 ready work 转移给空闲或负载更低的成员。' })
  }

  const priorityRank: Record<TeamCommandPriority, number> = { high: 0, medium: 1, low: 2 }
  commands.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.id.localeCompare(b.id))

  return {
    version: 1,
    total: commands.length,
    highPriorityCount: commands.filter(c => c.priority === 'high').length,
    mediumPriorityCount: commands.filter(c => c.priority === 'medium').length,
    lowPriorityCount: commands.filter(c => c.priority === 'low').length,
    commands,
  }
}

/** 对一份团队快照做完整智能分析。纯函数,不改动快照。 */
export function analyzeTeamSnapshot(snapshot: TeamActivitySnapshot): TeamIntelligence {
  const memberNames = new Set(snapshot.members.map(member => member.name))
  const removedMembers = new Set(
    snapshot.members.filter(member => member.status === 'removed').map(member => member.name),
  )

  const rawInsights = snapshot.tasks.map(task => taskInsight(snapshot, task, memberNames))
  const actionable = rawInsights
    .filter(insight => insight.status !== 'completed' && insight.status !== 'failed' && insight.status !== 'cancelled')
    .sort((a, b) => interventionScore(b) - interventionScore(a))
  const priorityByTask = new Map(actionable.map((insight, index) => [insight.taskId, index + 1]))
  const insights = rawInsights.map(insight => ({
    ...insight,
    interventionPriority: priorityByTask.get(insight.taskId) ?? 0,
  })).sort((a, b) => {
    if (a.interventionPriority === 0 && b.interventionPriority === 0) return readinessRank[a.readiness] - readinessRank[b.readiness]
    return a.interventionPriority - b.interventionPriority
  })

  const priorities = insights.filter(insight => insight.interventionPriority > 0).slice(0, 5)
  const loads = memberLoads(snapshot, insights)
  const risks = messageRisks(snapshot, removedMembers)

  return {
    health: healthView(snapshot, insights, loads, risks, removedMembers),
    priorities,
    memberLoads: loads,
    messageRisks: risks,
    milestones: milestoneView(snapshot),
    commandPlan: commandPlan(snapshot, insights, loads, risks, removedMembers),
  }
}
