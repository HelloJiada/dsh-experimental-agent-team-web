/**
 * AgentTeam 设置中心 section(t13 重构)——一个 settings.section 两张卡。
 *
 * 卡片一 ModelGrantCard:模型调度授权——每 provider 的每模型一行 + switch
 * (key `${provider}/${model}` 复合);deepseek-official 名下模型恒授权锁定。
 * 卡片二 RolePresetCard:角色预设——每角色一行 + 预设模型/思考深度选择 +
 * 「默认」(删 settings 覆盖,回落到 profile.roleLlmDefaults → DEFAULT_ROLE_LLM)。
 *
 * 数据流:模型/角色列表 = /state 顶层(providers 含 advisory models,
 * roleDefaults 三源链合并视图含 overridden 标记);授权/覆盖状态 =
 * settingsScope 命名空间 resolved value;写面 = scope.set(宿主持久化,
 * spawn 校验随之下次 add_member 生效)。
 *
 * 纯逻辑(providerGrantRows/toggleProviderModels/roleDefaultsMap 等)导出供 node 直测,
 * 与 activity-panel-helpers.test 同构。
 * @module dsh-agent-team-web/client/provider-grants-section
 */
import type { ReactNode } from 'react';
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots';
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client';
import type { AgentTeamsTranslate } from './locales.ts';
/**
 * AgentTeam 设置中心命名空间(client 侧本地常量,与 host provider-grants.ts
 * 的 agent-team-web 保持一致;不导入 host 模块以保 client bundle 纯净)。
 */
export declare const PROVIDER_GRANTS_NAMESPACE = "agent-team-web";
/** 命名空间 resolved value 形状(与 host AgentTeamSettingsSchema 对齐)。 */
export interface ProviderGrantsSectionValue {
    readonly enabledModels?: Record<string, boolean>;
    readonly roleDefaults?: Record<string, {
        provider?: string;
        model?: string;
        reasoningEffort?: string;
    }>;
}
/** /state 顶层 providers 条目(t13:含 advisory 模型列表)。 */
export interface ProviderWithModels {
    readonly id: string;
    readonly name: string;
    readonly models?: readonly string[];
}
/** /state 顶层角色档位合并视图(三源链 + overridden 标记)。 */
export interface RolePresetView {
    readonly role: string;
    readonly provider?: string;
    readonly model?: string;
    readonly reasoningEffort?: string;
    readonly overridden: boolean;
}
/** Provider 粒度行(t14:第一张卡片,无模型子列表)。 */
export interface ProviderGrantRow {
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly locked: boolean;
}
/** 角色预设行(t17:合并视图直接透传,模型选项改由全 provider 分组提供)。 */
export type RolePresetRow = RolePresetView;
/** 注入面:scope(读写命名空间) + t(文案)。 */
export interface ProviderGrantsSectionInjected {
    scope: SettingsScope<ProviderGrantsSectionValue>;
    t: AgentTeamsTranslate;
}
/** Props delivered by the slot outlet: the inject face spread flat. */
export type ProviderGrantsSectionProps = Partial<InjectFace<ProviderGrantsSectionInjected>>;
/** 思考深度选项(与角色档位 effort 值域对齐)。 */
export declare const EFFORT_OPTIONS: readonly ["high", "max", "low", "off"];
/** 纯函数:复合 key(`${provider}/${model}`)。 */
export declare function modelKeyOf(provider: string, model: string): string;
/**
 * 纯函数(t14):provider 粒度行——只列 provider,无模型子列表。
 * 行 enabled = 该 provider 下所有模型均已授权(开关态语义:全开/全关);
 * deepseek-official 恒锁定恒启用(「默认」徽,无 switch)。 */
export declare function providerGrantRows(providers: readonly ProviderWithModels[], enabledModels: Readonly<Record<string, boolean>> | undefined): readonly ProviderGrantRow[];
/**
 * 纯函数(t14):provider 行 switch 联动该 provider 全部模型——
 * 开启 = 全部模型授权(写各自 `${provider}/${model}` key);关闭 = 全部撤销
 * (删除该 provider 全部模型 key)。设计决策:provider 粒度展示,授权数据仍
 * 模型粒度(enabledModels 复合 key)不变。 */
export declare function toggleProviderModels(current: Readonly<Record<string, boolean>> | undefined, provider: string, models: readonly string[] | undefined, nextEnabled: boolean): Record<string, boolean>;
/** 角色档位值(client 本地形状,与 host AgentTeamSettingsSchema 对齐;
 * 不导入 host provider-grants.ts 以保 client bundle 纯净)。 */
export interface RoleLlmDefaultValue {
    readonly provider?: string;
    readonly model?: string;
    readonly reasoningEffort?: string;
}
/** 纯函数(t20):实时合并角色档位——显示值 = 实时覆盖(scope snapshot)
 * ?? base(/state 的 profile ?? DEFAULT,不含覆盖);overridden 由实时覆盖
 * 判定(驱动「恢复默认」disabled 态与选中回显)。 */
export declare function mergeRoleDefaults(base: Readonly<Record<string, RoleLlmDefaultValue>> | undefined, overrides: Readonly<Record<string, RoleLlmDefaultValue>> | undefined): readonly RolePresetView[];
/** 纯函数:角色档位覆盖写后的 roleDefaults map(value=undefined → 删覆盖)。 */
export declare function roleDefaultsMap(current: Readonly<Record<string, {
    provider?: string;
    model?: string;
    reasoningEffort?: string;
}>> | undefined, roleKey: string, value: {
    provider?: string;
    model?: string;
    reasoningEffort?: string;
} | undefined): Record<string, {
    provider?: string;
    model?: string;
    reasoningEffort?: string;
}>;
/** 纯函数(t17):「恢复默认」= 清空全部 roleDefaults 覆盖,所有角色回落三源链。 */
export declare function resetRoleDefaults(): Record<string, {
    provider?: string;
    model?: string;
    reasoningEffort?: string;
}>;
/** 纯函数(t17):模型下拉按 provider 分组——返回全部含模型的 provider 组
 * (advisory models),供 <optgroup> 渲染;选中任一项即写该组 provider。 */
export declare function rolePresetModelGroups(providers: readonly ProviderWithModels[]): readonly {
    providerId: string;
    models: readonly string[];
}[];
/** 纯函数(t20):从 /state 响应体取设置中心数据——providers(含 models)+
 * roleDefaultsBase(不含覆盖的 base:profile ?? DEFAULT)+ roleDefaultsOverrides
 * (settings.roleDefaults 原文,初始值;实时覆盖由 scope snapshot 提供)。 */
export declare function settingsCenterFromStateBody(body: unknown): {
    providers: readonly ProviderWithModels[];
    roleDefaultsBase: Record<string, RoleLlmDefaultValue>;
    roleDefaultsOverrides: Record<string, RoleLlmDefaultValue>;
};
/** 从 /state 拉取设置中心数据(经授权 token)。 */
export declare function fetchSettingsCenter(): Promise<{
    providers: readonly ProviderWithModels[];
    roleDefaultsBase: Record<string, RoleLlmDefaultValue>;
    roleDefaultsOverrides: Record<string, RoleLlmDefaultValue>;
}>;
/**
 * AgentTeam 设置中心 section:两张卡(模型调度授权 + 角色预设)。
 * t20 数据流:模型/角色 base = /state 顶层(一次性);授权/覆盖实时状态 =
 * settingsScope 命名空间 resolved value(订阅自动刷新);显示值 = 实时覆盖
 * ?? base;开关/选择写面 = scope.set(宿主持久化,写后 snapshot 更新即时回显)。
 */
export declare function ProviderGrantsSection(props: ProviderGrantsSectionProps): ReactNode | null;
//# sourceMappingURL=ProviderGrantsSection.d.ts.map