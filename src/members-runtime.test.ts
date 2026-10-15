/**
 * R-16 members.ts 运行时补测(spawnMember/interruptMember/memberWelcome/
 * resolveMemberLlmSelection/withPending/installRetiredMemberGuard/memberActivity)。
 *
 * members.ts 此前 24.28% stmts / 16.27% branch,生命周期函数基本零覆盖;
 * 本文件补齐服务端运行时层(memberPersona 已在 members-persona/member-memory
 * 覆盖,docs 角色用例见 members-persona.test.ts 补充)。
 * @module dsh-agent-team-web/members-runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deliverToMember,
  installMemberSelectionRuntime,
  installRetiredMemberGuard,
  interruptMember,
  memberActivity,
  memberDeniedTools,
  memberWelcome,
  resolveMemberLlmCandidates,
  resolveMemberLlmSelection,
  spawnMember,
  startMemberChild,
  type MemberChildStartSpec,
  type MemberRuntimeConfig,
} from './members.ts'
import type { TeamMember, TeamState } from './types.ts'
import { isMemberAgent, resetMemberAgents } from './member-state-guard.ts'

const STATE_DIR = '.agent-team-web'

function team(overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: '运行时测试团队',
    id: 'team-runtime',
    description: 'demo',
    captainSessionId: 'session-captain',
    createdAt: 1000,
    members: [],
    tasks: [],
    taskSeq: 0,
    ...overrides,
  }
}

function member(name: string, overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: '',
    name,
    role: 'engineer',
    provider: 'p',
    model: 'm',
    joinedAt: 1000,
    status: 'idle',
    ...overrides,
  }
}

function captain(workspace: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'session-captain',
    session: {
      header: { cwd: workspace, id: 'session-captain' },
      id: 'session-captain',
      requestHeader: () => ({ config: {} }),
    },
    options: { provider: 'p', model: 'm' },
    steer: () => undefined,
    ...overrides,
  } as unknown as Agent
}

function baseCtx(overrides: Record<string, unknown> = {}): Context {
  return {
    agents: { get: () => undefined },
    llm: { resolveCallConfig: async (config: { provider: string; model: string }) => ({ ...config }) },
    logger: { warn: () => undefined, debug: () => undefined },
    on: () => undefined,
    effect: () => () => undefined,
    subagents: {
      registerContinuableSetup: () => undefined,
      sendMessage: async () => MessageId('message-1'),
      interrupt: () => undefined,
      list: () => ['spawn'],
      getProvider: () => ({
        prepareContinuable: {},
        capabilities: { persona: true, toolFilter: true },
      }),
      startActivation: async (spec: { childId?: string }) => ({ childId: SessionId(spec.childId ?? 'child-1'), messageId: MessageId('message-1') }),
    },
    ...overrides,
  } as unknown as Context
}

const runtimeConfig: MemberRuntimeConfig = { provider: 'spawn', maxDepth: 1 }

describe('memberWelcome — 欢迎语', () => {
  it('包含团队名与任务数', () => {
    const text = memberWelcome(team({ tasks: [
      { id: 't1', subject: 'a', status: 'pending', dependencies: [], createdAt: 1, updatedAt: 1 },
    ] }))
    expect(text).toContain('运行时测试团队')
    expect(text).toContain('1 task(s)')
  })
})

describe('resolveMemberLlmSelection — LLM 路由解析', () => {
  it('主路径:同路由继承队长 provider/model/effort', async () => {
    const cap = captain('/ws', {
      session: {
        header: { cwd: '/ws', id: 'session-captain' },
        id: 'session-captain',
        requestHeader: () => ({ config: { provider: 'p', model: 'm', reasoningEffort: 'high' } }),
      },
      options: { provider: 'p', model: 'm' },
    } as unknown as Agent)
    const ctx = baseCtx({
      llm: {
        resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: model, reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' } }),
        resolveCallConfig: async (config: { provider: string; model: string }) => ({ ...config }),
      },
    })
    const selection = await resolveMemberLlmSelection(ctx, cap, {})
    expect(selection.provider).toBe('p')
    expect(selection.model).toBe('m')
  })

  it('显式 provider 要求显式 model,缺失时报可操作错误', async () => {
    await expect(resolveMemberLlmSelection(baseCtx(), captain('/ws'), { provider: 'other' }))
      .rejects.toThrow(/explicit member LLM provider requires an explicit member model/)
  })

  it('显式 provider+model 且 effort="default" → 目标模型默认 effort(不传 effort)', async () => {
    const ctx = baseCtx({
      llm: {
        resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: model, reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' } }),
        resolveCallConfig: async (config: { provider: string; model: string; reasoningEffort?: string }) => ({ ...config }),
      },
    })
    const selection = await resolveMemberLlmSelection(ctx, captain('/ws'), {
      provider: 'other', model: 'm2', reasoningEffort: 'default',
    })
    expect(selection.provider).toBe('other')
    expect(selection.model).toBe('m2')
    expect(selection.reasoningEffort).toBeUndefined()
  })

  it('空 provider/model 报错', async () => {
    await expect(resolveMemberLlmSelection(baseCtx(), captain('/ws'), { provider: '  ' }))
      .rejects.toThrow(/member LLM provider must not be empty/)
  })

  it('旧 roleDefaults 不再指定新成员路由；无显式选择时继承队长路由', async () => {
    const cap = captain('/ws', {
      session: {
        header: { cwd: '/ws', id: 'session-captain' },
        id: 'session-captain',
        requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' } }),
      },
      options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    } as unknown as Agent)
    const ctx = baseCtx({
      llm: { resolveCallConfig: async (config: { provider: string; model: string; reasoningEffort?: string }) => ({ ...config }) },
    })
    // Legacy route/effort remain readable but do not pin new-member routing.
    const selection = await resolveMemberLlmSelection(ctx, cap, {
      roleDefaults: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
    })
    expect(selection.provider).toBe('deepseek-official')
    expect(selection.model).toBe('deepseek-v4-flash')
    expect(selection.reasoningEffort).toBe('high')
  })

  it('roleDefaults:显式 provider/model 永远优先于角色档位', async () => {
    const cap = captain('/ws', {
      session: {
        header: { cwd: '/ws', id: 'session-captain' },
        id: 'session-captain',
        requestHeader: () => ({ config: { provider: 'p', model: 'm', reasoningEffort: 'high' } }),
      },
      options: { provider: 'p', model: 'm' },
    } as unknown as Agent)
    const ctx = baseCtx({
      llm: { resolveCallConfig: async (config: { provider: string; model: string; reasoningEffort?: string }) => ({ ...config }) },
    })
    const selection = await resolveMemberLlmSelection(ctx, cap, {
      provider: 'explicit-p',
      model: 'explicit-m',
      reasoningEffort: 'low',
      roleDefaults: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
    })
    expect(selection.provider).toBe('explicit-p')
    expect(selection.model).toBe('explicit-m')
    expect(selection.reasoningEffort).toBe('low')
  })

  it('无显式/无角色档位 → 继承队长会话路由(含 effort)', async () => {
    const cap = captain('/ws', {
      session: {
        header: { cwd: '/ws', id: 'session-captain' },
        id: 'session-captain',
        requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' } }),
      },
      options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    } as unknown as Agent)
    const ctx = baseCtx({
      llm: { resolveCallConfig: async (config: { provider: string; model: string; reasoningEffort?: string }) => ({ ...config }) },
    })
    const selection = await resolveMemberLlmSelection(ctx, cap, {})
    expect(selection.provider).toBe('deepseek-official')
    expect(selection.model).toBe('deepseek-v4-flash')
    expect(selection.reasoningEffort).toBe('high') // 同会话路由继承 effort
  })

  it('roleDefaults:档位仅 model 无 provider(内置档位)时也不参与路由——仍取队长路由', async () => {
    const cap = captain('/ws', {
      session: {
        header: { cwd: '/ws', id: 'session-captain' },
        id: 'session-captain',
        requestHeader: () => ({ config: { provider: 'cc-switch', model: 'gpt-5.6-sol[1M]', reasoningEffort: 'high' } }),
      },
      options: { provider: 'cc-switch', model: 'gpt-5.6-sol[1M]' },
    } as unknown as Agent)
    const ctx = baseCtx({
      llm: { resolveCallConfig: async (config: { provider: string; model: string; reasoningEffort?: string }) => ({ ...config }) },
    })
    // Provider and model form one inseparable route; a legacy record that names
    // only a model can never cross-pair with the captain's provider, and since
    // role presets no longer route at all the captain route wins outright.
    const selection = await resolveMemberLlmSelection(ctx, cap, {
      roleDefaults: { model: 'deepseek-v4-pro', reasoningEffort: 'high' }, // 无 provider(内置档位)
    })
    expect(selection.provider).toBe('cc-switch')
    expect(selection.model).toBe('gpt-5.6-sol[1M]')
  })

  it('roleDefaults:角色档位只给 effort 时不再覆盖队长 effort', async () => {
    const cap = captain('/ws', {
      session: {
        header: { cwd: '/ws', id: 'session-captain' },
        id: 'session-captain',
        requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' } }),
      },
      options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    } as unknown as Agent)
    const ctx = baseCtx({
      llm: { resolveCallConfig: async (config: { provider: string; model: string; reasoningEffort?: string }) => ({ ...config }) },
    })
    // A legacy effort-only record is ignored: same-route inheritance from the
    // captain is the only implicit effort source under the new contract.
    const selection = await resolveMemberLlmSelection(ctx, cap, {
      roleDefaults: { reasoningEffort: 'low' },
    })
    expect(selection.provider).toBe('deepseek-official')
    expect(selection.model).toBe('deepseek-v4-flash')
    expect(selection.reasoningEffort).toBe('high')
  })
})

describe('resolveMemberLlmCandidates — portable route admission', () => {
  it('rejects an explicit ungranted route without trying captain fallback', async () => {
    let calls = 0
    const ctx = baseCtx({ llm: { resolveCallConfig: async (config: { provider: string; model: string }) => { calls++; return config } } })
    await expect(resolveMemberLlmCandidates(ctx, captain('/ws'), [
      { label: 'explicit', explicit: true, request: { provider: 'foreign', model: 'm1' } },
      { label: 'captain route', request: {} },
    ], () => false)).rejects.toThrow(/explicit member route explicit rejected.*not authorized/)
    expect(calls).toBe(0)
  })

  it('rejects the inherited captain route when its model switch is off(继承不豁免授权)', async () => {
    const ctx = baseCtx({ llm: {
      resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: model,
        reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }),
      resolveCallConfig: async (config: { provider: string; model: string }) => config,
    } })
    // 授权表即权限:关掉的模型连继承路径也不能用,报错要指向设置页而不是静默换模型。
    await expect(resolveMemberLlmCandidates(ctx, captain('/ws'), [
      { label: 'captain route', request: {} },
    ], () => false, undefined, () => ({ enabled: false })))
      .rejects.toThrow(/model p\/m is not authorized \(captain route\).*Settings → AgentTeam → 模型选择/)
  })

  it('admits the inherited captain route once its switch is on', async () => {
    const ctx = baseCtx({ llm: {
      resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: model,
        reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }),
      resolveCallConfig: async (config: { provider: string; model: string }) => config,
    } })
    const selection = await resolveMemberLlmCandidates(ctx, captain('/ws'), [
      { label: 'captain route', request: {} },
    ], () => false, undefined, () => ({ enabled: true }))
    expect(selection).toMatchObject({ provider: 'p', model: 'm' })
    expect(selection.reasoningEffort).toBe('low')
  })

  it('still rejects the same route when it is requested explicitly', async () => {
    const ctx = baseCtx({ llm: {
      resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: model }),
      resolveCallConfig: async (config: { provider: string; model: string }) => config,
    } })
    await expect(resolveMemberLlmCandidates(ctx, captain('/ws'), [
      { label: 'explicit', explicit: true, request: { provider: 'p', model: 'm' } },
    ], () => false, undefined, () => ({ enabled: false }))).rejects.toThrow(/explicit member route explicit rejected.*not authorized/)
  })

  it('admits only the captain route when no explicit provider/model is selected', async () => {
    const ctx = baseCtx({ llm: {
      resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: model }),
      resolveCallConfig: async (config: { provider: string; model: string }) => config,
    } })
    const selection = await resolveMemberLlmCandidates(ctx, captain('/ws'), [
      { label: 'captain route', request: {} },
    ], (provider, model) => provider === 'p' && model === 'm', undefined,
      () => ({ enabled: true, legacy: true }))
    expect(selection).toMatchObject({ provider: 'p', model: 'm' })
  })

  it('aggregates adapter failure on the inherited captain route', async () => {
    const ctx = baseCtx({ llm: {
      resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: model }),
      resolveCallConfig: async () => { throw new Error('adapter rejected route') },
    } })
    await expect(resolveMemberLlmCandidates(ctx, captain('/ws'), [
      { label: 'captain route', request: {} },
    ], () => true, undefined, () => ({ enabled: true, legacy: true }))).rejects.toThrow(/captain route:.*adapter rejected route/)
  })
})

describe('spawnMember — 成员派生', () => {
  it('主路径:startActivation 成功后 member.id 填充为 reserved childId', async () => {
    const state = team({ members: [member('技术员')] })
    const draft = member('技术员')
    const selections = installMemberSelectionRuntime(baseCtx(), STATE_DIR)
    await spawnMember(
      baseCtx(),
      runtimeConfig,
      selections,
      { provider: 'p', model: 'm' },
      captain('/ws'),
      state,
      draft,
      STATE_DIR,
      new AbortController().signal,
    )
    expect(draft.id).not.toBe('')
    expect(draft.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(isMemberAgent(draft.id)).toBe(true)
  })

  it('startActivation 的 parent delivery 携带一次欢迎语且预留 ID 在首个 pre-step 前登记', async () => {
    resetMemberAgents()
    const state = team({ members: [member('技术员')] })
    const draft = member('技术员')
    const selections = installMemberSelectionRuntime(baseCtx(), STATE_DIR)
    let registeredAtCallTime: boolean | undefined
    let reservedAtCallTime: string | undefined
    let activationSpec: unknown
    const ctx = baseCtx({
      subagents: {
        ...baseCtx().subagents,
        startActivation: async (options: { childId?: string }) => {
          activationSpec = options
          reservedAtCallTime = options.childId
          registeredAtCallTime = options.childId !== undefined && isMemberAgent(options.childId)
          return { childId: SessionId('unexpected-child'), messageId: MessageId('message-1'), dispose: async () => undefined }
        },
      },
    })
    await expect(spawnMember(
      ctx,
      runtimeConfig,
      selections,
      { provider: 'p', model: 'm' },
      captain('/ws'),
      state,
      draft,
      STATE_DIR,
      new AbortController().signal,
    )).rejects.toThrow(/returned child id.*instead of reserved id/)
    expect(reservedAtCallTime).toBeDefined()
    expect(registeredAtCallTime).toBe(true)
    expect(activationSpec).toMatchObject({
      delivery: 'parent',
      childId: reservedAtCallTime,
      request: { prompt: [{ type: 'text', text: expect.stringContaining('运行时测试团队') }] },
    })
    expect(draft.id).toBe('')
    expect(isMemberAgent(reservedAtCallTime!)).toBe(false)
  })

  it('provider 未注册:报错含可用列表,id 不填充', async () => {
    const state = team()
    const draft = member('技术员')
    const selections = installMemberSelectionRuntime(baseCtx(), STATE_DIR)
    await expect(spawnMember(
      baseCtx({ subagents: { ...baseCtx().subagents, getProvider: () => undefined } }),
      runtimeConfig,
      selections,
      { provider: 'p', model: 'm' },
      captain('/ws'),
      state,
      draft,
      STATE_DIR,
      new AbortController().signal,
    )).rejects.toThrow(/no subagent provider "spawn" is registered/)
    expect(draft.id).toBe('')
  })
})

describe('startMemberChild — 两代 DSH subagent API', () => {
  const spec = {
    provider: 'spawn',
    childId: SessionId('child-reserved'),
    label: 'lbl',
    request: {
      prompt: [{ type: 'text' as const, text: 'welcome' }],
      parent: captain('/ws'),
      persona: 'persona',
      toolFilter: { deny: ['agent_teams_create'] },
      agentOptions: { provider: 'p', model: 'm' },
    },
    signal: new AbortController().signal,
  } satisfies MemberChildStartSpec

  it('DSH 0.2.1-alpha.x:优先 startActivation,携带 parent delivery', async () => {
    const seen: unknown[] = []
    const receipt = await startMemberChild({
      startActivation: async (received: unknown) => {
        seen.push(received)
        return { childId: SessionId('child-reserved'), dispose: async () => undefined }
      },
      startContinuable: async () => {
        throw new Error('startContinuable must not be used when startActivation exists')
      },
    }, spec)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ delivery: 'parent', childId: 'child-reserved', provider: 'spawn', label: 'lbl' })
    expect(receipt.childId).toBe('child-reserved')
    expect(typeof receipt.dispose).toBe('function')
  })

  it('DSH 0.2.0-rc.x:仅有 startContinuable 时回退到该 API,不携带 delivery', async () => {
    const seen: Record<string, unknown>[] = []
    const receipt = await startMemberChild({
      startContinuable: async (received: Record<string, unknown>) => {
        seen.push(received)
        return { childId: SessionId('child-reserved') }
      },
    }, spec)
    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toHaveProperty('delivery')
    expect(seen[0]).toMatchObject({ childId: 'child-reserved', request: { persona: 'persona' } })
    expect(receipt.childId).toBe('child-reserved')
    expect(receipt.dispose).toBeUndefined()
  })

  it('两代 API 都不存在:报错同时点名 startActivation 与 startContinuable', async () => {
    await expect(startMemberChild({}, spec))
      .rejects.toThrow(/neither startActivation .* nor startContinuable/)
  })
})

describe('memberDeniedTools — 队长专属 deny 名单按宿主已知工具过滤', () => {
  it('无探针(宿主不暴露查询)时下发完整名单,保持原有行为', () => {
    expect(memberDeniedTools()).toHaveLength(9)
    expect(memberDeniedTools()).toContain('agent_teams_create')
  })

  it('探针为真(eager:工具在全局层)时名单不变', () => {
    expect(memberDeniedTools(() => true)).toHaveLength(9)
  })

  it('探针为假(lazy:名字只在队长 agent scope)时降级为空,不触发 tools.restrict 抛错', () => {
    expect(memberDeniedTools(() => false)).toEqual([])
  })
})

describe('interruptMember — 中断(尽力而为)', () => {
  it('正常调用子代理 interrupt', () => {
    let interrupted = ''
    const ctx = baseCtx({
      subagents: { ...baseCtx().subagents, interrupt: (id: string) => { interrupted = String(id) } },
    } as unknown as Partial<Context>)
    interruptMember(ctx, captain('/ws'), 'child-9')
    expect(interrupted).toBe('child-9')
  })

  it('interrupt 抛错被吞(warn),不向上传播', () => {
    const ctx = baseCtx({
      subagents: { ...baseCtx().subagents, interrupt: () => { throw new Error('boom') } },
    } as unknown as Partial<Context>)
    expect(() => interruptMember(ctx, captain('/ws'), 'child-9')).not.toThrow()
  })
})

describe('withPending — 模型选择桥(installMemberSelectionRuntime)', () => {
  it('operation 成功后 pending 清除(重复 key 可再次使用)', async () => {
    const runtime = installMemberSelectionRuntime(baseCtx(), STATE_DIR)
    const selection = { provider: 'p', model: 'm' }
    await runtime.withPending('parent', 'label:技术员', selection, async () => 'ok')
    // 第一次已 finally 清除,第二次同 key 不冲突。
    await expect(runtime.withPending('parent', 'label:技术员', selection, async () => 'ok2')).resolves.toBe('ok2')
  })

  it('重复 pending key 抛错(并发冲突防护)', async () => {
    const runtime = installMemberSelectionRuntime(baseCtx(), STATE_DIR)
    const selection = { provider: 'p', model: 'm' }
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const first = runtime.withPending('parent', 'label:技术员', selection, async () => { await gate })
    await expect(runtime.withPending('parent', 'label:技术员', selection, async () => 'x'))
      .rejects.toThrow(/already pending/)
    release()
    await first
  })

  it('operation 抛错时 pending 仍清除', async () => {
    const runtime = installMemberSelectionRuntime(baseCtx(), STATE_DIR)
    await expect(runtime.withPending('parent', 'label:技术员', { provider: 'p', model: 'm' }, async () => {
      throw new Error('spawn failed')
    })).rejects.toThrow(/spawn failed/)
    await expect(runtime.withPending('parent', 'label:技术员', { provider: 'p', model: 'm' }, async () => 'ok')).resolves.toBe('ok')
  })
})

describe('deliverToMember — sendMessage 交付', () => {
  it('使用正式 sendMessage API 发送文本与 signal', async () => {
    const parent = captain('/ws')
    const signal = new AbortController().signal
    let call: unknown[] = []
    const ctx = baseCtx({
      subagents: {
        ...baseCtx().subagents,
        sendMessage: async (...args: unknown[]) => { call = args; return MessageId('accepted-message') },
      },
    } as unknown as Partial<Context>)

    await expect(deliverToMember(ctx, parent, 'child-1', 'hello', signal)).resolves.toBe(true)
    expect(call).toEqual([parent, 'child-1', [{ type: 'text', text: 'hello' }], { signal }])
  })

  it('sendMessage 拒绝时返回 false 并记录 warn', async () => {
    const warnings: string[] = []
    const ctx = baseCtx({
      logger: { warn: (message: string) => warnings.push(message), debug: () => undefined },
      subagents: { ...baseCtx().subagents, sendMessage: async () => { throw new Error('delivery failed') } },
    } as unknown as Partial<Context>)
    await expect(deliverToMember(ctx, captain('/ws'), 'child-1', 'hello', new AbortController().signal)).resolves.toBe(false)
    expect(warnings).toEqual([expect.stringContaining('delivery failed')])
  })
})

describe('installRetiredMemberGuard — 退休成员 sendMessage 边界', () => {
  let workspace: string
  let stateRoot: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-guard-'))
    stateRoot = join(workspace, STATE_DIR)
    await mkdir(stateRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('退休成员 sendMessage 抛 NOT_RESUMABLE;未退休成员正常透传', async () => {
    await writeFile(join(stateRoot, 'retired-members.json'), `${JSON.stringify(['child-retired'], null, 2)}\n`)
    const calls: string[] = []
    const original = async (_parent: unknown, childId: string) => { calls.push(String(childId)); return MessageId('accepted-message') }
    const ctx = baseCtx({
      // 真实执行 effect 回调,让 retired guard 完成安装。
      effect: (cb: () => () => void) => {
        const cleanup = cb()
        return cleanup
      },
      subagents: {
        ...baseCtx().subagents,
        sendMessage: original,
      },
    } as unknown as Partial<Context>)
    installRetiredMemberGuard(ctx, STATE_DIR)

    const guarded = ctx.subagents.sendMessage
    const content = [{ type: 'text' as const, text: 'hello' }]
    const options = { signal: new AbortController().signal }
    await expect(guarded(captain(workspace), 'child-retired' as never, content, options))
      .rejects.toMatchObject({ code: 'NOT_RESUMABLE' })
    await expect(guarded(captain(workspace), 'child-live' as never, content, options)).resolves.toBe(MessageId('accepted-message'))
    expect(calls).toEqual(['child-live'])
  })

  it('每次 sendMessage 都实时读取 durable retired index，刚退休立即拒绝', async () => {
    const calls: string[] = []
    const send = async (_parent: unknown, childId: string) => { calls.push(childId); return MessageId(`send:${childId}`) }
    const ctx = baseCtx({
      effect: (cb: () => () => void) => cb(),
      subagents: { ...baseCtx().subagents, sendMessage: send },
    } as unknown as Partial<Context>)
    installRetiredMemberGuard(ctx, STATE_DIR)
    const runtime = ctx.subagents
    const content = [{ type: 'text' as const, text: 'hello' }]
    const options = { signal: new AbortController().signal }

    await expect(runtime.sendMessage(captain(workspace), 'child-live' as never, content, options)).resolves.toBe(MessageId('send:child-live'))
    await writeFile(join(stateRoot, 'retired-members.json'), `${JSON.stringify(['child-retired'], null, 2)}\n`)
    await expect(runtime.sendMessage(captain(workspace), 'child-retired' as never, content, options))
      .rejects.toMatchObject({ code: 'NOT_RESUMABLE' })
    expect(calls).toEqual(['child-live'])
  })

  it('effect cleanup restores original sendMessage without overwriting a later wrapper', () => {
    const original = async () => 'original'
    let restore!: () => void
    const ctx = baseCtx({
      effect: (cb: () => () => void) => { restore = cb(); return restore },
      subagents: { ...baseCtx().subagents, sendMessage: original },
    } as unknown as Partial<Context>)
    installRetiredMemberGuard(ctx, STATE_DIR)
    const guarded = ctx.subagents.sendMessage
    expect(guarded).not.toBe(original)
    restore()
    expect(ctx.subagents.sendMessage).toBe(original)

    let restoreSecond!: () => void
    const secondCtx = baseCtx({
      effect: (cb: () => () => void) => { restoreSecond = cb(); return restoreSecond },
      subagents: { ...baseCtx().subagents, sendMessage: guarded },
    } as unknown as Partial<Context>)
    installRetiredMemberGuard(secondCtx, STATE_DIR)
    const installed = secondCtx.subagents.sendMessage
    const later = async () => MessageId('later')
    secondCtx.subagents.sendMessage = later
    restoreSecond()
    expect(installed).not.toBe(guarded)
    expect(secondCtx.subagents.sendMessage).toBe(later)
  })
})

describe('memberActivity — 实时活动映射', () => {
  it('running/idle/ready 三态映射;空 id 跳过', () => {
    const ctx = baseCtx({
      agents: {
        get: (id: string) => (id === 'session-a'
          ? { status: 'running' }
          : id === 'session-b'
            ? { status: 'idle' }
            : undefined) as unknown as Agent,
      },
    } as unknown as Partial<Context>)
    const activity = memberActivity(ctx, ['session-a', 'session-b', 'session-c', ''])
    expect(activity.get('session-a')).toBe('running')
    expect(activity.get('session-b')).toBe('idle')
    expect(activity.get('session-c')).toBe('ready') // 未驻留
    expect(activity.has('')).toBe(false)
  })
})
