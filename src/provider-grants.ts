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

import z from '@deepseek-ai/schemastery'

/** 与 dsh-settings 同构的命名空间约束（kebab-case，无点号）。 */
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/

/** 品牌化 settings 命名空间字符串（编译期类型，运行时即原字符串）。 */
export type SettingsNamespace = string & { readonly __settingsNamespace: unique symbol }

/** 校验并品牌化一个命名空间（与宿主 settings 服务一致，非法值抛 TypeError）。 */
export function settingsNamespace(value: string): SettingsNamespace {
  if (!NAMESPACE_PATTERN.test(value)) {
    throw new TypeError(`settings namespace "${value}" must match ${String(NAMESPACE_PATTERN)}`)
  }
  return value as SettingsNamespace
}

/** AgentTeam 设置中心命名空间(t13:弃旧 agent-team-web-providers 取新)。 */
export const AGENT_TEAM_SETTINGS_NS = settingsNamespace('agent-team-web')

/** 角色默认档位值(settings.roleDefaults 的条目形状,与 roleLlmDefaults 同构)。 */
export interface RoleLlmDefaultValue {
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
}

/** 命名空间 resolved value(t13 schema)。 */
export interface ModelCapabilityValue {
  readonly enabled: boolean
  /** Opaque adapter effort id; a model-specific ceiling that limits explicit request selection. */
  readonly maxReasoningEffort?: string
}

export interface ResolvedModelCapability extends ModelCapabilityValue {
  /** Legacy grant or implicit DeepSeek before a new policy entry was saved. */
  readonly legacy?: true
}

export interface ModelReasoningEffort {
  readonly id: string
  readonly name: string
  readonly description?: string
}

export interface ModelReasoningCapability {
  readonly efforts: readonly ModelReasoningEffort[]
  readonly defaultEffort?: string
}

export interface ProviderModelCapability {
  readonly id: string
  readonly reasoning?: ModelReasoningCapability
}

export interface AgentTeamSettingsValue {
  /** Legacy authorization map retained for old profile layers. */
  readonly enabledModels?: Record<string, boolean>
  /** Per-route authorization and ceiling keyed by `${provider}/${model}`. */
  readonly modelCapabilities?: Record<string, ModelCapabilityValue>
  /** Legacy role-route entries, retained for display/migration but not selection. */
  readonly roleDefaults?: Record<string, RoleLlmDefaultValue>
}

/** 设置页表单 schema：模型授权 + 角色档位覆盖。
 * schemastery 宽松解析(缺省字段透传),roleDefaults 条目可部分提供。
 * 显式类型注解避免声明发射引用深层 pnpm 路径(TS2742)。 */
const enabledModelsSchema = z.dict(z.boolean()).default({})
const roleDefaultsSchema = z.dict(z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
})).default({})
const modelCapabilitiesSchema = z.dict(z.object({
  enabled: z.boolean(),
  maxReasoningEffort: z.string(),
})).default({})

// DSH 只接受 volatile 字段下的设置页即时写入(settings/schema.ts 的
// isVolatilePath),且 volatileForm 会跳过没有 volatile 字段的 entry。若少
// 了该标记,宿主既不暴露可编辑表单、也拒绝一切写入——控件点了等于没点。
// 必须使用 Schemastery >=3.18.4：其解析器才会把 meta.volatile 字段包装为
// 实时 Volatile 引用。3.18.2 即便设置 meta 标记也只返回裸对象，宿主 Loader
// 的 _commitVolatile 找不到引用，导致落盘成功但页面与运行时始终是旧值。
const liveEnabledModelsSchema: z<Record<string, boolean>> = enabledModelsSchema.volatile() as unknown as z<Record<string, boolean>>
const liveRoleDefaultsSchema: z<Record<string, RoleLlmDefaultValue>> = roleDefaultsSchema.volatile() as unknown as z<Record<string, RoleLlmDefaultValue>>
const liveModelCapabilitiesSchema: z<Record<string, ModelCapabilityValue>> = modelCapabilitiesSchema.volatile() as unknown as z<Record<string, ModelCapabilityValue>>

/** 两个设置字段的 schema 片段。宿主插件把它们并入自己的 `Config`
 * (组合 entry id = 命名空间 `agent-team-web`),标记因此只有一处定义。
 * 显式类型注解避免声明发射引用深层 pnpm 路径(TS2742)。 */
export const AgentTeamSettingsFields: {
  enabledModels: typeof liveEnabledModelsSchema
  roleDefaults: typeof liveRoleDefaultsSchema
  modelCapabilities: typeof liveModelCapabilitiesSchema
} = {
  enabledModels: liveEnabledModelsSchema,
  roleDefaults: liveRoleDefaultsSchema,
  modelCapabilities: liveModelCapabilitiesSchema,
}

/** 设置页字段的合成视图(类型消费者与测试用)。 */
export const AgentTeamSettingsSchema: z<AgentTeamSettingsValue> = z.object({
  enabledModels: AgentTeamSettingsFields.enabledModels,
  roleDefaults: AgentTeamSettingsFields.roleDefaults,
  modelCapabilities: AgentTeamSettingsFields.modelCapabilities,
})

/** 复合授权 key:`${provider}/${model}`(跨 provider 同名模型不撞车)。 */
export function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

/** 宿主 settings 服务的最小契约面。
 *
 * DSH 0.1.7 的 `SettingsForms` 只有 `describe/update/replace/mutate/configure`
 * —— 旧版的 `register(ns, schema)` 已移除,设置命名空间不再是独立注册的
 * 对象,而是**组合 entry 的 id**,其 schema 即该 entry 插件的 `Config`。
 * 因此本插件的设置字段必须住在自己的 `Config` 里(见 index.ts)。
 */
export interface SettingsSurface {
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
}

/** 一个已注册命名空间的描述（配置 UI / 读取方消费）。 */
export interface SettingsDescriptor {
  readonly ns: SettingsNamespace
  readonly schema: unknown
  readonly value: unknown
  readonly revision: number
  readonly applies: 'live' | 'restart'
}

/** 旧版(`register` 返回命名空间 scope)的 SettingsScope 形状,保留仅作类型
 * 参考,不再参与接线。 */
export interface SettingsScope {
  /** 当前 resolved value：schema 默认值 → base → 用户层。同步。 */
  get(): unknown
  watch(callback: (next: unknown, prev: unknown) => void | Promise<void>): () => void
  update(patch: object): Promise<void>
  replace(section: object): Promise<void>
}

/** 模型授权判定(基于 apply 期 Config 的 enabledModels):deepseek-official
 * 名下模型恒授权(回退不死路);其余看 enabledModels[`${provider}/${model}`]。 */
export function modelCapabilityFromValue(
  value: AgentTeamSettingsValue | undefined, provider: string, model: string,
): ResolvedModelCapability {
  const key = modelKey(provider, model)
  const configured = value?.modelCapabilities?.[key]
  if (configured !== undefined) return provider === 'deepseek-official' ? { ...configured, enabled: true } : configured
  return { enabled: provider === 'deepseek-official' || value?.enabledModels?.[key] === true, legacy: true }
}

export function modelGrantedFromValue(
  value: AgentTeamSettingsValue | undefined,
  provider: string,
  model: string,
): boolean {
  return modelCapabilityFromValue(value, provider, model).enabled === true
}

/** 角色档位解析(config 覆盖 → profile.roleLlmDefaults → DEFAULT_ROLE_LLM
 * 三源链):config.roleDefaults[roleKey] 存在即用之(「默认」= 删覆盖);
 * 否则 profile 档位;再否则内置档位。 */
export function resolveRoleDefault(
  value: AgentTeamSettingsValue | undefined,
  profile: Record<string, RoleLlmDefaultValue> | undefined,
  builtin: Record<string, RoleLlmDefaultValue> | undefined,
  roleKey: string,
): RoleLlmDefaultValue | undefined {
  const override = value?.roleDefaults?.[roleKey]
  if (override !== undefined) return override
  return profile?.[roleKey] ?? builtin?.[roleKey]
}

/** 设置中心的工具侧/写面共享访问对象（apply 期接线写入，作用域释放清空）。 */
export interface AgentTeamSettingsAccess {
  /** spawn 校验模型授权(tools.ts 读)；undefined → 仅 deepseek-official 恒授权。 */
  modelGrantedFor?: (provider: string, model: string) => boolean
  /** 角色档位三源链解析(tools.ts 读)；undefined → 走 profile → DEFAULT_ROLE_LLM。 */
  roleDefaultsFor?: (roleKey: string) => RoleLlmDefaultValue | undefined
  /** 当前 enabledModels 快照(快照透出/设置页初始值)；undefined → 空 map。 */
  enabledModels?: () => Record<string, boolean>
  /** 当前 roleDefaults 覆盖快照(历史只读迁移视图)；undefined → 空 map。 */
  roleDefaults?: () => Record<string, RoleLlmDefaultValue>
  /** New exact-route policy. Undefined entry falls back to legacy enabledModels. */
  modelCapabilities?: () => Record<string, ModelCapabilityValue>
  modelCapabilityFor?: (provider: string, model: string) => ResolvedModelCapability
  /** 模型授权写入(HTTP 路由第二写面)；undefined → 写面不可用(settings 缺席)。 */
  setModelGrant?: (provider: string, model: string, enabled: boolean) => Promise<void>
  /** 角色档位覆盖写入(设置页 RolePresetCard)；value=undefined → 删覆盖回「默认」。 */
  setRoleDefault?: (roleKey: string, value: RoleLlmDefaultValue | undefined) => Promise<void>
}

/** DSH 交付 volatile 配置字段的引用形状(schemastery 的 `volatile()` 分支在
 * `Schema.resolve` 里把该字段包成 `createVolatile(value)`)。
 *
 * 宿主自己的插件同样按引用取值——例如 subagent 插件的
 * `this.config.maxActiveSubagents.get()`。**volatile 字段在 apply 期不是裸值**:
 * 直接当对象读(键查找)会恒得 undefined,写面看起来永远"没生效"。
 * 本地结构化声明,避免依赖宿主侧的深层类型导出。 */
export interface VolatileBox<T> {
  get(): T | undefined
}

/** 取 volatile 字段的当前值:是引用就走 `.get()`(每次读都是最新值),
 * 是裸值则原样返回(测试夹具与旧宿主)。 */
export function unwrapVolatile<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    return (value as VolatileBox<T>).get()
  }
  return value as T
}

/** apply 期 config 里两个设置字段的来源(运行时是 VolatileBox,测试里可以是裸值)。 */
export interface AgentTeamSettingsSource {
  readonly enabledModels?: unknown
  readonly roleDefaults?: unknown
  readonly modelCapabilities?: unknown
}

/** 从 apply 期 Config 构造读访问对象。
 *
 * DSH 0.1.7 没有 `settings.register`,设置字段只能住在插件自己的 `Config`
 * 里(entry id = `agent-team-web`,与设置页命名空间同名)。两个字段是
 * volatile:Loader 检测到"仅 volatile 变化"时**不重新 apply**,而是把新值
 * 提交进运行中 fiber 的引用(`_commitVolatile` → `updateVolatile`)。因此这里
 * 每次读都经 `unwrapVolatile` 现场取值,而不是在 apply 期快照一次。 */
export function settingsAccessFromConfig(config: AgentTeamSettingsSource): AgentTeamSettingsAccess {
  const enabledModels = (): Record<string, boolean> => unwrapVolatile<Record<string, boolean>>(config.enabledModels) ?? {}
  const roleDefaults = (): Record<string, RoleLlmDefaultValue> => unwrapVolatile<Record<string, RoleLlmDefaultValue>>(config.roleDefaults) ?? {}
  const modelCapabilities = (): Record<string, ModelCapabilityValue> => unwrapVolatile<Record<string, ModelCapabilityValue>>(config.modelCapabilities) ?? {}
  return {
    modelGrantedFor: (provider: string, model: string) => modelGrantedFromValue({ enabledModels: enabledModels(), modelCapabilities: modelCapabilities() }, provider, model),
    roleDefaultsFor: (roleKey: string) => roleDefaults()[roleKey],
    enabledModels,
    roleDefaults,
    modelCapabilities,
    modelCapabilityFor: (provider, model) => modelCapabilityFromValue({ enabledModels: enabledModels(), modelCapabilities: modelCapabilities() }, provider, model),
  }
}

/** 接线写面(HTTP 路由第二写面):经宿主 `settings.update(ns, patch)` 写入
 * 组合 entry 的 volatile 字段。settings 服务缺席(headless)时写面保持
 * undefined → 路由 503,读访问不受影响。 */
export function wireAgentTeamSettings(settingsCtx: unknown, access: AgentTeamSettingsAccess): void {
  const settings = (settingsCtx as { settings?: SettingsSurface }).settings
  if (settings === undefined) return
  access.setModelGrant = async (provider: string, model: string, enabled: boolean): Promise<void> => {
    if (provider === 'deepseek-official') return // 隐式恒授权,永不落盘
    const current = access.enabledModels?.() ?? {}
    const key = modelKey(provider, model)
    const capabilities = { ...(access.modelCapabilities?.() ?? {}) }
    capabilities[key] = { ...(capabilities[key] ?? {}), enabled }
    await settings.update(String(AGENT_TEAM_SETTINGS_NS), { modelCapabilities: capabilities, enabledModels: { ...current, [key]: enabled } })
  }
  access.setRoleDefault = async (roleKey: string, value: RoleLlmDefaultValue | undefined): Promise<void> => {
    const next = { ...(access.roleDefaults?.() ?? {}) }
    if (value === undefined) delete next[roleKey] // 「默认」= 删覆盖
    else next[roleKey] = value
    await settings.update(String(AGENT_TEAM_SETTINGS_NS), { roleDefaults: next })
  }
  const dispose = (): void => {
    access.setModelGrant = undefined
    access.setRoleDefault = undefined
  }
  const effect = (settingsCtx as { effect?: (fn: () => () => void) => void }).effect
  if (effect !== undefined) {
    effect(() => dispose)
  }
}
