/**
 * R-13 团队生命周期工具集成测试(create / add_member / remove_member / delete)。
 *
 * 复用 tools-suggest-gate.test.ts 的「桩 ctx + mkdtemp 工作区 + 磁盘状态 +
 * 断言落盘」模式;桩面按质检员一号方案扩展:
 * - subagents.getProvider → 假 provider(prepareContinuable + persona/toolFilter 能力)
 * - subagents.startContinuable → 假 child(id 自增,避免成员 id 撞车)
 * - ctx.llm.resolveCallConfig → 固定 provider/model
 * - 成员 agents.get 返回 running+whenIdle:调度器 kick 短路、waitForMemberIdle 快速过
 * @module dsh-agent-team-web/tools-lifecycle
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerAgentTeamsTools, type ToolsConfig } from './tools.ts'
import { BEST_PRACTICES_FILE, type BestPracticeEntry } from './best-practices.ts'
import { AGENT_TEAM_SETTINGS_NS, wireAgentTeamSettings } from './provider-grants.ts'
import { readTeam } from './state.ts'
import type { TeamMember, TeamState, TeamTask } from './types.ts'

const config: ToolsConfig = {
  stateDir: '.agent-team-web',
  memberProvider: 'spawn',
  maxMembers: 8,
  stallThresholdMs: 120_000,
}

const CAPTAIN_ID = 'session-captain'

function task(id: string, overrides: Partial<TeamTask> = {}): TeamTask {
  return {
    id,
    subject: `任务${id}`,
    status: 'pending',
    dependencies: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function team(overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: '测试团队',
    id: 'team-tools',
    description: 'demo',
    captainSessionId: CAPTAIN_ID,
    createdAt: 1000,
    members: [],
    tasks: [],
    taskSeq: 0,
    ...overrides,
  }
}

function member(name: string, overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: `session-${name}`,
    name,
    role: 'engineer',
    provider: 'p',
    model: 'm',
    joinedAt: 1000,
    status: 'idle',
    ...overrides,
  }
}

interface CapturedTool {
  name: string
  execute(args: Record<string, unknown>, exec: { agent: Agent; signal: AbortSignal }): Promise<unknown>
  output?: { render(args: Record<string, unknown>, value: unknown): { type: string; text: string }[] }
  [key: string]: unknown
}

/**
 * 扩展桩 ctx:支持 spawn 链路(subagents.getProvider/startContinuable/withPending)
 * 与 LLM 路由解析(ctx.llm.resolveCallConfig)。MEMBER_IDS 内成员返回
 * running+whenIdle(调度 kick 短路、quiesce 快速过),其余(含队长)返回 undefined。
 * `providerOverrides` 可注入残缺 provider,用于 spawnMember 前置校验失败分支;
 * `spawnRequests` 捕获 startContinuable 请求(断言 persona 记忆注入)。
 */
function harness(
  extraMemberIds: ReadonlySet<string> = new Set(),
  providerOverrides: {
    getProvider?: () => unknown
    prepareContinuable?: boolean
    persona?: boolean
    toolFilter?: boolean
  } = {},
  spawnRequests: Array<{ request: { persona: string; toolFilter: { deny: readonly string[] } } }> = [],
): (name: string) => CapturedTool {
  const tools = new Map<string, CapturedTool>()
  let childSeq = 0
  const runningIds = new Set(extraMemberIds)
  const fakeCtx = {
    tools: {
      register: (def: CapturedTool) => {
        tools.set(def.name, def)
        return def
      },
    },
    agents: {
      get: (id: string) => runningIds.has(id)
        ? { id, status: 'running', whenIdle: async () => undefined }
        : undefined,
    },
    llm: {
      resolveCallConfig: async () => ({ provider: 'p', model: 'm' }),
    },
    logger: { warn: () => undefined, debug: () => undefined },
    on: () => undefined,
    effect: () => () => undefined,
    subagents: {
      registerContinuableSetup: () => undefined,
      followup: async () => undefined,
      interrupt: () => undefined,
      list: () => ['spawn'],
      getProvider: providerOverrides.getProvider ?? (() => ({
        prepareContinuable: providerOverrides.prepareContinuable === false ? undefined : {},
        capabilities: {
          persona: providerOverrides.persona !== false,
          toolFilter: providerOverrides.toolFilter !== false,
        },
      })),
      startContinuable: async (options: { request: { persona: string; toolFilter: { deny: readonly string[] } } }) => {
        spawnRequests.push(options)
        return { childId: `child-${++childSeq}` }
      },
    },
  } as unknown as Context
  registerAgentTeamsTools(fakeCtx, config)
  return (name: string) => {
    const def = tools.get(name)
    if (def === undefined) throw new Error(`tool "${name}" not registered`)
    return def
  }
}

function agent(workspace: string, id: string): Agent {
  return {
    id,
    session: {
      header: { cwd: workspace, id },
      id,
      requestHeader: () => ({ config: {} }),
    },
    options: { provider: 'p', model: 'm' },
    steer: () => undefined,
  } as unknown as Agent
}

const execOf = (agentRef: Agent) => ({ agent: agentRef, signal: new AbortController().signal })

async function writeTeamToDisk(stateRoot: string, teamState: TeamState): Promise<void> {
  const dir = join(stateRoot, teamState.id)
  await mkdir(join(dir, 'inbox'), { recursive: true })
  await writeFile(join(dir, 'team.json'), JSON.stringify(teamState, null, 2))
}

describe('agent_teams_create — 建队 + 政委自动创建', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness()

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-create-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('主路径:建队落盘,政委成员自动 spawn 并写入', async () => {
    const result = await tool('agent_teams_create').execute(
      { name: '生命周期测试团队', description: 'R-13 集成测试' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { team_id: string; team_name: string; state_dir: string }
    expect(result.team_id).toBe('生命周期测试团队')
    expect(result.team_name).toBe('生命周期测试团队')

    const persisted = await readTeam(stateRoot, result.team_id)
    expect(persisted?.captainSessionId).toBe(CAPTAIN_ID)
    expect(persisted?.description).toBe('R-13 集成测试')
    expect(persisted?.members).toHaveLength(1)
    const commissar = persisted?.members[0]
    expect(commissar?.name).toBe('政委')
    expect(commissar?.role).toBe('commissar')
    expect(commissar?.id).toBe('child-1') // startContinuable 假 child id
    expect(commissar?.provider).toBe('p')
    expect(commissar?.model).toBe('m')
    // inbox 目录已建(空邮箱文件在首条消息时才创建)。
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(join(stateRoot, result.team_id, 'inbox'))).toEqual([])
  })

  it('错误分支:队长已带领团队时再建队被拒', async () => {
    await tool('agent_teams_create').execute(
      { name: '第一个团队' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )
    await expect(tool('agent_teams_create').execute(
      { name: '第二个团队' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/already lead team/)
    // 磁盘上只有第一个团队。
    const entries = await readFile(join(stateRoot, '.gitkeep'), 'utf8').catch(() => '')
    void entries
    await expect(readTeam(stateRoot, '第二个团队')).resolves.toBeUndefined()
  })

  it('错误分支:空团队名被拒', async () => {
    await expect(tool('agent_teams_create').execute(
      { name: '   ' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/team name must not be empty/)
  })
})

describe('agent_teams_add_member — 添加成员', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness(new Set(['session-eng']))

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-add-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
    await writeTeamToDisk(stateRoot, team({
      members: [
        { id: 'session-commissar', name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1000, status: 'idle' },
      ],
      taskSeq: 0,
    }))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('主路径:成员 spawn + 落盘(名称/角色/子代理 id)', async () => {
    const result = await tool('agent_teams_add_member').execute(
      { role: 'engineer' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { member_name: string; member_id: string; role?: string; provider: string; model: string }
    expect(result.member_name).toBe('技术员')
    expect(result.member_id).toBe('child-1')
    expect(result.provider).toBe('p')
    expect(result.model).toBe('m')

    const persisted = await readTeam(stateRoot, 'team-tools')
    const added = persisted?.members.find(m => m.name === '技术员')
    expect(added?.role).toBe('engineer')
    expect(added?.id).toBe('child-1')
    expect(added?.status).toBe('idle')
  })

  it('错误分支:重名成员被拒(显式自定义名重复)', async () => {
    await tool('agent_teams_add_member').execute(
      { name: '小明', role: 'engineer' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )
    await expect(tool('agent_teams_add_member').execute(
      { name: '小明', role: 'engineer' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/has already been used/)
  })

  it('错误分支:第二个政委被拒(唯一性门禁,显式名绕过默认名撞名)', async () => {
    await expect(tool('agent_teams_add_member').execute(
      { name: '政委二号', role: 'commissar' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/already has a commissar/)
  })

  it('错误分支:执行角色达上限(默认每角色 1 人)', async () => {
    await tool('agent_teams_add_member').execute({ role: 'engineer' }, execOf(agent(workspace, CAPTAIN_ID)))
    await expect(tool('agent_teams_add_member').execute(
      { role: 'engineer' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/已达上限/)
  })

  it('maxExecPerRoleByRole:engineer 覆盖为 2(第 2 人放行),qa 保持默认 1(第 2 人被拒)', async () => {
    // 独立 config + 独立 harness:engineer cap=2,其余角色回退默认 1。
    const tools = new Map<string, CapturedTool>()
    const capCtx = {
      tools: { register: (def: CapturedTool) => { tools.set(def.name, def); return def } },
      agents: { get: () => undefined },
      logger: { warn: () => undefined, debug: () => undefined },
      on: () => undefined,
      effect: () => () => undefined,
      llm: { resolveCallConfig: async (args: { provider?: string }) => ({ provider: args.provider ?? 'p', model: 'm' }) },
      subagents: {
        registerContinuableSetup: () => undefined,
        followup: async () => undefined,
        getProvider: () => ({
          prepareContinuable: {},
          capabilities: { persona: true, toolFilter: true },
        }),
        list: () => ['spawn'],
        startContinuable: async () => ({ childId: 'child-' + Math.random().toString(36).slice(2) }),
      },
    } as unknown as Context
    registerAgentTeamsTools(capCtx, {
      ...config,
      maxExecPerRoleByRole: { engineer: 2 },
    })
    const capTool = (name: string): CapturedTool => {
      const def = tools.get(name)
      if (def === undefined) throw new Error(`tool "${name}" not registered`)
      return def
    }

    // 第 1 个 engineer 放行,第 2 个 engineer 放行(覆盖生效)。
    await capTool('agent_teams_add_member').execute({ role: 'engineer' }, execOf(agent(workspace, CAPTAIN_ID)))
    await capTool('agent_teams_add_member').execute({ role: 'engineer' }, execOf(agent(workspace, CAPTAIN_ID)))

    // qa 未在覆盖中 → 第 1 个放行、第 2 个拒绝(回退默认 1)。
    await capTool('agent_teams_add_member').execute({ role: 'qa' }, execOf(agent(workspace, CAPTAIN_ID)))
    await expect(capTool('agent_teams_add_member').execute(
      { role: 'qa' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/已达上限/)
  })

  it('provider 授权:显式指定未授权 provider 回退 deepseek-official(软约束不阻断)', async () => {
    // 独立 harness:显式传 provider='kimi-coding'(未授权)→ 回退 deepseek-official。
    // 回退需能解析(测试 ctx.llm 接受任意 provider/model)。
    const tools = new Map<string, CapturedTool>()
    const grantCtx = {
      tools: { register: (def: CapturedTool) => { tools.set(def.name, def); return def } },
      agents: { get: () => undefined },
      logger: { warn: () => undefined, debug: () => undefined },
      on: () => undefined,
      effect: () => () => undefined,
      llm: { resolveCallConfig: async (args: { provider?: string; model?: string; reasoningEffort?: string }) => ({
        provider: args.provider ?? 'p', model: args.model ?? 'm', reasoningEffort: args.reasoningEffort,
      }) },
      subagents: {
        registerContinuableSetup: () => undefined,
        followup: async () => undefined,
        getProvider: () => ({
          prepareContinuable: {},
          capabilities: { persona: true, toolFilter: true },
        }),
        list: () => ['spawn'],
        startContinuable: async () => ({ childId: 'child-' + Math.random().toString(36).slice(2) }),
      },
    } as unknown as Context
    registerAgentTeamsTools(grantCtx, { ...config })
    const grantTool = (name: string): CapturedTool => {
      const def = tools.get(name)
      if (def === undefined) throw new Error(`tool "${name}" not registered`)
      return def
    }
    // 显式指定 kimi-coding(未授权)→ 应回退 deepseek-official,成员创建成功。
    const result = await grantTool('agent_teams_add_member').execute(
      { role: 'engineer', provider: 'kimi-coding', model: 'kimi-k2.7-code' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { member_name: string; provider: string; model: string }
    expect(result.member_name).toBe('技术员')
    expect(result.provider).toBe('deepseek-official') // 未授权 → 回退
    // 模型档位回退默认:不携带原路由的 kimi-k2.7-code,落回角色默认档位。
    expect(result.model).toBe('deepseek-v4-flash')
    // 落盘成员记录也应为 deepseek-official(与 spawn 描述符一致,冷恢复不炸)。
    const persisted = await readTeam(stateRoot, 'team-tools')
    const persistedEngineer = persisted?.members.find(m => m.name === '技术员')
    expect(persistedEngineer?.provider).toBe('deepseek-official')
    expect(persistedEngineer?.model).toBe('deepseek-v4-flash')
  })

  it('模型授权:设置页已授权模型 → 不回退,成员按显式路由 spawn', async () => {
    // t13 接线:授权判定走 config.modelGrantedFor(settings scope 闭包);
    // 设置页 enabledModels 含 kimi-coding/kimi-k2.7-code → 授权放行,不触发回退。
    const tools = new Map<string, CapturedTool>()
    const grantedCtx = {
      tools: { register: (def: CapturedTool) => { tools.set(def.name, def); return def } },
      agents: { get: () => undefined },
      logger: { warn: () => undefined, debug: () => undefined },
      on: () => undefined,
      effect: () => () => undefined,
      llm: { resolveCallConfig: async (args: { provider?: string; model?: string; reasoningEffort?: string }) => ({
        provider: args.provider ?? 'p', model: args.model ?? 'm', reasoningEffort: args.reasoningEffort,
      }) },
      subagents: {
        registerContinuableSetup: () => undefined,
        followup: async () => undefined,
        getProvider: () => ({
          prepareContinuable: {},
          capabilities: { persona: true, toolFilter: true },
        }),
        list: () => ['spawn'],
        startContinuable: async () => ({ childId: 'child-' + Math.random().toString(36).slice(2) }),
      },
    } as unknown as Context
    registerAgentTeamsTools(grantedCtx, {
      ...config,
      modelGrantedFor: (provider: string, model: string) => provider === 'kimi-coding' && model === 'kimi-k2.7-code',
    })
    const grantedTool = (name: string): CapturedTool => {
      const def = tools.get(name)
      if (def === undefined) throw new Error(`tool "${name}" not registered`)
      return def
    }
    const result = await grantedTool('agent_teams_add_member').execute(
      { role: 'engineer', provider: 'kimi-coding', model: 'kimi-k2.7-code' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { member_name: string; provider: string; model: string }
    expect(result.member_name).toBe('技术员')
    expect(result.provider).toBe('kimi-coding') // 设置页已授权 → 无回退
    expect(result.model).toBe('kimi-k2.7-code')
    const persisted = await readTeam(stateRoot, 'team-tools')
    expect(persisted?.members.find(m => m.name === '技术员')?.provider).toBe('kimi-coding')
  })

  it('模型授权:真实 scope 穿透——inject 捕获的 settings scope 真正被 execute 使用', async () => {
    // 全链路验证(t13 接线):wireAgentTeamSettings(inject 作用域捕获 register()
    // 返回的 scope,经闭包写入 config.modelGrantedFor)→ registerAgentTeamsTools
    // → add_member execute 读 config.modelGrantedFor。工具 ctx 不含 settings
    // stub —— 若接线断裂(直读 ctx.settings 或 scope 未穿透),授权判定恒 false,
    // 本用例必回退 deepseek-official 而失败。
    const tools = new Map<string, CapturedTool>()
    const executeCtx = {
      tools: { register: (def: CapturedTool) => { tools.set(def.name, def); return def } },
      agents: { get: () => undefined },
      logger: { warn: () => undefined, debug: () => undefined },
      on: () => undefined,
      effect: () => () => undefined,
      llm: { resolveCallConfig: async (args: { provider?: string; model?: string; reasoningEffort?: string }) => ({
        provider: args.provider ?? 'p', model: args.model ?? 'm', reasoningEffort: args.reasoningEffort,
      }) },
      subagents: {
        registerContinuableSetup: () => undefined,
        followup: async () => undefined,
        getProvider: () => ({
          prepareContinuable: {},
          capabilities: { persona: true, toolFilter: true },
        }),
        list: () => ['spawn'],
        startContinuable: async () => ({ childId: 'child-' + Math.random().toString(36).slice(2) }),
      },
    } as unknown as Context
    // 模拟 apply 期:settings 服务在 inject 作用域内注册命名空间并返回 scope。
    const scope = {
      get: () => ({ enabledModels: { 'kimi-coding/kimi-k2.7-code': true }, roleDefaults: {} }),
      watch: () => () => undefined,
      update: async () => undefined,
      replace: async () => undefined,
    }
    const settingsCtx = {
      settings: {
        register: () => scope,
        describe: () => [{ ns: AGENT_TEAM_SETTINGS_NS, schema: {}, value: { enabledModels: { 'kimi-coding/kimi-k2.7-code': true } }, revision: 0, applies: 'live' }],
      },
      effect: () => () => undefined,
    }
    const wiredConfig = { ...config }
    wireAgentTeamSettings(settingsCtx, wiredConfig)
    registerAgentTeamsTools(executeCtx, wiredConfig)
    const execTool = (name: string): CapturedTool => {
      const def = tools.get(name)
      if (def === undefined) throw new Error(`tool "${name}" not registered`)
      return def
    }
    // 已授权(kimi-coding/kimi-k2.7-code):scope 穿透 → 无回退,按显式路由 spawn。
    const granted = await execTool('agent_teams_add_member').execute(
      { role: 'engineer', provider: 'kimi-coding', model: 'kimi-k2.7-code' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { member_name: string; provider: string }
    expect(granted.provider).toBe('kimi-coding')
    // 未授权(xiaomi/xiaomi-m1):scope 判定 false → 回退 deepseek-official(软约束)。
    const revoked = await execTool('agent_teams_add_member').execute(
      { role: 'qa', provider: 'xiaomi', model: 'xiaomi-m1' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { member_name: string; provider: string }
    expect(revoked.provider).toBe('deepseek-official')
    // deepseek-official 恒授权,不走 scope 判定。
    const builtin = await execTool('agent_teams_add_member').execute(
      { role: 'researcher', provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { member_name: string; provider: string }
    expect(builtin.provider).toBe('deepseek-official')
  })

  it('R-26:spawn(网络)在锁外——add_member 进行中,同队 status 不被阻塞', async () => {
    // 让 startContinuable 挂起 300ms,模拟慢网络 spawn。
    let releaseSpawn!: () => void
    const spawnGate = new Promise<void>((resolve) => { releaseSpawn = resolve })
    const tools = new Map<string, CapturedTool>()
    let childSeq = 0
    // 团队 fixture 只有政委成员(session-commissar);running 使其 kick 短路。
    const runningIds = new Set(['session-commissar'])
    const fakeCtx = {
      tools: { register: (def: CapturedTool) => { tools.set(def.name, def); return def } },
      agents: {
        get: (id: string) => runningIds.has(id)
          ? { id, status: 'running', whenIdle: async () => undefined }
          : undefined,
      },
      llm: { resolveCallConfig: async () => ({ provider: 'p', model: 'm' }) },
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
        startContinuable: async () => {
          await spawnGate
          return { childId: `child-${++childSeq}` }
        },
      },
    } as unknown as Context
    registerAgentTeamsTools(fakeCtx, config)
    const localTool = (name: string) => {
      const def = tools.get(name)
      if (def === undefined) throw new Error(`tool "${name}" not registered`)
      return def
    }

    // 启动 add_member(内部 spawn 挂起);同时立即调用 status(政委视角,同队)。
    const addPromise = localTool('agent_teams_add_member').execute(
      { role: 'engineer' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )
    const statusPromise = localTool('agent_teams_status').execute(
      {},
      execOf(agent(workspace, 'session-commissar')),
    )
    // R-26 修复前:add_member 持有团队锁期间 await spawn,status 排队等锁,
    // 300ms 内无法完成;修复后 spawn 在锁外,status 立即完成。
    const statusResult = await Promise.race([
      statusPromise.then(value => ({ value, blocked: false })),
      new Promise<{ blocked: true }>((resolve) => setTimeout(() => resolve({ blocked: true }), 150)),
    ])
    expect(statusResult.blocked).toBe(false)
    releaseSpawn()
    await addPromise
  })
})

describe('add_member spawnMember 前置校验失败分支(4 种残缺 provider)', () => {
  let workspace: string
  let stateRoot: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-spawnfail-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
    await writeTeamToDisk(stateRoot, team({
      members: [
        { id: 'session-commissar', name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1000, status: 'idle' },
      ],
      taskSeq: 0,
    }))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('provider 未注册 → 可操作报错,不落盘成员', async () => {
    const tool = harness(new Set(), { getProvider: () => undefined })
    await expect(tool('agent_teams_add_member').execute(
      { role: 'engineer' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/no subagent provider "spawn" is registered/)
    const persisted = await readTeam(stateRoot, 'team-tools')
    expect(persisted?.members).toHaveLength(1) // 仅政委,失败不落盘
  })

  it('provider 不支持 continuable → 拒绝', async () => {
    const tool = harness(new Set(), { prepareContinuable: false })
    await expect(tool('agent_teams_add_member').execute(
      { role: 'engineer' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/does not support continuable members/)
  })

  it('provider 不支持 persona → 拒绝', async () => {
    const tool = harness(new Set(), { persona: false })
    await expect(tool('agent_teams_add_member').execute(
      { role: 'engineer' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/cannot apply a member persona/)
  })

  it('provider 不支持 toolFilter → 拒绝(成员工具面不可控)', async () => {
    const tool = harness(new Set(), { toolFilter: false })
    await expect(tool('agent_teams_add_member').execute(
      { role: 'engineer' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/cannot restrict captain-only tools/)
  })
})

describe('add_member best-practices 记忆注入', () => {
  let workspace: string
  let stateRoot: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-mem-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
    await writeTeamToDisk(stateRoot, team({
      members: [
        { id: 'session-commissar', name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1000, status: 'idle' },
      ],
      taskSeq: 0,
    }))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('角色匹配样本 ≥2 时,经验注入成员 persona(startContinuable 请求断言)', async () => {
    // 冷启动守卫:engineer 角色需 ≥2 条已验证(useful/revised)经验才注入;
    // R-20 门控:pending 未校准条目不计入可注入样本。
    const library: BestPracticeEntry[] = [
      {
        id: 'bp-1', sourceTeamId: 'team-a', sourceTaskId: 't1', sourceTaskSubject: '任务t1',
        role: 'engineer', cause: 'underestimated', practice: '先读测试再动手', verdict: 'useful',
        createdAt: 1000, updatedAt: 2000,
      },
      {
        id: 'bp-2', sourceTeamId: 'team-a', sourceTaskId: 't2', sourceTaskSubject: '任务t2',
        role: 'engineer', cause: 'on_time', practice: '实现前先定验收标准', verdict: 'revised',
        createdAt: 1000, updatedAt: 2000,
      },
      {
        id: 'bp-3', sourceTeamId: 'team-a', sourceTaskId: 't3', sourceTaskSubject: '任务t3',
        role: 'engineer', cause: 'other', practice: '未校准经验不应注入', verdict: 'pending',
        createdAt: 1000, updatedAt: 3000,
      },
    ]
    await writeFile(join(stateRoot, BEST_PRACTICES_FILE), `${JSON.stringify(library, null, 2)}\n`)

    const spawnRequests: Array<{ request: { persona: string; toolFilter: { deny: readonly string[] } } }> = []
    const tool = harness(new Set(), {}, spawnRequests)
    await tool('agent_teams_add_member').execute(
      { role: 'engineer' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )

    // 技术员 spawn 请求捕获:persona 含记忆注入段,工具面含 deny 清单。
    const spawn = spawnRequests[spawnRequests.length - 1]
    expect(spawn?.request.persona).toContain('Team memory (from the global best-practices library')
    expect(spawn?.request.persona).toContain('先读测试再动手')
    expect(spawn?.request.persona).toContain('实现前先定验收标准')
    // R-20:pending 未校准条目不注入。
    expect(spawn?.request.persona).not.toContain('未校准经验不应注入')
    // R-29:队长专属工具(含 retro_review/best_practices)全部在成员 deny 清单。
    expect(spawn?.request.toolFilter.deny).toEqual(expect.arrayContaining([
      'agent_teams_create', 'agent_teams_add_member', 'agent_teams_remove_member',
      'agent_teams_reassign_task', 'agent_teams_create_task', 'agent_teams_delete',
      'agent_teams_retro_review', 'agent_teams_best_practices',
    ]))
  })

  it('样本不足(<2)时冷启动守卫触发:不注入记忆段', async () => {
    const library: BestPracticeEntry[] = [
      {
        id: 'bp-1', sourceTeamId: 'team-a', sourceTaskId: 't1', sourceTaskSubject: '任务t1',
        role: 'engineer', cause: 'underestimated', practice: '孤例经验', verdict: 'useful',
        createdAt: 1000, updatedAt: 2000,
      },
    ]
    await writeFile(join(stateRoot, BEST_PRACTICES_FILE), `${JSON.stringify(library, null, 2)}\n`)

    const spawnRequests: Array<{ request: { persona: string; toolFilter: { deny: readonly string[] } } }> = []
    const tool = harness(new Set(), {}, spawnRequests)
    await tool('agent_teams_add_member').execute(
      { role: 'engineer' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )
    const spawn = spawnRequests[spawnRequests.length - 1]
    expect(spawn?.request.persona).not.toContain('Team memory')
  })
})

describe('agent_teams_remove_member — 移除成员', () => {
  let workspace: string
  let stateRoot: string
  // 政委与技术员都标记 running:remove 后的 kickTeam 短路,退池任务不被自动再派,
  // 便于断言"退回共享池"的干净状态。
  const tool = harness(new Set(['session-eng', 'session-commissar']))

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-remove-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
    await writeTeamToDisk(stateRoot, team({
      members: [
        { id: 'session-commissar', name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1000, status: 'idle' },
        member('技术员', { id: 'session-eng', role: 'engineer' }),
      ],
      tasks: [
        task('t1', { status: 'in_progress', assignee: '技术员', attempt: 1, attemptId: 'att-1' }),
        task('t2', { status: 'completed', assignee: '技术员' }),
      ],
      taskSeq: 2,
    }))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('主路径:未完成任务退回共享池,成员标记 removed,子代理 id 退休', async () => {
    const result = await tool('agent_teams_remove_member').execute(
      { name: '技术员' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { member_name: string; status: string; requeued_tasks: string[] }
    expect(result.member_name).toBe('技术员')
    expect(result.status).toBe('removed')
    expect(result.requeued_tasks).toEqual(['t1'])

    const persisted = await readTeam(stateRoot, 'team-tools')
    const removed = persisted?.members.find(m => m.name === '技术员')
    expect(removed?.status).toBe('removed')
    const t1 = persisted?.tasks.find(t => t.id === 't1')
    expect(t1?.status).toBe('pending')
    expect(t1?.assignee).toBeUndefined()
    expect(t1?.attemptId).toBeUndefined()
    // 已完成任务不动。
    expect(persisted?.tasks.find(t => t.id === 't2')?.status).toBe('completed')
    // 退休索引落盘。
    const retired = JSON.parse(await readFile(join(stateRoot, 'retired-members.json'), 'utf8')) as string[]
    expect(retired).toContain('session-eng')
  })

  it('错误分支:移除不存在的成员被拒', async () => {
    await expect(tool('agent_teams_remove_member').execute(
      { name: '不存在的人' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/no active member named/)
  })
})

describe('R-31 — 调度扇出不占工具关键路径(kick fire-and-forget)', () => {
  it('慢 kickMember(挂起 followup)不阻塞 create_task 响应', async () => {
    let workspace: string
    let stateRoot: string
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-kickff-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
    try {
      await writeTeamToDisk(stateRoot, {
        name: '测试团队',
        id: 'team-tools',
        description: 'demo',
        captainSessionId: 'session-captain',
        createdAt: 1000,
        members: [
          { id: 'session-commissar', name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1000, status: 'idle' },
          // 技术员 idle:create_task 后 kickTeam → kickMember → deliverToMember。
          member('技术员', { id: 'session-eng', role: 'engineer' }),
        ],
        tasks: [],
        taskSeq: 0,
      })
      // 自定义 harness:followup(实时唤醒)挂起 300ms 模拟慢网络派发。
      let releaseFollowup!: () => void
      const followupGate = new Promise<void>((resolve) => { releaseFollowup = resolve })
      const tools = new Map<string, CapturedTool>()
      let childSeq = 0
      const fakeCtx = {
        tools: { register: (def: CapturedTool) => { tools.set(def.name, def); return def } },
        agents: {
          get: (id: string) => id === 'session-eng' || id === 'session-commissar'
            ? { id, status: 'idle', whenIdle: async () => undefined }
            : undefined,
        },
        llm: { resolveCallConfig: async () => ({ provider: 'p', model: 'm' }) },
        logger: { warn: () => undefined, debug: () => undefined },
        on: () => undefined,
        effect: () => () => undefined,
        subagents: {
          registerContinuableSetup: () => undefined,
          followup: async () => { await followupGate },
          interrupt: () => undefined,
          list: () => ['spawn'],
          getProvider: () => ({
            prepareContinuable: {},
            capabilities: { persona: true, toolFilter: true },
          }),
          startContinuable: async () => ({ childId: `child-${++childSeq}` }),
        },
      } as unknown as Context
      registerAgentTeamsTools(fakeCtx, config)
      const localTool = (name: string) => {
        const def = tools.get(name)
        if (def === undefined) throw new Error(`tool "${name}" not registered`)
        return def
      }
      // create_task 结尾 kickTeam(逐成员 kickMember → 挂起 followup)。
      // 修复前 await kick → 300ms 后返回;修复后 fire-and-forget,立即返回。
      const createPromise = localTool('agent_teams_create_task').execute(
        { subject: '实现调度器建议' },
        execOf(agent(workspace, 'session-captain')),
      )
      const raced = await Promise.race([
        createPromise.then(value => ({ value, blocked: false as const })),
        new Promise<{ blocked: true }>((resolve) => setTimeout(() => resolve({ blocked: true }), 150)),
      ])
      expect(raced.blocked).toBe(false)
      if (!raced.blocked) {
        expect((raced.value as { task_id: string }).task_id).toBe('t1')
        // 任务已落盘(工具主路径完成);kick 仍在后台挂起,释放后正常结束。
        const persisted = await readTeam(stateRoot, 'team-tools')
        expect(persisted?.tasks.find(t => t.id === 't1')?.subject).toBe('实现调度器建议')
      }
      releaseFollowup()
      // 等待后台 kick 结束(避免测试退出时挂起 promise 告警)。
      await new Promise((resolve) => setTimeout(resolve, 20))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

describe('R-17: scheduler kick 真链路(解除 stub running 短路,验证自动派单)', () => {
  it('create_task → kickTeam → 空闲成员被派单:followup 收派单文本,成员落盘 working', async () => {
    let workspace: string
    let stateRoot: string
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-kickchain-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
    try {
      await writeTeamToDisk(stateRoot, {
        name: '测试团队',
        id: 'team-tools',
        description: 'demo',
        captainSessionId: 'session-captain',
        createdAt: 1000,
        members: [
          // 技术员不注册在 agents 中 → isMemberAvailable=true(真正 idle),
          // kick 会真实走派单链路,而非被 running 短路。
          member('技术员', { id: 'session-eng', role: 'engineer' }),
        ],
        tasks: [],
        taskSeq: 0,
      })
      const deliveredTexts: string[] = []
      const tools = new Map<string, CapturedTool>()
      let childSeq = 0
      const fakeCtx = {
        tools: { register: (def: CapturedTool) => { tools.set(def.name, def); return def } },
        agents: {
          // 队长在线(实时唤醒需要),技术员不注册(空闲)。
          get: (id: string) => id === 'session-captain'
            ? { id, status: 'idle', whenIdle: async () => undefined }
            : undefined,
        },
        llm: { resolveCallConfig: async () => ({ provider: 'p', model: 'm' }) },
        logger: { warn: () => undefined, debug: () => undefined },
        on: () => undefined,
        effect: () => () => undefined,
        subagents: {
          registerContinuableSetup: () => undefined,
          followup: async (_parent: unknown, _child: unknown, content: unknown) => {
            const text = (content as { type: string; text: string }[])[0]?.text ?? ''
            deliveredTexts.push(text)
          },
          interrupt: () => undefined,
          list: () => ['spawn'],
          getProvider: () => ({
            prepareContinuable: {},
            capabilities: { persona: true, toolFilter: true },
          }),
          startContinuable: async () => ({ childId: `child-${++childSeq}` }),
        },
      } as unknown as Context
      registerAgentTeamsTools(fakeCtx, config)
      const localTool = (name: string) => {
        const def = tools.get(name)
        if (def === undefined) throw new Error(`tool "${name}" not registered`)
        return def
      }
      // create_task 触发 kickTeam → 空闲技术员被派单(followup 收到 assignmentPrompt)。
      const created = await localTool('agent_teams_create_task').execute(
        { subject: '实现调度器建议' },
        execOf(agent(workspace, 'session-captain')),
      ) as { task_id: string }
      expect(created.task_id).toBe('t1')

      // 等后台 kick 完成(fire-and-forget 异步)。
      for (let i = 0; i < 20 && deliveredTexts.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(deliveredTexts.length).toBeGreaterThan(0)
      expect(deliveredTexts[0]).toContain('agent_teams_claim_task')
      expect(deliveredTexts[0]).toContain('t1')
      // t7:派发消息含「已认领不重复 claim」引导(成员不再误传 assignee 反复报错)。
      expect(deliveredTexts[0]).toContain('members cannot set assignee')
      // 成员状态落盘为 working(派单生效)。
      const persisted = await readTeam(stateRoot, 'team-tools')
      expect(persisted?.members.find(m => m.name === '技术员')?.status).toBe('working')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

describe('agent_teams_delete — 归档团队', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness(new Set(['session-eng']))

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-delete-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
    await writeTeamToDisk(stateRoot, team({
      members: [
        { id: 'session-commissar', name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1000, status: 'idle' },
        member('技术员', { id: 'session-eng', role: 'engineer' }),
      ],
      tasks: [task('t1', { status: 'completed', assignee: '技术员' })],
      taskSeq: 1,
    }))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('主路径:团队成员退休、目录迁入 archive/(非删除)', async () => {
    const result = await tool('agent_teams_delete').execute(
      {},
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { deleted: boolean; team_name: string }
    expect(result.deleted).toBe(true)
    expect(result.team_name).toBe('测试团队')

    // 活动目录消失,归档目录出现(team.json 保留供复盘)。
    const moved = await readTeam(join(stateRoot, 'archive'), 'team-tools')
    expect(moved?.name).toBe('测试团队')
    expect(moved?.members.every(m => m.status === 'removed')).toBe(true)
    await expect(readFile(join(stateRoot, 'team-tools', 'team.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    // 所有成员 id 退休。
    const retired = JSON.parse(await readFile(join(stateRoot, 'retired-members.json'), 'utf8')) as string[]
    expect(retired).toContain('session-eng')
    expect(retired).toContain('session-commissar')
  })

  it('错误分支:非队长调用 delete 被拒(无团队)', async () => {
    await expect(tool('agent_teams_delete').execute(
      {},
      execOf(agent(workspace, 'session-eng')),
    )).rejects.toThrow(/you are not leading any team yet/)
  })
})
