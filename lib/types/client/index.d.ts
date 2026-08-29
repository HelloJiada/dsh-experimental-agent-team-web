/** Browser plugin for the AgentTeams activity floater and conversation card. */
import type { Context } from '@deepseek-ai/cordis';
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client';
import { type AgentTeamsLocaleKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** AgentTeams conversation card and activity monitor copy. */
        agentTeamWeb: AgentTeamsLocaleKey;
    }
}
/** Required services: conversation nodes, slots, sessions navigation, locale,
 * and the settings-namespace scope (Provider 授权设置页卡片读写命名空间)。
 * `settingsScope` 必须显式声明——cordis 服务代理守卫在未 inject 时访问会抛
 * "cannot get property 'settingsScope' without inject",渲染期崩溃被错误边界
 * 吞掉导致 content 区空白(t11 根因)。 */
export declare const inject: string[];
/** rc.2 宿主显式类型面:覆写 cordis Context 的 sessions 为 ISessions。 */
type ClientContext = Omit<Context, 'sessions'> & {
    readonly sessions: ISessions;
};
/**
 * Register the activity monitor in the shell's additive overlay and the
 * in-conversation team card. The card's activity button re-opens a folded
 * monitor via a window event — the recovery path for an old session.
 */
export declare function apply(ctx: ClientContext): void;
export {};
//# sourceMappingURL=index.d.ts.map