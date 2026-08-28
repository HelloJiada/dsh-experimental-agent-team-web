/**
 * Event-driven shared task scheduler.
 *
 * Claude Code teammates keep polling the shared task list after a turn. DSH
 * continuable agents instead expose explicit idle/running edges, so this
 * scheduler closes the same loop without keeping a polling turn alive: every
 * idle edge and every task-graph mutation attempts one atomic claim and wakes
 * the selected durable member. A resident member that becomes idle while it
 * still owns an open attempt is parked: only an explicit captain reassignment
 * may rotate that capability. Automatic retry is reserved for cold recovery,
 * when the durable owner is no longer resident in the live Agent registry.
 * @module dsh-agent-team-web/scheduler
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { TeamState, TeamTask } from './types.ts';
export interface SchedulerConfig {
    readonly stateDir: string;
    /** A member-owned open task is "stalled" (helppable) after this many ms. */
    readonly stallThresholdMs: number;
}
export interface TeamScheduler {
    /** Try to give every genuinely idle/ready member one unit of ready work. */
    kickTeam(workspace: string, teamId: string, captain?: Agent): Promise<void>;
    /** Try to flush fallback mail or give one member one ready task. */
    kickMember(workspace: string, teamId: string, memberName: string, captain?: Agent): Promise<void>;
}
/** The next ready task for one member: its assigned ready work first, then
 * any unassigned ready work. R-02: awaitingInput(待输入)任务不参与自动派单,
 * 等队长 input_answered 清除后才可派发(claim_task 同规则拦截)。 */
export declare function nextReadyTask(tasks: readonly TeamTask[], memberName: string): TeamTask | undefined;
/**
 * Whether a teammate's claimed/in-progress task is stalled enough for a
 * helper to push it forward — without transferring ownership. All conditions
 * must hold: non-terminal, owned by someone else (a live member, not the
 * captain), no helper yet, owner not actively running, owner did not
 * intentionally park this exact attempt, dependencies satisfied, and the task
 * has had no update for at least `stallThresholdMs`.
 */
export declare function isHelppableTask(task: TeamTask, team: TeamState, helperName: string, now: number, parkedAttempts: ReadonlyMap<string, string>, liveStatus: (memberId: string) => 'running' | 'idle' | undefined, stallThresholdMs: number): boolean;
/**
 * The next helppable task for one member: the oldest stalled teammate task
 * (by `updatedAt`), so the helper who comes free first takes the most urgent.
 * The commissar is never dispatched as a helper — independent oversight must
 * not execute the work it later gates (review independence).
 */
export declare function nextHelpTask(tasks: readonly TeamTask[], team: TeamState, helperName: string, now: number, parkedAttempts: ReadonlyMap<string, string>, liveStatus: (memberId: string) => 'running' | 'idle' | undefined, stallThresholdMs: number): TeamTask | undefined;
/** Install one scheduler and its member activity observer. */
export declare function installTeamScheduler(ctx: Context, config: SchedulerConfig): TeamScheduler;
//# sourceMappingURL=scheduler.d.ts.map