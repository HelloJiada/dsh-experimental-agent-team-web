import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { TeamMessageId, TeamTaskId } from './agent-team-types.js';
export interface AgentTeamTimelineSummaryView {
    readonly totalEvents: number;
    readonly memberEvents: number;
    readonly taskEvents: number;
    readonly messageEvents: number;
    readonly coalescedEntries: number;
    readonly firstSeq: number | null;
    readonly lastSeq: number | null;
    readonly firstTime: number | null;
    readonly lastTime: number | null;
    readonly latestTitle: string | null;
}
export interface AgentTeamMilestoneWindowView {
    readonly windowId: string;
    readonly startSeq: number | null;
    readonly endSeq: number | null;
    readonly entryCount: number;
    readonly eventCount: number;
    readonly memberEvents: number;
    readonly taskEvents: number;
    readonly messageEvents: number;
    readonly headline: string;
    readonly headlineTone: 'neutral' | 'good' | 'warn' | 'danger';
}
export type AgentTeamMemberRole = 'lead' | 'teammate';
export type AgentTeamMemberPhase = 'provisioning' | 'active' | 'failed';
export type AgentTeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type AgentTeamTaskReadiness = 'ready' | 'blocked' | 'orphaned' | 'stalled' | 'failed' | 'cancelled';
export type AgentTeamTaskSeverity = 'low' | 'medium' | 'high';
export type AgentTeamMemberLoadLevel = 'idle' | 'focused' | 'stretched' | 'overloaded';
export type AgentTeamMessageRiskLevel = 'low' | 'medium' | 'high';
export type AgentTeamCommandKind = 'task:claim' | 'task:reassign' | 'task:unblock' | 'member:restart' | 'message:redeliver' | 'message:broadcast';
export interface AgentTeamMemberView {
    readonly id: SessionId;
    readonly name: string;
    readonly role: AgentTeamMemberRole;
    readonly phase: AgentTeamMemberPhase;
    readonly sessionId: SessionId;
}
export interface AgentTeamTaskView {
    readonly id: TeamTaskId;
    readonly subject: string;
    readonly description: string;
    readonly status: AgentTeamTaskStatus;
    readonly ownerId: SessionId | null;
    readonly blockedBy: TeamTaskId[];
    readonly writeScopes: string[];
    readonly revision: number;
}
export interface AgentTeamTaskInsightView {
    readonly taskId: TeamTaskId;
    readonly subject: string;
    readonly status: AgentTeamTaskStatus;
    readonly readiness: AgentTeamTaskReadiness;
    readonly reasons: string[];
    readonly severity: AgentTeamTaskSeverity;
    readonly ownerId: SessionId | null;
    readonly interventionPriority: number;
    readonly dependencyDepth: number;
}
export interface AgentTeamMemberLoadView {
    readonly memberId: SessionId;
    readonly memberName: string;
    readonly level: AgentTeamMemberLoadLevel;
    readonly activeTaskCount: number;
    readonly pendingOwnedTaskCount: number;
    readonly stalledTaskCount: number;
    readonly orphanedTaskCount: number;
}
export interface AgentTeamMessageView {
    readonly id: TeamMessageId;
    readonly senderId: SessionId;
    readonly senderName: string;
    readonly targetId: SessionId;
    readonly delivery: 'quiet' | 'wakeup';
    readonly content: ContentBlock[];
    readonly delivered: boolean;
}
export interface AgentTeamMessageRiskView {
    readonly messageId: TeamMessageId;
    readonly senderName: string;
    readonly targetId: SessionId;
    readonly delivery: 'quiet' | 'wakeup';
    readonly delivered: boolean;
    readonly riskLevel: AgentTeamMessageRiskLevel;
    readonly reasons: string[];
}
export interface AgentTeamFilterOption {
    readonly key: string;
    readonly label: string;
    readonly count: number;
}
export interface AgentTeamQuickFiltersView {
    readonly taskFilters: AgentTeamFilterOption[];
    readonly memberFilters: AgentTeamFilterOption[];
    readonly messageFilters: AgentTeamFilterOption[];
}
export interface AgentTeamTimelineEntryView {
    readonly id: string;
    readonly kind: 'member' | 'task' | 'message';
    readonly title: string;
    readonly detail: string;
    readonly tone: 'neutral' | 'good' | 'warn' | 'danger';
    readonly time?: number;
    readonly seq?: number;
    /** Number of committed events coalesced into this entry. */
    readonly count?: number;
}
export interface AgentTeamCommandSuggestion {
    readonly id: string;
    readonly kind: AgentTeamCommandKind;
    readonly label: string;
    readonly targetId: string;
    readonly targetLabel: string;
    readonly priority: 'low' | 'medium' | 'high';
    readonly rationale: string;
}
export interface AgentTeamCommandPlanView {
    readonly version: 1;
    readonly generatedFromTeamId: SessionId;
    readonly total: number;
    readonly highPriorityCount: number;
    readonly mediumPriorityCount: number;
    readonly lowPriorityCount: number;
    readonly commands: AgentTeamCommandSuggestion[];
}
export interface AgentTeamSummaryView {
    readonly memberCount: number;
    readonly failedMemberCount: number;
    readonly taskCount: number;
    readonly pendingTaskCount: number;
    readonly inProgressTaskCount: number;
    readonly completedTaskCount: number;
    readonly blockedTaskCount: number;
    readonly stalledTaskCount: number;
    readonly orphanedTaskCount: number;
    readonly readyTaskCount: number;
    readonly overloadedMemberCount: number;
    readonly messageCount: number;
    readonly undeliveredMessageCount: number;
    readonly wakeupMessageCount: number;
    readonly highRiskMessageCount: number;
    readonly healthScore: number;
    readonly statusLabel: string;
    readonly overview: string;
    readonly alerts: string[];
    readonly recommendedActions: string[];
    readonly captainBriefing: string[];
    readonly topInterventions: string[];
}
export interface AgentTeamView {
    readonly teamId: SessionId;
    readonly leadMemberId: SessionId;
    readonly members: AgentTeamMemberView[];
    readonly tasks: AgentTeamTaskView[];
    readonly messages: AgentTeamMessageView[];
    readonly blockedTasks: AgentTeamTaskView[];
    readonly activeTasks: AgentTeamTaskView[];
    readonly pendingTasks: AgentTeamTaskView[];
    readonly completedTasks: AgentTeamTaskView[];
    readonly stalledTasks: AgentTeamTaskView[];
    readonly orphanedTasks: AgentTeamTaskView[];
    readonly readyTasks: AgentTeamTaskView[];
    readonly taskInsights: AgentTeamTaskInsightView[];
    readonly memberLoads: AgentTeamMemberLoadView[];
    readonly messageRisks: AgentTeamMessageRiskView[];
    readonly quickFilters: AgentTeamQuickFiltersView;
    readonly timeline: AgentTeamTimelineEntryView[];
    readonly timelineSummary: AgentTeamTimelineSummaryView;
    readonly timelineMilestones: AgentTeamMilestoneWindowView[];
    readonly commandPlan: AgentTeamCommandPlanView;
    readonly summary: AgentTeamSummaryView;
}
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        agentTeam: AgentTeamView | null;
    }
}
//# sourceMappingURL=contract.d.ts.map