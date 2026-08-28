/**
 * Durable AgentTeams state types.
 *
 * A team is one directory under the state root holding `team.json` plus an
 * `inbox/` of per-agent JSONL mailboxes. Members are continuable subagents
 * whose durable child session ids are recorded in the team file, so a team
 * survives harness restarts.
 * @module dsh-agent-team-web/types
 */

/** Task lifecycle statuses in progression order. */
export type TaskStatus =
  | 'pending'
  | 'claimed'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** Statuses after which a task can no longer be claimed or worked on. */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['completed', 'failed', 'cancelled']

/** Task risk level, set by the captain at creation time. */
export type TaskRiskLevel = 'low' | 'medium' | 'high' | 'critical'

/**
 * 复盘原因分类(超时归因)。与 t1 设计一致:
 * 任务被低估 / 依赖阻塞 / 需求变化 / 成员效率 / 环境问题 / 按时完成 / 其他。
 * 方向决策:on_time 也沉淀经验;cancelled 记耗时但不推经验(归 other)。
 */
export type TaskRetroCause =
  | 'underestimated'
  | 'dependency-blocked'
  | 'requirement-change'
  | 'member-efficiency'
  | 'environment'
  | 'on_time'
  | 'other'

/** 全部允许的复盘原因(工具枚举与校验共用)。 */
export const TASK_RETRO_CAUSES: readonly TaskRetroCause[] = [
  'underestimated',
  'dependency-blocked',
  'requirement-change',
  'member-efficiency',
  'environment',
  'on_time',
  'other',
] as const

/**
 * 预估工作量等级(对外口径,方向决策 2)。
 * 队长 create_task 填 S/M/L;参考区间常量集中定义可调;estimatedMs 仅作内部换算。
 */
export type EstimateLevel = 'S' | 'M' | 'L'

/** 等级参考区间(分钟)与毫秒上限 —— 集中可调的唯一位置。 */
export const ESTIMATE_LEVEL_RANGES: Readonly<Record<EstimateLevel, {
  readonly maxMinutes: number
  readonly maxMs: number
  readonly label: string
}>> = {
  S: { maxMinutes: 15, maxMs: 15 * 60_000, label: '≤15m' },
  M: { maxMinutes: 45, maxMs: 45 * 60_000, label: '≤45m' },
  L: { maxMinutes: Number.POSITIVE_INFINITY, maxMs: Number.POSITIVE_INFINITY, label: '>45m' },
}

/** 等级顺序索引(S=0 / M=1 / L=2),用于等级偏差计算。 */
const ESTIMATE_LEVEL_ORDER: readonly EstimateLevel[] = ['S', 'M', 'L']

/** 等级的最大参考毫秒(超时判定基准)。 */
export function estimateLevelMaxMs(level: EstimateLevel): number {
  return ESTIMATE_LEVEL_RANGES[level].maxMs
}

/** 实际耗时落入的等级(S/M/L)。 */
export function estimateLevelOf(actualMs: number): EstimateLevel {
  if (actualMs <= ESTIMATE_LEVEL_RANGES.S.maxMs) return 'S'
  if (actualMs <= ESTIMATE_LEVEL_RANGES.M.maxMs) return 'M'
  return 'L'
}

/** 等级索引:0=S / 1=M / 2=L。 */
export function estimateLevelIndex(level: EstimateLevel): number {
  return ESTIMATE_LEVEL_ORDER.indexOf(level)
}

/**
 * 等级偏差:实际等级索引 − 预估等级索引(-1/0/+1 等)。
 * 如 S 预估 → 实际 M = +1 级;L 预估 → 实际 S = -2 级。
 */
export function estimateLevelDeviation(actualMs: number, estimatedLevel: EstimateLevel): number {
  return estimateLevelIndex(estimateLevelOf(actualMs)) - estimateLevelIndex(estimatedLevel)
}

/**
 * 任务产出信号:墙钟耗时之外的"做了多少事"证据,避免慢模型被误判卡住。
 * 服务端可观测近似(turns 增量落盘 / toolCalls 读取时派生 / outputBytes 终结落盘)
 * + 成员可选自报(selfReport,不强制)。
 */
export interface TaskSignals {
  /** 回合数近似:该任务 status 变更次数,update_task 每次状态变更增量 +1。 */
  readonly turns?: number
  /** 工具调用数近似:与该任务相关的团队消息数(按 taskId/subject 提及),快照装配时派生。 */
  readonly toolCalls?: number
  /** 输出量:output 长度(字符数),terminal 时写入。 */
  readonly outputBytes: number
  /** 成员可选自报补充(不强制),如"深挖了 1400 行 CSS"。 */
  readonly selfReport?: string
}

/** 队长对复盘/经验的校准结论(复盘三层之第三层)。 */
export type RetroCaptainVerdict = 'useful' | 'useless' | 'revised'

/** 单任务复盘记录:实际耗时/偏差/原因分类/最优方案(自成长沉淀)。
 * 每次任务 terminal(completed/failed/cancelled)生成一条,on_time 也沉淀。 */
export interface TaskRetro {
  /** 对应 task.attempt(attempt 级历史标识)。 */
  readonly attempt: number
  /** 实际耗时(ms)。 */
  readonly actualMs: number
  /** 预估等级(对外口径)。 */
  readonly estimateLevel?: EstimateLevel
  /** 预估耗时(ms);任务创建时未填预估毫秒则缺省。 */
  readonly estimatedMs?: number
  /** 偏差 = 实际 - 预估预算(ms);预算等级优先,仅预算存在时计算。 */
  readonly overrunMs?: number
  /** 等级偏差:实际等级 − 预估等级(-1/0/+1 等)。 */
  readonly levelDeviation?: number
  /** 是否超时:实际 > 预估区间上限(或 1.5×内部毫秒)。 */
  readonly overran: boolean
  /** 原因分类(自动归因或成员/队长声明)。 */
  readonly cause: TaskRetroCause
  /** 复盘摘要。 */
  readonly summary: string
  /** 成员可选填:一句话经验(bestPractice 原始素材)。 */
  readonly retroNote?: string
  /** 队长校准结论(useful=确认入库/useless=无效剔除/revised=改原因重新入库)。 */
  readonly captainVerdict?: RetroCaptainVerdict
  /** 最优方案建议(反哺队长后续派单)。 */
  readonly recommendation: string
  /** 生成时间戳。 */
  readonly createdAt: number
  /** 边界标注:true=任务曾被政委门禁等待;复盘注明「含等待」。 */
  readonly includesGateWait?: boolean
  /** 边界标注:true=曾有 helper 介入;复盘注明「有 helper 介入」。 */
  readonly hasHelper?: boolean
}

/** One commissar review verdict record (the latest verdict gates completion). */
export interface TaskReviewRecord {
  /** The commissar member's name. */
  readonly reviewerName: string
  readonly verdict: 'pass' | 'reject'
  readonly comment?: string
  readonly reviewedAt: number
}

/** One task of a team's task list. */
export interface TeamTask {
  /** Stable task id within the team (`t1`, `t2`, …). */
  id: string
  /** Brief title for the task. */
  subject: string
  /** What needs to be done. */
  description?: string
  status: TaskStatus
  /** Member name (or `captain`) the task is assigned to; unassigned tasks await a claim. */
  assignee?: string
  /** Task ids that must reach `completed` before this task can be claimed. */
  dependencies: string[]
  /** The worker's written result, set when the task completes or fails. */
  output?: string
  /** Monotonic execution generation. Reassignment/retry invalidates every older attempt. */
  attempt?: number
  /** Capability for the current claimed/in-progress attempt. Members must present it when updating. */
  attemptId?: string
  /** Opaque generation for a revocation/handoff that has not started its next attempt yet. */
  handoffId?: string
  /** A handoff is quiescing the old owner; the scheduler must not dispatch it yet. */
  reassigning?: boolean
  /** Commissar-gate risk level (captain-set at creation). */
  riskLevel?: TaskRiskLevel
  /** Final-milestone marker (captain-set at creation). */
  milestone?: boolean
  /** Derived gate flag: `riskLevel ∈ {high, critical}` or `milestone === true`.
   * Such tasks may only be marked `completed` after a commissar
   * `verdict === 'pass'` review record exists. */
  reviewRequired?: boolean
  /** Latest commissar review record (audit trail for the gate). */
  review?: TaskReviewRecord
  /** 中间态:任务完成被政委门禁拦截,等待 pass 复核(改进 4)。
   * update_task 的完成请求被门禁拦截时置位,政委 verdict=pass 后清除,
   * 任务进入终结状态时兜底清除。与派生的 reviewRequired 不同:它表示
   * "确实发生过一次被拦截的完成尝试",是比"门禁适用"更强的阻塞信号。 */
  blockedByReview?: boolean
  /** 中间态:任务等待队长/成员提供输入(改进 4)。
   * create_task 按任务描述中的待确认问题自动置位(见 descriptionAwaitingInput),
   * 快照读取时也按描述派生兜底,旧任务无需迁移即可识别。 */
  awaitingInput?: boolean
  /** Helper member currently pushing this task forward (ownership unchanged). */
  helper?: string
  /** When the current helper started helping (stall recovery bookkeeping). */
  helperSince?: number
  /** 本 attempt 内是否曾有 helper 介入(复盘 hasHelper 标注的持久化信号)。 */
  helperEver?: boolean
  /** 预估工作量等级(对外口径,create_task 填 S/M/L)。 */
  estimateLevel?: EstimateLevel
  /** 预估耗时(ms);队长 create_task 时可填,用于耗时追踪与超时警示。 */
  estimatedMs?: number
  /** 认领时间(activateTaskAttempt 时记录,每次新 attempt 重置)。 */
  claimedAt?: number
  /** 开工时间(update_task 进入 in_progress 时幂等记录)。 */
  startedAt?: number
  /** 终结时间(进入 completed/failed/cancelled 时记录,幂等)。 */
  completedAt?: number
  /** 实际耗时 = completedAt - claimedAt(ms)。 */
  actualMs?: number
  /** 实际 - 预估预算 偏差(ms);预算取等级优先口径(estimateBudgetMs),负值表示提前完成。 */
  overrunMs?: number
  /** 产出信号(服务端可观测近似 + 成员自报)。 */
  signals?: TaskSignals
  /** 超时归因复盘记录(终结时自动生成,可被 update_task 显式覆盖)。 */
  retro?: TaskRetro
  createdAt: number
  updatedAt: number
}

/** Member lifecycle status. */
export type MemberStatus = 'idle' | 'working' | 'removed'

/** One team member: a continuable subagent plus its team-side record. */
export interface TeamMember {
  /** Durable continuable subagent session id (empty until spawned). */
  id: string
  /** Unique display name inside the team. */
  name: string
  /** Role description, e.g. `researcher`, `engineer`, `reviewer`. */
  role?: string
  /** Resolved LLM provider route captured when this member was created. */
  provider?: string
  /** Resolved model captured when this member was created. */
  model?: string
  /** Resolved reasoning effort captured from the captain or target model default. */
  reasoningEffort?: string
  joinedAt: number
  status: MemberStatus
}

/** One mailbox message. */
export interface TeamMessage {
  id: string
  /** `captain` or a member name. */
  from: string
  /** `captain` or a member name. */
  to: string
  content: string
  ts: number
  /** Process-local delivery lease; prevents fallback and direct delivery racing. */
  deliveryClaimedAt?: number
  /** Set after the durable message was accepted by the recipient's live Harness inbox. */
  deliveredAt?: number
  /** Set once the recipient has consumed or been shown the durable fallback. */
  readAt?: number
}

/** The full durable team record. */
export interface TeamState {
  /** Original team name. */
  name: string
  /** Sanitized directory id; the team's stable identity. */
  id: string
  /** Team purpose/goal. */
  description?: string
  /** Session id of the captain agent that owns this team. */
  captainSessionId: string
  createdAt: number
  /** Teammates only; the captain is implicit (the owning session). */
  members: TeamMember[]
  tasks: TeamTask[]
  /** Monotonic task id counter. */
  taskSeq: number
}
