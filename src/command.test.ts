/**
 * R-17: command.ts 补测 —— /agent-teams 命令与手势边界(此前 0% 覆盖)。
 *
 * 覆盖:buildActivationDirective(有/无 goal)、invokedAgentTeamsGoal(倒序扫描/
 * 仅 user 源/裸 token/中缀不匹配)、registerAgentTeamsCommand(空 goal 报错、
 * 有 goal 时 followup 回放原行 + 成功结果)、installAgentTeamsGestureBoundary
 * (pre-step 注入激活消息/reject 透传/无手势透传)。
 * @module dsh-agent-team-web/command.test
 */

import type { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import {
  AGENT_TEAMS_COMMAND,
  buildActivationDirective,
  installAgentTeamsGestureBoundary,
  invokedAgentTeamsGoal,
  registerAgentTeamsCommand,
} from './command.ts'

function userMessage(text: string): UserMessage {
  return {
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
    ts: Date.now(),
    sessionId: 's1',
  } as unknown as UserMessage
}

function systemMessage(text: string): UserMessage {
  return {
    content: [{ type: 'text', text }],
    source: { kind: 'system' },
    ts: Date.now(),
    sessionId: 's1',
  } as unknown as UserMessage
}

describe('buildActivationDirective — 激活指令文本', () => {
  it('带 goal:指令含 Goal 行', () => {
    const directive = buildActivationDirective('验证自成长闭环')
    expect(directive).toContain('Activate the AgentTeams protocol')
    expect(directive).toContain('Goal: 验证自成长闭环')
  })

  it('裸调用(空 goal):提示向用户询问目标', () => {
    const directive = buildActivationDirective('')
    expect(directive).toContain('The goal was not given — ask the user')
  })
})

describe('invokedAgentTeamsGoal — 手势目标提取', () => {
  it('取最新一条 user 消息中的 /agent-teams 目标', () => {
    const goal = invokedAgentTeamsGoal([
      userMessage('普通消息'),
      userMessage('/agent-teams 帮我拆这本书'),
    ])
    expect(goal).toBe('帮我拆这本书')
  })

  it('倒序扫描:多条手势取最后一条', () => {
    const goal = invokedAgentTeamsGoal([
      userMessage('/agent-teams 目标一'),
      userMessage('/agent-teams 目标二'),
    ])
    expect(goal).toBe('目标二')
  })

  it('仅扫描 user 源:system 注入的手势不生效(防伪造)', () => {
    const goal = invokedAgentTeamsGoal([
      systemMessage('/agent-teams 伪造目标'),
      userMessage('正常内容'),
    ])
    expect(goal).toBeUndefined()
  })

  it('裸 /agent-teams token(无 goal)返回空串', () => {
    expect(invokedAgentTeamsGoal([userMessage('/agent-teams')])).toBe('')
    expect(invokedAgentTeamsGoal([userMessage('/agent-teams  ')] )).toBe('')
  })

  it('中缀提及/路径不匹配手势(需行首 + 空白边界)', () => {
    expect(invokedAgentTeamsGoal([userMessage('请用 /agent-teams 处理')])).toBeUndefined()
    expect(invokedAgentTeamsGoal([userMessage('path/to/agent-teams')])).toBeUndefined()
    expect(invokedAgentTeamsGoal([userMessage('xx/agent-teams foo')])).toBeUndefined()
  })

  it('无手势消息返回 undefined', () => {
    expect(invokedAgentTeamsGoal([userMessage('普通消息')])).toBeUndefined()
  })
})

describe('registerAgentTeamsCommand — 斜杠命令注册', () => {
  it('空 goal:返回 usage 错误,不触发 followup', () => {
    const registered: Array<{ name: string; handler: (inv: { rawInput: string; agent: { followup: (m: unknown) => void } }) => unknown }> = []
    const ctx = {
      effect: (fn: () => unknown) => fn(),
      commands: {
        register: (def: { name: string; handler: unknown }) => {
          registered.push(def as never)
          return def
        },
      },
    } as unknown as Context
    registerAgentTeamsCommand(ctx)
    const def = registered.find(d => d.name === AGENT_TEAMS_COMMAND)
    expect(def).toBeDefined()
    const result = def!.handler({ rawInput: '', agent: { followup: () => { throw new Error('不应触发 followup') } } })
    expect(result).toMatchObject({ kind: 'error' })
  })

  it('有 goal:followup 回放原斜杠行(用户可见),返回成功', () => {
    const followed: unknown[] = []
    const registered: Array<{ name: string; handler: (inv: { rawInput: string; agent: { followup: (m: unknown) => void } }) => unknown }> = []
    const ctx = {
      effect: (fn: () => unknown) => fn(),
      commands: {
        register: (def: { name: string; handler: unknown }) => {
          registered.push(def as never)
          return def
        },
      },
    } as unknown as Context
    registerAgentTeamsCommand(ctx)
    const def = registered.find(d => d.name === AGENT_TEAMS_COMMAND)
    const result = def!.handler({
      rawInput: ' 验证自成长闭环',
      agent: { followup: (message: unknown) => { followed.push(message) } },
    })
    expect(result).toMatchObject({ kind: 'success' })
    expect(followed).toHaveLength(1)
  })
})

describe('installAgentTeamsGestureBoundary — pre-step 手势边界', () => {
  function contextWithOn(): { ctx: Context; handlers: Array<(args: { messages: UserMessage[]; signal: { throwIfAborted: () => void } }, next: () => Promise<{ kind: string; messages: unknown[] }>) => Promise<unknown>> } {
    const handlers: Array<(args: unknown, next: () => Promise<unknown>) => Promise<unknown>> = []
    return {
      handlers,
      ctx: {
        on: (_event: string, handler: (args: unknown, next: () => Promise<unknown>) => Promise<unknown>) => {
          handlers.push(handler)
        },
      } as unknown as Context,
    }
  }

  it('user 消息带手势:注入激活消息(在 next 结果之后追加)', async () => {
    const { ctx, handlers } = contextWithOn()
    installAgentTeamsGestureBoundary(ctx)
    const handler = handlers[0]!
    const result = await handler(
      { messages: [userMessage('/agent-teams 验证自成长')], signal: { throwIfAborted: () => undefined } },
      async () => ({ kind: 'enter', messages: [{ type: 'text', text: '原注入' }] }),
    )
    const decision = result as { kind: string; messages: unknown[] }
    expect(decision.kind).toBe('enter')
    expect(decision.messages).toHaveLength(2)
    const activation = decision.messages[1] as { source?: { kind: string; goal?: string }; content: { type: string; text: string }[] }
    expect(activation.source?.kind).toBe('agent-teams-command')
    expect(activation.source?.goal).toBe('验证自成长')
    expect(activation.content[0]?.text).toContain('Goal: 验证自成长')
  })

  it('next 返回 reject:透传,不注入', async () => {
    const { ctx, handlers } = contextWithOn()
    installAgentTeamsGestureBoundary(ctx)
    const result = await handlers[0]!(
      { messages: [userMessage('/agent-teams 目标')], signal: { throwIfAborted: () => undefined } },
      async () => ({ kind: 'reject' }) as unknown as { kind: string; messages: unknown[] },
    )
    expect(result).toEqual({ kind: 'reject' })
  })

  it('无手势消息:原样透传 next 结果', async () => {
    const { ctx, handlers } = contextWithOn()
    installAgentTeamsGestureBoundary(ctx)
    const result = await handlers[0]!(
      { messages: [userMessage('普通消息')], signal: { throwIfAborted: () => undefined } },
      async () => ({ kind: 'enter', messages: ['原样'] }),
    )
    expect(result).toEqual({ kind: 'enter', messages: ['原样'] })
  })
})
