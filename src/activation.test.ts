/**
 * 按需激活回归测试(activation.ts)。
 *
 * 这里锁的是「token 成本分界」这个契约本身,而不只是功能能不能跑:
 * - 插件根上下文只装「提示段 + 激活工具」,14 个团队工具与完整协议都**不在**
 *   根层——未使用 AgentTeams 的会话因此只付提示的钱(实测根层约 215 tokens
 *   对齐全量约 4,500 tokens);
 * - 激活把 14 个工具与完整协议装进**调用方 agent 自己的 ctx**,协议段与提示段
 *   同名(靠 scoped section 遮蔽,而非并列);
 * - 重复激活幂等(第二次 false 且不抛 duplicate registration);
 * - 两个 agent 各自独立激活;
 * - 无 agent 调激活工具 → 明确报错,不静默成功。
 *
 * scope 继承(成员子 scope 拿到队长的工具)由 harness 自身保证,见
 * packages/core/tools/tests/scoped.spec.ts「filters tools the child inherits
 * from an ancestor scope」;本文件用桩层验证我们注册到哪一层。
 *
 * @module dsh-agent-team-web/activation
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'
import {
  AGENT_TEAMS_ACTIVATION_TOOL,
  AGENT_TEAMS_USAGE_SECTION,
  TEAM_TOOL_NAMES,
  activateAgentTeams,
  activationHintText,
  isAgentTeamsActivated,
  registerAgentTeamsActivation,
  usageSectionText,
} from './activation.ts'
import type { AgentTeamsRuntime, ToolsConfig } from './tools.ts'
import { registerAgentTeamsTools } from './tools.ts'

const config: ToolsConfig = {
  stateDir: '.agent-team-web',
  memberProvider: 'spawn',
  maxMembers: 18,
  stallThresholdMs: 120_000,
}

/** 桩运行时:注册期只被解构,只有 execute 才用其成员,故空对象足够。 */
const runtime = { } as AgentTeamsRuntime

/** 一段 stub 注册层,模拟一个 scope 的 tools/systemPrompt 贡献表。 */
interface Layer {
  tools: Map<string, StubTool>
  sections: Map<string, { order: number; text: string | ((context: unknown) => string) }>
}

/** 注册进桩层的最小工具面。 */
interface StubTool {
  name: string
  execute: (
    args: unknown,
    exec: { agent?: Agent; signal: AbortSignal },
  ) => Promise<{ activated: boolean; tool_count: number }>
}

function layer(): Layer {
  return { tools: new Map(), sections: new Map() }
}

function ctxOf(target: Layer): Context {
  return {
    tools: {
      register: (definition: StubTool) => {
        target.tools.set(definition.name, definition)
        return () => undefined
      },
    },
    systemPrompt: {
      section: (section: { name: string; order: number; text: string | ((context: unknown) => string) }) => {
        target.sections.set(section.name, section)
        return () => undefined
      },
    },
    logger: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
  } as unknown as Context
}

function agentOf(target: Layer, id = 'session-captain'): Agent {
  return { id, ctx: ctxOf(target) } as unknown as Agent
}

/** 根层注册后取到的激活工具定义。 */
function activationTool(root: Layer): StubTool {
  const tool = root.tools.get(AGENT_TEAMS_ACTIVATION_TOOL)
  if (tool === undefined) throw new Error('activation tool was not registered on the plugin root')
  return tool
}

/** 走真实工具入口激活一次(而不是直接调 activateAgentTeams)。 */
async function activateViaTool(root: Layer, agent: Agent): Promise<{ activated: boolean; tool_count: number }> {
  return activationTool(root).execute({}, { agent, signal: new AbortController().signal })
}

describe('always-on surface', () => {
  it('TEAM_TOOL_NAMES 与实际注册的工具集逐字一致(协议工具清单不许漂移)', () => {
    const registered = layer()
    registerAgentTeamsTools(ctxOf(registered), config, runtime)

    // 这条断言抓到过一次真实缺陷:协议末尾的 Tools: 行漏了 agent_teams_set_mode,
    // 而工具其实是注册的(模型被清单误导)。清单与实际注册集必须互为全集。
    expect([...registered.tools.keys()].sort()).toEqual([...TEAM_TOOL_NAMES].sort())
    expect(TEAM_TOOL_NAMES.length).toBe(registered.tools.size)
  })

  it('注册到根层的只有提示段与激活工具,没有任何团队工具', () => {
    const root = layer()
    registerAgentTeamsActivation(ctxOf(root), config, 117, runtime)

    expect([...root.tools.keys()]).toEqual([AGENT_TEAMS_ACTIVATION_TOOL])
    expect([...root.sections.keys()]).toEqual([AGENT_TEAMS_USAGE_SECTION])
    for (const name of TEAM_TOOL_NAMES) expect(root.tools.has(name)).toBe(false)
  })

  it('提示段说明「未加载」并给出激活入口,长度远小于完整协议', () => {
    const hint = activationHintText()
    expect(hint).toContain('NOT loaded')
    expect(hint).toContain(AGENT_TEAMS_ACTIVATION_TOOL)
    expect(hint).toContain('/agent-teams')
    // 提示段必须是完整协议的零头,否则按需加载就没有意义了。
    expect(hint.length * 8).toBeLessThan(usageSectionText(TEAM_TOOL_NAMES.join(', ')).length)
  })

  it('未激活的 agent 层看不到任何团队工具', () => {
    const root = layer()
    const other = layer()
    registerAgentTeamsActivation(ctxOf(root), config, 117, runtime)

    expect(other.tools.size).toBe(0)
    expect(activateAgentTeams(agentOf(other), config, 117, runtime)).toBe(true)
  })
})

describe('activation', () => {
  it('把 14 个工具与完整协议装进调用方 agent 自己的层,根层不变', async () => {
    const root = layer()
    const captain = layer()
    registerAgentTeamsActivation(ctxOf(root), config, 117, runtime)
    const agent = agentOf(captain)

    const result = await activateViaTool(root, agent)

    expect(result).toEqual({ activated: true, tool_count: TEAM_TOOL_NAMES.length })
    expect([...captain.tools.keys()].sort()).toEqual([...TEAM_TOOL_NAMES].sort())
    const protocol = captain.sections.get(AGENT_TEAMS_USAGE_SECTION)?.text
    expect(typeof protocol).toBe('string')
    expect(protocol as string).toContain('you are the captain of a multi-agent team')
    expect(protocol as string).toContain('agent_teams_retro_review')
    // 协议段与提示段同名:激活后遮蔽提示,而不是两段并存。
    expect(captain.sections.size).toBe(1)

    // 根层(其他会话)仍然只付提示的钱。
    expect([...root.tools.keys()]).toEqual([AGENT_TEAMS_ACTIVATION_TOOL])
    expect(root.sections.get(AGENT_TEAMS_USAGE_SECTION)?.text).toBe(activationHintText())
  })

  it('重复激活幂等:第二次 false、不重复注册、不抛 duplicate', () => {
    const root = layer()
    const captain = layer()
    registerAgentTeamsActivation(ctxOf(root), config, 117, runtime)
    const agent = agentOf(captain)

    expect(activateAgentTeams(agent, config, 117, runtime)).toBe(true)
    expect(activateAgentTeams(agent, config, 117, runtime)).toBe(false)
    expect(isAgentTeamsActivated(agent)).toBe(true)
    expect(captain.tools.size).toBe(TEAM_TOOL_NAMES.length)
    expect(captain.sections.size).toBe(1)
  })

  it('第二次走工具入口返回 activated:false,且提示队长不要重复建队', async () => {
    const root = layer()
    const captain = layer()
    registerAgentTeamsActivation(ctxOf(root), config, 117, runtime)
    const agent = agentOf(captain)

    await activateViaTool(root, agent)
    expect(await activateViaTool(root, agent)).toEqual({
      activated: false,
      tool_count: TEAM_TOOL_NAMES.length,
    })
  })

  it('两个 agent 各自独立激活,互不影响', async () => {
    const root = layer()
    const first = layer()
    const second = layer()
    registerAgentTeamsActivation(ctxOf(root), config, 117, runtime)

    const a = agentOf(first, 'session-a')
    const b = agentOf(second, 'session-b')
    expect(await activateViaTool(root, a)).toMatchObject({ activated: true })
    expect(await activateViaTool(root, b)).toMatchObject({ activated: true })

    expect(first.tools.size).toBe(TEAM_TOOL_NAMES.length)
    expect(second.tools.size).toBe(TEAM_TOOL_NAMES.length)
    expect(isAgentTeamsActivated(a)).toBe(true)
    expect(isAgentTeamsActivated(b)).toBe(true)
  })

  it('没有调用方 agent 时明确报错,而不是静默成功', async () => {
    const root = layer()
    registerAgentTeamsActivation(ctxOf(root), config, 117, runtime)

    await expect(activationTool(root).execute({}, { signal: new AbortController().signal }))
      .rejects.toThrow(/requires a calling agent/)
  })
})
