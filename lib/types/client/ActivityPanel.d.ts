/**
 * AgentTeams activity panel: the top-right floater monitoring every team.
 *
 * Modeled on the Claude Code desktop SessionActivityPanel: a shell-overlay
 * panel that docks at the conversation's top-right edge by default, can be
 * dragged into a floating window, resized, and folded into an activity badge.
 * On wide viewports the docked panel makes the conversation column yield
 * space; narrow viewports keep a simple inset overlay. It
 * polls the host `/plugins/agent-team-web/state` route for
 * server-side snapshots (durable files + live subagent activity), with a
 * collapsed badge that auto-expands once when activity appears. Archived
 * teams stay available for the owning conversation after live work ends.
 *
 * The floater mounts in ui-layout's additive `shell.overlay`; it is not a
 * conversation node — the in-conversation panel was removed in favor of this
 * always-available monitor.
 * @module dsh-agent-team-web/client/activity
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ObservableSnapshot, SessionListState } from '@deepseek-ai/dsh-client-runtime/client';
import { type ActivityMember, type ActivityTask, type ActivityTeam } from './activity-monitor.ts';
import type { AgentTeamsTranslate } from './locales.ts';
/**
 * 全局 dock 布局让步的单一写面(t27):宽 dock 模式下给会话列让出
 * `--agent-team-web-panel-shift` 宽度(html 属性 + CSS 变量)。删除团队
 * (dismissal → return null)时组件可能绕过 useLayoutEffect 清理,此 helper
 * 供删除成功路径同步调用,确保面板消失的同时全局宽度让步立即释放。
 * @param shouldYield - 是否让位(dock 展开态)。
 * @param width - 让位宽度(dock 面板宽 + 间距),shouldYield=false 时忽略。
 * @param doc - document 注入点(node 测试无全局 document;缺省用全局)。
 */
export declare function applyDockLayout(shouldYield: boolean, width?: number, doc?: Document): void;
/** t24:删除后完全消失状态机的内部状态。 */
export interface DismissalState {
    /** 本面板是否曾有过活动团队(用于识别「从有变无」的删除事件,区别于从未有团队)。 */
    readonly hadLive: boolean;
    /** 是否处于「删除后完全消失」态(隐藏面板含徽标/空壳/归档区)。 */
    readonly dismissed: boolean;
}
/**
 * 纯函数(t24):删除后完全消失状态转移——活动团队数量变化驱动:
 * - liveCount > 0(有活动团队,含新团队出现)→ hadLive=true、dismissed=false(复位);
 * - liveCount === 0 且 hadLive(从有变无,语音删除或 X 关闭)→ dismissed=true(完全消失);
 * - liveCount === 0 且从未有过(liveCount 0 首挂)→ 保持原状(交给 !hasTeams 门控)。
 */
export declare function dismissalTransition(prev: DismissalState, liveCount: number): DismissalState;
export declare function taskStatusLabel(status: string, t: AgentTeamsTranslate): string;
/** 成员模型小字标签(t7,用户最终格式):`ds-v4-flash · high`。
 * deepseek-official → 品牌缩写 `ds` + 完整型号去 provider 前缀段
 * (`deepseek-v4-flash` → `ds-v4-flash`);其他 provider 取 id 首段为品牌,
 * 模型带该前缀则去掉、否则保留完整;effort(high/max/low/off)以 ` · ` 跟后。
 * model 缺失 → null(旧数据不显示小字)。 */
export declare function memberModelLabel(provider: string | undefined, model: string | undefined, reasoningEffort: string | undefined): string | null;
export declare function formatTaskIds(ids: readonly string[], t: AgentTeamsTranslate): string;
/** Badge/bar coloring key: visual state, widened for terminal statuses. */
export declare function taskTone(state: ActivityTask['state'], status: string): string;
/** 任务耗时超时档位(ok 不输出警示;warn/over 分别黄/红)。 */
export declare function timingData(task: ActivityTask): 'ok' | 'warn' | 'over';
export declare function compactTaskLabel(subject: string): string;
export declare function taskSummary(team: ActivityTeam, t: AgentTeamsTranslate): string;
/** 健康档位:0-49 需要立即干预,50-79 存在风险,80+ 运行平稳。 */
export declare function healthLevel(score: number): 'critical' | 'warn' | 'ok';
/** 高风险消息计数(融合分析层)。 */
export declare function healthRiskCount(team: ActivityTeam): number;
/** 成员负载条:active / pending / stalled / orphaned 四段。 */
export declare function loadBarFor(team: ActivityTeam, member: ActivityMember): JSX.Element | null;
/** The top-right activity floater. Teams follow the current session: live
 * snapshots and historic card summaries are only shown while their captain
 * session is the one currently open. */
export type ActivityPanelProps = {
    readonly sessionsList: ObservableSnapshot<SessionListState>;
    readonly openMember: (parentId: SessionId, childId: SessionId) => void;
} & PropsLocale<'agentTeamWeb'>;
export declare function ActivityPanel({ sessionsList, openMember, t }: ActivityPanelProps): import("react").JSX.Element | null;
//# sourceMappingURL=ActivityPanel.d.ts.map