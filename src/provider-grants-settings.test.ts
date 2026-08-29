/**
 * Provider 授权中心 —— settings 命名空间域测试（设置页迁移接线）。
 *
 * t6 核验结论落地：spawn 校验走「inject 捕获 scope → 闭包携带 → 工具
 * execute 读」链路。本文件覆盖：命名空间合法性（kebab-case 无点号）、
 * register 返回 scope（get() 读 resolved value）、grantedFromScope 授权
 * 判定（deepseek-official 恒授权）、wireSettingsGranted 接线（holder 写入
 * 与作用域释放清空、无 settings 服务抛错）。
 * @module dsh-agent-team-web/provider-grants-settings.test
 */

import { describe, expect, it } from 'vitest'
import {
  AGENT_TEAM_PROVIDERS_NS,
  ProviderGrantsSchema,
  grantedFromScope,
  registerProviderGrantsSettings,
  settingsNamespace,
  wireSettingsGranted,
  type ProviderGrantAccess,
  type SettingsDescriptor,
  type SettingsScope,
  type SettingsSurface,
} from './provider-grants.ts'

/** 假 scope:get() 返回固定 resolved value。 */
function scopeOf(value: unknown): SettingsScope {
  return {
    get: () => value,
    watch: () => () => undefined,
    update: async () => undefined,
    replace: async () => undefined,
  }
}

/** 可变假 scope:记录 update 调用并让 get() 反映最新值。 */
function mutableScope(initial: unknown, updates: Array<object>): SettingsScope {
  let value: unknown = initial
  return {
    get: () => value,
    watch: () => () => undefined,
    update: async (patch) => {
      updates.push(patch)
      value = { ...(value as Record<string, unknown>), ...patch as Record<string, unknown> }
    },
    replace: async (section) => { value = section },
  }
}

/** 最小 settings 服务桩:记录注册,返回假 scope;describe 可注入 value。 */
function fakeSettings(overrides: { value?: unknown; scope?: SettingsScope } = {}): SettingsSurface & { registrations: Map<string, { schema: unknown; value: unknown }> } {
  const registrations = new Map<string, { schema: unknown; value: unknown }>()
  return {
    registrations,
    register(ns, schema) {
      registrations.set(String(ns), { schema, value: overrides.value })
      return overrides.scope ?? scopeOf(overrides.value)
    },
    describe(): SettingsDescriptor[] {
      return [...registrations].map(([ns, registration]) => ({
        ns: ns as SettingsDescriptor['ns'],
        schema: registration.schema,
        value: registration.value,
        revision: 0,
        applies: 'live',
      }))
    },
  }
}

describe('settingsNamespace — 命名空间合法性', () => {
  it('kebab-case 合法(连字符变体)', () => {
    expect(settingsNamespace('agent-team-web-providers')).toBe('agent-team-web-providers')
  })

  it('含点号/大写/空串 → 抛 TypeError(设计文档原 `agent-team-web.providers` 不合法)', () => {
    expect(() => settingsNamespace('agent-team-web.providers')).toThrow(TypeError)
    expect(() => settingsNamespace('AgentTeam')).toThrow(TypeError)
    expect(() => settingsNamespace('')).toThrow(TypeError)
  })
})

describe('registerProviderGrantsSettings — 注册并返回 scope', () => {
  it('register 后 describe 可见 enabledProviders schema 与默认值,scope.get() 读 resolved value', () => {
    const settings = fakeSettings({ value: { enabledProviders: { 'kimi-coding': true } } })
    const scope = registerProviderGrantsSettings({ settings })
    const descriptors = settings.describe()
    expect(descriptors).toHaveLength(1)
    expect(descriptors[0]?.ns).toBe(AGENT_TEAM_PROVIDERS_NS)
    expect(descriptors[0]?.schema).toBe(ProviderGrantsSchema)
    expect(scope.get()).toEqual({ enabledProviders: { 'kimi-coding': true } })
    // schema 缺省解析:无用户层时 enabledProviders 为 {}。
    expect(ProviderGrantsSchema({ enabledProviders: {} })).toEqual({ enabledProviders: {} })
  })

  it('无 settings 服务 → 抛错(注册面不裸奔)', () => {
    expect(() => registerProviderGrantsSettings({})).toThrow(/settings service is not available/)
  })
})

describe('grantedFromScope — 基于 scope resolved value 的授权判定', () => {
  it('deepseek-official 恒授权(不看 scope)', () => {
    expect(grantedFromScope(scopeOf({}), 'deepseek-official')).toBe(true)
    expect(grantedFromScope(scopeOf({ enabledProviders: {} }), 'deepseek-official')).toBe(true)
  })

  it('其余 provider 需 enabledProviders 开关为 true', () => {
    const scope = scopeOf({ enabledProviders: { 'kimi-coding': true, xiaomi: false } })
    expect(grantedFromScope(scope, 'kimi-coding')).toBe(true)
    expect(grantedFromScope(scope, 'xiaomi')).toBe(false)
    expect(grantedFromScope(scope, 'cc-switch')).toBe(false)
  })

  it('scope 值缺失/结构不符 → 未授权(安全降级)', () => {
    expect(grantedFromScope(scopeOf(undefined), 'kimi-coding')).toBe(false)
    expect(grantedFromScope(scopeOf({ otherField: 1 }), 'kimi-coding')).toBe(false)
  })
})

describe('wireSettingsGranted — apply 期接线(scope 闭包 → access 三通道)', () => {
  it('接线后 providerGrantedFor/enabledProviders/setProviderGrant 经 scope 生效;作用域释放全清空', async () => {
    const updates: Array<object> = []
    const scope = mutableScope({ enabledProviders: { 'kimi-coding': true } }, updates)
    const settings = fakeSettings({ scope, value: { enabledProviders: { 'kimi-coding': true } } })
    let disposer: (() => void) | undefined
    const settingsCtx = {
      settings,
      effect: (fn: () => () => void) => { disposer = fn() },
    }
    const access: ProviderGrantAccess = {}
    wireSettingsGranted(settingsCtx, access)

    // 读判定
    expect(access.providerGrantedFor?.('kimi-coding')).toBe(true)
    expect(access.providerGrantedFor?.('xiaomi')).toBe(false)
    expect(access.providerGrantedFor?.('deepseek-official')).toBe(true)
    // 快照读
    expect(access.enabledProviders?.()).toEqual({ 'kimi-coding': true })
    // 写面:授权 xiaomi → scope.update 收到完整 enabledProviders 重建(map),
    // 且 get() 反映新值(后续判定立即生效)。
    await access.setProviderGrant?.('xiaomi', true)
    expect(updates).toEqual([{ enabledProviders: { 'kimi-coding': true, xiaomi: true } }])
    expect(access.providerGrantedFor?.('xiaomi')).toBe(true)
    expect(access.enabledProviders?.()).toEqual({ 'kimi-coding': true, xiaomi: true })

    disposer?.()
    expect(access.providerGrantedFor).toBeUndefined()
    expect(access.enabledProviders).toBeUndefined()
    expect(access.setProviderGrant).toBeUndefined()
  })

  it('写面 deepseek-official → no-op 不落盘', async () => {
    const updates: Array<object> = []
    const scope = mutableScope({ enabledProviders: {} }, updates)
    const access: ProviderGrantAccess = {}
    wireSettingsGranted({ settings: fakeSettings({ scope }), effect: () => () => undefined }, access)
    await access.setProviderGrant?.('deepseek-official', true)
    expect(updates).toEqual([])
  })

  it('settingsCtx 无 effect(最小上下文)→ 仍完成接线,不抛错', () => {
    const settings = fakeSettings({ value: { enabledProviders: {} } })
    const access: ProviderGrantAccess = {}
    wireSettingsGranted({ settings }, access)
    expect(access.providerGrantedFor?.('deepseek-official')).toBe(true)
  })

  it('无 settings 服务 → 抛错,access 不被写入', () => {
    const access: ProviderGrantAccess = {}
    expect(() => wireSettingsGranted({}, access)).toThrow(/settings service is not available/)
    expect(access.providerGrantedFor).toBeUndefined()
  })
})
