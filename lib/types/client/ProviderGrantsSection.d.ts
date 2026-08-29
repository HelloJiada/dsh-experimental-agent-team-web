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
 * 纯逻辑(modelGrantRows/toggleModelMap/roleDefaultsMap 等)导出供 node 直测,
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
/** 模型授权行。 */
export interface ModelGrantRow {
    readonly provider: string;
    readonly model: string;
    readonly enabled: boolean;
    readonly locked: boolean;
}
/** 角色预设行。 */
export interface RolePresetRow extends RolePresetView {
    /** 该角色可选的模型(按选中 provider 过滤)。 */
    readonly modelOptions: readonly string[];
}
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
/** 纯函数:provider×模型 → 模型授权行(deepseek-official 恒锁定恒启用)。 */
export declare function modelGrantRows(providers: readonly ProviderWithModels[], enabledModels: Readonly<Record<string, boolean>> | undefined): readonly ModelGrantRow[];
/** 纯函数:toggle 后的 enabledModels map(保留其他项)。 */
export declare function toggleModelMap(current: Readonly<Record<string, boolean>> | undefined, key: string, nextEnabled: boolean): Record<string, boolean>;
/** 纯函数:角色预设行(合并视图 + 按选中 provider 过滤模型选项)。 */
export declare function rolePresetRows(views: readonly RolePresetView[], providers: readonly ProviderWithModels[]): readonly RolePresetRow[];
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
/** 纯函数:从 /state 响应体取顶层 providers(含 models)与 roleDefaults 合并视图。 */
export declare function settingsCenterFromStateBody(body: unknown): {
    providers: readonly ProviderWithModels[];
    roleDefaults: readonly RolePresetView[];
};
/** 从 /state 拉取设置中心数据(经授权 token)。 */
export declare function fetchSettingsCenter(): Promise<{
    providers: readonly ProviderWithModels[];
    roleDefaults: readonly RolePresetView[];
}>;
/**
 * AgentTeam 设置中心 section:两张卡(模型调度授权 + 角色预设)。
 * 数据流:模型/角色列表 = /state 顶层;授权/覆盖状态 = settingsScope 命名
 * 空间 resolved value;开关/选择写面 = scope.set(宿主持久化)。
 */
export declare function ProviderGrantsSection(props: ProviderGrantsSectionProps): ReactNode | null;
//# sourceMappingURL=ProviderGrantsSection.d.ts.map