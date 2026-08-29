/**
 * AgentTeam 设置中心 —— settings 命名空间域测试(t13 重构)。
 *
 * 覆盖：命名空间合法性(kebab-case)、register 返回 scope(describe 可见
 * enabledModels/roleDefaults schema)、modelGrantedFromScope(复合 key +
 * deepseek 恒授权)、resolveRoleDefaults(三源链:settings 覆盖 → profile →
 * builtin)、wireAgentTeamSettings(读/写/快照三通道 + 释放全清空)。
 * @module dsh-agent-team-web/provider-grants-settings.test
 */

import { describe, expect, it } from 'vitest'
import {
  AGENT_TEAM_SETTINGS_NS,
  AgentTeamSettingsSchema,
  modelGrantedFromScope,
  modelKey,
  registerAgentTeamSettings,
  resolveRoleDefaults,
  settingsNamespace,
  wireAgentTeamSettings,
  type AgentTeamSettingsAccess,
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
  it('kebab-case 合法', () => {
    expect(settingsNamespace('agent-team-web')).toBe('agent-team-web')
  })

  it('含点号/大写/空串 → 抛 TypeError', () => {
    expect(() => settingsNamespace('agent-team-web.providers')).toThrow(TypeError)
    expect(() => settingsNamespace('AgentTeam')).toThrow(TypeError)
    expect(() => settingsNamespace('')).toThrow(TypeError)
  })
})

describe('registerAgentTeamSettings — 注册并返回 scope', () => {
  it('register 后 describe 可见 enabledModels/roleDefaults schema 与默认值', () => {
    const settings = fakeSettings({ value: { enabledModels: { 'kimi-coding/kimi-k2.7-code': true } } })
    const scope = registerAgentTeamSettings({ settings })
    const descriptors = settings.describe()
    expect(descriptors).toHaveLength(1)
    expect(descriptors[0]?.ns).toBe(AGENT_TEAM_SETTINGS_NS)
    expect(descriptors[0]?.schema).toBe(AgentTeamSettingsSchema)
    expect(scope.get()).toEqual({ enabledModels: { 'kimi-coding/kimi-k2.7-code': true } })
    // schema 缺省解析:无用户层时两字段均为 {}。
    expect(AgentTeamSettingsSchema({})).toEqual({ enabledModels: {}, roleDefaults: {} })
  })

  it('无 settings 服务 → 抛错', () => {
    expect(() => registerAgentTeamSettings({})).toThrow(/settings service is not available/)
  })
})

describe('modelGrantedFromScope — 复合 key 模型授权判定', () => {
  it('deepseek-official 名下模型恒授权(不看 scope)', () => {
    expect(modelGrantedFromScope(scopeOf({}), 'deepseek-official', 'deepseek-v4-flash')).toBe(true)
  })

  it('其余 provider 按 `${provider}/${model}` 复合 key(跨 provider 同名不撞车)', () => {
    const scope = scopeOf({ enabledModels: { 'kimi-coding/kimi-k2.7-code': true } })
    expect(modelGrantedFromScope(scope, 'kimi-coding', 'kimi-k2.7-code')).toBe(true)
    // 另一 provider 的同名模型不因 kimi 授权而授权。
    expect(modelGrantedFromScope(scope, 'cc-switch', 'kimi-k2.7-code')).toBe(false)
    expect(modelGrantedFromScope(scope, 'kimi-coding', 'other-model')).toBe(false)
  })

  it('scope 值缺失 → 未授权(安全降级)', () => {
    expect(modelGrantedFromScope(scopeOf(undefined), 'kimi-coding', 'kimi-k2.7-code')).toBe(false)
  })

  it('modelKey 复合格式', () => {
    expect(modelKey('kimi-coding', 'kimi-k2.7-code')).toBe('kimi-coding/kimi-k2.7-code')
  })
})

describe('resolveRoleDefaults — 三源链(settings 覆盖 → profile → builtin)', () => {
  const profile = { engineer: { model: 'deepseek-v4-flash' }, qa: { model: 'deepseek-v4-flash' } }
  const builtin = { engineer: { model: 'deepseek-v4-pro', reasoningEffort: 'high' }, researcher: { model: 'deepseek-v4-pro' } }

  it('settings 覆盖优先;无覆盖 → profile;无 profile → builtin;都无 → undefined', () => {
    const withOverride = scopeOf({ roleDefaults: { engineer: { model: 'custom-m1', reasoningEffort: 'low' } } })
    expect(resolveRoleDefaults(withOverride, profile, builtin, 'engineer')).toEqual({ model: 'custom-m1', reasoningEffort: 'low' })
    expect(resolveRoleDefaults(scopeOf({}), profile, builtin, 'engineer')).toEqual({ model: 'deepseek-v4-flash' })
    expect(resolveRoleDefaults(scopeOf({}), {}, builtin, 'researcher')).toEqual({ model: 'deepseek-v4-pro' })
    expect(resolveRoleDefaults(scopeOf({}), {}, {}, 'unknown-role')).toBeUndefined()
  })

  it('roleDefaults 缺失字段不覆盖下层(部分覆盖语义由调用方保证)', () => {
    const partial = scopeOf({ roleDefaults: { engineer: { reasoningEffort: 'off' } } })
    expect(resolveRoleDefaults(partial, profile, builtin, 'engineer')).toEqual({ reasoningEffort: 'off' })
  })
})

describe('wireAgentTeamSettings — apply 期接线(scope 闭包 → access)', () => {
  it('三通道经 scope 生效;作用域释放全清空', async () => {
    const updates: Array<object> = []
    const scope = mutableScope({
      enabledModels: { 'kimi-coding/kimi-k2.7-code': true },
      roleDefaults: {},
    }, updates)
    const settings = fakeSettings({ scope })
    let disposer: (() => void) | undefined
    const settingsCtx = {
      settings,
      effect: (fn: () => () => void) => { disposer = fn() },
    }
    const access: AgentTeamSettingsAccess = {}
    wireAgentTeamSettings(settingsCtx, access)

    // 读判定(复合 key + deepseek 恒授权)
    expect(access.modelGrantedFor?.('kimi-coding', 'kimi-k2.7-code')).toBe(true)
    expect(access.modelGrantedFor?.('kimi-coding', 'other')).toBe(false)
    expect(access.modelGrantedFor?.('deepseek-official', 'deepseek-v4-flash')).toBe(true)
    // 快照读
    expect(access.enabledModels?.()).toEqual({ 'kimi-coding/kimi-k2.7-code': true })
    expect(access.roleDefaults?.()).toEqual({})
    // 写面:授权模型 → scope.update 收到重建的 enabledModels map
    await access.setModelGrant?.('xiaomi', 'm1', true)
    expect(updates[0]).toEqual({ enabledModels: { 'kimi-coding/kimi-k2.7-code': true, 'xiaomi/m1': true } })
    expect(access.modelGrantedFor?.('xiaomi', 'm1')).toBe(true)
    // 写面:deepseek 名下 no-op
    await access.setModelGrant?.('deepseek-official', 'deepseek-v4-flash', true)
    expect(updates).toHaveLength(1)
    // 角色档位覆盖写 + 「默认」删覆盖
    await access.setRoleDefault?.('engineer', { model: 'custom-m1' })
    await access.setRoleDefault?.('engineer', undefined)
    expect(access.roleDefaults?.()).toEqual({})

    disposer?.()
    expect(access.modelGrantedFor).toBeUndefined()
    expect(access.enabledModels).toBeUndefined()
    expect(access.setModelGrant).toBeUndefined()
    expect(access.roleDefaultsFor).toBeUndefined()
    expect(access.setRoleDefault).toBeUndefined()
  })

  it('无 settings 服务 → 抛错,access 不被写入', () => {
    const access: AgentTeamSettingsAccess = {}
    expect(() => wireAgentTeamSettings({}, access)).toThrow(/settings service is not available/)
    expect(access.modelGrantedFor).toBeUndefined()
  })
})
