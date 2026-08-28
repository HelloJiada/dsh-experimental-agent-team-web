/**
 * 融合智能分析层 —— 我们原创的 AgentTeam 分析设计,适配到磁盘快照数据源。
 *
 * 消费 `TeamActivitySnapshot`(磁盘为真源 + 实时成员活动),推导:
 * 健康分 / P1-P3 优先干预 / 成员负载 / 消息风险 / 时间线里程碑 / 命令建议。
 * 纯函数、只读、JSON 可序列化,供活动面板与宿主消费层使用。
 *
 * @module agent-team-web/intelligence
 */
import type { TeamActivitySnapshot } from './snapshot.ts';
/** 任务就绪度(旧投影内核的 readiness 词汇,适配新内核)。 */
export type TeamTaskReadiness = 'blocked' | 'stalled' | 'ready' | 'orphaned' | 'failed' | 'cancelled' | 'completed';
/** 严重度 / 负载档位 / 风险档位 / 命令优先级。 */
export type TeamSeverity = 'high' | 'medium' | 'low';
export type TeamLoadLevel = 'overloaded' | 'stretched' | 'focused' | 'idle';
export type TeamRiskLevel = 'high' | 'medium' | 'low';
export type TeamCommandPriority = 'high' | 'medium' | 'low';
export type TeamCommandKind = 'task:claim' | 'task:reassign' | 'task:unblock' | 'member:restart' | 'message:redeliver' | 'message:broadcast';
/** 单任务洞察:就绪度 + 严重度 + 原因 + 干预优先级。 */
export interface TeamTaskInsight {
    readonly taskId: string;
    readonly subject: string;
    readonly status: string;
    readonly readiness: TeamTaskReadiness;
    readonly severity: TeamSeverity;
    readonly reasons: readonly string[];
    readonly assignee: string | null;
    readonly dependencyDepth: number;
    /** 1..n 按 interventionScore 排序;terminal 任务为 0。 */
    readonly interventionPriority: number;
}
/** 成员负载:进行中/待处理/停滞/悬空 四段计数 + 档位。 */
export interface TeamMemberLoad {
    readonly memberId: string;
    readonly memberName: string;
    readonly activeTaskCount: number;
    readonly pendingOwnedTaskCount: number;
    readonly stalledTaskCount: number;
    readonly orphanedTaskCount: number;
    readonly level: TeamLoadLevel;
}
/** 消息风险:来自队长收件箱 + 成员不可用性。 */
export interface TeamMessageRisk {
    readonly from: string;
    readonly content: string;
    readonly riskLevel: TeamRiskLevel;
    readonly reasons: readonly string[];
}
/** 团队健康:加权扣分 + 状态标签 + 概览 + 告警 + 建议动作。 */
export interface TeamHealthView {
    readonly score: number;
    readonly statusLabel: string;
    readonly overview: string;
    readonly alerts: readonly string[];
    readonly recommendedActions: readonly string[];
}
/** 时间线里程碑(轻量派生:最新已完成/进行中任务)。 */
export interface TeamMilestoneView {
    readonly latestTitle: string | null;
    readonly completedTaskCount: number;
    readonly runningTaskCount: number;
}
/** 命令建议(只读桥,供宿主执行层消费)。 */
export interface TeamCommandSuggestion {
    readonly id: string;
    readonly kind: TeamCommandKind;
    readonly label: string;
    readonly targetId: string;
    readonly targetLabel: string;
    readonly priority: TeamCommandPriority;
    readonly rationale: string;
}
/** 命令计划信封。 */
export interface TeamCommandPlan {
    readonly version: 1;
    readonly total: number;
    readonly highPriorityCount: number;
    readonly mediumPriorityCount: number;
    readonly lowPriorityCount: number;
    readonly commands: readonly TeamCommandSuggestion[];
}
/** 融合分析层的完整输出。 */
export interface TeamIntelligence {
    readonly health: TeamHealthView;
    readonly priorities: readonly TeamTaskInsight[];
    readonly memberLoads: readonly TeamMemberLoad[];
    readonly messageRisks: readonly TeamMessageRisk[];
    readonly milestones: TeamMilestoneView;
    readonly commandPlan: TeamCommandPlan;
}
/** 对一份团队快照做完整智能分析。纯函数,不改动快照。 */
export declare function analyzeTeamSnapshot(snapshot: TeamActivitySnapshot): TeamIntelligence;
//# sourceMappingURL=intelligence.d.ts.map