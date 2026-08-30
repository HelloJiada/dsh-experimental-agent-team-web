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
 * 不导入 host provider-grants.ts 以保 client bundle 纯净)。
 * auto 标记(t23):系统自动分配标识,使下次授权变化可重算(区别于手动覆盖)。 */
export interface RoleLlmDefaultValue {
    readonly provider?: string;
    readonly model?: string;
    readonly reasoningEffort?: string;
    readonly auto?: boolean;
}
/** 自动重分配档位表(t23,用户确认 v2;t26 修正:cc-switch GPT-5.6 不支持
 * reasoning effort,cc-switch 目标不配 effort——仅模型,effort 由模型默认;
 * deepseek 回退档位保留 effort(deepseek 支持)。sol=最强推理(pro 级 5 角色),
 * terra=稳健执行(技术/质检),luna=轻量省成本(文书/文宣,支持视觉)。 */
export interface RoleAutoAssignEntry {
    readonly provider: string;
    readonly model: string;
    /** 目标模型的 effort;cc-switch(GPT-5.6)不支持 reasoning → undefined 不写。 */
    readonly reasoningEffort?: string;
    readonly fallback: {
        readonly provider: string;
        readonly model: string;
        readonly reasoningEffort: string;
    };
}
export declare const ROLE_AUTO_ASSIGN_TABLE: Readonly<Record<string, RoleAutoAssignEntry>>;
/**
 * 纯函数(t23;t26 修正):授权变化后自动重分配角色档位(写 settings 覆盖层,
 * 不动默认/内置表)。逐角色(table 的 key):
 * a. 手动覆盖(roleDefaults[role] 存在且无 auto 标记)→ 保留不动(尊重显式选择);
 * b. 否则(继承态或带 auto 标记的自动分配结果)→ 目标模型已授权 → 写
 *    {provider:'cc-switch', model:目标, auto:true}(cc-switch GPT-5.6 不支持
 *    reasoning effort,不落 effort 字段;deepseek 回退条目保留 effort);
 *    目标未授权 → 写 deepseek 原档位回退(deepseek-official 恒授权),同样 auto:true。
 * 返回新 map 仅含变更(无关角色/已有覆盖原样保留)。
 */
export declare function autoAssignRoleDefaults(current: Readonly<Record<string, RoleLlmDefaultValue>> | undefined, enabledModels: Readonly<Record<string, boolean>> | undefined, table?: Readonly<Record<string, RoleAutoAssignEntry>>): Record<string, RoleLlmDefaultValue>;
/** 纯函数(t20):实时合并角色档位——显示值 = 实时覆盖(scope snapshot)
 * ?? base(/state 的 profile ?? DEFAULT,不含覆盖);overridden 由实时覆盖
 * 判定(驱动「恢复默认」disabled 态与选中回显)。 */
export declare function mergeRoleDefaults(base: Readonly<Record<string, RoleLlmDefaultValue>> | undefined, overrides: Readonly<Record<string, RoleLlmDefaultValue>> | undefined): readonly RolePresetView[];
/** 纯函数(t25):是否存在任一档位表目标模型已授权(初始化分配的前提——
 * 有目标可分配才写,避免无谓覆盖/写入)。 */
export declare function autoAssignHasTarget(enabledModels: Readonly<Record<string, boolean>> | undefined, table?: Readonly<Record<string, RoleAutoAssignEntry>>): boolean;
/** 纯函数(t25):初始化重分配幂等判定——按表重算结果与当前覆盖是否不同
 * (无变更则不写 scope,避免无谓写入/触发 uSES 重渲染循环)。 */
export declare function autoAssignDiffers(current: Readonly<Record<string, RoleLlmDefaultValue>> | undefined, enabledModels: Readonly<Record<string, boolean>> | undefined, table?: Readonly<Record<string, RoleAutoAssignEntry>>): boolean;
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
/** 纯函数(t17/t22):模型下拉按 provider 分组——可调度判定与第一张卡
 * providerGrantRows.enabled 语义一致:deepseek-official 恒可调度(全量模型);
 * 其他 provider = models 非空 && 全部模型已授权(enabledModels 每个
 * `${provider}/${model}` key 均为 true)。enabledModels 缺省(undefined)时
 * 不过滤(兼容旧行为/快照缺省);过滤后空组剔除。 */
export declare function rolePresetModelGroups(providers: readonly ProviderWithModels[], enabledModels?: Readonly<Record<string, boolean>>): readonly {
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