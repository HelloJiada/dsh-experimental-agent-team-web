/**
 * AgentTeam 设置中心 section 纯逻辑测试(t13/t14/t20)。
 *
 * 与 activity-panel-helpers.test 同构(node 环境无 jsdom,直测导出纯函数):
 * providerGrantRows(t14)、toggleProviderModels、mergeRoleDefaults(t20 实时
 * 合并)、rolePresetModelGroups、roleDefaultsMap、resetRoleDefaults、
 * settingsCenterFromStateBody(t20 base/覆盖拆分)。
 * @module dsh-agent-team-web/client/provider-grants-section.test
 */

import { describe, expect, it, vi } from 'vitest'

// ProviderGrantsSection 引入的 dsh-client-ui-primitives 带 .module.css(node
// 环境无法解析外部化包的 CSS);图标仅作展示,桩为最小 stub 组件。
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconBrowseOutline16: () => null,
}))

import { ROLE_DUTY } from './roles.ts'
import {
  autoAssignDiffers,
  autoAssignHasTarget,
  autoAssignRoleDefaults,
  mergeRoleDefaults,
  modelKeyOf,
  providerGrantRows,
  resetRoleDefaults,
  roleDefaultsMap,
  rolePresetModelGroups,
  settingsCenterFromStateBody,
  supportsReasoningEffort,
  toggleProviderModels,
} from './ProviderGrantsSection.tsx'

const PROVIDERS = [
  { id: 'deepseek-official', name: 'DeepSeek Official', models: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
  { id: 'kimi-coding', name: 'Kimi Coding', models: ['kimi-k2.7-code'] },
  { id: 'xiaomi', name: 'Xiaomi', models: ['xiaomi-m1'] },
  { id: 'cc-switch', name: 'CC Switch', models: ['cc-model-1'] },
]

describe('providerGrantRows — provider 粒度行(t14)', () => {
  it('4 provider 各一行(无模型子列表);deepseek-official 恒锁定恒启用', () => {
    const rows = providerGrantRows(PROVIDERS, {})
    expect(rows).toEqual([
      { id: 'deepseek-official', name: 'DeepSeek Official', enabled: true, locked: true },
      { id: 'kimi-coding', name: 'Kimi Coding', enabled: false, locked: false },
      { id: 'xiaomi', name: 'Xiaomi', enabled: false, locked: false },
      { id: 'cc-switch', name: 'CC Switch', enabled: false, locked: false },
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

describe('mergeRoleDefaults — 实时合并(t20 主因修复)', () => {
  const base = {
    engineer: { model: 'deepseek-v4-flash', reasoningEffort: 'high' },
    qa: { model: 'deepseek-v4-flash' },
  }

  it('显示值 = 实时覆盖 ?? base;overridden 由实时覆盖判定', () => {
    const rows = mergeRoleDefaults(base, { engineer: { model: 'custom-m1' } })
    expect(rows).toEqual([
      { role: 'engineer', model: 'custom-m1', overridden: true },
      { role: 'qa', model: 'deepseek-v4-flash', overridden: false },
    ])
  })

  it('删覆盖后回落 base(overridden 翻 false);base 缺失安全', () => {
    const rows = mergeRoleDefaults(base, {})
    expect(rows.find(r => r.role === 'engineer')).toMatchObject({ model: 'deepseek-v4-flash', reasoningEffort: 'high', overridden: false })
    expect(mergeRoleDefaults(undefined, { engineer: { model: 'm' } })).toEqual([
      { role: 'engineer', model: 'm', overridden: true },
    ])
    expect(mergeRoleDefaults(undefined, undefined)).toEqual([])
  })
})

describe('rolePresetModelGroups — 模型下拉按 provider 分组 + 授权过滤(t17/t22)', () => {
  it('enabledModels 缺省时不过滤(兼容旧行为);无模型 provider 过滤', () => {
    expect(rolePresetModelGroups(PROVIDERS)).toEqual([
      { providerId: 'deepseek-official', models: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
      { providerId: 'kimi-coding', models: ['kimi-k2.7-code'] },
      { providerId: 'xiaomi', models: ['xiaomi-m1'] },
      { providerId: 'cc-switch', models: ['cc-model-1'] },
    ])
    expect(rolePresetModelGroups([{ id: 'x', name: 'X' }])).toEqual([])
  })

  it('t22:deepseek-official 恒可调度(不看授权);其他 provider 需全部模型已授权', () => {
    const enabled = { 'kimi-coding/kimi-k2.7-code': true }
    const groups = rolePresetModelGroups(PROVIDERS, enabled)
    expect(groups).toEqual([
      { providerId: 'deepseek-official', models: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
      { providerId: 'kimi-coding', models: ['kimi-k2.7-code'] },
    ])
  })

  it('t22:未授权/部分授权组剔除;空组剔除', () => {
    // 部分授权(kimi 两模型只授权一个)→ 组剔除。
    const partial = rolePresetModelGroups([
      { id: 'kimi-coding', name: 'Kimi', models: ['m1', 'm2'] },
    ], { 'kimi-coding/m1': true })
    expect(partial).toEqual([])
    // 全部授权 → 组全量。
    const all = rolePresetModelGroups([
      { id: 'kimi-coding', name: 'Kimi', models: ['m1', 'm2'] },
    ], { 'kimi-coding/m1': true, 'kimi-coding/m2': true })
    expect(all).toEqual([{ providerId: 'kimi-coding', models: ['m1', 'm2'] }])
  })
})

describe('resetRoleDefaults — 「恢复默认」全清(t17)', () => {
  it('返回空 map(scope.set 后所有角色回落三源链)', () => {
    expect(resetRoleDefaults()).toEqual({})
  })
})

describe('autoAssignRoleDefaults — 授权变化自动重分配(t23/t26)', () => {
  // 小档位表(两角色)便于断言。t26:cc-switch(GPT-5.6)目标不支持 reasoning
  // effort → 不配 effort;deepseek 回退保留 effort。
  const table = {
    engineer: {
      provider: 'cc-switch', model: 'gpt-5.6-terra[1M]',
      fallback: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
    },
    designer: {
      provider: 'cc-switch', model: 'gpt-5.6-luna[1M]',
      fallback: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', reasoningEffort: 'low' },
    },
  }

  it('继承态角色被分配:目标授权 → 写 cc-switch + auto:true(无 effort 字段)', () => {
    const next = autoAssignRoleDefaults(undefined, {
      'cc-switch/gpt-5.6-terra[1M]': true,
      'cc-switch/gpt-5.6-luna[1M]': true,
    }, table)
    expect(next).toEqual({
      engineer: { provider: 'cc-switch', model: 'gpt-5.6-terra[1M]', auto: true },
      designer: { provider: 'cc-switch', model: 'gpt-5.6-luna[1M]', auto: true },
    })
  })

  it('目标未授权 → 回退 deepseek 档位(仍 auto:true,保留 effort)', () => {
    const next = autoAssignRoleDefaults(undefined, {}, table)
    expect(next).toEqual({
      engineer: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', auto: true },
      designer: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', reasoningEffort: 'low', auto: true },
    })
  })

  it('手动覆盖(无 auto)→ 保留不动;auto 标记角色可重算(关授权回退 deepseek)', () => {
    const current = {
      engineer: { provider: 'kimi-coding', model: 'kimi-k2.7-code', reasoningEffort: 'high' }, // 手动
      designer: { provider: 'cc-switch', model: 'gpt-5.6-luna[1M]', auto: true }, // auto(无 effort)
    }
    const next = autoAssignRoleDefaults(current, {}, table)
    expect(next.engineer).toEqual({ provider: 'kimi-coding', model: 'kimi-k2.7-code', reasoningEffort: 'high' })
    expect(next.designer).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', reasoningEffort: 'low', auto: true })
  })

  it('无关角色/已有覆盖原样保留;再开授权 auto 角色回到目标(无 effort)', () => {
    const current = {
      docs: { provider: 'kimi-coding', model: 'kimi-k2.7-code' }, // 无关角色(不在表)
      engineer: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', auto: true },
    }
    const next = autoAssignRoleDefaults(current, { 'cc-switch/gpt-5.6-terra[1M]': true }, table)
    expect(next.docs).toEqual({ provider: 'kimi-coding', model: 'kimi-k2.7-code' })
    expect(next.engineer).toEqual({ provider: 'cc-switch', model: 'gpt-5.6-terra[1M]', auto: true })
  })

  it('t25:幂等——已分配且授权匹配 → 重算结果不变(初始化不重复写)', () => {
    const current = {
      engineer: { provider: 'cc-switch', model: 'gpt-5.6-terra[1M]', auto: true },
      designer: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', reasoningEffort: 'low', auto: true },
    }
    const enabled = { 'cc-switch/gpt-5.6-terra[1M]': true } // designer 目标未授权
    expect(autoAssignRoleDefaults(current, enabled, table)).toEqual(current)
    expect(autoAssignDiffers(current, enabled, table)).toBe(false)
  })

  it('t25:autoAssignDiffers——有变更 true/无变更 false', () => {
    const enabled = { 'cc-switch/gpt-5.6-terra[1M]': true, 'cc-switch/gpt-5.6-luna[1M]': true }
    // 空覆盖 → 需要分配(differs true)。
    expect(autoAssignDiffers(undefined, enabled, table)).toBe(true)
    // 已按表分配 → 无变更(false)。
    const assigned = autoAssignRoleDefaults(undefined, enabled, table)
    expect(autoAssignDiffers(assigned, enabled, table)).toBe(false)
    // 手动覆盖(engineer 非表档位)→ 仍有变更(designer 待分配)。
    expect(autoAssignDiffers({ engineer: { model: 'custom' } }, enabled, table)).toBe(true)
  })

  it('t25:autoAssignHasTarget——任一表目标已授权为 true;无/undefined 为 false', () => {
    expect(autoAssignHasTarget({ 'cc-switch/gpt-5.6-terra[1M]': true }, table)).toBe(true)
    expect(autoAssignHasTarget({ 'cc-switch/other-model': true }, table)).toBe(false)
    expect(autoAssignHasTarget({}, table)).toBe(false)
    expect(autoAssignHasTarget(undefined, table)).toBe(false)
  })
})

describe('roleDefaultsMap — 角色档位覆盖写(「默认」= 删覆盖)', () => {
  it('写覆盖保留其他项;undefined 删该项', () => {
    expect(roleDefaultsMap({ engineer: { model: 'm1' } }, 'qa', { model: 'm2' }))
      .toEqual({ engineer: { model: 'm1' }, qa: { model: 'm2' } })
    expect(roleDefaultsMap({ engineer: { model: 'm1' }, qa: { model: 'm2' } }, 'qa', undefined))
      .toEqual({ engineer: { model: 'm1' } })
  })

  it('map 缺失 → 只含目标项', () => {
    expect(roleDefaultsMap(undefined, 'engineer', { model: 'm1' })).toEqual({ engineer: { model: 'm1' } })
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

describe('supportsReasoningEffort — 能力表查表(t8 通用适配)', () => {
  it('已知不支持列表(cc-switch)→ false', () => {
    expect(supportsReasoningEffort('cc-switch')).toBe(false)
  })

  it('deepseek-official(默认支持)→ true', () => {
    expect(supportsReasoningEffort('deepseek-official')).toBe(true)
  })

  it('未知 provider 默认支持(新增模型未登记也安全)→ true', () => {
    expect(supportsReasoningEffort('kimi-coding')).toBe(true)
    expect(supportsReasoningEffort('xiaomi')).toBe(true)
    expect(supportsReasoningEffort('future-provider')).toBe(true)
  })

  it('undefined → false(无 provider 无 effort)', () => {
    expect(supportsReasoningEffort(undefined)).toBe(false)
  })
})

describe('ROLE_DUTY — 角色职责说明表(t9 查看弹窗数据源)', () => {
  const ALL_ROLES = [
    'researcher', 'engineer', 'qa', 'designer', 'data',
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
