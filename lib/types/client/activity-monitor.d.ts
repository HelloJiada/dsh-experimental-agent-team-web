/** Shared, demand-driven state for the AgentTeams browser monitor. */
import type { TeamIntelligence } from '../intelligence.ts';
/** One member row of a host snapshot. */
export interface ActivityMember {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly status?: 'idle' | 'working' | 'removed';
    readonly activity: 'working' | 'idle' | 'unknown';
    readonly progress: number;
    readonly done: number;
    readonly total: number;
    readonly currentTask: string;
    /** 当前进行中任务的已用耗时(ms);无当前任务为 0(自成长)。 */
    readonly currentTaskElapsedMs: number;
    /** 已耗时为近似值(缺 claimedAt,以 updatedAt 回退;旧团队/跨版本升级)。 */
    readonly currentTaskElapsedApprox: boolean;
    /** The id of a task this member is helping on, when any (self-organizing). */
    readonly helpingTask?: string;
    readonly unread: number;
}
/** One task row of a host snapshot. */
export interface ActivityTask {
    readonly id: string;
    readonly subject: string;
    readonly status: string;
    readonly state: 'blocked' | 'open' | 'running' | 'completed';
    readonly assignee: string;
    readonly dependencies: readonly string[];
    readonly depth: number;
    /** True while the task awaits a commissar `pass` (commissar gate). */
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
    readonly estimateLevel?: 'S' | 'M' | 'L';
    /** 预估耗时(ms)(自成长)。 */
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
    readonly signals?: {
        readonly turns?: number;
        readonly toolCalls?: number;
        readonly outputBytes: number;
        readonly selfReport?: string;
    };
    /** 复盘记录(自成长)。 */
    readonly retro?: {
        readonly attempt: number;
        readonly actualMs: number;
        readonly estimateLevel?: 'S' | 'M' | 'L';
        readonly estimatedMs?: number;
        readonly overrunMs?: number;
        readonly levelDeviation?: number;
        readonly overran: boolean;
        readonly cause: string;
        readonly summary: string;
        readonly retroNote?: string;
        readonly captainVerdict?: 'useful' | 'useless' | 'revised';
        readonly recommendation: string;
        readonly includesGateWait?: boolean;
        readonly hasHelper?: boolean;
        readonly createdAt: number;
    };
}
/** One captain-inbox preview row. */
export interface ActivityMessage {
    readonly from: string;
    readonly content: string;
}
/** One team snapshot (mirrors the host TeamActivitySnapshot). */
export interface ActivityTeam {
    readonly workspace: string;
    readonly teamId: string;
    readonly name: string;
    readonly description?: string;
    readonly captainSessionId: string;
    readonly members: readonly ActivityMember[];
    readonly tasks: readonly ActivityTask[];
    readonly messageCount: number;
    readonly captainInbox: readonly ActivityMessage[];
    /** 融合分析层输出(服务端快照附加)。 */
    readonly intelligence?: TeamIntelligence;
    /** 自成长:全局经验库最近条目。 */
    readonly bestPractices?: readonly {
        readonly id: string;
        readonly sourceTeamId: string;
        readonly sourceTaskId: string;
        readonly sourceTaskSubject: string;
        readonly role: string;
        readonly level?: 'S' | 'M' | 'L';
        readonly cause: string;
        readonly practice: string;
        readonly verdict: 'pending' | 'useful' | 'useless' | 'revised';
        readonly createdAt: number;
        readonly updatedAt: number;
    }[];
    /** 自成长:(角色×等级)校准统计。 */
    readonly calibration?: {
        readonly completedWithTiming: number;
        readonly byRoleLevel: readonly {
            readonly role: string;
            readonly level: string;
            readonly taskCount: number;
            readonly avgActualMs?: number;
            readonly overrunRatio?: number;
        }[];
    };
}
/** A successfully-created conversation card that currently needs updates. */
export interface ActivityMonitorTarget {
    readonly key: string;
    readonly sessionId: string;
    readonly teamId: string;
}
/** Latest shared response data for both the floater and conversation cards. */
export interface ActivitySnapshots {
    readonly teams: readonly ActivityTeam[];
    readonly archivedTeams: readonly ActivityTeam[];
}
/** Subscribe to the active monitor-target list (React external-store shape). */
export declare function subscribeActivityMonitorTargets(listener: () => void): () => void;
/** Read the stable active-target snapshot. */
export declare function getActivityMonitorTargetsSnapshot(): readonly ActivityMonitorTarget[];
/**
 * Register one successful AgentTeams card as a monitoring demand.
 *
 * The returned cleanup is reference-counted so multiple cards and React
 * StrictMode remounts cannot stop another card's monitor.
 */
export declare function monitorAgentTeam(sessionId: string, teamId: string): () => void;
/** Stop polling targets whose final archived snapshot has been captured. */
export declare function settleActivityMonitorTargets(keys: ReadonlySet<string>): void;
/** Subscribe to the shared live/archive snapshot. */
export declare function subscribeActivitySnapshots(listener: () => void): () => void;
/** Read the stable shared live/archive snapshot. */
export declare function getActivitySnapshotsSnapshot(): ActivitySnapshots;
/** Publish one or both successful state-route responses. */
export declare function updateActivitySnapshots(update: Partial<ActivitySnapshots>): void;
/** Poll cadence for the live host snapshot route. */
export declare const ACTIVITY_POLL_MS = 1000;
/**
 * Low-frequency probe cadence while a cardless discovery session still owns
 * no team. The probe keeps the panel able to pick up a team created later in
 * that session (e.g. a run_code-wrapped agent_teams_create) without turning
 * every ordinary session into a one-second filesystem scan.
 */
export declare const ACTIVITY_PROBE_MS = 5000;
/** Host route serving live and archived team snapshots. */
export declare const ACTIVITY_STATE_URL = "/plugins/agent-team-web/state";
interface ActivityFetchResponse {
    readonly ok: boolean;
    json(): Promise<unknown>;
}
/** Injectable browser primitives used by the poll controller and its tests. */
export interface ActivityPollingRuntime {
    /**
     * Current captain session to discover after a cold client/host restart.
     * This one-time scope restores teams whose older conversation log has no
     * AgentTeams card capable of registering an explicit monitor target.
     */
    readonly discoverySessionId?: string;
    readonly fetchState?: (url: string, init: {
        readonly cache: 'no-store';
        readonly signal: AbortSignal;
    }) => Promise<ActivityFetchResponse>;
    readonly schedule?: (callback: () => void, intervalMs: number) => unknown;
    readonly cancel?: (timer: unknown) => void;
    readonly publishSnapshots?: (update: Partial<ActivitySnapshots>) => void;
    readonly settleTargets?: (keys: ReadonlySet<string>) => void;
}
/** Handle returned by one current-session polling loop. */
export interface ActivityPollingController {
    /** The immediate first pass, exposed so offline verification can await it. */
    readonly firstTick: Promise<void>;
    /** Idempotently stop the timer and abort the current request. */
    stop(): void;
}
/**
 * Start the single polling loop for the current session's requested targets.
 *
 * With neither targets nor a discovery session this is deliberately inert.
 * Explicit card targets poll at the live cadence from the start. A discovery
 * session performs an immediate live+archive restore pass, then — while it
 * still owns no team — probes on a low-frequency cadence, so a team created
 * later in that session (e.g. a run_code-wrapped agent_teams_create) is
 * discovered without a manual reload, without turning every ordinary session
 * into a one-second filesystem scan. The moment a team for the discovery
 * session appears, the controller upgrades to the live one-second cadence for
 * the rest of its lifetime. The caller — the session view, which stops the
 * controller when the session is no longer current — bounds the lifetime, and
 * archive state is refreshed when a target or a previously discovered live
 * team disappears.
 */
export declare function startActivityPolling(monitorTargets: readonly ActivityMonitorTarget[], runtime?: ActivityPollingRuntime): ActivityPollingController;
export {};
//# sourceMappingURL=activity-monitor.d.ts.map