/**
 * 任务耗时/复盘纯逻辑:预估等级(S/M/L)、实际、超时判定、三层复盘与团队校准统计。
 *
 * 纯函数、只读、无副作用,供 tools(结算/生成)、snapshot(面板快照)、
 * intelligence(超时提示)与客户端(超时警示 UI)共用,保证服务端与面板对
 * "超时"的判定完全一致(方向决策 2/4/6):
 * - 预算 = 预估等级区间上限(ESTIMATE_LEVEL_RANGES,集中可调)或内部毫秒;
 * - 实际/已用 > 预算 → overran(超预算,黄);> 预算 × 1.5 → 严重超时(红);
 * - 每次 terminal 都生成复盘(on_time 也沉淀);cancelled 记耗时不推经验。
 * @module dsh-agent-team-web/retro
 */
import { type EstimateLevel, type RetroCaptainVerdict, type TaskRetro, type TaskRetroCause, type TeamMember, type TeamTask } from './types.ts';
/** 超预算阈值:实际/已用超过预估预算即视为黄色警示(= overran)。 */
export declare const OVERRUN_WARN_FACTOR = 1;
/** 严重超时阈值:实际/已用超过预算 1.5 倍即红色警示。 */
export declare const OVERRUN_OVER_FACTOR = 1.5;
/** 耗时档位:ok 正常 / warn 超预算(>预算) / over 严重超时(>预算 1.5 倍)。 */
export type TaskTimingState = 'ok' | 'warn' | 'over';
/**
 * 预估预算(ms):等级区间上限优先(S/M 有上限;L 无上限时回落内部毫秒);
 * 两者都无返回 undefined(不判超时)。
 */
export declare function estimateBudgetMs(estimateLevel: EstimateLevel | undefined, estimatedMs: number | undefined): number | undefined;
/**
 * 实际/已用耗时相对预估的档位(等级优先口径)。
 * @param estimateLevel - 预估等级(S/M/L)。
 * @param estimatedMs - 内部毫秒换算(等级 L 或未设等级时兜底)。
 * @param actualOrElapsedMs - 实际(已完成)或已用(进行中)耗时。
 */
export declare function taskTimingState(estimateLevel: EstimateLevel | undefined, estimatedMs: number | undefined, actualOrElapsedMs: number | undefined): TaskTimingState;
/** 是否超预算(实际 > 预估预算);无预算恒为 false。 */
export declare function taskOverran(estimateLevel: EstimateLevel | undefined, estimatedMs: number | undefined, actualMs: number | undefined): boolean;
/**
 * 任务的已用/实际耗时(ms):已完成取 actualMs;进行中优先 now - claimedAt,
 * 缺 claimedAt(旧团队/跨版本升级)时回退 now - updatedAt 作为近似起点,
 * 仍缺失则 0。
 */
export declare function taskElapsedMs(task: Pick<TeamTask, 'claimedAt' | 'completedAt' | 'actualMs'> & {
    readonly updatedAt?: number;
}, now: number): number;
/** 成员当前进行中任务的已用耗时(ms);无当前任务或未记认领时间时为 0。 */
export declare function currentTaskElapsedMs(memberName: string, tasks: readonly TeamTask[], now: number): number;
/**
 * 当前进行中任务的耗时是否为近似值:任务缺 claimedAt(旧团队/跨版本升级)而
 * 回退到 updatedAt 推算时为 true;无当前任务恒为 false。
 */
export declare function currentTaskElapsedApprox(memberName: string, tasks: readonly TeamTask[]): boolean;
/** 生成一次复盘需要的最小任务耗时/边界信息。 */
export interface RetroTaskFacts {
    readonly attempt?: number;
    readonly estimateLevel?: EstimateLevel;
    readonly estimatedMs?: number;
    readonly claimedAt?: number;
    readonly completedAt?: number;
    readonly actualMs?: number;
    /** 终结状态:completed/failed/cancelled(决定是否推经验)。 */
    readonly status?: string;
    /** 成员一句话经验(bestPractice 原始素材)。 */
    readonly retroNote?: string;
    /** 边界:任务曾被政委门禁等待。 */
    readonly includesGateWait?: boolean;
    /** 边界:本 attempt 曾有 helper 介入。 */
    readonly hasHelper?: boolean;
}
/** 结算一次任务耗时(幂等):补记 completedAt 与 actualMs,并算 overrunMs。 */
export declare function resolveTaskTiming(task: RetroTaskFacts, now: number): {
    readonly completedAt: number;
    readonly actualMs?: number;
    readonly overrunMs?: number;
};
/** 复盘原因的中文标签(复盘摘要/面板展示)。 */
export declare const RETRO_CAUSE_LABEL: Readonly<Record<TaskRetroCause, string>>;
/** 按原因取推荐建议文案(队长 revised 校准改原因时重新生成)。 */
export declare function retroRecommendationFor(cause: TaskRetroCause): string;
/**
 * 自动生成一条任务复盘记录(复盘三层之服务端自动主体)。
 *
 * 原因分类优先取显式传入的 `cause`(update_task 的 retro_cause);未声明时按
 * 数字推导:cancelled → other(不推经验);超预算(overran) → underestimated;
 * 按时完成(实际 ≤ 预算) → on_time;无预算 → other。
 *
 * @param facts - 任务的耗时事实(至少需要实际耗时)。
 * @param cause - 显式原因分类(可选)。
 * @param now - 生成时间戳。
 */
export declare function buildTaskRetro(facts: RetroTaskFacts, cause?: TaskRetroCause, now?: number): TaskRetro;
/** 团队校准统计中的单角色×等级条目。 */
export interface RoleLevelTimingStat {
    readonly role: string;
    readonly level: string;
    readonly taskCount: number;
    /** 该 (role, level) 组已完成任务的平均实际耗时(ms)。 */
    readonly avgActualMs?: number;
    /** 该组超预算任务占比,0..1。 */
    readonly overrunRatio?: number;
}
/** 团队级复盘校准统计(自成长闭环:反哺队长后续派单)。 */
export interface TeamRetroSummary {
    /** 已完成且有耗时结算的任务数。 */
    readonly completedWithTiming: number;
    /** 已完成且超预算的任务数。 */
    readonly overranCount: number;
    /** 全部已结算任务的平均实际耗时(ms);无数据时为 undefined。 */
    readonly avgActualMs?: number;
    /** 全部有预估任务的超预算占比,0..1;无数据时为 undefined。 */
    readonly overallOverrunRatio?: number;
    /** 按角色 × 预估等级统计(校准预估的核心口径)。 */
    readonly byRoleLevel: readonly RoleLevelTimingStat[];
    /** 兼容视图:按角色统计(不再拆分等级)。 */
    readonly byRole: readonly RoleTimingStat[];
}
/** 团队校准统计中的单角色条目(兼容旧口径)。 */
export interface RoleTimingStat {
    readonly role: string;
    readonly taskCount: number;
    readonly avgActualMs?: number;
    readonly overrunRatio?: number;
}
/**
 * 汇总团队已完成任务的耗时复盘,输出队长可用的校准数据。
 * 只读、纯函数;只统计已完成且具备实际耗时的任务。角色取成员 role 字段,
 * 未提供成员名单(或成员已移除)时回退为任务 assignee 姓名。
 */
export declare function summarizeTeamRetro(tasks: readonly TeamTask[], members?: readonly TeamMember[]): TeamRetroSummary;
/** 生成一条面向队长的复盘校准提示(自成长闭环的可读输出)。
 * 冷启动守卫:已结算样本 <2 时不出校准结论(方向决策 7)。 */
export declare function retroCalibrationHint(summary: TeamRetroSummary): string;
/**
 * 复盘质量闭环:high/critical 任务终结生成 retro 后,若既无成员经验
 * (retro_note)也无队长校准(captainVerdict),判定为「待校准」——
 * 复盘三层之第二、三层均缺失,面板据此提示队长补全闭环。
 *
 * 边界:
 * - 仅 completed / failed 判定(cancelled 不推经验,无校准价值);
 * - 仅 riskLevel ∈ {high, critical} 判定(milestone 属门禁范畴,不在此列);
 * - 无 retro(未终结)恒为 false。
 */
export declare function retroPendingCalibration(task: Pick<TeamTask, 'status' | 'riskLevel' | 'retro'>): boolean;
/** 兼容导出:旧 buildTaskRetro 的 attempt 默认值。 */
export type { RetroCaptainVerdict };
//# sourceMappingURL=retro.d.ts.map