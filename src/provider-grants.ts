/**
 * Provider 授权中心 —— settings 命名空间域（设置页迁移）。
 *
 * 设计变更（docs/provider-grant-center-design.md 新增节）：Provider 授权是
 * 全局（profile 级）设置，从活动面板迁至 DSH 设置页。设置页通过标准
 * settings 服务读写授权（天然鉴权 + profile 级）。决策 2/1（政委拍板）：
 * provider-grants.json 持久化与 HTTP 路由保留为第二写面，settings 为
 * 主通道——spawn 校验的「settings 优先 + 文件 fallback」双通道接线待 t6
 * 核验结论后落地；本模块当前提供注册骨架与读取/判定纯函数。
 *
 * 注意：本仓库不直接依赖 @deepseek-ai/dsh-settings（宿主提供该服务），
 * 此处用本地最小契约（SettingsSurface）访问 `ctx.settings`——与 index.ts
 * 访问 webServer/workspace 服务同模式。命名空间必须匹配 settings 的
 * kebab-case 约束（/^[a-z][a-z0-9-]*$/，无点号——设计文档原写的
 * `agent-team-web.providers` 会抛 TypeError，故用连字符变体）。
 * @module dsh-agent-team-web/provider-grants
 */

import type { Context } from '@deepseek-ai/cordis'
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

/** 宿主 settings 服务的最小契约面（本仓库只用到 register/describe 子集）。 */
export interface SettingsSurface {
  register(ns: SettingsNamespace, schema: unknown): unknown
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

/** 从任意上下文读取宿主 settings 服务（headless/无 settings 时返回 undefined）。 */
export function settingsOf(ctx: Context): SettingsSurface | undefined {
  return (ctx as unknown as { settings?: SettingsSurface }).settings
}

/** 在 settings 服务上注册 Provider 授权命名空间（设置页自动渲染该 section）。 */
export function registerProviderGrantsSettings(sctx: unknown): void {
  const settings = (sctx as { settings?: SettingsSurface }).settings
  if (settings === undefined) {
    throw new Error('settings service is not available to register agent-team-web-providers')
  }
  settings.register(AGENT_TEAM_PROVIDERS_NS, ProviderGrantsSchema)
}

/** 从 settings 命名空间 resolved value 读出已启用 provider 集合（读不到/无服务 → 空）。 */
export function readEnabledProviders(ctx: Context): ReadonlySet<string> {
  try {
    const settings = settingsOf(ctx)
    if (settings === undefined) return new Set()
    const descriptor = settings.describe().find(d => d.ns === AGENT_TEAM_PROVIDERS_NS)
    const value = descriptor?.value as { enabledProviders?: Record<string, boolean> } | undefined
    const map = value?.enabledProviders ?? {}
    return new Set(
      Object.entries(map)
        .filter(([, enabled]) => enabled === true)
        .map(([provider]) => provider),
    )
  } catch {
    return new Set()
  }
}

/** 授权判定：deepseek-official 恒授权；其余 provider 需在设置页拨开开关。 */
export function providerGranted(grants: ReadonlySet<string>, provider: string): boolean {
  if (provider === 'deepseek-official') return true
  return grants.has(provider)
}
