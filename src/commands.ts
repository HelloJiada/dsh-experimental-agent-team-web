import type {
  AgentTeamCommandKind,
  AgentTeamCommandPlanView,
  AgentTeamCommandSuggestion,
  AgentTeamMemberLoadView,
  AgentTeamMemberView,
  AgentTeamMessageRiskView,
  AgentTeamTaskInsightView,
} from './contract.js'
import type { TeamId } from './agent-team-types.js'

export type {
  AgentTeamCommandKind,
  AgentTeamCommandPlanView,
  AgentTeamCommandSuggestion,
} from './contract.js'

/**
 * Single source of truth for the command vocabulary. The union type
 * `AgentTeamCommandKind` lives in `contract.ts`; this runtime list is
 * compile-time checked against it, so host consumers (and the zod schema)
 * always see the exact same set.
 */
export const AGENT_TEAM_COMMAND_KINDS: readonly AgentTeamCommandKind[] = [
  'task:claim',
  'task:reassign',
  'task:unblock',
  'member:restart',
  'message:redeliver',
  'message:broadcast',
]

/**
 * The slice of the Team view the command bridge derives from. Deliberately
 * narrower than `AgentTeamView` so the projection can build the plan before
 * the full view object (which contains the plan itself) is assembled.
 */
export interface AgentTeamCommandPlanSource {
  readonly teamId: TeamId
  readonly members: AgentTeamMemberView[]
  readonly taskInsights: AgentTeamTaskInsightView[]
  readonly memberLoads: AgentTeamMemberLoadView[]
  readonly messageRisks: AgentTeamMessageRiskView[]
}

const priorityRank: Record<AgentTeamCommandSuggestion['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
}

/**
 * Wraps the derived command suggestions into a stable, host-consumable plan
 * envelope. The plan is a pure read-only projection of committed Team facts:
 * a runtime tool layer may consume `commands` (each with a concrete targetId)
 * and execute them; this bundle never executes anything itself.
 */
export function commandPlanView(view: AgentTeamCommandPlanSource): AgentTeamCommandPlanView {
  const commands = suggestCommands(view)
  const countByPriority = (priority: AgentTeamCommandSuggestion['priority']): number =>
    commands.filter(command => command.priority === priority).length
  return {
    version: 1,
    generatedFromTeamId: view.teamId,
    total: commands.length,
    highPriorityCount: countByPriority('high'),
    mediumPriorityCount: countByPriority('medium'),
    lowPriorityCount: countByPriority('low'),
    commands,
  }
}

/**
 * Derives actionable command suggestions from committed Team facts. These are
 * recommendations for a host runtime tool layer: this bundle does not execute
 * them (the Team surface stays read-only), but it exposes the bridge contract
 * and the concrete target ids any executor would need.
 */
export function suggestCommands(view: AgentTeamCommandPlanSource): AgentTeamCommandSuggestion[] {
  const suggestions: AgentTeamCommandSuggestion[] = []

  for (const insight of view.taskInsights) {
    if (insight.status === 'completed') continue
    const targetId = String(insight.taskId)
    if (insight.readiness === 'orphaned') {
      suggestions.push({
        id: `cmd:reassign:${targetId}`,
        kind: 'task:reassign',
        label: `重新分配任务「${insight.subject}」`,
        targetId,
        targetLabel: insight.subject,
        priority: 'high',
        rationale: `任务 owner（${String(insight.ownerId ?? '未知')}）在成员快照中不可见，需要重新归属。`,
      })
    } else if (insight.readiness === 'stalled' && insight.ownerId === null) {
      suggestions.push({
        id: `cmd:claim:${targetId}`,
        kind: 'task:claim',
        label: `认领任务「${insight.subject}」`,
        targetId,
        targetLabel: insight.subject,
        priority: 'medium',
        rationale: '任务已具备执行条件但无 owner，建议 Captain 认领或指派。',
      })
    } else if (insight.readiness === 'blocked') {
      suggestions.push({
        id: `cmd:unblock:${targetId}`,
        kind: 'task:unblock',
        label: `解除任务「${insight.subject}」阻塞`,
        targetId,
        targetLabel: insight.subject,
        priority: 'high',
        rationale: `任务被依赖阻塞：${insight.reasons[0] ?? '前置任务未完成'}，需优先推进前置依赖。`,
      })
    }
  }

  for (const member of view.members) {
    if (member.role === 'teammate' && member.phase === 'failed') {
      suggestions.push({
        id: `cmd:restart:${String(member.id)}`,
        kind: 'member:restart',
        label: `重启成员「${member.name}」`,
        targetId: String(member.id),
        targetLabel: member.name,
        priority: 'high',
        rationale: '成员处于 failed 状态，需要重启、替换或由 Captain 接管其任务。',
      })
    }
  }

  for (const risk of view.messageRisks) {
    if (risk.riskLevel !== 'high') continue
    const targetId = String(risk.targetId)
    if (!risk.delivered) {
      suggestions.push({
        id: `cmd:redeliver:${String(risk.messageId)}`,
        kind: 'message:redeliver',
        label: `重发高风险消息 → ${targetId}`,
        targetId,
        targetLabel: String(risk.messageId),
        priority: 'high',
        rationale: risk.reasons.join(' ') || '高风险消息尚未送达。',
      })
    } else {
      suggestions.push({
        id: `cmd:broadcast:${String(risk.messageId)}`,
        kind: 'message:broadcast',
        label: `广播消息（目标 ${targetId} 不可达）`,
        targetId,
        targetLabel: String(risk.messageId),
        priority: 'medium',
        rationale: risk.reasons.join(' ') || '目标成员状态异常，建议改为广播。',
      })
    }
  }

  for (const load of view.memberLoads) {
    if (load.level !== 'overloaded') continue
    suggestions.push({
      id: `cmd:rebalance:${String(load.memberId)}`,
      kind: 'task:reassign',
      label: `为成员「${load.memberName}」转移负载`,
      targetId: String(load.memberId),
      targetLabel: load.memberName,
      priority: 'medium',
      rationale: '成员负载过高，建议把部分 ready work 转移给空闲或负载更低的成员。',
    })
  }

  return suggestions.sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority] || left.id.localeCompare(right.id))
}
