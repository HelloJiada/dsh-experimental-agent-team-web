/**
 * AgentTeam 设置中心 —— settings 命名空间域(t13 重构)。
 *
 * 设计(t12 拍板):Provider 授权粒度从 provider 升到 model——授权 key 为
 * `${provider}/${model}` 复合键(避免跨 provider 同名模型撞车);deepseek
 * -official 名下模型恒授权(回退不死路);仅显式路由才拦。命名空间更名
 * agent-team-web(schema 扩 enabledModels + roleDefaults),旧
 * agent-team-web-providers/enabledProviders 废弃(provider 粒度无法无损迁
 * 到 model 粒度,弃旧取新;profile.roleLlmDefaults 保留作 fallback/初始值)。
 *
 * 接线(t6 结论延续):ctx.settings 是可选服务只在 inject 作用域内绑定,
 * apply 期捕获 register() 返回的 SettingsScope,经闭包写入可变 access
 * (判定/快照/写面),工具 execute 与 HTTP 路由、快照采集经 access 读写;
 * settings 作用域释放时清空。
 *
 * 注意:本仓库不直接依赖 @deepseek-ai/dsh-settings(宿主提供服务),用本地
 * 最小契约(SettingsSurface)访问 ctx.settings。命名空间匹配 settings 的
 * kebab-case 约束(/^[a-z][a-z0-9-]*$/)。
 * @module dsh-agent-team-web/provider-grants
 */
import z from '@deepseek-ai/schemastery';
/** 品牌化 settings 命名空间字符串（编译期类型，运行时即原字符串）。 */
export type SettingsNamespace = string & {
    readonly __settingsNamespace: unique symbol;
};
/** 校验并品牌化一个命名空间（与宿主 settings 服务一致，非法值抛 TypeError）。 */
export declare function settingsNamespace(value: string): SettingsNamespace;
/** AgentTeam 设置中心命名空间(t13:弃旧 agent-team-web-providers 取新)。 */
export declare const AGENT_TEAM_SETTINGS_NS: SettingsNamespace;
/** 角色默认档位值(settings.roleDefaults 的条目形状,与 roleLlmDefaults 同构)。 */
export interface RoleLlmDefaultValue {
    readonly provider?: string;
    readonly model?: string;
    readonly reasoningEffort?: string;
}
/** 命名空间 resolved value(t13 schema)。 */
export interface AgentTeamSettingsValue {
    /** 模型授权开关:key = `${provider}/${model}`,true = 授权。 */
    readonly enabledModels?: Record<string, boolean>;
    /** 角色默认档位覆盖:roleKey → 档位;缺失 = 走 profile.roleLlmDefaults → DEFAULT_ROLE_LLM。 */
    readonly roleDefaults?: Record<string, RoleLlmDefaultValue>;
}
/** 设置页表单 schema：模型授权 + 角色档位覆盖。
 * schemastery 宽松解析(缺省字段透传),roleDefaults 条目可部分提供。
 * 显式类型注解避免声明发射引用深层 pnpm 路径(TS2742)。 */
export declare const AgentTeamSettingsSchema: z<AgentTeamSettingsValue>;
/** 复合授权 key:`${provider}/${model}`(跨 provider 同名模型不撞车)。 */
export declare function modelKey(provider: string, model: string): string;
/** 宿主 settings 服务的最小契约面（register 返回命名空间 scope）。 */
export interface SettingsSurface {
    register(ns: SettingsNamespace, schema: unknown): SettingsScope;
    describe(options?: {
        redactSecrets?: boolean;
    }): readonly SettingsDescriptor[];
}
/** 一个已注册命名空间的描述（配置 UI / 读取方消费）。 */
export interface SettingsDescriptor {
    readonly ns: SettingsNamespace;
    readonly schema: unknown;
    readonly value: unknown;
    readonly revision: number;
    readonly applies: 'live' | 'restart';
}
/** 命名空间 owner 侧句柄（与宿主 dsh-settings SettingsScope 同构的子集）。 */
export interface SettingsScope {
    /** 当前 resolved value：schema 默认值 → base → 用户层。同步。 */
    get(): unknown;
    watch(callback: (next: unknown, prev: unknown) => void | Promise<void>): () => void;
    update(patch: object): Promise<void>;
    replace(section: object): Promise<void>;
}
/** 注册 AgentTeam 设置中心命名空间，返回命名空间 scope（设置页渲染 + spawn 校验共用）。 */
export declare function registerAgentTeamSettings(sctx: unknown): SettingsScope;
/** 模型授权判定(基于 scope resolved value):deepseek-official 名下模型恒
 * 授权(回退不死路);其余看 enabledModels[`${provider}/${model}`] 开关。 */
export declare function modelGrantedFromScope(scope: SettingsScope, provider: string, model: string): boolean;
/** 角色档位解析(settings 覆盖 → profile.roleLlmDefaults → DEFAULT_ROLE_LLM
 * 三源链):settings.roleDefaults[roleKey] 存在即用之(「默认」= 删该覆盖);
 * 否则 profile 档位;再否则内置档位。 */
export declare function resolveRoleDefaults(scope: SettingsScope, profile: Record<string, RoleLlmDefaultValue> | undefined, builtin: Record<string, RoleLlmDefaultValue> | undefined, roleKey: string): RoleLlmDefaultValue | undefined;
/** 设置中心的工具侧/写面共享访问对象（apply 期接线写入，作用域释放清空）。 */
export interface AgentTeamSettingsAccess {
    /** spawn 校验模型授权(tools.ts 读)；undefined → 仅 deepseek-official 恒授权。 */
    modelGrantedFor?: (provider: string, model: string) => boolean;
    /** 角色档位三源链解析(tools.ts 读)；undefined → 走 profile → DEFAULT_ROLE_LLM。 */
    roleDefaultsFor?: (roleKey: string) => RoleLlmDefaultValue | undefined;
    /** 当前 enabledModels 快照(快照透出/设置页初始值)；undefined → 空 map。 */
    enabledModels?: () => Record<string, boolean>;
    /** 当前 roleDefaults 覆盖快照(设置页 RolePresetCard)；undefined → 空 map。 */
    roleDefaults?: () => Record<string, RoleLlmDefaultValue>;
    /** 模型授权写入(HTTP 路由第二写面)；undefined → 写面不可用(settings 缺席)。 */
    setModelGrant?: (provider: string, model: string, enabled: boolean) => Promise<void>;
    /** 角色档位覆盖写入(设置页 RolePresetCard)；value=undefined → 删覆盖回「默认」。 */
    setRoleDefault?: (roleKey: string, value: RoleLlmDefaultValue | undefined) => Promise<void>;
}
/** apply 期接线（在 ctx.inject(['settings']) 作用域内调用）：
 * 捕获 scope 经闭包写入 access(判定/快照/写面);settings 作用域释放时
 * 全部清空(sctx.effect 注册 disposer)。工具 execute 与 HTTP 路由、快照
 * 采集经 access 读写。 */
export declare function wireAgentTeamSettings(settingsCtx: unknown, access: AgentTeamSettingsAccess): void;
//# sourceMappingURL=provider-grants.d.ts.map