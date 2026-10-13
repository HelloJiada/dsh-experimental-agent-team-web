/**
 * AgentTeam 设置中心 section(t13 重构)——一个 settings.section 两张卡。
 *
 * 卡片一 RolePresetCard:角色预设——紧凑网格,每格=角色名 + mono id + 单行职责
 * 摘要,整格可点开完整职责说明;不含任何模型或档位控件。
 * 卡片二 ModelGrantCard(模型选择):每 provider 的每模型一行 + 真实 switch
 * (key `${provider}/${model}` 复合,deepseek-official 同样可开关) + 最高
 * 思考档位(由 adapter reasoning 能力驱动),不再渲染任何预设参考区块。
 *
 * 数据流:模型列表 = /state 顶层(providers 含 advisory models);
 * 授权状态 = settingsScope 命名空间 resolved value;写面 = scope.set
 * (宿主持久化,spawn 校验随之下次 add_member 生效)。
 *
 * 纯逻辑(providerGrantRows/toggleProviderModels/roleDefaultsMap 等)导出供 node 直测,
 * 与 activity-panel-helpers.test 同构。
 * @module dsh-agent-team-web/client/provider-grants-section
 */
import type { ReactNode } from 'react';
/** Minimal settings namespace face retained for the panel's host bridge. */
export interface SettingsScopeSnapshot<T> {
    readonly status: 'loading' | 'ready' | 'unavailable';
    readonly value: T | undefined;
    readonly base: unknown;
    readonly user: unknown;
    readonly revision: number | undefined;
    readonly writable: boolean;
    readonly mode: 'host' | 'memory';
}
export interface SettingsScope<T> {
    getSnapshot(): SettingsScopeSnapshot<T>;
    subscribe(listener: () => void): () => void;
    /** `true` when Host persisted the edit; `false` when it refused it. */
    set(field: string, value: unknown): Promise<boolean>;
}
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots';
import type { AgentTeamsTranslate } from './locales.ts';
/**
 * AgentTeam 设置中心命名空间(client 侧本地常量,与 host provider-grants.ts
 * 的 agent-team-web 保持一致;不导入 host 模块以保 client bundle 纯净)。
 */
export declare const PROVIDER_GRANTS_NAMESPACE = "agent-team-web";
/** 命名空间 resolved value 形状(与 host AgentTeamSettingsSchema 对齐)。 */
export interface ProviderGrantsSectionValue {
    /** New per-model allowlist and supported effort ceiling. */
    readonly modelCapabilities?: Record<string, {
        enabled: boolean;
        maxReasoningEffort?: string;
    }>;
    /** Legacy fields remain readable and are never auto-deleted. */
    readonly enabledModels?: Record<string, boolean>;
    readonly roleDefaults?: Record<string, {
        provider?: string;
        model?: string;
        reasoningEffort?: string;
    }>;
}
/** /state 顶层 providers 条目(t13:含 advisory 模型列表)。 */
export interface ProviderModelCapability {
    readonly id: string;
    /** Adapter-provided capabilities in its original preferred order. */
    readonly reasoning?: {
        readonly efforts: readonly {
            readonly id: string;
            readonly name: string;
            readonly description?: string;
        }[];
        readonly defaultEffort?: string;
    };
}
export interface ProviderWithModels {
    readonly id: string;
    readonly name: string;
    readonly models?: readonly (ProviderModelCapability | string)[];
}
export declare function modelCapabilityValue(value: ProviderGrantsSectionValue | undefined, provider: string, model: string): {
    enabled: boolean;
    maxReasoningEffort?: string;
};
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
}
/** 角色预设行(t17:合并视图直接透传,模型选项改由全 provider 分组提供)。 */
export type RolePresetRow = RolePresetView;
/** 注入面:scope(读写命名空间) + t(文案)。 */
export interface ProviderGrantsSectionInjected {
    scope?: SettingsScope<ProviderGrantsSectionValue>;
    t: AgentTeamsTranslate;
}
/** Props delivered by the slot outlet: the inject face spread flat. */
export type ProviderGrantsSectionProps = Partial<InjectFace<ProviderGrantsSectionInjected>>;
/** 纯函数:复合 key(`${provider}/${model}`)。 */
export declare function modelKeyOf(provider: string, model: string): string;
/**
 * 纯函数(t14):provider 粒度行——只列 provider,无模型子列表。
 * 行 enabled = 该 provider 下所有模型均已授权(开关态语义:全开/全关);
 * 没有 provider 是恒授权的(deepseek-official 也可全关)。 */
export declare function providerGrantRows(providers: readonly ProviderWithModels[], enabledModels: Readonly<Record<string, boolean>> | undefined): readonly ProviderGrantRow[];
/**
 * 纯函数(t14):provider 行 switch 联动该 provider 全部模型——
 * 开启 = 全部模型授权(写各自 `${provider}/${model}` key);关闭 = 全部撤销
 * (删除该 provider 全部模型 key)。设计决策:provider 粒度展示,授权数据仍
 * 模型粒度(enabledModels 复合 key)不变。 */
export declare function toggleProviderModels(current: Readonly<Record<string, boolean>> | undefined, provider: string, models: readonly (ProviderModelCapability | string)[] | undefined, nextEnabled: boolean): Record<string, boolean>;
export declare function toggleModelCapability(current: ProviderGrantsSectionValue | undefined, provider: string, model: ProviderModelCapability, enabled: boolean, maxReasoningEffort?: string): Record<string, {
    enabled: boolean;
    maxReasoningEffort?: string;
}>;
export declare function modelEnabled(provider: string, model: ProviderModelCapability, value: ProviderGrantsSectionValue | undefined): boolean;
/** 角色档位值(client 本地形状,与 host AgentTeamSettingsSchema 对齐;
 * 不导入 host provider-grants.ts 以保 client bundle 纯净)。
 * auto 标记(t23):系统自动分配标识,使下次授权变化可重算(区别于手动覆盖)。 */
export interface RoleLlmDefaultValue {
    readonly provider?: string;
    readonly model?: string;
    readonly reasoningEffort?: string;
    readonly auto?: boolean;
}
/** 纯函数(t20):实时合并角色档位——显示值 = 实时覆盖(scope snapshot)
 * ?? base(/state 的 profile ?? DEFAULT,不含覆盖);overridden 由实时覆盖
 * 判定(驱动「恢复默认」disabled 态与选中回显)。 */
export declare const MEMBER_PRESET_ROLES: readonly ["researcher", "engineer", "qa", "designer", "data", "docs", "security", "reviewer", "commissar"];
export declare function roleDutyDescription(role: string, t: AgentTeamsTranslate): string;
export declare function mergeRoleDefaults(base: Readonly<Record<string, RoleLlmDefaultValue>> | undefined, overrides: Readonly<Record<string, RoleLlmDefaultValue>> | undefined): readonly RolePresetView[];
/** /state 顶层自成长数据(t10:设置页第三张卡数据源)。 */
export interface SelfGrowthView {
    readonly total: number;
    readonly calibrated: number;
    readonly recent: readonly {
        readonly id: string;
        readonly sourceTeamId: string;
        readonly sourceTaskSubject: string;
        readonly role: string;
        readonly practice: string;
        readonly verdict: string;
    }[];
}
export interface PracticeEntry {
    readonly id: string;
    readonly sourceTeamId: string;
    readonly sourceTaskId: string;
    readonly sourceTaskSubject: string;
    readonly role: string;
    readonly practice: string;
    readonly verdict: string;
    readonly appliesWhen?: readonly string[];
    readonly counterexamples?: readonly {
        readonly context: string;
        readonly reason: string;
    }[];
    readonly expiresAt?: number | null;
    readonly disabledAt?: number | null;
    readonly disabledReason?: string;
    readonly revision: number;
    readonly reviewHistory?: readonly unknown[];
}
export interface PracticeWorkspace {
    readonly path: string;
    readonly title: string;
}
export interface PracticesResponse {
    readonly workspaces?: readonly PracticeWorkspace[];
    readonly entries?: readonly PracticeEntry[];
    readonly workspace?: string;
}
/** Explicit scope is mandatory: no browser cwd or implicit workspace fallback. */
export declare function fetchPractices(workspace?: string): Promise<PracticesResponse>;
export type PracticeWriteResult = {
    readonly kind: 'ok';
    readonly entry: PracticeEntry;
} | {
    readonly kind: 'conflict';
} | {
    readonly kind: 'forbidden';
} | {
    readonly kind: 'failed';
    readonly status?: number;
};
/** Persist before changing UI state; stale/forbidden/error responses never become success. */
export declare function submitPracticeMutation(body: object, token: string | undefined, send?: typeof fetch): Promise<PracticeWriteResult>;
export declare function validatePracticePatch(patch: {
    practice: string;
    appliesWhen: string;
    counterexamples: string;
    expiresAt: string;
}): string | undefined;
/** 纯函数(t20):从 /state 响应体取设置中心数据——providers(含 models)+
 * roleDefaultsBase(不含覆盖的 base:profile ?? DEFAULT)+ roleDefaultsOverrides
 * (settings.roleDefaults 原文,初始值;实时覆盖由 scope snapshot 提供)
 * + selfGrowth(自成长数据,t10)。 */
export declare function settingsCenterFromStateBody(body: unknown): {
    providers: readonly ProviderWithModels[];
    roleDefaultsBase: Record<string, RoleLlmDefaultValue>;
    roleDefaultsOverrides: Record<string, RoleLlmDefaultValue>;
    selfGrowth: SelfGrowthView;
};
/** 从 /state 拉取设置中心数据(经授权 token)。 */
export declare function fetchSettingsCenter(): Promise<{
    providers: readonly ProviderWithModels[];
    roleDefaultsBase: Record<string, RoleLlmDefaultValue>;
    roleDefaultsOverrides: Record<string, RoleLlmDefaultValue>;
    selfGrowth: SelfGrowthView;
}>;
/**
 * AgentTeam 设置中心 section:两张卡(模型调度授权 + 角色预设)。
 * t20 数据流:模型/角色 base = /state 顶层(一次性);授权/覆盖实时状态 =
 * settingsScope 命名空间 resolved value(订阅自动刷新);显示值 = 实时覆盖
 * ?? base;开关/选择写面 = scope.set(宿主持久化,写后 snapshot 更新即时回显)。
 */
export declare function ProviderGrantsSection(props: ProviderGrantsSectionProps): ReactNode | null;
//# sourceMappingURL=ProviderGrantsSection.d.ts.map