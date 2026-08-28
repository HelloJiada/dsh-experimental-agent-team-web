/**
 * 调度器按角色能力建议任务分配(改进方向 3 —— 队长负载缓解)。
 *
 * 队长建任务/看状态时,由纯函数根据任务标题与描述推断合适角色
 * (调研类→researcher、实现类→engineer、验收类→qa、视觉类→designer、
 * 数据类→data),输出「任务→建议角色/成员」映射,供队长参考确认。
 *
 * 设计约束:
 * - 只建议、不派单:本模块不写状态、不触发认领;队长确认后仍走现有
 *   assignee 流程(保持队长决策权)。
 * - 纯函数、只读、无 I/O、确定性:同一输入永远同一输出,可单测。
 * - 关键词命中计数决定角色与置信度:命中 0 条 → 不推荐(null);
 *   命中 1/2/≥3 条 → low/medium/high。平票时按固定角色顺序取先者。
 *
 * @module dsh-agent-team-web/suggest
 */
/** 预设可建议的 6 个执行角色(与预设行为角色一一对应)。 */
export type SuggestedRole = 'researcher' | 'engineer' | 'qa' | 'designer' | 'data' | 'docs' | 'security';
/** 建议置信度:命中关键词条数 1/2/≥3 → low/medium/high。 */
export type SuggestionConfidence = 'low' | 'medium' | 'high';
/** 固定角色顺序:平票时先者胜(engineer 优先于 qa,researcher 优先于 data)。 */
export declare const SUGGESTED_ROLES: readonly SuggestedRole[];
/** 角色 key → 中文军职标题(展示用,与 client/roles 的军职表一致)。 */
export declare const ROLE_TITLES: Readonly<Record<SuggestedRole, string>>;
/** 单角色命中结果。 */
export interface RoleSuggestion {
    readonly role: SuggestedRole;
    /** 中文军职标题,如「技术员」。 */
    readonly roleTitle: string;
    readonly confidence: SuggestionConfidence;
    /** 命中的关键词原文(解释/调试用)。 */
    readonly matchedKeywords: readonly string[];
    /** 命中关键词条数(置信度依据)。 */
    readonly matchCount: number;
}
/** 成员的结构化最小视图(与 TeamMember/快照成员形状兼容,保持模块解耦)。 */
export interface SuggestableMember {
    readonly name: string;
    readonly role?: string;
    readonly status?: string;
}
/** 任务的结构化最小视图(与 TeamTask/快照任务形状兼容)。 */
export interface SuggestableTask {
    readonly id: string;
    readonly subject: string;
    readonly description?: string;
    readonly status?: string;
    readonly assignee?: string;
}
/** 「任务→建议角色/成员」映射项。 */
export interface TaskAssigneeSuggestion {
    readonly taskId: string;
    readonly subject: string;
    /** null = 关键词未命中任何角色,不推荐。 */
    readonly suggestedRole: SuggestedRole | null;
    /** 建议角色的中文标题;无建议时为 null。 */
    readonly roleTitle: string | null;
    /** 该角色在场的成员名(按负载最少挑选);该角色无成员时为 null。 */
    readonly suggestedMember: string | null;
    readonly confidence: SuggestionConfidence | null;
    readonly matchedKeywords: readonly string[];
    /** 是否真有该角色成员可派(区分「角色没匹配」与「角色匹配但无人可派」)。 */
    readonly roleHasMember: boolean;
}
/**
 * 根据任务标题与描述推断合适角色。纯函数。
 * 命中 0 条关键词 → null(不推荐,避免瞎猜)。
 * 平票时按 SUGGESTED_ROLES 固定顺序取先者(确定性)。
 */
export declare function suggestRole(subject: string, description?: string): RoleSuggestion | null;
/**
 * 对一组任务批量输出「任务→建议角色/成员」映射。纯函数。
 *
 * 成员挑选:建议角色在场的活跃成员(status ≠ 'removed')中,取未终结任务
 * 持有数最少者(负载均衡);平手按名字字典序(确定性)。
 * 只做建议:返回的 suggestedMember 不会被写入任何状态。
 */
export declare function suggestAssignments(tasks: readonly SuggestableTask[], members: readonly SuggestableMember[]): TaskAssigneeSuggestion[];
/** 单任务快捷建议(create_task 未指定 assignee 时使用)。 */
export declare function suggestAssigneeForTask(task: SuggestableTask, members: readonly SuggestableMember[]): TaskAssigneeSuggestion;
//# sourceMappingURL=suggest.d.ts.map