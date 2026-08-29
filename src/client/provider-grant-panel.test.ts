/**
 * Provider 授权中心面板纯逻辑测试(switch 数据行 + 拨动请求契约)。
 *
 * 与 activity-panel-helpers.test.ts 同构:node 环境无 jsdom,抽取
 * ProviderGrantPanel 的纯函数层直测 —— providerGrantRows(deepseek-official
 * 恒锁定、enabled 透传、undefined 安全)与 providerToggleRequest(endpoint/
 * 方法/取反载荷契约,锁 R-17 写面)。
 * @module dsh-agent-team-web/client/provider-grant-panel.test
 */

import { describe, expect, it, vi } from 'vitest'

// ActivityPanel 引入的 dsh-client-ui-primitives 带 .module.css(node 环境无法
// 解析外部化包的 CSS);icon 仅作展示,桩为最小 stub 组件。
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconBranchOutline16: () => null,
  IconChevronDownOutline14: () => null,
  IconCloseOutline16: () => null,
  IconPanelLeftOutline16: () => null,
}))

import { providerGrantRows, providerToggleRequest } from './ActivityPanel.tsx'

describe('providerGrantRows — switch 行数据', () => {
  it('undefined(快照未透出)→ 空数组,面板不渲染', () => {
    expect(providerGrantRows(undefined)).toEqual([])
    expect(providerGrantRows([])).toEqual([])
  })

  it('deepseek-official 恒锁定,其余 provider 可拨动', () => {
    const rows = providerGrantRows([
      { id: 'deepseek-official', name: 'DeepSeek Official', enabled: true },
      { id: 'kimi-coding', name: 'Kimi Coding', enabled: false },
    ])
    expect(rows).toEqual([
      { id: 'deepseek-official', name: 'DeepSeek Official', enabled: true, locked: true },
      { id: 'kimi-coding', name: 'Kimi Coding', enabled: false, locked: false },
    ])
  })

  it('保持注册顺序与 enabled 状态透传(快照即真相)', () => {
    const rows = providerGrantRows([
      { id: 'xiaomi', name: 'Xiaomi', enabled: true },
      { id: 'cc-switch', name: 'CC Switch', enabled: true },
    ])
    expect(rows.map(row => row.id)).toEqual(['xiaomi', 'cc-switch'])
    expect(rows.every(row => row.enabled)).toBe(true)
    expect(rows.every(row => !row.locked)).toBe(true)
  })
})

describe('providerToggleRequest — switch 拨动请求契约', () => {
  it('关闭→开启:POST 授权路由,enabled 取反为 true', () => {
    expect(providerToggleRequest({ id: 'kimi-coding', enabled: false })).toEqual({
      method: 'POST',
      path: '/plugins/agent-team-web/provider-grant',
      body: { provider: 'kimi-coding', enabled: true },
    })
  })

  it('开启→关闭:enabled 取反为 false', () => {
    expect(providerToggleRequest({ id: 'xiaomi', enabled: true })).toEqual({
      method: 'POST',
      path: '/plugins/agent-team-web/provider-grant',
      body: { provider: 'xiaomi', enabled: false },
    })
  })

  it('写面固定 POST + 授权中心 endpoint(与后端路由契约一致)', () => {
    const request = providerToggleRequest({ id: 'cc-switch', enabled: false })
    expect(request.method).toBe('POST')
    expect(request.path).toBe('/plugins/agent-team-web/provider-grant')
  })
})
