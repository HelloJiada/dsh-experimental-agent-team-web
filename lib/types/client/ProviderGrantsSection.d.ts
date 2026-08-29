/**
 * Provider 授权设置页卡片(t8)——补 settings.section slot。
 *
 * 后端 settings 命名空间(agent-team-web-providers)已注册,但 DSH 设置页
 * shell 依赖 client 侧 `settings.section` slot 渲染功能卡片——本组件即该
 * 卡片:列出 DSH 已注册 provider(ctx.llm 经快照 /state 透出)+ enabledProviders
 * 开关;deepseek-official 恒授权锁定显示「默认」;开关切换经 client
 * settingsScope.set('enabledProviders', nextMap) 写命名空间(宿主持久化,
 * spawn 校验随之下一次 add_member 生效)。
 *
 * 纯逻辑(providerGrantRows/toggleEnabledMap)导出供 node 环境直测,与
 * activity-panel-helpers.test 同构。
 * @module dsh-agent-team-web/client/provider-grants-section
 */
import type { ReactNode } from 'react';
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots';
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client';
import type { AgentTeamsTranslate } from './locales.ts';
/** 命名空间 resolved value 形状(与 host ProviderGrantsSchema 对齐)。 */
export interface ProviderGrantsSectionValue {
    readonly enabledProviders?: Record<string, boolean>;
}
/**
 * Provider 授权命名空间(client 侧本地常量,与 host provider-grants.ts 的
 * agent-team-web-providers 保持一致;不导入 host 模块以保 client bundle
 * 纯净——provider-grants.ts 顶层执行 schemastery schema,会拖入 host 依赖)。
 */
export declare const PROVIDER_GRANTS_NAMESPACE = "agent-team-web-providers";
/** 一个 provider 行:列表 + 授权状态 + 锁定(deepseek-official 恒授权)。 */
export interface ProviderGrantRow {
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly locked: boolean;
}
/** 注入面:scope(读写命名空间) + t(文案)。 */
export interface ProviderGrantsSectionInjected {
    scope: SettingsScope<ProviderGrantsSectionValue>;
    t: AgentTeamsTranslate;
}
/** Props delivered by the slot outlet: the inject face spread flat. */
export type ProviderGrantsSectionProps = Partial<InjectFace<ProviderGrantsSectionInjected>>;
/** 纯函数:provider 列表 + 授权 map → 行(deepseek-official 恒锁定且恒 enabled)。 */
export declare function providerGrantRows(providers: readonly {
    id: string;
    name: string;
}[], enabled: Readonly<Record<string, boolean>> | undefined): readonly ProviderGrantRow[];
/** 纯函数:toggle 后的 enabledProviders map(保留其他项)。 */
export declare function toggleEnabledMap(current: Readonly<Record<string, boolean>> | undefined, provider: string, nextEnabled: boolean): Record<string, boolean>;
/** 从快照 /state 提取 DSH 已注册 provider 列表(经授权 token)。 */
export declare function fetchRegisteredProviders(): Promise<readonly {
    id: string;
    name: string;
}[]>;
/**
 * Provider 授权设置页卡片:provider 列表 + 授权开关。
 * 数据流:provider 列表 = 快照 /state 透出(注册表实时);授权状态 =
 * settingsScope 命名空间 resolved value(推送失效自动刷新)。开关写面 =
 * scope.set('enabledProviders', nextMap)(宿主持久化)。
 */
export declare function ProviderGrantsSection(props: ProviderGrantsSectionProps): ReactNode | null;
//# sourceMappingURL=ProviderGrantsSection.d.ts.map