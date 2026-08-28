/**
 * 面板耗时展示与超时警示的客户端辅助(与服务端 retro.ts 同阈值)。
 *
 * 判定规则与 tools/intelligence/snapshot 完全一致:
 * 预算 = 预估等级区间上限(ESTIMATE_LEVEL_RANGES)或内部毫秒;
 * 已用/实际 > 预算 → warn(黄),> 预算 × 1.5 → over(红)。
 * @module dsh-agent-team-web/client/task-timing
 */

import { formatDuration } from '../duration.ts'
import { ESTIMATE_LEVEL_RANGES } from '../types.ts'
import type { ActivityMember, ActivityTask } from './activity-monitor.ts'
import type { AgentTeamsLocaleKey, AgentTeamsTranslate } from './locales.ts'

/** 客户端侧复用的超时档位。 */
export type TaskTimingState = 'ok' | 'warn' | 'over'

/** 预估预算(ms):等级区间上限优先,其次内部毫秒;都无则 undefined。 */
export function estimateBudgetMs(task: ActivityTask): number | undefined {
  if (task.estimateLevel !== undefined) {
    const maxMs = ESTIMATE_LEVEL_RANGES[task.estimateLevel].maxMs
    if (Number.isFinite(maxMs)) return maxMs
  }
  return task.estimatedMs !== undefined && task.estimatedMs > 0 ? task.estimatedMs : undefined
}

/** 任务当前展示用的耗时(ms):已完成取实际耗时,进行中取 now - claimedAt。 */
export function taskElapsedMs(task: ActivityTask, now: number): number {
  if (task.actualMs !== undefined && task.actualMs >= 0) return task.actualMs
  if (task.claimedAt !== undefined) return Math.max(0, now - task.claimedAt)
  return 0
}

/** 超时档位(与服务端 taskTimingState 一致,等级优先口径)。 */
export function taskTimingState(task: ActivityTask, now: number): TaskTimingState {
  const budget = estimateBudgetMs(task)
  const elapsed = taskElapsedMs(task, now)
  if (budget === undefined || elapsed <= 0) return 'ok'
  if (elapsed > budget * 1.5) return 'over'
  if (elapsed > budget) return 'warn'
  return 'ok'
}

/** 预估展示文本:等级优先(S(≤15m)),其次毫秒。 */
export function estimateText(task: ActivityTask, t: AgentTeamsTranslate): string | null {
  if (task.estimateLevel !== undefined) {
    const range = ESTIMATE_LEVEL_RANGES[task.estimateLevel].label
    return `${task.estimateLevel}(${range})`
  }
  if (task.estimatedMs !== undefined && task.estimatedMs > 0) {
    return formatDuration(task.estimatedMs)
  }
  return null
}

/** 任务行的"预估 vs 实际/已用"文本;无预估返回 null。 */
export function taskTimingText(task: ActivityTask, t: AgentTeamsTranslate, now = Date.now()): string | null {
  const estimate = estimateText(task, t)
  if (estimate === null) return null
  if (task.actualMs !== undefined && task.actualMs >= 0) {
    const actual = formatDuration(task.actualMs)
    const overrun = task.actualMs - (task.estimatedMs ?? 0)
    const overrunText = task.estimatedMs !== undefined && overrun > 0
      ? t('timing.overrun', { value: formatDuration(overrun) })
      : null
    return [t('timing.estimated', { value: estimate }), t('timing.actual', { value: actual }), overrunText]
      .filter((part): part is string => part !== null)
      .join(' · ')
  }
  const elapsed = taskElapsedMs(task, now)
  if (elapsed <= 0) return t('timing.estimated', { value: estimate })
  return `${t('timing.estimated', { value: estimate })} · ${t('timing.elapsed', { value: formatDuration(elapsed) })}`
}

/** 任务详情展开时的完整耗时行:预估/实际/等级偏差(如有)。 */
export function taskTimingDetailText(task: ActivityTask, t: AgentTeamsTranslate, now = Date.now()): string | null {
  const parts = taskTimingText(task, t, now)
  if (parts === null) return null
  const deviation = task.retro?.levelDeviation
  if (deviation !== undefined && deviation !== 0) {
    return `${parts} · ${t('timing.deviation', { value: deviation > 0 ? `+${deviation}` : `${deviation}` })}`
  }
  return parts
}

/** 成员状态行的"已耗时"文本;无当前任务或未计时返回 null。 */
export function memberElapsedText(member: ActivityMember, t: AgentTeamsTranslate): string | null {
  if (member.currentTaskElapsedMs <= 0) return null
  const value = formatDuration(member.currentTaskElapsedMs)
  return member.currentTaskElapsedApprox === true
    ? t('timing.memberElapsedApprox', { value })
    : t('timing.memberElapsed', { value })
}

/** 成员当前任务的超时档位(用于已耗时文本的警示着色)。 */
export function memberTimingState(
  member: ActivityMember,
  tasks: readonly ActivityTask[],
  now = Date.now(),
): TaskTimingState {
  const current = tasks.find(task => task.id === member.currentTask)
  if (current === undefined) return 'ok'
  return taskTimingState(current, now)
}

/** 任务详情的产出信号行(含成员自报);无信号返回 null。 */
export function taskSignalsText(task: ActivityTask, t: AgentTeamsTranslate): string | null {
  if (task.signals === undefined) return null
  const parts = [t('timing.signals', {
    turns: task.signals.turns ?? 0,
    toolCalls: task.signals.toolCalls ?? 0,
    bytes: task.signals.outputBytes,
  })]
  if (task.signals.selfReport !== undefined && task.signals.selfReport !== '') {
    parts.push(t('timing.selfReport', { note: task.signals.selfReport }))
  }
  return parts.join(' · ')
}

/** 复盘原因 → 本地化 key 的静态映射(避免动态字符串索引)。 */
const RETRO_CAUSE_KEYS: Record<string, AgentTeamsLocaleKey> = {
  underestimated: 'retro.cause.underestimated',
  'dependency-blocked': 'retro.cause.dependencyBlocked',
  'requirement-change': 'retro.cause.requirementChange',
  'member-efficiency': 'retro.cause.memberEfficiency',
  environment: 'retro.cause.environment',
  on_time: 'retro.cause.onTime',
  other: 'retro.cause.other',
}

/** 复盘原因标签(zh/en 双语)。 */
export function retroCauseLabel(cause: string, t: AgentTeamsTranslate): string {
  const key = RETRO_CAUSE_KEYS[cause]
  return key === undefined ? cause : t(key)
}

/** 任务详情的复盘行(原因/经验/边界标注/队长校准);无复盘返回 null。 */
export function retroDetailText(task: ActivityTask, t: AgentTeamsTranslate): string | null {
  const retro = task.retro
  if (retro === undefined) return null
  const parts = [t('retro.causeLabel', { cause: retroCauseLabel(retro.cause, t) })]
  // 经验/最优方案是复盘的核心价值,必须展示(cancelled 留空则不显示)。
  if (retro.recommendation !== undefined && retro.recommendation !== '') {
    parts.push(t('timing.recommendation', { note: retro.recommendation }))
  }
  if (retro.retroNote !== undefined && retro.retroNote !== '') {
    parts.push(t('timing.retroNote', { note: retro.retroNote }))
  }
  if (retro.includesGateWait === true) parts.push(t('timing.gateWait'))
  if (retro.hasHelper === true) parts.push(t('timing.hasHelper'))
  if (retro.captainVerdict !== undefined) parts.push(`captain: ${retro.captainVerdict}`)
  return parts.join(' · ')
}

/**
 * 复盘质量闭环:任务行/详情「待校准」徽标条件。与服务端
 * retroPendingCalibration 同口径(high/critical + 终结 + 无 retro_note +
 * 无 captainVerdict),并优先信任服务端快照透出的 pendingCalibration 标志。
 */
export function taskPendingCalibration(task: ActivityTask): boolean {
  if (task.pendingCalibration === true) return true
  const retro = task.retro
  if (retro === undefined) return false
  if (task.status !== 'completed' && task.status !== 'failed') return false
  if (task.riskLevel !== 'high' && task.riskLevel !== 'critical') return false
  const hasNote = retro.retroNote !== undefined && retro.retroNote.trim() !== ''
  return !hasNote && retro.captainVerdict === undefined
}
