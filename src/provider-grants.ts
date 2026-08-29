/**
 * Provider 授权中心 —— settings 命名空间域（设置页迁移）。
 *
 * 设计变更（docs/provider-grant-center-design.md 新增节）：Provider 授权是
 * 全局（profile 级）设置，从活动面板迁至 DSH 设置页。设置页通过标准
 * settings 服务读写授权（天然鉴权 + profile 级）。
 *
 * 接线（t6 核验结论，照 harness 先例 agent-presets this.settings /
 * llm-deepseek setSource）：ctx.settings 是可选服务，只在 `ctx.inject(
 * ['settings'])` 作用域内绑定，apply 期父 ctx 上不可假定存在——因此不能
 * 在工具 execute 时直读 ctx.settings（那会恒返回空）。正确链路：
 * apply 时在 inject 作用域内捕获 `register()` 返回的 SettingsScope（含
 * 同步 get()），经闭包写入可变的 providerGrantedFor 持有者，工具 execute
 * 读持有者；settings 作用域释放时清空持有者。
 *
 * 注意：本仓库不直接依赖 @deepseek-ai/dsh-settings（宿主提供该服务），
 * 此处用本地最小契约（SettingsSurface）访问 `ctx.settings`——与 index.ts
 * 访问 webServer/workspace 服务同模式。命名空间必须匹配 settings 的
 * kebab-case 约束（/^[a-z][a-z0-9-]*$/，无点号——设计文档原写的
 * `agent-team-web.providers` 会抛 TypeError，故用连字符变体）。
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

/** 本插件 Provider 授权命名空间（设计文档原 `agent-team-web.providers`
 * 含点号不符合 settings 约束，改用连字符变体）。 */
export const AGENT_TEAM_PROVIDERS_NS = settingsNamespace('agent-team-web-providers')

/** 设置页表单 schema：open map —— 任意 provider id → 布尔开关。
 * 显式类型注解避免声明发射引用深层 pnpm 路径(TS2742)。 */
export const ProviderGrantsSchema: z<{ enabledProviders: Record<string, boolean> }> = z.object({
  enabledProviders: z.dict(z.boolean()).default({}),
})

/** 宿主 settings 服务的最小契约面（register 返回命名空间 scope）。 */
export interface SettingsSurface {
  register(ns: SettingsNamespace, schema: unknown): SettingsScope
  describe(options?: { redactSecrets?: boolean }): readonly SettingsDescriptor[]
}

/** 一个已注册命名空间的描述（配置 UI / 读取方消费）。 */
export interface SettingsDescriptor {
  readonly ns: SettingsNamespace
  readonly schema: unknown
  readonly value: unknown
  readonly revision: number
  readonly applies: 'live' | 'restart'
}

/** 命名空间 owner 侧句柄（与宿主 dsh-settings SettingsScope 同构的子集）。 */
export interface SettingsScope {
  /** 当前 resolved value：schema 默认值 → base → 用户层。同步。 */
  get(): unknown
  watch(callback: (next: unknown, prev: unknown) => void | Promise<void>): () => void
  update(patch: object): Promise<void>
  replace(section: object): Promise<void>
}

/** 注册 Provider 授权命名空间，返回命名空间 scope（设置页渲染 + spawn 校验共用）。 */
export function registerProviderGrantsSettings(sctx: unknown): SettingsScope {
  const settings = (sctx as { settings?: SettingsSurface }).settings
  if (settings === undefined) {
    throw new Error('settings service is not available to register agent-team-web-providers')
  }
  return settings.register(AGENT_TEAM_PROVIDERS_NS, ProviderGrantsSchema)
}

/** 授权判定（基于命名空间 scope 的 resolved value）：deepseek-official 恒
 * 授权；其余 provider 需设置页 enabledProviders 开关为 true。 */
export function grantedFromScope(scope: SettingsScope, provider: string): boolean {
  if (provider === 'deepseek-official') return true
  const value = scope.get() as { enabledProviders?: Record<string, boolean> } | undefined
  return value?.enabledProviders?.[provider] === true
}

/** 工具侧授权判定的可变持有者：apply 期接线写入，settings 作用域释放清空。 */
export interface ProviderGrantedHolder {
  providerGrantedFor?: (provider: string) => boolean
}

/** apply 期接线（在 ctx.inject(['settings']) 作用域内调用）：
 * 捕获 scope 经闭包写入 holder.providerGrantedFor；settings 作用域释放时
 * 清空（sctx.effect 注册 disposer）。工具 execute 通过 holder 读授权。 */
export function wireSettingsGranted(settingsCtx: unknown, holder: ProviderGrantedHolder): void {
  const scope = registerProviderGrantsSettings(settingsCtx)
  holder.providerGrantedFor = (provider: string) => grantedFromScope(scope, provider)
  const dispose = (): void => {
    holder.providerGrantedFor = undefined
  }
  const effect = (settingsCtx as { effect?: (fn: () => () => void) => void }).effect
  if (effect !== undefined) {
    effect(() => dispose)
  }
}
