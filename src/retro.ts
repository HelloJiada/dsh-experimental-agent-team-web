/**
 * 任务耗时/复盘纯逻辑:预估等级(S/M/L)、实际、超时判定、三层复盘与团队校准统计。
 *
 * 纯函数、只读、无副作用,供 tools(结算/生成)、snapshot(面板快照)、
 * intelligence(超时提示)与客户端(超时警示 UI)共用,保证服务端与面板对
 * "超时"的判定完全一致(方向决策 2/4/6):
 * - 预算 = 预估等级区间上限(ESTIMATE_LEVEL_RANGES,集中可调)或内部毫秒;
 * - 实际/已用 > 预算 → overran(超预算,黄);> 预算 × 1.5 → 严重超时(红);
 * - 每次 terminal 都生成复盘(on_time 也沉淀);cancelled 记耗时不推经验。
 * @module dsh-agent-team-web/retro
 */

import { formatDuration } from './duration.ts'
import {
  ESTIMATE_LEVEL_RANGES,
  estimateLevelDeviation,
  TASK_RETRO_CAUSES,
  type EstimateLevel,
  type RetroCaptainVerdict,
  type TaskRetro,
  type TaskRetroCause,
  type TeamMember,
  type TeamTask,
} from './types.ts'

/** 超预算阈值:实际/已用超过预估预算即视为黄色警示(= overran)。 */
export const OVERRUN_WARN_FACTOR = 1.0
/** 严重超时阈值:实际/已用超过预算 1.5 倍即红色警示。 */
export const OVERRUN_OVER_FACTOR = 1.5

/** 耗时档位:ok 正常 / warn 超预算(>预算) / over 严重超时(>预算 1.5 倍)。 */
export type TaskTimingState = 'ok' | 'warn' | 'over'

/**
 * 预估预算(ms):等级区间上限优先(S/M 有上限;L 无上限时回落内部毫秒);
 * 两者都无返回 undefined(不判超时)。
 */
export function estimateBudgetMs(
  estimateLevel: EstimateLevel | undefined,
  estimatedMs: number | undefined,
): number | undefined {
  if (estimateLevel !== undefined) {
    const maxMs = ESTIMATE_LEVEL_RANGES[estimateLevel].maxMs
    if (Number.isFinite(maxMs)) return maxMs
  }
  return estimatedMs !== undefined && estimatedMs > 0 ? estimatedMs : undefined
}

/**
 * 实际/已用耗时相对预估的档位(等级优先口径)。
 * @param estimateLevel - 预估等级(S/M/L)。
 * @param estimatedMs - 内部毫秒换算(等级 L 或未设等级时兜底)。
 * @param actualOrElapsedMs - 实际(已完成)或已用(进行中)耗时。
 */
export function taskTimingState(
  estimateLevel: EstimateLevel | undefined,
  estimatedMs: number | undefined,
  actualOrElapsedMs: number | undefined,
): TaskTimingState {
  const budget = estimateBudgetMs(estimateLevel, estimatedMs)
  if (budget === undefined) return 'ok'
  if (actualOrElapsedMs === undefined || actualOrElapsedMs < 0) return 'ok'
  if (actualOrElapsedMs > budget * OVERRUN_OVER_FACTOR) return 'over'
  if (actualOrElapsedMs > budget * OVERRUN_WARN_FACTOR) return 'warn'
  return 'ok'
}

/** 是否超预算(实际 > 预估预算);无预算恒为 false。 */
export function taskOverran(
  estimateLevel: EstimateLevel | undefined,
  estimatedMs: number | undefined,
  actualMs: number | undefined,
): boolean {
  const budget = estimateBudgetMs(estimateLevel, estimatedMs)
  if (budget === undefined || actualMs === undefined) return false
  return actualMs > budget
}

/**
 * 任务的已用/实际耗时(ms):已完成取 actualMs;进行中优先 now - claimedAt,
 * 缺 claimedAt(旧团队/跨版本升级)时回退 now - updatedAt 作为近似起点,
 * 仍缺失则 0。
 */
export function taskElapsedMs(
  task: Pick<TeamTask, 'claimedAt' | 'completedAt' | 'actualMs'> & { readonly updatedAt?: number },
  now: number,
): number {
  if (task.actualMs !== undefined && task.actualMs >= 0) return task.actualMs
  if (task.claimedAt !== undefined) return Math.max(0, now - task.claimedAt)
  if (task.updatedAt !== undefined) return Math.max(0, now - task.updatedAt)
  return 0
}

/** 成员当前进行中任务的已用耗时(ms);无当前任务或未记认领时间时为 0。 */
export function currentTaskElapsedMs(
  memberName: string,
  tasks: readonly TeamTask[],
  now: number,
): number {
  const current = tasks.find(task => task.status === 'in_progress' && task.assignee === memberName)
  if (current === undefined) return 0
  return taskElapsedMs(current, now)
}

/**
 * 当前进行中任务的耗时是否为近似值:任务缺 claimedAt(旧团队/跨版本升级)而
 * 回退到 updatedAt 推算时为 true;无当前任务恒为 false。
 */
export function currentTaskElapsedApprox(
  memberName: string,
  tasks: readonly TeamTask[],
): boolean {
  const current = tasks.find(task => task.status === 'in_progress' && task.assignee === memberName)
  if (current === undefined) return false
  return current.claimedAt === undefined && current.updatedAt !== undefined
}

/** 生成一次复盘需要的最小任务耗时/边界信息。 */
export interface RetroTaskFacts {
  readonly attempt?: number
  readonly estimateLevel?: EstimateLevel
  readonly estimatedMs?: number
  readonly claimedAt?: number
  readonly completedAt?: number
  readonly actualMs?: number
  /** 终结状态:completed/failed/cancelled(决定是否推经验)。 */
  readonly status?: string
  /** 成员一句话经验(bestPractice 原始素材)。 */
  readonly retroNote?: string
  /** 边界:任务曾被政委门禁等待。 */
  readonly includesGateWait?: boolean
  /** 边界:本 attempt 曾有 helper 介入。 */
  readonly hasHelper?: boolean
}

/** 结算一次任务耗时(幂等):补记 completedAt 与 actualMs,并算 overrunMs。 */
export function resolveTaskTiming(task: RetroTaskFacts, now: number): {
  readonly completedAt: number
  readonly actualMs?: number
  readonly overrunMs?: number
} {
  const completedAt = task.completedAt ?? now
  const actualMs = task.actualMs ?? (
    task.claimedAt !== undefined ? Math.max(0, completedAt - task.claimedAt) : undefined
  )
  const overrunMs = actualMs !== undefined && task.estimatedMs !== undefined
    ? actualMs - task.estimatedMs
    : undefined
  return { completedAt, ...actualMs !== undefined ? { actualMs } : {}, ...overrunMs !== undefined ? { overrunMs } : {} }
}

/** 各原因分类的固定建议文案(沉淀"最优方案",反哺队长派单)。 */
const CAUSE_RECOMMENDATION: Readonly<Record<TaskRetroCause, string>> = {
  underestimated: '同类任务下次派单时按实际耗时的 1.3~1.5 倍给出预估等级(或上调一档);拆解粒度建议更细,避免单个任务负载过重。',
  'dependency-blocked': '派单前先梳理依赖链并预留阻塞缓冲;关键路径任务应提前解耦或并行化,减少等待前置的时间损耗。',
  'requirement-change': '开工前与队长对齐验收标准;需求中途变更时及时在 update_task 中记录,便于复盘时区分范围膨胀与执行问题。',
  'member-efficiency': '为成员建立常用模式/模板沉淀(工具链、代码片段、检查清单),减少重复性摸索;超负载成员应优先减负。',
  environment: '优先修复或规避环境问题(工具链/网络/权限);派单时把环境准备作为独立前置任务,避免计入执行耗时。',
  on_time: '同类任务下次可按同等级预估;若实际明显低于本档区间,可考虑下调一档预估。',
  other: '建议在复盘时补充具体原因(retro_note),形成团队可复用的经验条目。',
}

/** 复盘原因的中文标签(复盘摘要/面板展示)。 */
export const RETRO_CAUSE_LABEL: Readonly<Record<TaskRetroCause, string>> = {
  underestimated: '任务被低估',
  'dependency-blocked': '依赖阻塞',
  'requirement-change': '需求变化',
  'member-efficiency': '成员效率',
  environment: '环境问题',
  on_time: '按时完成',
  other: '其他',
}

/** 按原因取推荐建议文案(队长 revised 校准改原因时重新生成)。 */
export function retroRecommendationFor(cause: TaskRetroCause): string {
  return CAUSE_RECOMMENDATION[cause]
}

/**
 * 自动生成一条任务复盘记录(复盘三层之服务端自动主体)。
 *
 * 原因分类优先取显式传入的 `cause`(update_task 的 retro_cause);未声明时按
 * 数字推导:cancelled → other(不推经验);超预算(overran) → underestimated;
 * 按时完成(实际 ≤ 预算) → on_time;无预算 → other。
 *
 * @param facts - 任务的耗时事实(至少需要实际耗时)。
 * @param cause - 显式原因分类(可选)。
 * @param now - 生成时间戳。
 */
export function buildTaskRetro(facts: RetroTaskFacts, cause?: TaskRetroCause, now = Date.now()): TaskRetro {
  const timing = resolveTaskTiming(facts, now)
  const estimatedMs = facts.estimatedMs
  const estimateLevel = facts.estimateLevel
  const budget = estimateBudgetMs(estimateLevel, estimatedMs)
  const overran = budget !== undefined && timing.actualMs !== undefined && timing.actualMs > budget
  const cancelled = facts.status === 'cancelled'
  const resolvedCause: TaskRetroCause = cause !== undefined && TASK_RETRO_CAUSES.includes(cause)
    ? cause
    : cancelled
      ? 'other'
      : overran
        ? 'underestimated'
        : budget !== undefined
          ? 'on_time'
          : 'other'
  const actualText = timing.actualMs !== undefined ? formatDuration(timing.actualMs) : '未知'
  const levelText = estimateLevel !== undefined
    ? `${estimateLevel}(${ESTIMATE_LEVEL_RANGES[estimateLevel].label})`
    : estimatedMs !== undefined ? formatDuration(estimatedMs) : '未预估'
  const deviation = timing.actualMs !== undefined && estimatedMs !== undefined
    ? timing.actualMs > estimatedMs
      ? `超出预估 ${formatDuration(timing.actualMs - estimatedMs)}`
      : `提前 ${formatDuration(estimatedMs - timing.actualMs)}`
    : undefined
  const levelDeviation = estimateLevel !== undefined && timing.actualMs !== undefined
    ? estimateLevelDeviation(timing.actualMs, estimateLevel)
    : undefined
  const boundaries = [
    facts.includesGateWait === true ? '含等待' : null,
    facts.hasHelper === true ? '有 helper 介入' : null,
  ].filter((part): part is string => part !== null)
  const boundaryText = boundaries.length > 0 ? `(${boundaries.join(' · ')})` : ''
  const summary = overran
    ? `任务超时完成:实际 ${actualText},预估 ${levelText}${deviation !== undefined ? `(${deviation})` : ''},超过预估预算${boundaryText}。`
    : timing.actualMs !== undefined && budget !== undefined
      ? `任务按预期完成:实际 ${actualText},预估 ${levelText}${deviation !== undefined ? `(${deviation})` : ''}${boundaryText}。`
      : `任务完成:实际耗时 ${actualText}${estimatedMs !== undefined || estimateLevel !== undefined ? `,预估 ${levelText}` : '(未设预估)'}${boundaryText}。`
  // cancelled:记耗时不强推经验 —— recommendation 留空,不入经验库。
  const recommendation = cancelled ? '' : CAUSE_RECOMMENDATION[resolvedCause]
  return {
    attempt: facts.attempt ?? 0,
    actualMs: timing.actualMs ?? 0,
    ...estimateLevel !== undefined ? { estimateLevel } : {},
    ...estimatedMs !== undefined ? { estimatedMs } : {},
    ...timing.overrunMs !== undefined ? { overrunMs: timing.overrunMs } : {},
    ...levelDeviation !== undefined ? { levelDeviation } : {},
    overran,
    cause: resolvedCause,
    summary,
    ...facts.retroNote !== undefined && facts.retroNote.trim() !== '' ? { retroNote: facts.retroNote.trim() } : {},
    recommendation,
    ...facts.includesGateWait === true ? { includesGateWait: true } : {},
    ...facts.hasHelper === true ? { hasHelper: true } : {},
    createdAt: now,
  }
}

/** 团队校准统计中的单角色×等级条目。 */
export interface RoleLevelTimingStat {
  readonly role: string
  readonly level: string
  readonly taskCount: number
  /** 该 (role, level) 组已完成任务的平均实际耗时(ms)。 */
  readonly avgActualMs?: number
  /** 该组超预算任务占比,0..1。 */
  readonly overrunRatio?: number
}

/** 团队级复盘校准统计(自成长闭环:反哺队长后续派单)。 */
export interface TeamRetroSummary {
  /** 已完成且有耗时结算的任务数。 */
  readonly completedWithTiming: number
  /** 已完成且超预算的任务数。 */
  readonly overranCount: number
  /** 全部已结算任务的平均实际耗时(ms);无数据时为 undefined。 */
  readonly avgActualMs?: number
  /** 全部有预估任务的超预算占比,0..1;无数据时为 undefined。 */
  readonly overallOverrunRatio?: number
  /** 按角色 × 预估等级统计(校准预估的核心口径)。 */
  readonly byRoleLevel: readonly RoleLevelTimingStat[]
  /** 兼容视图:按角色统计(不再拆分等级)。 */
  readonly byRole: readonly RoleTimingStat[]
}

/** 团队校准统计中的单角色条目(兼容旧口径)。 */
export interface RoleTimingStat {
  readonly role: string
  readonly taskCount: number
  readonly avgActualMs?: number
  readonly overrunRatio?: number
}

/**
 * 汇总团队已完成任务的耗时复盘,输出队长可用的校准数据。
 * 只读、纯函数;只统计已完成且具备实际耗时的任务。角色取成员 role 字段,
 * 未提供成员名单(或成员已移除)时回退为任务 assignee 姓名。
 */
export function summarizeTeamRetro(
  tasks: readonly TeamTask[],
  members: readonly TeamMember[] = [],
): TeamRetroSummary {
  const roleByName = new Map(members
    .filter(member => member.role !== undefined && member.role !== '')
    .map(member => [member.name, member.role ?? '']))
  const settled = tasks.filter(task =>
    task.status === 'completed' && task.actualMs !== undefined && task.claimedAt !== undefined)
  const withEstimate = settled.filter(task =>
    estimateBudgetMs(task.estimateLevel, task.estimatedMs) !== undefined)
  const overran = withEstimate.filter(task =>
    taskOverran(task.estimateLevel, task.estimatedMs, task.actualMs))

  const byRoleLevelMap = new Map<string, { role: string; level: string; count: number; actualSum: number; withEstimate: number; overran: number }>()
  const byRoleMap = new Map<string, { count: number; actualSum: number; withEstimate: number; overran: number }>()
  for (const task of settled) {
    const role = roleByName.get(task.assignee ?? '') ?? roleOf(task.assignee ?? '')
    const hasEstimate = estimateBudgetMs(task.estimateLevel, task.estimatedMs) !== undefined
    const isOverran = taskOverran(task.estimateLevel, task.estimatedMs, task.actualMs)
    const roleEntry = byRoleMap.get(role) ?? { count: 0, actualSum: 0, withEstimate: 0, overran: 0 }
    roleEntry.count += 1
    roleEntry.actualSum += task.actualMs ?? 0
    if (hasEstimate) {
      roleEntry.withEstimate += 1
      if (isOverran) roleEntry.overran += 1
    }
    byRoleMap.set(role, roleEntry)

    const level = task.estimateLevel ?? (task.estimatedMs !== undefined ? 'ms' : '-')
    const key = `${role}\u0000${level}`
    const entry = byRoleLevelMap.get(key) ?? { role, level, count: 0, actualSum: 0, withEstimate: 0, overran: 0 }
    entry.count += 1
    entry.actualSum += task.actualMs ?? 0
    if (hasEstimate) {
      entry.withEstimate += 1
      if (isOverran) entry.overran += 1
    }
    byRoleLevelMap.set(key, entry)
  }

  const byRoleLevel: RoleLevelTimingStat[] = [...byRoleLevelMap.values()]
    .sort((left, right) => left.role.localeCompare(right.role, 'zh-CN') || left.level.localeCompare(right.level))
    .map(entry => ({
      role: entry.role,
      level: entry.level,
      taskCount: entry.count,
      ...entry.count > 0 ? { avgActualMs: Math.round(entry.actualSum / entry.count) } : {},
      ...entry.withEstimate > 0 ? { overrunRatio: entry.overran / entry.withEstimate } : {},
    }))

  const byRole: RoleTimingStat[] = [...byRoleMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
    .map(([role, entry]) => ({
      role,
      taskCount: entry.count,
      ...entry.count > 0 ? { avgActualMs: Math.round(entry.actualSum / entry.count) } : {},
      ...entry.withEstimate > 0 ? { overrunRatio: entry.overran / entry.withEstimate } : {},
    }))

  const avgActualMs = settled.length > 0
    ? Math.round(settled.reduce((sum, task) => sum + (task.actualMs ?? 0), 0) / settled.length)
    : undefined
  const overallOverrunRatio = withEstimate.length > 0 ? overran.length / withEstimate.length : undefined

  return {
    completedWithTiming: settled.length,
    overranCount: overran.length,
    ...avgActualMs !== undefined ? { avgActualMs } : {},
    ...overallOverrunRatio !== undefined ? { overallOverrunRatio } : {},
    byRoleLevel,
    byRole,
  }
}

/** 生成一条面向队长的复盘校准提示(自成长闭环的可读输出)。
 * 冷启动守卫:已结算样本 <2 时不出校准结论(方向决策 7)。 */
export function retroCalibrationHint(summary: TeamRetroSummary): string {
  if (summary.completedWithTiming === 0) {
    return '样本不足,暂不输出校准结论 —— 先为任务填写预估等级(estimate_level)并完成一轮执行,再校准预估。'
  }
  if (summary.completedWithTiming < 2) {
    return '样本不足(仅 1 个已结算任务),暂不输出校准结论 —— 先收集展示、再变聪明。'
  }
  const avg = summary.avgActualMs !== undefined ? formatDuration(summary.avgActualMs) : '未知'
  const ratio = summary.overallOverrunRatio !== undefined
    ? `超预算率 ${Math.round(summary.overallOverrunRatio * 100)}%`
    : '无预估任务,无法计算超预算率'
  const parts = [`团队已完成 ${summary.completedWithTiming} 个任务,平均实际耗时 ${avg},${ratio}。`]
  for (const entry of summary.byRoleLevel) {
    if (entry.taskCount === 0) continue
    const roleAvg = entry.avgActualMs !== undefined ? formatDuration(entry.avgActualMs) : '未知'
    const roleRatio = entry.overrunRatio !== undefined
      ? `超预算率 ${Math.round(entry.overrunRatio * 100)}%`
      : '无预估'
    parts.push(`「${entry.role} × ${entry.level}」${entry.taskCount} 个任务,平均 ${roleAvg},${roleRatio}。`)
  }
  if (summary.overranCount > 0) {
    parts.push(`有 ${summary.overranCount} 个任务超预算,建议下次派单按该 (角色×等级) 的实际耗时上调一档预估。`)
  }
  return parts.join(' ')
}

/** 成员角色回退:队长保持 captain,其余按姓名(无成员名单时的兜底)。 */
function roleOf(assignee: string): string {
  if (assignee === '' || assignee === 'captain') return 'captain'
  return assignee
}

/** 兼容导出:旧 buildTaskRetro 的 attempt 默认值。 */
export type { RetroCaptainVerdict }
