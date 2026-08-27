/**
 * L3 自成长落点:bestPractice 经验库(全局,跨会话跨团队)。
 *
 * 存储:独立于团队状态,位于 `<workspace>/.agent-team-web/best-practices.json`。
 * 条目带 sourceTeamId+sourceTaskId+时间 溯源;复盘三层之成员 retro_note 是
 * 原始素材,terminal 时自动提炼入库(verdict=pending),队长用
 * agent_teams_retro_review 校准(useful/useless/revised)。
 * 读写串行:复用 state.ts 的 withTeamLock 原子写,跨团队互不干扰。
 * @module dsh-agent-team-web/best-practices
 */
import type { EstimateLevel, TaskRetro, TaskRetroCause } from './types.ts';
/** 经验条目校准状态。 */
export type BestPracticeVerdict = 'pending' | 'useful' | 'useless' | 'revised';
/** 一条经验库条目(全局,跨团队,带溯源)。 */
export interface BestPracticeEntry {
    /** 稳定 id(bp-<uuid8>)。 */
    readonly id: string;
    /** 溯源:来源团队。 */
    readonly sourceTeamId: string;
    /** 溯源:来源任务。 */
    readonly sourceTaskId: string;
    /** 便于检索:来源任务标题。 */
    readonly sourceTaskSubject: string;
    /** 执行成员角色。 */
    readonly role: string;
    /** 任务预估等级。 */
    readonly level?: EstimateLevel;
    /** 复盘原因。 */
    readonly cause: TaskRetroCause;
    /** 提炼后的经验("这类任务下次先做什么")。 */
    readonly practice: string;
    /** 队长校准状态。 */
    readonly verdict: BestPracticeVerdict;
    readonly createdAt: number;
    readonly updatedAt: number;
}
/** 全局经验库文件名(位于 stateRoot 下)。 */
export declare const BEST_PRACTICES_FILE = "best-practices.json";
/** 生成稳定的条目 id。 */
export declare function bestPracticeId(): string;
/** 从复盘提炼经验文本:retroNote 优先,其次 recommendation(空则不产经验)。 */
export declare function distillPracticeText(retro: TaskRetro): string;
/** 读取全局经验库(文件不存在视为空库)。 */
export declare function readBestPractices(stateRoot: string): Promise<BestPracticeEntry[]>;
/** 持久化全局经验库(在调用方锁内或自行加锁)。 */
export declare function writeBestPractices(stateRoot: string, entries: readonly BestPracticeEntry[]): Promise<void>;
/** 新增或更新一条经验(同 sourceTaskId 幂等更新,不重复新增)。 */
export declare function upsertBestPractice(entries: readonly BestPracticeEntry[], next: BestPracticeEntry): BestPracticeEntry[];
/** 更新一条经验的队长校准结论;revised 时可选改写原因。 */
export declare function updateBestPracticeVerdict(entries: readonly BestPracticeEntry[], entryId: string, verdict: BestPracticeVerdict, cause?: TaskRetroCause): BestPracticeEntry[];
/** 从一次 terminal 复盘提炼入库(无经验内容不入库)。 */
export declare function distillBestPractice(retro: TaskRetro, source: {
    readonly sourceTeamId: string;
    readonly sourceTaskId: string;
    readonly sourceTaskSubject: string;
    readonly role: string;
}): BestPracticeEntry | undefined;
//# sourceMappingURL=best-practices.d.ts.map