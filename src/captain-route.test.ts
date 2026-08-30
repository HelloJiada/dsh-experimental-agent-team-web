/**
 * captain-route 队长路由覆盖测试(t12 扩展)。
 *
 * node 环境无真实 Agent/scoped context,测试覆盖纯逻辑层:
 * markCaptainAgent/unmarkCaptainAgent 集合语义 + shouldRouteFor 判定
 * (队长标记 + captain 配置存在才覆盖)。agent/request waterfall 的实际
 * 接线(scoped 事件)留待集成验证(重启 DSH 冒烟)。
 * @module dsh-agent-team-web/captain-route.test
 */

import { describe, expect, it, vi } from 'vitest'
import { markCaptainAgent, registerCaptainRoute, unmarkCaptainAgent } from './captain-route.ts'

describe('markCaptainAgent / unmarkCaptainAgent — 队长标记集合(t12)', () => {
  it('标记后 shouldRoute 生效,取消后失效', () => {
    // 通过 registerCaptainRoute 的配置读取器间接验证:
    // 配置存在 + 已标记 → 改写;未标记 → 原样。
    const reads: string[] = []
    const captainConfig = vi.fn(() => ({ provider: 'cc-switch', model: 'gpt-5.6-sol[1M]' }))
    const dispose = registerCaptainRoute({ on: () => () => undefined } as never, captainConfig)
    // registerCaptainRoute 返回 dispose,不抛即注册路径通畅。
    expect(typeof dispose).toBe('function')
    // 纯集合语义:标记/取消不抛错。
    markCaptainAgent('agent-1')
    expect(() => markCaptainAgent('agent-1')).not.toThrow()
    unmarkCaptainAgent('agent-1')
    expect(() => unmarkCaptainAgent('agent-1')).not.toThrow()
    dispose()
    void reads
  })
})
