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
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  installMemberSelectionRuntime,
  installRetiredMemberGuard,
  interruptMember,
  memberActivity,
  memberWelcome,
  resolveMemberLlmSelection,
  spawnMember,
  type MemberRuntimeConfig,
} from './members.ts'
import type { TeamMember, TeamState } from './types.ts'

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
      followup: async () => undefined,
      interrupt: () => undefined,
      list: () => ['spawn'],
      getProvider: () => ({
        prepareContinuable: {},
        capabilities: { persona: true, toolFilter: true },
      }),
      startContinuable: async () => ({ childId: 'child-1' }),
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
      llm: { resolveCallConfig: async (config: { provider: string; model: string }) => ({ ...config }) },
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
      llm: { resolveCallConfig: async (config: { provider: string; model: string; reasoningEffort?: string }) => ({ ...config }) },
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

  it('roleDefaults:无显式路由时按角色档位取 provider/model/effort(自动分配)', async () => {
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
    // security 角色默认档位:pro + max,覆盖队长继承的 flash + high。
    const selection = await resolveMemberLlmSelection(ctx, cap, {
      roleDefaults: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
    })
    expect(selection.provider).toBe('deepseek-official')
    expect(selection.model).toBe('deepseek-v4-pro')
    expect(selection.reasoningEffort).toBe('max')
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

  it('captainDefaults:会话 ds-flash 但 captain 预设 gpt-5.6-sol → 成员继承 captain 配置(t12)', async () => {
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
    // 未显式、未配角色档位 → 继承 captain 预设(而非会话 ds-flash)。
    const selection = await resolveMemberLlmSelection(ctx, cap, {
      captainDefaults: { provider: 'cc-switch', model: 'gpt-5.6-sol[1M]' },
    })
    expect(selection.provider).toBe('cc-switch')
    expect(selection.model).toBe('gpt-5.6-sol[1M]')
    // effort:captain 预设未给 effort → 目标路由非会话路由 → 不继承会话 effort。
    expect(selection.reasoningEffort).toBeUndefined()
  })

  it('captainDefaults:未配置 captain 预设 → 回落会话路由(行为不变)', async () => {
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

  it('captainDefaults:显式/角色档位仍优先于 captain 预设', async () => {
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
    // 角色档位优先于 captain 预设。
    const withRole = await resolveMemberLlmSelection(ctx, cap, {
      roleDefaults: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
      captainDefaults: { provider: 'cc-switch', model: 'gpt-5.6-sol[1M]' },
    })
    expect(withRole.model).toBe('deepseek-v4-pro')
    // 显式永远优先。
    const withExplicit = await resolveMemberLlmSelection(ctx, cap, {
      provider: 'explicit-p', model: 'explicit-m',
      captainDefaults: { provider: 'cc-switch', model: 'gpt-5.6-sol[1M]' },
    })
    expect(withExplicit.provider).toBe('explicit-p')
  })

  it('roleDefaults:角色档位只给 effort、model 缺失时仍从队长继承', async () => {
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
    // 角色档位只声明 effort(low),provider/model 回退队长。
    const selection = await resolveMemberLlmSelection(ctx, cap, {
      roleDefaults: { reasoningEffort: 'low' },
    })
    expect(selection.provider).toBe('deepseek-official')
    expect(selection.model).toBe('deepseek-v4-flash')
    expect(selection.reasoningEffort).toBe('low')
  })
})

describe('spawnMember — 成员派生', () => {
  it('主路径:startContinuable 成功后 member.id 填充', async () => {
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
    expect(draft.id).toBe('child-1')
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

describe('installRetiredMemberGuard — 退休成员 followup 边界', () => {
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

  it('退休成员 followup 抛 NOT_RESUMABLE;未退休成员正常透传', async () => {
    await writeFile(join(stateRoot, 'retired-members.json'), `${JSON.stringify(['child-retired'], null, 2)}\n`)
    const calls: string[] = []
    const original = async (_parent: unknown, childId: string) => { calls.push(String(childId)) }
    const ctx = baseCtx({
      // 真实执行 effect 回调,让 retired guard 完成安装。
      effect: (cb: () => () => void) => {
        const cleanup = cb()
        return cleanup
      },
      subagents: {
        ...baseCtx().subagents,
        followup: original,
      },
    } as unknown as Partial<Context>)
    installRetiredMemberGuard(ctx, STATE_DIR)

    const guarded = (ctx.subagents as unknown as { followup: (p: unknown, id: string) => Promise<void> }).followup
    await expect(guarded(captain(workspace), 'child-retired')).rejects.toMatchObject({ code: 'NOT_RESUMABLE' })
    await guarded(captain(workspace), 'child-live')
    expect(calls).toEqual(['child-live'])
  })

  it('R-21/L-4:TTL 缓存生效——写入退休索引后立即可拒绝(不依赖每次磁盘读)', async () => {
    await writeFile(join(stateRoot, 'retired-members.json'), `${JSON.stringify(['child-retired'], null, 2)}\n`)
    const ctx = baseCtx({
      effect: (cb: () => () => void) => {
        const cleanup = cb()
        return cleanup
      },
    } as unknown as Partial<Context>)
    installRetiredMemberGuard(ctx, STATE_DIR)
    const guarded = (ctx.subagents as unknown as { followup: (p: unknown, id: string) => Promise<void> }).followup

    // 首次调用加载缓存并拒绝退休 id。
    await expect(guarded(captain(workspace), 'child-retired')).rejects.toMatchObject({ code: 'NOT_RESUMABLE' })

    // TTL 窗口内,即使索引文件被外部改写(模拟直接编辑),守卫仍按缓存拒绝——
    // 观察行为不变(拒绝),证明缓存路径生效而非每次读盘。
    await writeFile(join(stateRoot, 'retired-members.json'), `${JSON.stringify([], null, 2)}\n`)
    await expect(guarded(captain(workspace), 'child-retired')).rejects.toMatchObject({ code: 'NOT_RESUMABLE' })
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
