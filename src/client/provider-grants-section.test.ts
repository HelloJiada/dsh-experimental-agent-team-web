/**
 * AgentTeam 设置中心 section 纯逻辑测试(t13/t14)。
 *
 * 与 activity-panel-helpers.test 同构(node 环境无 jsdom,直测导出纯函数):
 * providerGrantRows(t14:provider 粒度行,deepseek 锁定「默认」,enabled=全部
 * 模型已授权)、toggleProviderModels(provider 行 switch 联动全部模型 key)、
 * rolePresetRows、roleDefaultsMap、settingsCenterFromStateBody。
 * @module dsh-agent-team-web/client/provider-grants-section.test
 */

import { describe, expect, it } from 'vitest'
import {
  modelKeyOf,
  providerGrantRows,
  resetRoleDefaults,
  roleDefaultsMap,
  rolePresetModelGroups,
  rolePresetRows,
  rolePresetSelectedGroup,
  settingsCenterFromStateBody,
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

describe('rolePresetRows — 角色预设行(t17 合并视图透传)', () => {
  const views = [
    { role: 'engineer', provider: 'kimi-coding', model: 'kimi-k2.7-code', reasoningEffort: 'high', overridden: true },
    { role: 'qa', overridden: false },
  ]

  it('合并视图直接透传(模型选项改由全 provider 分组提供)', () => {
    expect(rolePresetRows(views)).toEqual(views)
  })
})

describe('rolePresetModelGroups / rolePresetSelectedGroup — 模型下拉按 provider 分组(t17)', () => {
  it('分组 = 全部含模型的 provider;无模型 provider 过滤', () => {
    expect(rolePresetModelGroups(PROVIDERS)).toEqual([
      { providerId: 'deepseek-official', models: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
      { providerId: 'kimi-coding', models: ['kimi-k2.7-code'] },
      { providerId: 'xiaomi', models: ['xiaomi-m1'] },
      { providerId: 'cc-switch', models: ['cc-model-1'] },
    ])
    expect(rolePresetModelGroups([{ id: 'x', name: 'X' }])).toEqual([])
  })

  it('选中值所在组:按 provider+model 定位;无覆盖/模型不在任何组 → undefined', () => {
    const groups = rolePresetModelGroups(PROVIDERS)
    expect(rolePresetSelectedGroup(groups, { provider: 'kimi-coding', model: 'kimi-k2.7-code' })).toBe('kimi-coding')
    expect(rolePresetSelectedGroup(groups, { provider: 'kimi-coding', model: 'no-such' })).toBeUndefined()
    expect(rolePresetSelectedGroup(groups, undefined)).toBeUndefined()
  })
})

describe('resetRoleDefaults — 「恢复默认」全清(t17)', () => {
  it('返回空 map(scope.set 后所有角色回落三源链)', () => {
    expect(resetRoleDefaults()).toEqual({})
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

describe('settingsCenterFromStateBody — /state 顶层数据解析(t13)', () => {
  it('providers(含 models)与 roleDefaults 合并视图直取', () => {
    const body = {
      providers: PROVIDERS,
      roleDefaults: [{ role: 'engineer', model: 'deepseek-v4-flash', overridden: true }],
    }
    expect(settingsCenterFromStateBody(body)).toEqual(body)
  })

  it('结构不符 → 空数组', () => {
    expect(settingsCenterFromStateBody(undefined)).toEqual({ providers: [], roleDefaults: [] })
    expect(settingsCenterFromStateBody({ teams: [] })).toEqual({ providers: [], roleDefaults: [] })
  })
})
