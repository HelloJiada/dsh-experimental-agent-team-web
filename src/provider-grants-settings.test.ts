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

/** 最小 settings 服务桩:记录注册,返回假 scope;describe 可注入 value。 */
function fakeSettings(overrides: { value?: unknown } = {}): SettingsSurface & { registrations: Map<string, { schema: unknown; value: unknown }> } {
  const registrations = new Map<string, { schema: unknown; value: unknown }>()
  return {
    registrations,
    register(ns, schema) {
      registrations.set(String(ns), { schema, value: overrides.value })
      return scopeOf(overrides.value)
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

describe('wireSettingsGranted — apply 期接线(scope 闭包 → holder)', () => {
  it('接线后 holder.providerGrantedFor 经 scope 判定;作用域释放后清空', () => {
    const settings = fakeSettings({ value: { enabledProviders: { 'kimi-coding': true } } })
    let disposer: (() => void) | undefined
    const settingsCtx = {
      settings,
      effect: (fn: () => () => void) => { disposer = fn() },
    }
    const holder: { providerGrantedFor?: (provider: string) => boolean } = {}
    wireSettingsGranted(settingsCtx, holder)

    expect(holder.providerGrantedFor?.( 'kimi-coding')).toBe(true)
    expect(holder.providerGrantedFor?.('xiaomi')).toBe(false)
    expect(holder.providerGrantedFor?.('deepseek-official')).toBe(true)

    disposer?.()
    expect(holder.providerGrantedFor).toBeUndefined()
  })

  it('settingsCtx 无 effect(最小上下文)→ 仍完成接线,不抛错', () => {
    const settings = fakeSettings({ value: { enabledProviders: {} } })
    const holder: { providerGrantedFor?: (provider: string) => boolean } = {}
    wireSettingsGranted({ settings }, holder)
    expect(holder.providerGrantedFor?.('deepseek-official')).toBe(true)
  })

  it('无 settings 服务 → 抛错,holder 不被写入', () => {
    const holder: { providerGrantedFor?: (provider: string) => boolean } = {}
    expect(() => wireSettingsGranted({}, holder)).toThrow(/settings service is not available/)
    expect(holder.providerGrantedFor).toBeUndefined()
  })
})
