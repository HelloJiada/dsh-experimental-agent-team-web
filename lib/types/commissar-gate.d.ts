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
import type { Context } from '@deepseek-ai/cordis';
import type { TeamMember, TeamState, TeamTask } from './types.ts';
/** Whether a role string denotes the commissar oversight role (any spelling). */
export declare function isCommissarRole(role: string | undefined): boolean;
/** Whether a member record is an active (non-removed) commissar. */
export declare function isActiveCommissar(member: TeamMember | undefined): boolean;
/**
 * The completion gate: a task may only be marked `completed` when it needs no
 * review, or its latest review verdict is `pass`.
 * @param task - the task about to be completed.
 */
export declare function gateBlocksCompletion(task: TeamTask): boolean;
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
export declare function notifyCommissarPendingReview(ctx: Context, stateRoot: string, team: TeamState, task: TeamTask, signal: AbortSignal): Promise<boolean>;
//# sourceMappingURL=commissar-gate.d.ts.map