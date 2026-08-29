/**
 * AgentTeam 设置中心 section 纯逻辑测试(t13)。
 *
 * 与 activity-panel-helpers.test 同构(node 环境无 jsdom,直测导出纯函数):
 * modelGrantRows(复合 key/锁定语义)、toggleModelMap、rolePresetRows(模型
 * 选项过滤)、roleDefaultsMap(「默认」=删覆盖)、settingsCenterFromStateBody。
 * @module dsh-agent-team-web/client/provider-grants-section.test
 */

import { describe, expect, it } from 'vitest'
import {
  modelGrantRows,
  modelKeyOf,
  roleDefaultsMap,
  rolePresetRows,
  settingsCenterFromStateBody,
  toggleModelMap,
} from './ProviderGrantsSection.tsx'

const PROVIDERS = [
  { id: 'deepseek-official', name: 'DeepSeek Official', models: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
  { id: 'kimi-coding', name: 'Kimi Coding', models: ['kimi-k2.7-code'] },
]

describe('modelGrantRows — 模型授权行(复合 key + 锁定语义)', () => {
  it('deepseek-official 名下模型恒锁定恒启用;其余按 enabledModels 复合 key', () => {
    const rows = modelGrantRows(PROVIDERS, { 'kimi-coding/kimi-k2.7-code': true })
    expect(rows).toEqual([
      { provider: 'deepseek-official', model: 'deepseek-v4-flash', enabled: true, locked: true },
      { provider: 'deepseek-official', model: 'deepseek-v4-pro', enabled: true, locked: true },
      { provider: 'kimi-coding', model: 'kimi-k2.7-code', enabled: true, locked: false },
    ])
  })

  it('跨 provider 同名模型不撞车:另一 provider 的同名 key 不影响本 provider', () => {
    const rows = modelGrantRows(
      [
        { id: 'a', name: 'A', models: ['m1'] },
        { id: 'b', name: 'B', models: ['m1'] },
      ],
      { 'a/m1': true },
    )
    expect(rows).toEqual([
      { provider: 'a', model: 'm1', enabled: true, locked: false },
      { provider: 'b', model: 'm1', enabled: false, locked: false },
    ])
  })

  it('无 models / 空列表 → 空行', () => {
    expect(modelGrantRows([{ id: 'x', name: 'X' }], {})).toEqual([])
    expect(modelGrantRows([], {})).toEqual([])
  })

  it('modelKeyOf 复合格式', () => {
    expect(modelKeyOf('kimi-coding', 'kimi-k2.7-code')).toBe('kimi-coding/kimi-k2.7-code')
  })
})

describe('toggleModelMap — 开关 toggle 后的 enabledModels', () => {
  it('保留其他项,只翻转目标 key', () => {
    expect(toggleModelMap({ 'a/m1': true }, 'b/m1', true)).toEqual({ 'a/m1': true, 'b/m1': true })
    expect(toggleModelMap({ 'a/m1': true }, 'a/m1', false)).toEqual({ 'a/m1': false })
  })

  it('map 缺失 → 只含目标 key', () => {
    expect(toggleModelMap(undefined, 'a/m1', true)).toEqual({ 'a/m1': true })
  })
})

describe('rolePresetRows — 角色预设行(模型选项按选中 provider 过滤)', () => {
  const views = [
    { role: 'engineer', provider: 'kimi-coding', model: 'kimi-k2.7-code', reasoningEffort: 'high', overridden: true },
    { role: 'qa', overridden: false },
  ]

  it('合并视图透传 + modelOptions 按 provider 过滤;未选 provider 无模型选项', () => {
    const rows = rolePresetRows(views, PROVIDERS)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ role: 'engineer', modelOptions: ['kimi-k2.7-code'] })
    expect(rows[1]).toMatchObject({ role: 'qa', modelOptions: [] })
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
