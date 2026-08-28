/**
 * Commissar gate: the hard host-side rule that high/critical risk and
 * milestone tasks may only be marked `completed` after an active commissar
 * member records a `pass` verdict (agent_teams_review_task).
 *
 * The gate is a pure state decision (`gateBlocksCompletion`) plus a
 * best-effort notification that wakes the commissar when a completion is
 * rejected. The status machine is untouched: a gated task simply stays
 * in_progress/claimed, which automatically keeps it out of `isTeamCloseable`.
 * @module dsh-agent-team-web/commissar-gate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { deliverToMember } from './members.ts'
import { appendMailbox, CAPTAIN_KEY, createMessage } from './state.ts'
import type { TeamMember, TeamMessage, TeamState, TeamTask } from './types.ts'

/** Whether a role string denotes the commissar oversight role (any spelling). */
export function isCommissarRole(role: string | undefined): boolean {
  if (role === undefined) return false
  const normalized = role.trim().toLowerCase()
  return normalized === 'commissar' || normalized === '政委' || normalized === '政治委员'
}

/** Whether a member record is an active (non-removed) commissar. */
export function isActiveCommissar(member: TeamMember | undefined): boolean {
  return member !== undefined && member.status !== 'removed' && isCommissarRole(member.role)
}

/**
 * The completion gate: a task may only be marked `completed` when it needs no
 * review, or its latest review verdict is `pass`.
 * @param task - the task about to be completed.
 */
export function gateBlocksCompletion(task: TeamTask): boolean {
  return task.reviewRequired === true && task.review?.verdict !== 'pass'
}

/**
 * Notify the active commissar that a task is waiting for gate review. Uses the
 * same two channels as `agent_teams_send_message`: a durable mailbox append
 * (always, so offline members still see it via agent_teams_status) plus a
 * best-effort live wake through the captain's continuable parent.
 *
 * R-26:拆成两段——`appendCommissarReviewNotice`(锁内,仅持久化,快)与
 * `wakeCommissarReview`(锁外,网络 live 唤醒)。本函数保留为组合版,
 * 供直接调用方/测试使用;工具侧在 update_task 门禁里只锁内 append,
 * 释放团队锁后再 wake,避免秒级 followup 阻塞同队所有工具。
 * @param ctx - the plugin context (injects `agents`).
 * @param stateRoot - resolved absolute state root directory.
 * @param team - the team record (membership authority).
 * @param task - the task waiting for review.
 * @param signal - caller cancellation, forwarded to the live delivery.
 * @returns whether an active commissar exists and was notified.
 */
export async function notifyCommissarPendingReview(
  ctx: Context,
  stateRoot: string,
  team: TeamState,
  task: TeamTask,
  signal: AbortSignal,
): Promise<boolean> {
  const notice = await appendCommissarReviewNotice(stateRoot, team, task)
  if (notice === undefined) return false
  await wakeCommissarReview(ctx, stateRoot, team, notice, signal)
  return true
}

/** 门禁通知的内容与目标(锁内 append 的产物,供锁外 wake 使用)。 */
export interface CommissarReviewNotice {
  readonly commissar: TeamMember
  readonly message: TeamMessage
}

/**
 * R-26:锁内持久化门禁通知——只写政委 mailbox(本地文件,快),不做网络调用。
 * 无活跃政委时返回 undefined(调用方按"无政委"处理)。
 */
export async function appendCommissarReviewNotice(
  stateRoot: string,
  team: TeamState,
  task: TeamTask,
): Promise<CommissarReviewNotice | undefined> {
  const commissar = team.members.find(isActiveCommissar)
  if (commissar === undefined) return undefined
  const message = createMessage(
    CAPTAIN_KEY,
    commissar.name,
    `门禁通知：任务 ${task.id}「${task.subject}」等待政委复核（risk=${task.riskLevel ?? '-'}${task.milestone === true ? ', milestone' : ''}）。请用 agent_teams_review_task 给出 verdict=pass|reject。`,
  )
  await appendMailbox(stateRoot, team.id, commissar.name, message)
  return { commissar, message }
}

/**
 * R-26:锁外 live 唤醒——把已持久化的门禁通知实时推给政委(网络,可能秒级)。
 * 失败静默:mailbox 已落盘,政委下次 status 仍能看到。
 */
export async function wakeCommissarReview(
  ctx: Context,
  stateRoot: string,
  team: TeamState,
  notice: CommissarReviewNotice,
  signal: AbortSignal,
): Promise<void> {
  const captain = ctx.agents.get(team.captainSessionId as SessionId)
  if (captain !== undefined && notice.commissar.id !== '') {
    await deliverToMember(ctx, captain, notice.commissar.id, `AgentTeams 门禁通知：\n\n${notice.message.content}`, signal)
  }
}
