/**
 * Provider 授权设置页卡片纯逻辑测试(t8)。
 *
 * 与 activity-panel-helpers.test 同构(node 环境无 jsdom,直测导出纯函数):
 * providerGrantRows(deepseek-official 恒锁定恒启用、授权 map 映射、undefined
 * 安全)与 toggleEnabledMap(保留其他项、增删键)。
 * @module dsh-agent-team-web/client/provider-grants-section.test
 */

import { describe, expect, it } from 'vitest'
import {
  providerGrantRows,
  providersFromStateBody,
  toggleEnabledMap,
} from './ProviderGrantsSection.tsx'

const PROVIDERS = [
  { id: 'deepseek-official', name: 'DeepSeek Official' },
  { id: 'kimi-coding', name: 'Kimi Coding' },
  { id: 'xiaomi', name: 'Xiaomi' },
]

describe('providerGrantRows — 设置页 provider 行', () => {
  it('deepseek-official 恒锁定且恒 enabled;其余按授权 map', () => {
    const rows = providerGrantRows(PROVIDERS, { 'kimi-coding': true, xiaomi: false })
    expect(rows).toEqual([
      { id: 'deepseek-official', name: 'DeepSeek Official', enabled: true, locked: true },
      { id: 'kimi-coding', name: 'Kimi Coding', enabled: true, locked: false },
      { id: 'xiaomi', name: 'Xiaomi', enabled: false, locked: false },
    ])
  })

  it('授权 map 缺失 → 非 deepseek 全未授权(默认语义)', () => {
    const rows = providerGrantRows(PROVIDERS, undefined)
    expect(rows.every(row => row.id === 'deepseek-official' ? row.enabled : !row.enabled)).toBe(true)
  })

  it('空列表 → 空行(卡片不渲染)', () => {
    expect(providerGrantRows([], {})).toEqual([])
  })
})

describe('toggleEnabledMap — 开关 toggle 后的命名空间值', () => {
  it('保留其他项,只翻转目标 provider', () => {
    expect(toggleEnabledMap({ 'kimi-coding': true }, 'xiaomi', true))
      .toEqual({ 'kimi-coding': true, xiaomi: true })
    expect(toggleEnabledMap({ 'kimi-coding': true, xiaomi: true }, 'xiaomi', false))
      .toEqual({ 'kimi-coding': true, xiaomi: false })
  })

  it('map 缺失 → 只含目标项', () => {
    expect(toggleEnabledMap(undefined, 'cc-switch', true)).toEqual({ 'cc-switch': true })
  })
})

describe('providersFromStateBody — /state 顶层 providers(t10 全局化)', () => {
  it('顶层 providers 直接返回(不依赖 teams)', () => {
    expect(providersFromStateBody({ providers: PROVIDERS, teams: [] })).toEqual(PROVIDERS)
  })

  it('无顶层 providers / 结构不符 → 空数组', () => {
    expect(providersFromStateBody({ teams: [{ providers: PROVIDERS }] })).toEqual([])
    expect(providersFromStateBody(undefined)).toEqual([])
    expect(providersFromStateBody({ providers: 'nope' })).toEqual([])
  })
})
