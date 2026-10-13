/**
 * AgentTeam 设置中心 section 纯逻辑测试(t13/t14/t20)。
 *
 * 与 activity-panel-helpers.test 同构(node 环境无 jsdom,直测导出纯函数):
 * providerGrantRows(t14)、toggleProviderModels、mergeRoleDefaults(t20 实时
 * 合并)、settingsCenterFromStateBody(t20 base/覆盖拆分)。
 * @module dsh-agent-team-web/client/provider-grants-section.test
 */

import { describe, expect, it, vi } from 'vitest'

// ProviderGrantsSection 引入的 dsh-client-ui-primitives 带 .module.css(node
// 环境无法解析外部化包的 CSS);图标仅作展示,桩为最小 stub 组件。
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconBrowseOutline16: () => null,
}))

import { ROLE_DUTY } from './roles.ts'

describe('experience editor server settlement', () => {
  const body = { workspace: '/explicit/workspace', id: 'bp-1', expectedRevision: 0, action: 'disable', reason: '用户撤销' }
  it('only 200 with a valid entry reports success and includes token', async () => {
    let request: RequestInit | undefined
    const send = vi.fn(async (_url: string, init?: RequestInit) => {
      request = init
      return { ok: true, status: 200, json: async () => ({ id: 'bp-1', revision: 1 }) } as Response
    })
    expect(await submitPracticeMutation(body, 'token', send as typeof fetch)).toEqual({ kind: 'ok', entry: { id: 'bp-1', revision: 1 } })
    expect(request?.headers).toMatchObject({ 'x-dsh-agent-teams-token': 'token' })
    expect(JSON.parse(String(request?.body))).toMatchObject(body)
  })
  it.each([409, 403, 500])('HTTP %i never reports optimistic success', async status => {
    const send = vi.fn(async () => ({ ok: false, status }) as Response)
    expect((await submitPracticeMutation(body, 'token', send as typeof fetch)).kind).toBe(
      status === 409 ? 'conflict' : status === 403 ? 'forbidden' : 'failed',
    )
  })
  it('network error fails closed and never confirms save', async () => {
    const send = vi.fn(async () => { throw new Error('offline') })
    expect(await submitPracticeMutation(body, 'token', send as typeof fetch)).toEqual({ kind: 'failed' })
  })
})

describe('experience editor input validation', () => {
  it('requires practice and structured counterexamples before posting', () => {
    expect(validatePracticePatch({ practice: ' ', appliesWhen: '', counterexamples: '', expiresAt: '' })).toContain('不能为空')
    expect(validatePracticePatch({ practice: 'valid', appliesWhen: '', counterexamples: 'no separator', expiresAt: '' })).toContain('场景 | 原因')
    expect(validatePracticePatch({ practice: 'valid', appliesWhen: '代码审查', counterexamples: '缓存未命中 | 先查日志', expiresAt: '' })).toBeUndefined()
  })
})
import {
  modelCapabilityValue,
  modelEnabled,
  toggleModelCapability,
  mergeRoleDefaults,
  roleDutyDescription,
  MEMBER_PRESET_ROLES,
  modelKeyOf,
  providerGrantRows,
  settingsCenterFromStateBody,
  toggleProviderModels,
  validatePracticePatch,
  submitPracticeMutation,
} from './ProviderGrantsSection.tsx'

const PROVIDERS = [
  { id: 'deepseek-official', name: 'DeepSeek Official', models: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
  { id: 'kimi-coding', name: 'Kimi Coding', models: ['kimi-k2.7-code'] },
  { id: 'xiaomi', name: 'Xiaomi', models: ['xiaomi-m1'] },
  { id: 'cc-switch', name: 'CC Switch', models: ['cc-model-1'] },
]

describe('model capability allowlist UI contract', () => {
  const model = { id: 'routed-model', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }
  it('uses exact adapter-provided effort ids and does not invent effort when absent', () => {
    expect(toggleModelCapability(undefined, 'p', model, true)).toEqual({ 'p/routed-model': { enabled: true } })
    expect(toggleModelCapability(undefined, 'p', { id: 'plain' }, true)).toEqual({ 'p/plain': { enabled: true } })
  })
  it('reads legacy boolean grants without deleting them and prefers explicit new value', () => {
    const legacy = { enabledModels: { 'p/routed-model': true }, roleDefaults: { engineer: { model: 'old' } } }
    expect(modelCapabilityValue(legacy, 'p', 'routed-model')).toEqual({ enabled: true })
    expect(modelEnabled('p', model, legacy)).toBe(true)
    expect(toggleModelCapability(legacy, 'p', model, false)).toEqual({ 'p/routed-model': { enabled: false } })
    expect(legacy.enabledModels).toEqual({ 'p/routed-model': true })
    expect(legacy.roleDefaults).toEqual({ engineer: { model: 'old' } })
  })
  it('keeps missing caps unset, clears cap on explicit default, and locks only built-in grant', () => {
    expect(toggleModelCapability({ modelCapabilities: { 'p/routed-model': { enabled: true, maxReasoningEffort: 'high' } } }, 'p', model, true, '')).toEqual({ 'p/routed-model': { enabled: true } })
    expect(toggleModelCapability(undefined, 'p', model, true, 'imaginary')).toEqual({ 'p/routed-model': { enabled: true } })
    expect(modelEnabled('deepseek-official', { id: 'd' }, undefined)).toBe(false)
    expect(modelEnabled('deepseek-official', { id: 'd' }, { modelCapabilities: { 'deepseek-official/d': { enabled: true } } })).toBe(true)
    expect(toggleModelCapability(undefined, 'deepseek-official', { id: 'd' }, false)).toEqual({ 'deepseek-official/d': { enabled: false } })
  })
})

describe('providerGrantRows — provider 粒度行(t14)', () => {
  it('4 provider 各一行;DeepSeek 授权由显式 grant 决定且可关闭', () => {
    const rows = providerGrantRows(PROVIDERS, {})
    expect(rows).toEqual([
      { id: 'deepseek-official', name: 'DeepSeek Official', enabled: false },
      { id: 'kimi-coding', name: 'Kimi Coding', enabled: false },
      { id: 'xiaomi', name: 'Xiaomi', enabled: false },
      { id: 'cc-switch', name: 'CC Switch', enabled: false },
    ])
  })

  it('行 enabled = 该 provider 全部模型已授权(全开才 ON)', () => {
    const rows = providerGrantRows(PROVIDERS, {
      'kimi-coding/kimi-k2.7-code': true,
      'xiaomi/xiaomi-m1': false,
    })
    const kimi = rows.find(r => r.id === 'kimi-coding')
    const xiaomi = rows.find(r => r.id === 'xiaomi')
    expect(kimi?.enabled).toBe(true)
    expect(xiaomi?.enabled).toBe(false)
  })

  it('部分授权(个别模型)不算全开 → 行 OFF', () => {
    const rows = providerGrantRows([
      { id: 'a', name: 'A', models: ['m1', 'm2'] },
    ], { 'a/m1': true })
    expect(rows[0]?.enabled).toBe(false)
  })

  it('空列表 → 空行', () => {
    expect(providerGrantRows([], {})).toEqual([])
  })

  it('modelKeyOf 复合格式', () => {
    expect(modelKeyOf('kimi-coding', 'kimi-k2.7-code')).toBe('kimi-coding/kimi-k2.7-code')
  })
})

describe('toggleProviderModels — provider 行 switch 联动全部模型(t14)', () => {
  it('开启 = 该 provider 全部模型授权(各写复合 key),保留其他 provider', () => {
    const next = toggleProviderModels({ 'cc-switch/cc-model-1': true }, 'kimi-coding', ['kimi-k2.7-code'], true)
    expect(next).toEqual({
      'cc-switch/cc-model-1': true,
      'kimi-coding/kimi-k2.7-code': true,
    })
  })

  it('关闭 = 删除该 provider 全部模型 key,保留其他', () => {
    const next = toggleProviderModels(
      { 'kimi-coding/kimi-k2.7-code': true, 'xiaomi/xiaomi-m1': true },
      'kimi-coding',
      ['kimi-k2.7-code'],
      false,
    )
    expect(next).toEqual({ 'xiaomi/xiaomi-m1': true })
  })

  it('map 缺失 / 无模型 → 安全处理', () => {
    expect(toggleProviderModels(undefined, 'kimi-coding', ['kimi-k2.7-code'], true))
      .toEqual({ 'kimi-coding/kimi-k2.7-code': true })
    expect(toggleProviderModels({}, 'kimi-coding', undefined, true)).toEqual({})
  })
})

describe('role preset duties survive empty legacy routing data', () => {
  it('uses every member duty role in stable preset order with empty base/overrides', () => {
    const rows = mergeRoleDefaults({}, {})
    expect(rows.map(row => row.role)).toEqual([...MEMBER_PRESET_ROLES])
    expect(rows.map(row => row.role)).toEqual(['researcher', 'engineer', 'qa', 'designer', 'data', 'docs', 'security', 'reviewer', 'commissar'])
  })
  it('uses duty slogan and neutral text for legacy-only roles', () => {
    const translate = (key: string): string => key === 'settings.agentTeam.roleDutyUnavailable' ? '暂无职责说明。' : key
    expect(roleDutyDescription('engineer', translate)).toBe(ROLE_DUTY.engineer?.slogan)
    expect(roleDutyDescription('custom-legacy', translate)).toBe('暂无职责说明。')
  })
  it('preserves legacy-only role ids after preset roles', () => {
    expect(mergeRoleDefaults({}, { 'custom-legacy': { model: 'old-model' } }).map(row => row.role)).toContain('custom-legacy')
  })
})

describe('mergeRoleDefaults — 实时合并(t20 主因修复)', () => {
  const base = {
    engineer: { model: 'deepseek-v4-flash', reasoningEffort: 'high' },
    qa: { model: 'deepseek-v4-flash' },
  }

  it('显示值 = 实时覆盖 ?? base;overridden 由实时覆盖判定', () => {
    const rows = mergeRoleDefaults(base, { engineer: { model: 'custom-m1' } })
    expect(rows.find(row => row.role === 'engineer')).toEqual({ role: 'engineer', model: 'custom-m1', overridden: true })
    expect(rows.find(row => row.role === 'qa')).toEqual({ role: 'qa', model: 'deepseek-v4-flash', overridden: false })
  })

  it('删覆盖后回落 base(overridden 翻 false);base 缺失安全', () => {
    const rows = mergeRoleDefaults(base, {})
    expect(rows.find(r => r.role === 'engineer')).toMatchObject({ model: 'deepseek-v4-flash', reasoningEffort: 'high', overridden: false })
    expect(mergeRoleDefaults(undefined, { engineer: { model: 'm' } }).find(row => row.role === 'engineer')).toEqual(
      { role: 'engineer', model: 'm', overridden: true },
    )
    expect(mergeRoleDefaults(undefined, undefined)).toHaveLength(MEMBER_PRESET_ROLES.length)
  })
})






describe('settingsCenterFromStateBody — /state 顶层数据解析(t20 base/覆盖拆分)', () => {
  it('providers + roleDefaultsBase + roleDefaultsOverrides + selfGrowth 直取', () => {
    const body = {
      providers: PROVIDERS,
      roleDefaultsBase: { engineer: { model: 'deepseek-v4-flash' } },
      roleDefaultsOverrides: { engineer: { model: 'custom-m1' } },
      selfGrowth: { total: 3, calibrated: 1, recent: [{ id: 'bp-1', sourceTeamId: 't', sourceTaskSubject: 's', role: 'r', practice: 'p', verdict: 'pending' }] },
    }
    expect(settingsCenterFromStateBody(body)).toEqual(body)
  })

  it('结构不符 → 空数组/空 map/空 selfGrowth', () => {
    const empty = { providers: [], roleDefaultsBase: {}, roleDefaultsOverrides: {}, selfGrowth: { total: 0, calibrated: 0, recent: [] } }
    expect(settingsCenterFromStateBody(undefined)).toEqual(empty)
    expect(settingsCenterFromStateBody({ teams: [] })).toEqual(empty)
  })
})


describe('ROLE_DUTY — 角色职责说明表(t9 查看弹窗数据源)', () => {
  const ALL_ROLES = [
    'captain', 'researcher', 'engineer', 'qa', 'designer', 'data',
    'docs', 'security', 'reviewer', 'commissar',
  ]

  it('9 个预设角色均有职责条目(slogan/steps/deliverable 非空)', () => {
    for (const role of ALL_ROLES) {
      const duty = ROLE_DUTY[role]
      expect(duty, `role ${role} missing ROLE_DUTY`).toBeDefined()
      expect(duty?.slogan.length).toBeGreaterThan(0)
      expect(duty?.steps.length).toBeGreaterThan(0)
      for (const step of duty?.steps ?? []) {
        expect(step.title.length).toBeGreaterThan(0)
        expect(step.desc.length).toBeGreaterThan(0)
      }
      expect(duty?.deliverable.length).toBeGreaterThan(0)
      expect(duty?.rules.length).toBeGreaterThan(0)
      for (const rule of duty?.rules ?? []) {
        expect(rule.length).toBeGreaterThan(0)
      }
    }
  })

  it('未知角色 → undefined(弹窗显示空态,不崩溃)', () => {
    expect(ROLE_DUTY['unknown-role']).toBeUndefined()
  })
})
