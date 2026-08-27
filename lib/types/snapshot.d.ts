/**
 * Team activity snapshot assembly for the activity panel.
 *
 * Server-side assembly mirrors the Claude Code desktop teamWatcher: read the
 * durable team files (the truth source) and enrich with live subagent
 * activity, so the panel always reflects the on-disk state even when a model
 * skipped a tool "ritual" (e.g. not calling update_task on completion).
 * @module dsh-agent-team-web/snapshot
 */
import type { Context } from '@deepseek-ai/cordis';
import { type TeamIntelligence } from './intelligence.ts';
import type { BestPracticeEntry } from './best-practices.ts';
import type { EstimateLevel, MemberStatus, TaskRetro, TaskSignals, TeamState } from './types.ts';
/** Visual task state for the activity panel. */
export type VisualTaskState = 'blocked' | 'open' | 'running' | 'completed';
/** One member row of the activity snapshot. */
export interface TeamActivityMember {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly status: MemberStatus;
    readonly activity: 'working' | 'idle' | 'unknown';
    readonly progress: number;
    readonly done: number;
    readonly total: number;
    readonly currentTask: string;
    /** 当前进行中任务的已用耗时(ms);无当前任务或未记认领时间为 0。 */
    readonly currentTaskElapsedMs: number;
    /** 已耗时为近似值(缺 claimedAt,以 updatedAt 回退推算;旧团队/跨版本升级)。 */
    readonly currentTaskElapsedApprox: boolean;
    /** The id of a task this member is helping on, when any (self-organizing). */
    readonly helpingTask?: string;
    readonly unread: number;
}
/** One task row of the activity snapshot. */
export interface TeamActivityTask {
    readonly id: string;
    readonly subject: string;
    readonly status: string;
    readonly state: VisualTaskState;
    readonly assignee: string;
    readonly dependencies: readonly string[];
    readonly depth: number;
    /** Risk level when the captain set one (commissar gate). */
    readonly riskLevel?: string;
    /** Milestone marker when set (commissar gate). */
    readonly milestone?: boolean;
    /** True while the task is under the gate and has no `pass` verdict yet. */
    readonly reviewRequired?: boolean;
    /** Latest commissar review record, when one exists. */
    readonly review?: {
        readonly reviewerName: string;
        readonly verdict: 'pass' | 'reject';
        readonly comment?: string;
        readonly reviewedAt: number;
    };
    /** Helper member currently pushing this task forward (ownership unchanged). */
    readonly helper?: string;
    /** 预估工作量等级(对外口径,自成长)。 */
    readonly estimateLevel?: EstimateLevel;
    /** 预估耗时(ms);create_task 时队长填写(自成长)。 */
    readonly estimatedMs?: number;
    /** 认领时间(自成长)。 */
    readonly claimedAt?: number;
    /** 开工时间(自成长)。 */
    readonly startedAt?: number;
    /** 终结时间(自成长)。 */
    readonly completedAt?: number;
    /** 实际耗时(ms)(自成长)。 */
    readonly actualMs?: number;
    /** 实际 - 预估 偏差(ms)(自成长)。 */
    readonly overrunMs?: number;
    /** 产出信号(自成长,L1)。 */
    readonly signals?: TaskSignals;
    /** 复盘记录(终结时自动生成,自成长)。 */
    readonly retro?: TaskRetro;
}
/** One captain-inbox preview row. */
export interface TeamActivityMessage {
    readonly from: string;
    readonly content: string;
}
/** The full panel payload for one team. */
export interface TeamActivitySnapshot {
    readonly workspace: string;
    readonly teamId: string;
    readonly name: string;
    readonly description?: string;
    readonly captainSessionId: string;
    readonly members: readonly TeamActivityMember[];
    readonly tasks: readonly TeamActivityTask[];
    readonly messageCount: number;
    readonly captainInbox: readonly TeamActivityMessage[];
    /** 融合分析层输出(健康/优先级/负载/风险/里程碑/命令建议)。 */
    readonly intelligence?: TeamIntelligence;
    /** 自成长:全局经验库最近条目(面板自成长区块)。 */
    readonly bestPractices?: readonly BestPracticeEntry[];
    /** 自成长:本团队已完成任务的 (角色×等级) 校准统计。 */
    readonly calibration?: TeamCalibrationView;
}
/** 自成长校准统计的快照视图(面板展示用,复用 retro.ts 纯函数)。 */
export interface TeamCalibrationView {
    readonly completedWithTiming: number;
    readonly byRoleLevel: readonly {
        readonly role: string;
        readonly level: string;
        readonly taskCount: number;
        readonly avgActualMs?: number;
        readonly overrunRatio?: number;
    }[];
}
/** Snapshot projection switches for live and archived teams. */
export interface TeamSnapshotOptions {
    /** Historic review must retain members that were marked removed at shutdown. */
    readonly includeRemoved?: boolean;
    /** Archived teams have no meaningful live activity after their sessions stop. */
    readonly historic?: boolean;
}
/**
 * Assemble one team snapshot from its durable files plus live activity.
 * @param ctx - the plugin context (injects `subagents`, used for activity).
 * @param stateRoot - resolved absolute state root of the owning workspace.
 * @param workspace - display name of the owning workspace.
 * @param state - the durable team record.
 * @returns the panel snapshot.
 */
export declare function assembleTeamSnapshot(ctx: Context, stateRoot: string, workspace: string, state: TeamState, options?: TeamSnapshotOptions): Promise<TeamActivitySnapshot>;
/**
 * Collect every team under the given workspace state roots.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs (resolved absolute roots).
 * @returns the snapshots in stable order (workspace, then team id).
 */
export declare function collectTeamsActivity(ctx: Context, roots: readonly {
    workspace: string;
    stateRoot: string;
}[]): Promise<TeamActivitySnapshot[]>;
/**
 * Collect every archived team under the given workspace state roots (the
 * `archive/` subdirectory of each state root). Used by the historic panel
 * path to restore full team detail after deletion.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs.
 * @returns the archived snapshots in stable order.
 */
export declare function collectArchivedTeamsActivity(ctx: Context, roots: readonly {
    workspace: string;
    stateRoot: string;
}[]): Promise<TeamActivitySnapshot[]>;
//# sourceMappingURL=snapshot.d.ts.map