import { z } from 'zod';
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
import type { TeamMemberSnapshot, TeamMessageSnapshot, TeamTaskSnapshot } from './agent-team-types.js';
import type { AgentTeamMemberLoadView, AgentTeamMemberView, AgentTeamMessageRiskView, AgentTeamMessageView, AgentTeamQuickFiltersView, AgentTeamTaskInsightView, AgentTeamTaskView, AgentTeamTimelineEntryView, AgentTeamTimelineSummaryView, AgentTeamView } from './contract.js';
export { timelineMilestonesView } from './timeline-milestones.js';
export { commandPlanView } from './commands.js';
export { dependencyDagView } from './dependency-dag.js';
/** One committed Team event, retained as a bounded timeline history entry. */
export interface AgentTeamHistoryEntry {
    readonly id: string;
    readonly seq: number;
    readonly time: number;
    readonly kind: 'member' | 'task' | 'message';
    readonly type: string;
    readonly title: string;
    readonly detail: string;
    readonly tone: 'neutral' | 'good' | 'warn' | 'danger';
    /** Stable entity key (member/task/message id) used for coalescing. */
    readonly entityKey?: string;
    /** Number of committed events coalesced into this entry. */
    readonly count?: number;
}
export interface AgentTeamProjectionState {
    readonly teamId: SessionId | null;
    readonly captainSessionId?: SessionId | null;
    readonly hasTeamEvents: boolean;
    readonly members: Record<string, TeamMemberSnapshot>;
    readonly tasks: Record<string, TeamTaskSnapshot>;
    readonly messages: Record<string, TeamMessageSnapshot>;
    readonly delivered: Record<string, true>;
    readonly history: AgentTeamHistoryEntry[];
}
export declare function initAgentTeamProjection(): AgentTeamProjectionState;
export declare function applyAgentTeamEvent(state: AgentTeamProjectionState, event: SessionEvent): AgentTeamProjectionState;
/** Count of tasks that transitively depend on the given task (risk propagation fan-out). */
export declare function dependencyDepthOf(taskId: string, tasks: readonly AgentTeamTaskView[]): number;
export declare function taskInsightView(task: AgentTeamTaskView, memberIds: ReadonlySet<string>, dependencyDepth: number): AgentTeamTaskInsightView;
export declare function messageRiskView(message: AgentTeamMessageView, failedTargets: ReadonlySet<string>): AgentTeamMessageRiskView;
export declare function quickFiltersView(tasks: readonly AgentTeamTaskView[], insights: readonly AgentTeamTaskInsightView[], memberLoads: readonly AgentTeamMemberLoadView[], messages: readonly AgentTeamMessageView[], messageRisks: readonly AgentTeamMessageRiskView[]): AgentTeamQuickFiltersView;
export declare function timelineView(members: readonly AgentTeamMemberView[], tasks: readonly AgentTeamTaskView[], messages: readonly AgentTeamMessageView[], history?: readonly AgentTeamHistoryEntry[]): AgentTeamTimelineEntryView[];
export declare function timelineSummaryView(timeline: readonly AgentTeamTimelineEntryView[]): AgentTeamTimelineSummaryView;
export declare function viewAgentTeam(state: AgentTeamProjectionState): AgentTeamView | null;
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionStateMap {
        agentTeam: AgentTeamProjectionState;
    }
}
export declare const agentTeamProjectionDefinition: {
    key: "agentTeam";
    stateSchema: z.ZodType<AgentTeamProjectionState, unknown, z.core.$ZodTypeInternals<AgentTeamProjectionState, unknown>>;
    init: typeof initAgentTeamProjection;
    apply: typeof applyAgentTeamEvent;
    wire: {
        viewSchema: z.ZodType<AgentTeamView | null, unknown, z.core.$ZodTypeInternals<AgentTeamView | null, unknown>>;
        view: typeof viewAgentTeam;
    };
    stateVersion: number;
};
//# sourceMappingURL=projection.d.ts.map