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
import type { TeamMember, TeamState, TeamTask } from './types.ts'

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
  const commissar = team.members.find(isActiveCommissar)
  if (commissar === undefined) return false
  const message = createMessage(
    CAPTAIN_KEY,
    commissar.name,
    `门禁通知：任务 ${task.id}「${task.subject}」等待政委复核（risk=${task.riskLevel ?? '-'}${task.milestone === true ? ', milestone' : ''}）。请用 agent_teams_review_task 给出 verdict=pass|reject。`,
  )
  await appendMailbox(stateRoot, team.id, commissar.name, message)
  const captain = ctx.agents.get(team.captainSessionId as SessionId)
  if (captain !== undefined && commissar.id !== '') {
    await deliverToMember(ctx, captain, commissar.id, `AgentTeams 门禁通知：\n\n${message.content}`, signal)
  }
  return true
}
