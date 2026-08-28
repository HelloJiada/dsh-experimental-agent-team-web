/**
 * Team activity snapshot assembly for the activity panel.
 *
 * Server-side assembly mirrors the Claude Code desktop teamWatcher: read the
 * durable team files (the truth source) and enrich with live subagent
 * activity, so the panel always reflects the on-disk state even when a model
 * skipped a tool "ritual" (e.g. not calling update_task on completion).
 * @module dsh-agent-team-web/snapshot
 */

import type { Context } from '@deepseek-ai/cordis'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { memberActivity } from './members.ts'
import { analyzeTeamSnapshot, type TeamIntelligence } from './intelligence.ts'
import { currentTaskElapsedApprox, currentTaskElapsedMs, retroPendingCalibration, summarizeTeamRetro } from './retro.ts'
import { readBestPractices } from './best-practices.ts'
import {
  CAPTAIN_KEY, listArchivedTeamIds, readArchivedTeam, readMailbox, readUnreadMailbox, readTeam,
  taskAwaitingInput, taskBlockedByReview, taskDepthsById, taskVisualState,
} from './state.ts'
import type { BestPracticeEntry } from './best-practices.ts'
import type { EstimateLevel, MemberStatus, TeamMember, TaskRetro, TaskSignals, TeamState, TeamTask } from './types.ts'

/** Visual task state for the activity panel. */
export type VisualTaskState = 'blocked' | 'open' | 'running' | 'completed'

/** One member row of the activity snapshot. */
export interface TeamActivityMember {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly status: MemberStatus
  readonly activity: 'working' | 'idle' | 'unknown'
  readonly progress: number
  readonly done: number
  readonly total: number
  readonly currentTask: string
  /** 当前进行中任务的已用耗时(ms);无当前任务或未记认领时间为 0。 */
  readonly currentTaskElapsedMs: number
  /** 已耗时为近似值(缺 claimedAt,以 updatedAt 回退推算;旧团队/跨版本升级)。 */
  readonly currentTaskElapsedApprox: boolean
  /** The id of a task this member is helping on, when any (self-organizing). */
  readonly helpingTask?: string
  readonly unread: number
}

/** One task row of the activity snapshot. */
export interface TeamActivityTask {
  readonly id: string
  readonly subject: string
  readonly status: string
  readonly state: VisualTaskState
  readonly assignee: string
  readonly dependencies: readonly string[]
  readonly depth: number
  /** Risk level when the captain set one (commissar gate). */
  readonly riskLevel?: string
  /** Milestone marker when set (commissar gate). */
  readonly milestone?: boolean
  /** True while the task is under the gate and has no `pass` verdict yet. */
  readonly reviewRequired?: boolean
  /** Latest commissar review record, when one exists. */
  readonly review?: {
    readonly reviewerName: string
    readonly verdict: 'pass' | 'reject'
    readonly comment?: string
    readonly reviewedAt: number
  }
  /** 中间态:完成被政委门禁拦截,等待 pass 复核(改进 4)。 */
  readonly blockedByReview?: boolean
  /** 中间态:等待队长/成员提供输入(改进 4)。 */
  readonly awaitingInput?: boolean
  /** Helper member currently pushing this task forward (ownership unchanged). */
  readonly helper?: string
  /** 预估工作量等级(对外口径,自成长)。 */
  readonly estimateLevel?: EstimateLevel
  /** 预估耗时(ms);create_task 时队长填写(自成长)。 */
  readonly estimatedMs?: number
  /** 认领时间(自成长)。 */
  readonly claimedAt?: number
  /** 开工时间(自成长)。 */
  readonly startedAt?: number
  /** 终结时间(自成长)。 */
  readonly completedAt?: number
  /** 实际耗时(ms)(自成长)。 */
  readonly actualMs?: number
  /** 实际 - 预估 偏差(ms)(自成长)。 */
  readonly overrunMs?: number
  /** 产出信号(自成长,L1)。 */
  readonly signals?: TaskSignals
  /** 复盘记录(终结时自动生成,自成长)。 */
  readonly retro?: TaskRetro
  /** 复盘质量闭环:high/critical 任务已终结生成 retro,但无成员经验且无队长
   * 校准(待校准)。派生自 retroPendingCalibration,快照只透出 true。 */
  readonly pendingCalibration?: boolean
}

/** One captain-inbox preview row. */
export interface TeamActivityMessage {
  readonly from: string
  readonly content: string
}

/** The full panel payload for one team. */
export interface TeamActivitySnapshot {
  readonly workspace: string
  readonly teamId: string
  readonly name: string
  readonly description?: string
  readonly captainSessionId: string
  readonly members: readonly TeamActivityMember[]
  readonly tasks: readonly TeamActivityTask[]
  readonly messageCount: number
  readonly captainInbox: readonly TeamActivityMessage[]
  /** 融合分析层输出(健康/优先级/负载/风险/里程碑/命令建议)。 */
  readonly intelligence?: TeamIntelligence
  /** 自成长:全局经验库最近条目(面板自成长区块)。 */
  readonly bestPractices?: readonly BestPracticeEntry[]
  /** 自成长:本团队已完成任务的 (角色×等级) 校准统计。 */
  readonly calibration?: TeamCalibrationView
}

/** 自成长校准统计的快照视图(面板展示用,复用 retro.ts 纯函数)。 */
export interface TeamCalibrationView {
  readonly completedWithTiming: number
  readonly byRoleLevel: readonly {
    readonly role: string
    readonly level: string
    readonly taskCount: number
    readonly avgActualMs?: number
    readonly overrunRatio?: number
  }[]
}

/** Snapshot projection switches for live and archived teams. */
export interface TeamSnapshotOptions {
  /** Historic review must retain members that were marked removed at shutdown. */
  readonly includeRemoved?: boolean
  /** Archived teams have no meaningful live activity after their sessions stop. */
  readonly historic?: boolean
}

/** The current task of a member: its first unfinished owned task. */
function currentTaskOf(memberName: string, tasks: readonly TeamTask[]): string {
  for (const task of tasks) {
    if (task.status === 'in_progress' && task.assignee === memberName) return task.id
  }
  return ''
}

/** 转义正则特殊字符,用于任务 id 的边界匹配。 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * R-32/F-14:toolCalls 派生扫描窗口上限——每个邮箱最多读最近 N 条消息。
 * 旧实现读整个邮箱全文并做 O(消息×任务) 正则匹配,长邮箱/大团队下开销
 * 随面板轮询放大;taskCalls 只是"是否被提及"的近似信号,最近窗口已足够,
 * 且任务 id 递增(t1,t2,…)尾部消息即最新进展。
 */
const MAX_TOOLCALL_SCAN_MESSAGES = 100

/**
 * 产出信号 toolCalls 的服务端可观测近似:扫描团队全部邮箱(captain + 成员),
 * 统计提及任务 id(词边界)或任务标题的消息条数。读取时派生,不落盘。
 * R-32:只扫描每个邮箱最近 {@link MAX_TOOLCALL_SCAN_MESSAGES} 条消息,
 * 并在所有任务都已被提及后提前结束(避免长邮箱 + 大团队的全量 O(邮箱×任务)
 * 扫描随面板轮询放大)。
 */
async function deriveTaskToolCalls(
  ctx: Context,
  stateRoot: string,
  teamId: string,
  roster: readonly TeamMember[],
  tasks: readonly TeamTask[],
): Promise<ReadonlyMap<string, number>> {
  const counts = new Map<string, number>()
  if (tasks.length === 0) return counts
  // 任务 id/标题 的边界正则(预编译,避免每条消息重复构造)。
  const needles = tasks.map(task => ({
    id: task.id,
    idPattern: new RegExp(`\\b${escapeRegex(task.id)}\\b`, 'u'),
    subject: task.subject.trim(),
  }))
  // 已提及任务集合:全部提及后即可停止扫描(计数只会更多,不会更少)。
  const mentioned = new Set<string>()
  const agents = [CAPTAIN_KEY, ...roster.map(member => member.name)]
  for (const agent of agents) {
    if (mentioned.size >= tasks.length) break
    try {
      const mailbox = await readMailbox(stateRoot, teamId, agent)
      for (const message of mailbox.slice(-MAX_TOOLCALL_SCAN_MESSAGES)) {
        if (mentioned.size >= tasks.length) break
        const text = `${message.from} ${message.to} ${message.content}`
        for (const needle of needles) {
          const hit = needle.idPattern.test(text)
            || (needle.subject.length >= 4 && text.includes(needle.subject))
          if (hit) {
            counts.set(needle.id, (counts.get(needle.id) ?? 0) + 1)
            mentioned.add(needle.id)
          }
        }
      }
    } catch (error: unknown) {
      ctx.logger.warn(`agent-team-web: mailbox read failed for ${agent} (toolCalls derivation): ${String(error)}`)
    }
  }
  return counts
}

/**
 * Assemble one team snapshot from its durable files plus live activity.
 * @param ctx - the plugin context (injects `subagents`, used for activity).
 * @param stateRoot - resolved absolute state root of the owning workspace.
 * @param workspace - display name of the owning workspace.
 * @param state - the durable team record.
 * @returns the panel snapshot.
 */
export async function assembleTeamSnapshot(
  ctx: Context,
  stateRoot: string,
  workspace: string,
  state: TeamState,
  options: TeamSnapshotOptions = {},
): Promise<TeamActivitySnapshot> {
  const tasks = state.tasks
  const depths = taskDepthsById(tasks)
  const roster = options.includeRemoved === true
    ? state.members
    : state.members.filter((member) => member.status !== 'removed')
  const activity = options.historic === true
    ? new Map<string, 'running' | 'idle' | 'ready'>()
    : memberActivity(ctx, roster.map((member) => member.id))
  const unreadByMember = new Map<string, number>()
  for (const member of roster) {
    try {
      unreadByMember.set(member.name, (await readUnreadMailbox(stateRoot, state.id, member.name)).length)
    } catch (error: unknown) {
      ctx.logger.warn(`agent-team-web: mailbox read failed for ${member.name}: ${String(error)}`)
      unreadByMember.set(member.name, 0)
    }
  }
  const mapMember = (member: TeamState['members'][number]): TeamActivityMember => {
    const owned = tasks.filter((task) => task.assignee === member.name)
    const done = owned.filter((task) => task.status === 'completed').length
    return {
      id: member.id,
      name: member.name,
      role: member.role ?? '',
      status: member.status,
      activity: options.historic === true
        ? 'idle'
        : member.id !== ''
          ? (activity.get(member.id) === 'running'
              ? 'working'
              : activity.get(member.id) === 'idle' || activity.get(member.id) === 'ready'
                ? 'idle'
                : 'unknown')
          : 'unknown',
      progress: owned.length === 0 ? 0 : Math.round((done / owned.length) * 100),
      done,
      total: owned.length,
      currentTask: currentTaskOf(member.name, tasks),
      // 面板"当前任务已耗时":以磁盘为准源,实时快照按当前时刻计算。
      // 缺 claimedAt 的旧任务以 updatedAt 近似,并标记近似标志供面板提示。
      currentTaskElapsedMs: currentTaskElapsedMs(member.name, tasks, Date.now()),
      currentTaskElapsedApprox: currentTaskElapsedApprox(member.name, tasks),
      helpingTask: tasks.find(task => task.helper === member.name
        && task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled')?.id,
      unread: unreadByMember.get(member.name) ?? 0,
    }
  }
  const members: TeamActivityMember[] = roster.map(mapMember)
  const captainInbox = await readUnreadMailbox(stateRoot, state.id, CAPTAIN_KEY)
  const toolCalls = await deriveTaskToolCalls(ctx, stateRoot, state.id, state.members, tasks)
  const bestPractices = await readBestPractices(stateRoot)
  const calibration = summarizeTeamRetro(tasks, state.members)
  const base: TeamActivitySnapshot = {
    workspace,
    teamId: state.id,
    name: state.name,
    ...state.description !== undefined ? { description: state.description } : {},
    captainSessionId: state.captainSessionId,
    members,
    tasks: tasks.map((task) => {
      // 读取时派生 toolCalls(服务端可观测近似),并入信号。
      const calls = toolCalls.get(task.id)
      const signals = task.signals !== undefined && calls !== undefined && calls > 0
        ? { ...task.signals, toolCalls: calls }
        : task.signals
      return {
        id: task.id,
        subject: task.subject,
        status: task.status,
        state: taskVisualState(task.status, task.dependencies, tasks),
        assignee: task.assignee ?? '',
        dependencies: task.dependencies,
        depth: depths.get(task.id) ?? 0,
        ...task.riskLevel !== undefined ? { riskLevel: task.riskLevel } : {},
        ...task.milestone === true ? { milestone: true } : {},
        ...task.reviewRequired === true && task.review?.verdict !== 'pass'
          ? { reviewRequired: true }
          : {},
        // 改进 4:透出任务中间态(等待政委复核 / 等待输入),供面板标记。
        ...taskBlockedByReview(task) ? { blockedByReview: true } : {},
        ...taskAwaitingInput(task) ? { awaitingInput: true } : {},
        ...task.review === undefined ? {} : {
          review: {
            reviewerName: task.review.reviewerName,
            verdict: task.review.verdict,
            ...task.review.comment !== undefined ? { comment: task.review.comment } : {},
            reviewedAt: task.review.reviewedAt,
          },
        },
        ...task.helper !== undefined ? { helper: task.helper } : {},
        ...task.estimateLevel !== undefined ? { estimateLevel: task.estimateLevel } : {},
        ...task.estimatedMs !== undefined ? { estimatedMs: task.estimatedMs } : {},
        ...task.claimedAt !== undefined ? { claimedAt: task.claimedAt } : {},
        ...task.startedAt !== undefined ? { startedAt: task.startedAt } : {},
        ...task.completedAt !== undefined ? { completedAt: task.completedAt } : {},
        ...task.actualMs !== undefined ? { actualMs: task.actualMs } : {},
        ...task.overrunMs !== undefined ? { overrunMs: task.overrunMs } : {},
        ...signals !== undefined ? { signals } : {},
        ...task.retro !== undefined ? { retro: task.retro } : {},
        // 复盘质量闭环:high/critical 任务缺成员经验与队长校准 → 面板标「待校准」。
        ...retroPendingCalibration(task) ? { pendingCalibration: true } : {},
      }
    }),
    messageCount: captainInbox.length
      + members.reduce((count, member) => count + member.unread, 0),
    captainInbox: captainInbox.slice(-5).map((message) => ({
      from: message.from,
      content: message.content,
    })),
    ...bestPractices.length > 0 ? { bestPractices: bestPractices.slice(-8) } : {},
    calibration: {
      completedWithTiming: calibration.completedWithTiming,
      byRoleLevel: calibration.byRoleLevel.map(entry => ({
        role: entry.role,
        level: entry.level,
        taskCount: entry.taskCount,
        ...entry.avgActualMs !== undefined ? { avgActualMs: entry.avgActualMs } : {},
        ...entry.overrunRatio !== undefined ? { overrunRatio: entry.overrunRatio } : {},
      })),
    },
  }
  // 融合分析层:用含 removed 成员的完整视角计算,附加到面板快照。
  const analysisMembers = state.members.map(mapMember)
  const intelligence = analyzeTeamSnapshot({ ...base, members: analysisMembers })
  return { ...base, intelligence }
}

/**
 * Collect every team under the given workspace state roots.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs (resolved absolute roots).
 * @returns the snapshots in stable order (workspace, then team id).
 */
export async function collectTeamsActivity(
  ctx: Context,
  roots: readonly { workspace: string; stateRoot: string }[],
): Promise<TeamActivitySnapshot[]> {
  const snapshots: TeamActivitySnapshot[] = []
  for (const root of roots) {
    let entries
    try {
      entries = await readdir(root.stateRoot, { withFileTypes: true })
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue
      }
      throw error
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const state = await readTeam(root.stateRoot, entry.name)
        if (state === undefined) continue
        snapshots.push(await assembleTeamSnapshot(ctx, root.stateRoot, root.workspace, state))
      } catch {
        ctx.logger.warn(`agent-team-web: skipped unreadable team state "${entry.name}" in workspace "${root.workspace}"`)
      }
    }
  }
  return snapshots
}

/**
 * Collect every archived team under the given workspace state roots (the
 * `archive/` subdirectory of each state root). Used by the historic panel
 * path to restore full team detail after deletion.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs.
 * @returns the archived snapshots in stable order.
 */
export async function collectArchivedTeamsActivity(
  ctx: Context,
  roots: readonly { workspace: string; stateRoot: string }[],
): Promise<TeamActivitySnapshot[]> {
  const snapshots: TeamActivitySnapshot[] = []
  for (const root of roots) {
    for (const teamId of await listArchivedTeamIds(root.stateRoot)) {
      try {
        const state = await readArchivedTeam(root.stateRoot, teamId)
        if (state === undefined) continue
        snapshots.push(await assembleTeamSnapshot(
          ctx,
          join(root.stateRoot, 'archive'),
          root.workspace,
          state,
          { includeRemoved: true, historic: true },
        ))
      } catch {
        ctx.logger.warn(`agent-team-web: skipped unreadable archived team "${teamId}" in workspace "${root.workspace}"`)
      }
    }
  }
  return snapshots
}

/**
 * R-17/H-1: project one full snapshot for the HTTP `/state` route.
 *
 * The browser panel renders only display data; every field it never touches
 * is stripped unconditionally — inbox full text (only `messageCount` stays),
 * the cross-team best-practices library, the calibration table, message-risk
 * content, and the command plan. Session identifiers (`captainSessionId`,
 * member subagent ids) are kept **only** for the authenticated same-origin
 * panel (they drive member navigation and session discovery); anonymous
 * callers receive blanked ids so nothing sensitive leaves the host.
 * @param snapshot - the fully assembled snapshot.
 * @param authorized - whether the caller presented the valid boot token.
 * @returns the HTTP-safe projection.
 */
export function redactSnapshotForHttp(
  snapshot: TeamActivitySnapshot,
  authorized: boolean,
): TeamActivitySnapshot {
  return {
    ...snapshot,
    captainSessionId: authorized ? snapshot.captainSessionId : '',
    captainInbox: [],
    bestPractices: undefined,
    calibration: undefined,
    members: snapshot.members.map(member => (
      authorized ? member : { ...member, id: '' }
    )),
    intelligence: snapshot.intelligence === undefined ? undefined : {
      ...snapshot.intelligence,
      messageRisks: snapshot.intelligence.messageRisks.map(risk => ({ ...risk, content: '' })),
      commandPlan: {
        version: 1,
        total: 0,
        highPriorityCount: 0,
        mediumPriorityCount: 0,
        lowPriorityCount: 0,
        commands: [],
      },
    },
  }
}
