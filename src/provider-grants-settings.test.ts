/**
 * AgentTeam 设置中心 —— 设置字段域测试(DSH 0.1.7 重构)。
 *
 * 覆盖：命名空间合法性(kebab-case)、设置字段必须 volatile(否则宿主既
 * 不暴露表单也拒绝写入)、modelGrantedFromValue(复合 key + deepseek 恒
 * 授权)、resolveRoleDefault(三源链:config 覆盖 → profile → builtin)、
 * settingsAccessFromConfig(读访问直接来自 apply 期 config)、
 * wireAgentTeamSettings(仅写面:经宿主 settings.update 落盘;释放即清空;
 * settings 缺席时读访问不受影响)。
 * @module dsh-agent-team-web/provider-grants-settings.test
 */

import { describe, expect, it } from 'vitest'
import {
  AGENT_TEAM_SETTINGS_NS,
  AgentTeamSettingsFields,
  AgentTeamSettingsSchema,
  modelGrantedFromValue,
  modelKey,
  resolveRoleDefault,
  settingsAccessFromConfig,
  settingsNamespace,
  wireAgentTeamSettings,
  type AgentTeamSettingsAccess,
  type SettingsSurface,
} from './provider-grants.ts'

/** 最小 settings 服务桩:记录 update 调用。 */
function fakeSettings(calls: Array<{ ns: string; patch: object }>): SettingsSurface {
  return {
    async update(ns: string, patch: object): Promise<void> {
      calls.push({ ns, patch })
    },
  }
}

/** volatile 标记读取(元数据形式,无 .volatile() 构造器)。 */
function volatileOf(schema: unknown): unknown {
  return (schema as { meta?: Record<string, unknown> }).meta?.volatile
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

describe('设置字段 schema', () => {
  it('实际插件解析器必须生成可实时更新的 volatile 引用，而非只有 meta 标记', () => {
    const parsed = AgentTeamSettingsSchema({
      enabledModels: { 'cc-switch/gpt-5.6-terra': true },
      roleDefaults: { engineer: { provider: 'cc-switch', model: 'gpt-5.6-terra' } },
    })
    const models = parsed.enabledModels as unknown as { get(): Record<string, boolean> }
    const roles = parsed.roleDefaults as unknown as { get(): Record<string, { provider?: string; model?: string }> }
    expect(typeof models.get).toBe('function')
    expect(typeof roles.get).toBe('function')
    const access = settingsAccessFromConfig(parsed)
    expect(access.modelGrantedFor?.('cc-switch', 'gpt-5.6-terra')).toBe(true)
    expect(access.roleDefaultsFor?.('engineer')).toEqual({ provider: 'cc-switch', model: 'gpt-5.6-terra' })
    expect((AgentTeamSettingsSchema({}).enabledModels as unknown as { get(): object }).get()).toEqual({})
    expect((AgentTeamSettingsSchema({}).roleDefaults as unknown as { get(): object }).get()).toEqual({})
  })

  it('两个字段都是 volatile —— 否则宿主不暴露表单且拒绝写入', () => {
    expect(volatileOf(AgentTeamSettingsFields.enabledModels)).toBe(true)
    expect(volatileOf(AgentTeamSettingsFields.roleDefaults)).toBe(true)
    expect(volatileOf(AgentTeamSettingsSchema.dict?.enabledModels)).toBe(true)
    expect(volatileOf(AgentTeamSettingsSchema.dict?.roleDefaults)).toBe(true)
  })

  it('命名空间与组合 entry id 一致(宿主以 entry id 作为设置命名空间)', () => {
    expect(String(AGENT_TEAM_SETTINGS_NS)).toBe('agent-team-web')
  })
})

describe('modelGrantedFromValue — 复合 key 模型授权判定', () => {
  it('deepseek-official 名下模型恒授权(不看 config)', () => {
    expect(modelGrantedFromValue({}, 'deepseek-official', 'deepseek-v4-flash')).toBe(true)
    expect(modelGrantedFromValue(undefined, 'deepseek-official', 'deepseek-v4-flash')).toBe(true)
  })

  it('其余 provider 按 `${provider}/${model}` 复合 key(跨 provider 同名不撞车)', () => {
    const value = { enabledModels: { 'kimi-coding/kimi-k2.7-code': true } }
    expect(modelGrantedFromValue(value, 'kimi-coding', 'kimi-k2.7-code')).toBe(true)
    // 另一 provider 的同名模型不因 kimi 授权而授权。
    expect(modelGrantedFromValue(value, 'cc-switch', 'kimi-k2.7-code')).toBe(false)
    expect(modelGrantedFromValue(value, 'kimi-coding', 'other-model')).toBe(false)
  })

  it('config 值缺失 → 未授权(安全降级)', () => {
    expect(modelGrantedFromValue(undefined, 'cc-switch', 'gpt-5.6-terra')).toBe(false)
  })

  it('modelKey 复合格式', () => {
    expect(modelKey('cc-switch', 'gpt-5.6-terra')).toBe('cc-switch/gpt-5.6-terra')
  })
})

describe('resolveRoleDefault — 三源链(config 覆盖 → profile → builtin)', () => {
  const profile = { engineer: { model: 'deepseek-v4-flash' }, qa: { model: 'deepseek-v4-flash' } }
  const builtin = { engineer: { model: 'deepseek-v4-pro', reasoningEffort: 'high' }, researcher: { model: 'deepseek-v4-pro' } }

  it('config 覆盖优先;无覆盖 → profile;无 profile → builtin;都无 → undefined', () => {
    const withOverride = { roleDefaults: { engineer: { model: 'custom-m1', reasoningEffort: 'low' } } }
    expect(resolveRoleDefault(withOverride, profile, builtin, 'engineer')).toEqual({ model: 'custom-m1', reasoningEffort: 'low' })
    expect(resolveRoleDefault({}, profile, builtin, 'engineer')).toEqual({ model: 'deepseek-v4-flash' })
    expect(resolveRoleDefault({}, {}, builtin, 'researcher')).toEqual({ model: 'deepseek-v4-pro' })
    expect(resolveRoleDefault({}, {}, {}, 'unknown-role')).toBeUndefined()
  })

  it('roleDefaults 缺失字段不覆盖下层(部分覆盖语义由调用方保证)', () => {
    const partial = { roleDefaults: { engineer: { reasoningEffort: 'off' } } }
    expect(resolveRoleDefault(partial, profile, builtin, 'engineer')).toEqual({ reasoningEffort: 'off' })
  })
})

describe('settingsAccessFromConfig — 读访问直接来自 apply 期 config', () => {
  it('判定/快照三通道都读同一份 config', () => {
    const access = settingsAccessFromConfig({
      enabledModels: { 'cc-switch/gpt-5.6-terra': true },
      roleDefaults: { engineer: { provider: 'cc-switch', model: 'gpt-5.6-terra' } },
    })
    expect(access.modelGrantedFor?.('cc-switch', 'gpt-5.6-terra')).toBe(true)
    expect(access.modelGrantedFor?.('cc-switch', 'gpt-5.6-luna')).toBe(false)
    expect(access.modelGrantedFor?.('deepseek-official', 'deepseek-v4-pro')).toBe(true)
    expect(access.enabledModels?.()).toEqual({ 'cc-switch/gpt-5.6-terra': true })
    expect(access.roleDefaultsFor?.('engineer')).toEqual({ provider: 'cc-switch', model: 'gpt-5.6-terra' })
    expect(access.roleDefaults?.()).toEqual({ engineer: { provider: 'cc-switch', model: 'gpt-5.6-terra' } })
  })

  it('volatile 引用在 apply 后更新时，每次读取均取得新快照', () => {
    let models: Record<string, boolean> = {}
    let roles: Record<string, { provider: string; model: string }> = {}
    const access = settingsAccessFromConfig({
      enabledModels: { get: () => models },
      roleDefaults: { get: () => roles },
    })
    expect(access.modelGrantedFor?.('cc-switch', 'gpt-5.6-terra')).toBe(false)
    models = { 'cc-switch/gpt-5.6-terra': true }
    roles = { engineer: { provider: 'cc-switch', model: 'gpt-5.6-terra' } }
    expect(access.modelGrantedFor?.('cc-switch', 'gpt-5.6-terra')).toBe(true)
    expect(access.enabledModels?.()).toEqual(models)
    expect(access.roleDefaultsFor?.('engineer')).toEqual(roles.engineer)
    expect(access.roleDefaults?.()).toEqual(roles)
  })

  it('缺省 config → 空 map 且仅 deepseek 恒授权', () => {
    const access = settingsAccessFromConfig({})
    expect(access.enabledModels?.()).toEqual({})
    expect(access.roleDefaults?.()).toEqual({})
    expect(access.roleDefaultsFor?.('engineer')).toBeUndefined()
    expect(access.modelGrantedFor?.('cc-switch', 'gpt-5.6-terra')).toBe(false)
    // 读访问不依赖 settings 服务,写面缺席(spawn 校验仍可用)。
    expect(access.setModelGrant).toBeUndefined()
  })
})

describe('wireAgentTeamSettings — 仅写面(经宿主 settings.update 落盘)', () => {
  it('授权/撤销与角色覆盖写入都落到命名空间,deepseek 为 no-op', async () => {
    const calls: Array<{ ns: string; patch: object }> = []
    let disposer: (() => void) | undefined
    const settingsCtx = {
      settings: fakeSettings(calls),
      effect: (fn: () => () => void) => { disposer = fn() },
    }
    const access: AgentTeamSettingsAccess = settingsAccessFromConfig({
      enabledModels: { 'kimi-coding/kimi-k2.7-code': true },
      roleDefaults: {},
    })
    wireAgentTeamSettings(settingsCtx, access)

    await access.setModelGrant?.('cc-switch', 'gpt-5.6-terra', true)
    expect(calls[0]).toEqual({
      ns: 'agent-team-web',
      patch: { enabledModels: { 'kimi-coding/kimi-k2.7-code': true, 'cc-switch/gpt-5.6-terra': true } },
    })

    // deepseek 名下隐式恒授权 → 不落盘
    await access.setModelGrant?.('deepseek-official', 'deepseek-v4-flash', true)
    expect(calls).toHaveLength(1)

    // 撤销 = 写 false(键保留,语义显式)
    await access.setModelGrant?.('cc-switch', 'gpt-5.6-terra', false)
    expect(calls[1]?.patch).toEqual({
      enabledModels: { 'kimi-coding/kimi-k2.7-code': true, 'cc-switch/gpt-5.6-terra': false },
    })

    // 角色覆盖写 + 「默认」删覆盖
    await access.setRoleDefault?.('engineer', { model: 'gpt-5.6-terra' })
    expect(calls[2]?.patch).toEqual({ roleDefaults: { engineer: { model: 'gpt-5.6-terra' } } })
    await access.setRoleDefault?.('engineer', undefined)
    expect(calls[3]?.patch).toEqual({ roleDefaults: {} })

    // 释放:写面清空(读访问由 config 闭包持有,不随之清空)
    disposer?.()
    expect(access.setModelGrant).toBeUndefined()
    expect(access.setRoleDefault).toBeUndefined()
    expect(access.modelGrantedFor?.('deepseek-official', 'x')).toBe(true)
  })

  it('settings 服务缺席(headless)→ 写面保持缺席,读访问不受影响', () => {
    const access: AgentTeamSettingsAccess = settingsAccessFromConfig({ enabledModels: {} })
    wireAgentTeamSettings({}, access)
    expect(access.setModelGrant).toBeUndefined()
    expect(access.setRoleDefault).toBeUndefined()
    expect(access.modelGrantedFor?.('deepseek-official', 'deepseek-v4-pro')).toBe(true)
  })
})

describe('插件 Config 就是设置命名空间(防回归)', () => {
  it('entry Config 必须携带两个 volatile 字段 —— 否则设置页整页消失', async () => {
    // DSH 0.1.7 的 SettingsForms.describe() 以组合 entry 的 Config 为 schema,
    // volatileForm() 会跳过没有 volatile 字段的 entry;write() 也只放行
    // volatile 路径。字段一旦离开 Config(比如改回「独立注册命名空间」),
    // 本用例先红,而不是等到用户点不动才发现。
    const { Config } = await import('./index.ts')
    const form = AgentTeamSettingsFields
    expect(volatileOf(form.enabledModels)).toBe(true)
    expect(volatileOf(form.roleDefaults)).toBe(true)
    // Config 复用同一份 schema 实例,故标记与字段名同时被钉住。
    expect(Config.dict?.enabledModels).toBe(form.enabledModels)
    expect(Config.dict?.roleDefaults).toBe(form.roleDefaults)
    expect(volatileOf(Config.dict?.enabledModels)).toBe(true)
    expect(volatileOf(Config.dict?.roleDefaults)).toBe(true)
  })
})
