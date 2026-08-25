import type { AgentTeamMemberLoadView, AgentTeamTaskInsightView, AgentTeamTaskView, AgentTeamView } from '../contract.js';
export interface ActivityPanelOverview {
    readonly memberCount: number;
    readonly activeTaskCount: number;
    readonly blockedTaskCount: number;
    readonly healthScore: number;
    readonly statusLabel: string;
    readonly overview: string;
}
export interface ActivityPanelPriorityRow {
    readonly taskId: string;
    readonly subject: string;
    readonly status: AgentTeamTaskInsightView['status'];
    readonly readiness: AgentTeamTaskInsightView['readiness'];
    readonly severity: AgentTeamTaskInsightView['severity'];
    readonly reasons: readonly string[];
    readonly interventionPriority: number;
    readonly dependencyDepth: number;
}
export interface ActivityPanelMemberRow extends AgentTeamMemberLoadView {
}
export interface ActivityPanelTaskRow {
    readonly taskId: string;
    readonly subject: string;
    readonly status: AgentTeamTaskView['status'];
    readonly category: 'active' | 'blocked';
    readonly ownerId: AgentTeamTaskView['ownerId'];
    readonly readiness: AgentTeamTaskInsightView['readiness'] | null;
    readonly severity: AgentTeamTaskInsightView['severity'] | null;
    readonly reasons: readonly string[];
}
export interface ActivityPanelFallback {
    readonly state: 'healthy';
    readonly message: string;
}
export interface ActivityPanelView {
    readonly overview: ActivityPanelOverview;
    readonly priorities: readonly ActivityPanelPriorityRow[];
    readonly members: readonly ActivityPanelMemberRow[];
    readonly tasks: readonly ActivityPanelTaskRow[];
    readonly fallback: ActivityPanelFallback | null;
}
export declare function qualifiesForActivityPanel(team: AgentTeamView | null): boolean;
export declare function activityPanelView(team: AgentTeamView): ActivityPanelView;
//# sourceMappingURL=activity-panel-view.d.ts.map