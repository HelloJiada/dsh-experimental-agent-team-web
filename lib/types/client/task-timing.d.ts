/**
 * 面板耗时展示与超时警示的客户端辅助(与服务端 retro.ts 同阈值)。
 *
 * 判定规则与 tools/intelligence/snapshot 完全一致:
 * 预算 = 预估等级区间上限(ESTIMATE_LEVEL_RANGES)或内部毫秒;
 * 已用/实际 > 预算 → warn(黄),> 预算 × 1.5 → over(红)。
 * @module dsh-agent-team-web/client/task-timing
 */
import type { ActivityMember, ActivityTask } from './activity-monitor.ts';
import type { AgentTeamsTranslate } from './locales.ts';
/** 客户端侧复用的超时档位。 */
export type TaskTimingState = 'ok' | 'warn' | 'over';
/** 预估预算(ms):等级区间上限优先,其次内部毫秒;都无则 undefined。 */
export declare function estimateBudgetMs(task: ActivityTask): number | undefined;
/** 任务当前展示用的耗时(ms):已完成取实际耗时,进行中取 now - claimedAt。 */
export declare function taskElapsedMs(task: ActivityTask, now: number): number;
/** 超时档位(与服务端 taskTimingState 一致,等级优先口径)。 */
export declare function taskTimingState(task: ActivityTask, now: number): TaskTimingState;
/** 预估展示文本:等级优先(S(≤15m)),其次毫秒。 */
export declare function estimateText(task: ActivityTask, t: AgentTeamsTranslate): string | null;
/** 任务行的"预估 vs 实际/已用"文本;无预估返回 null。 */
export declare function taskTimingText(task: ActivityTask, t: AgentTeamsTranslate, now?: number): string | null;
/** 任务详情展开时的完整耗时行:预估/实际/等级偏差(如有)。 */
export declare function taskTimingDetailText(task: ActivityTask, t: AgentTeamsTranslate, now?: number): string | null;
/** 成员状态行的"已耗时"文本;无当前任务或未计时返回 null。 */
export declare function memberElapsedText(member: ActivityMember, t: AgentTeamsTranslate): string | null;
/** 成员当前任务的超时档位(用于已耗时文本的警示着色)。 */
export declare function memberTimingState(member: ActivityMember, tasks: readonly ActivityTask[], now?: number): TaskTimingState;
/** 任务详情的产出信号行(含成员自报);无信号返回 null。 */
export declare function taskSignalsText(task: ActivityTask, t: AgentTeamsTranslate): string | null;
/** 复盘原因标签(zh/en 双语)。 */
export declare function retroCauseLabel(cause: string, t: AgentTeamsTranslate): string;
/** 任务详情的复盘行(原因/经验/边界标注/队长校准);无复盘返回 null。 */
export declare function retroDetailText(task: ActivityTask, t: AgentTeamsTranslate): string | null;
/**
 * 复盘质量闭环:任务行/详情「待校准」徽标条件。与服务端
 * retroPendingCalibration 同口径(high/critical + 终结 + 无 retro_note +
 * 无 captainVerdict),并优先信任服务端快照透出的 pendingCalibration 标志。
 */
export declare function taskPendingCalibration(task: ActivityTask): boolean;
//# sourceMappingURL=task-timing.d.ts.map