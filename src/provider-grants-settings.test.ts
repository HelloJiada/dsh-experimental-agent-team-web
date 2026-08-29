/**
 * Provider 授权中心 —— settings 命名空间域测试（设置页注册骨架）。
 *
 * 覆盖：settings 命名空间注册（register 后 describe 可见 enabledProviders
 * 默认值）、授权读取（readEnabledProviders 从 resolved value 取 enabled
 * 集合、无 settings 服务降级空集）、授权判定（deepseek-official 恒授权）、
 * 命名空间合法性（kebab-case 无点号）。spawn 校验的双通道接线（settings
 * 优先 + provider-grants.json fallback）待 t6 核验结论后落地，届时本文件
 * 的读取/判定函数成为校验路径数据源。
 * @module dsh-agent-team-web/provider-grants-settings.test
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  AGENT_TEAM_PROVIDERS_NS,
  ProviderGrantsSchema,
  providerGranted,
  readEnabledProviders,
  registerProviderGrantsSettings,
  settingsNamespace,
  type SettingsDescriptor,
  type SettingsSurface,
} from './provider-grants.ts'

/** 最小 settings 服务桩:记录注册,describe 返回注册列表(可注入 value)。 */
function fakeSettings(overrides: { value?: unknown } = {}): SettingsSurface & { registrations: Map<string, { schema: unknown; value: unknown }> } {
  const registrations = new Map<string, { schema: unknown; value: unknown }>()
  return {
    registrations,
    register(ns, schema) {
      registrations.set(String(ns), { schema, value: overrides.value })
      return {}
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

function ctxWith(settings: SettingsSurface | undefined): Context {
  return { settings } as unknown as Context
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

describe('registerProviderGrantsSettings — settings 命名空间注册', () => {
  it('register 后 describe 可见 enabledProviders schema 与默认值', () => {
    const settings = fakeSettings()
    registerProviderGrantsSettings({ settings })
    const descriptors = settings.describe()
    expect(descriptors).toHaveLength(1)
    expect(descriptors[0]?.ns).toBe(AGENT_TEAM_PROVIDERS_NS)
    expect(descriptors[0]?.schema).toBe(ProviderGrantsSchema)
    // schema 缺省解析:无用户层时 enabledProviders 为 {}。
    expect(ProviderGrantsSchema({ enabledProviders: {} })).toEqual({ enabledProviders: {} })
  })

  it('注册无 settings 服务的上下文 → 抛错(注册面不裸奔)', () => {
    expect(() => registerProviderGrantsSettings({})).toThrow(/settings service is not available/)
  })
})

describe('readEnabledProviders — 从 settings 读取已授权 provider', () => {
  it('enabled=true 的 provider 进集合,false 与缺失排除', () => {
    const settings = fakeSettings({
      value: { enabledProviders: { 'kimi-coding': true, xiaomi: false, 'cc-switch': true } },
    })
    registerProviderGrantsSettings({ settings })
    expect(readEnabledProviders(ctxWith(settings))).toEqual(new Set(['kimi-coding', 'cc-switch']))
  })

  it('未注册命名空间 / 无 enabledProviders 字段 → 空集合', () => {
    expect(readEnabledProviders(ctxWith(fakeSettings()))).toEqual(new Set())
    const settings = fakeSettings({ value: { otherField: 1 } })
    registerProviderGrantsSettings({ settings })
    expect(readEnabledProviders(ctxWith(settings))).toEqual(new Set())
  })

  it('ctx 无 settings 服务(headless)→ 空集合,不抛错', () => {
    expect(readEnabledProviders(ctxWith(undefined))).toEqual(new Set())
    expect(readEnabledProviders({} as unknown as Context)).toEqual(new Set())
  })
})

describe('providerGranted — 授权判定', () => {
  it('deepseek-official 恒授权(不看 grants)', () => {
    expect(providerGranted(new Set(), 'deepseek-official')).toBe(true)
    expect(providerGranted(new Set(['deepseek-official']), 'deepseek-official')).toBe(true)
  })

  it('其余 provider 需在设置页拨开开关', () => {
    expect(providerGranted(new Set(), 'kimi-coding')).toBe(false)
    expect(providerGranted(new Set(['kimi-coding']), 'kimi-coding')).toBe(true)
  })
})
