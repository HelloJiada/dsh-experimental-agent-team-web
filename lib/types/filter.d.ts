import type { AgentTeamMemberLoadView, AgentTeamMemberView, AgentTeamMessageRiskView, AgentTeamMessageView, AgentTeamTaskInsightView, AgentTeamTaskView, AgentTeamView } from './contract.js';
export type AgentTeamTaskFilterKey = 'all' | 'in_progress' | 'ready' | 'blocked' | 'stalled' | 'orphaned' | 'failed' | 'cancelled' | 'completed';
export type AgentTeamMemberFilterKey = 'all' | 'overloaded' | 'stretched' | 'focused' | 'idle';
export type AgentTeamMessageFilterKey = 'all' | 'undelivered' | 'high_risk' | 'wakeup' | 'quiet' | 'delivered';
export interface AgentTeamFilterState {
    readonly taskFilter: AgentTeamTaskFilterKey;
    readonly taskQuery: string;
    readonly memberFilter: AgentTeamMemberFilterKey;
    readonly memberQuery: string;
    readonly messageFilter: AgentTeamMessageFilterKey;
}
export declare function defaultAgentTeamFilterState(): AgentTeamFilterState;
export interface AgentTeamFilteredView {
    readonly tasks: AgentTeamTaskView[];
    readonly taskInsights: AgentTeamTaskInsightView[];
    readonly members: AgentTeamMemberView[];
    readonly memberLoads: AgentTeamMemberLoadView[];
    readonly messages: AgentTeamMessageView[];
    readonly messageRisks: AgentTeamMessageRiskView[];
    readonly displayedCount: number;
}
export declare function filterAgentTeam(view: AgentTeamView, state: AgentTeamFilterState): AgentTeamFilteredView;
//# sourceMappingURL=filter.d.ts.map