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
export declare function taskStatusLabel(status: string, t: AgentTeamsTranslate): string;
export declare function formatTaskIds(ids: readonly string[], t: AgentTeamsTranslate): string;
/** Badge/bar coloring key: visual state, widened for terminal statuses. */
export declare function taskTone(state: ActivityTask['state'], status: string): string;
/** 任务耗时超时档位(ok 不输出警示;warn/over 分别黄/红)。 */
export declare function timingData(task: ActivityTask): 'ok' | 'warn' | 'over';
export declare function compactTaskLabel(subject: string): string;
export declare function taskSummary(team: ActivityTeam, t: AgentTeamsTranslate): string;
/** Provider 授权中心行数据:一行一个 DSH 注册 provider,deepseek-official 恒锁定(不可关)。 */
export declare function providerGrantRows(providers: readonly {
    id: string;
    name: string;
    enabled: boolean;
}[] | undefined): readonly {
    id: string;
    name: string;
    enabled: boolean;
    locked: boolean;
}[];
/** Provider switch 拨动请求契约:endpoint + 方法 + 载荷(enabled 取反)。R-17 token 头由调用方注入。 */
export declare function providerToggleRequest(provider: {
    id: string;
    enabled: boolean;
}): {
    method: 'POST';
    path: string;
    body: {
        provider: string;
        enabled: boolean;
    };
};
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