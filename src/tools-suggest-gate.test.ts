/**
 * Tools 级集成测试(改进 3/4 补强 —— 政委与 QA 指出的同一类缺口)。
 *
 * 以 close-route.test.ts 同款「真实状态目录」集成测试模式,直接执行
 * registerAgentTeamsTools 注册后的真实工具定义,覆盖:
 * 1) create_task 未指定 assignee 时返回建议字段,且建议不落盘/不派单;
 * 2) status 任务附带建议字段 + renderStatus 展示「建议分配给:…」;
 * 3) 指定 assignee / 无关键词命中时不返回建议(队长确认权、不瞎猜);
 * 4) 门禁拦截 → blockedByReview 落盘 → 政委 pass/reject 放行 → completed 全链路。
 *
 * 测试基建说明:成员 agent 在桩 ctx.agents 中一律为 running,使调度器
 * kick 全部短路(不自动派单、不投递),从而隔离被测工具的真实行为;
 * captain 会话返回 undefined,跳过 live 投递路径(门禁通知走磁盘邮箱)。
 * @module dsh-agent-team-web/tools-suggest-gate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerAgentTeamsTools, type ToolsConfig } from './tools.ts'
import { readTeam } from './state.ts'
import type { TeamMember, TeamState, TeamTask } from './types.ts'

const config: ToolsConfig = {
  stateDir: '.agent-team-web',
  memberProvider: 'spawn',
  maxMembers: 8,
  stallThresholdMs: 120_000,
}

const CAPTAIN_ID = 'session-captain'
const COMMISSAR_ID = 'session-commissar'
const ENGINEER_ID = 'session-engineer'

function team(overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: '测试团队',
    id: 'team-tools',
    description: 'demo',
    captainSessionId: CAPTAIN_ID,
    createdAt: 1000,
    members: [
      { id: COMMISSAR_ID, name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1000, status: 'idle' },
      { id: ENGINEER_ID, name: '技术员', role: 'engineer', provider: 'p', model: 'm', joinedAt: 1001, status: 'idle' },
    ],
    tasks: [],
    taskSeq: 0,
    ...overrides,
  }
}

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

/** Write a team record at `<stateRoot>/<team.id>/team.json`(close-route 同款)。 */
async function writeTeamToDisk(stateRoot: string, teamState: TeamState): Promise<void> {
  const dir = join(stateRoot, teamState.id)
  await mkdir(join(dir, 'inbox'), { recursive: true })
  await writeFile(join(dir, 'team.json'), JSON.stringify(teamState, null, 2))
}

interface CapturedTool {
  name: string
  execute(args: Record<string, unknown>, exec: { agent: Agent; signal: AbortSignal }): Promise<unknown>
  output?: { render(args: Record<string, unknown>, value: unknown): { type: string; text: string }[] }
  [key: string]: unknown
}

/**
 * 注册真实工具到一个桩 Context 并捕获定义。
 * 关键桩点:
 * - agents.get(成员 id) → { status: 'running' }:调度器 kick 短路,隔离自动派单;
 * - agents.get(其它) → undefined:跳过 live 投递,门禁通知只落磁盘邮箱;
 * - subagents.registerContinuableSetup / effect / on:no-op(运行时安装不生效)。
 */
function harness(): (name: string) => CapturedTool {
  const tools = new Map<string, CapturedTool>()
  const MEMBER_IDS = new Set([COMMISSAR_ID, ENGINEER_ID])
  const fakeCtx = {
    tools: {
      register: (def: CapturedTool) => {
        tools.set(def.name, def)
        return def
      },
    },
    agents: {
      get: (id: string) => MEMBER_IDS.has(id)
        ? { id, status: 'running', session: { header: { cwd: '' } } }
        : undefined,
    },
    logger: { warn: () => undefined, debug: () => undefined },
    on: () => undefined,
    effect: () => () => undefined,
    subagents: {
      registerContinuableSetup: () => undefined,
      followup: async () => undefined,
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
    session: { header: { cwd: workspace }, id },
    steer: () => undefined,
  } as unknown as Agent
}

const execOf = (agentRef: Agent) => ({ agent: agentRef, signal: new AbortController().signal })

describe('agent_teams_create_task — 建议字段(改进3 工具级)', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness()

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-suggest-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('未指定 assignee 时返回 suggested_role/assignee/confidence', async () => {
    await writeTeamToDisk(stateRoot, team())
    const result = await tool('agent_teams_create_task').execute(
      { subject: '实现调度器建议分配', description: '接入 create_task 并展示建议' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as {
      task_id: string
      status: string
      suggested_role?: string
      suggested_assignee?: string
      suggestion_confidence?: string
    }
    expect(result.suggested_role).toBe('engineer')
    expect(result.suggested_assignee).toBe('技术员')
    expect(result.suggestion_confidence).toBe('medium') // 实现+接入 = 2 条命中

    // 建议不落盘、不派单:磁盘 TeamTask 无建议字段,任务保持 pending/unassigned。
    const persisted = await readTeam(stateRoot, 'team-tools')
    const created = persisted?.tasks.find(t => t.id === result.task_id)
    expect(created?.status).toBe('pending')
    expect(created?.assignee).toBeUndefined()
    expect(created?.attemptId).toBeUndefined()
    expect('suggestedRole' in (created ?? {})).toBe(false)
    expect('suggestedAssignee' in (created ?? {})).toBe(false)
    expect('suggestionConfidence' in (created ?? {})).toBe(false)
  })

  it('指定 assignee 时不返回建议字段(队长确认权保留)', async () => {
    await writeTeamToDisk(stateRoot, team())
    const result = await tool('agent_teams_create_task').execute(
      { subject: '实现调度器建议分配', assignee: '技术员' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { task_id: string; suggested_role?: string; suggested_assignee?: string }
    expect(result.suggested_role).toBeUndefined()
    expect(result.suggested_assignee).toBeUndefined()
    const persisted = await readTeam(stateRoot, 'team-tools')
    expect(persisted?.tasks[0]?.assignee).toBe('技术员')
  })

  it('assignee=captain 创建队长任务(不误报 no active member)', async () => {
    await writeTeamToDisk(stateRoot, team())
    const result = await tool('agent_teams_create_task').execute(
      { subject: '队长亲自收尾', assignee: 'captain' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { task_id: string; status: string; assignee?: string; suggested_role?: string }
    expect(result.assignee).toBe('captain')
    expect(result.suggested_role).toBeUndefined() // 显式指派 → 无建议
    const persisted = await readTeam(stateRoot, 'team-tools')
    const created = persisted?.tasks.find(t => t.id === result.task_id)
    expect(created?.assignee).toBe('captain')
    expect(created?.status).toBe('pending') // 仍待认领
  })

  it('无关键词命中的任务不返回建议(不瞎猜)', async () => {
    await writeTeamToDisk(stateRoot, team())
    const result = await tool('agent_teams_create_task').execute(
      { subject: '随便做点事情' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { suggested_role?: string; suggested_assignee?: string }
    expect(result.suggested_role).toBeUndefined()
    expect(result.suggested_assignee).toBeUndefined()
  })

  it('验收类任务建议 qa 角色(角色映射经工具链路生效)', async () => {
    await writeTeamToDisk(stateRoot, team())
    const result = await tool('agent_teams_create_task').execute(
      { subject: '改进3/4/5 验收', description: '回归测试与冒烟走查' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { suggested_role?: string }
    expect(result.suggested_role).toBe('qa')
  })
})

describe('agent_teams_status — 建议展示(改进3 工具级)', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness()

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-status-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('未派任务附带建议字段;已派给建议成员的任务不再重复提示', async () => {
    await writeTeamToDisk(stateRoot, team({
      tasks: [
        task('t1', { subject: '实现筛选功能', status: 'pending' }),
        task('t2', { subject: '实现筛选功能', status: 'pending', assignee: '技术员' }),
        task('t3', { subject: '已完成任务', status: 'completed', assignee: '技术员' }),
      ],
    }))
    const result = await tool('agent_teams_status').execute(
      {},
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as {
      tasks: {
        id: string
        status: string
        assignee: string
        suggested_role?: string
        suggested_member?: string
        suggestion_confidence?: string
      }[]
    }
    const t1 = result.tasks.find(t => t.id === 't1')
    expect(t1?.suggested_role).toBe('engineer')
    expect(t1?.suggested_member).toBe('技术员')
    expect(t1?.suggestion_confidence).toBeDefined()
    // 终结态任务不产生建议。
    const t3 = result.tasks.find(t => t.id === 't3')
    expect(t3?.suggested_role).toBeUndefined()

    // renderStatus 文本:未派任务展示「建议分配给:…」,已派给建议成员的不展示。
    const rendered = tool('agent_teams_status').output?.render?.({}, result) ?? []
    const text = rendered.map(block => block.text).join('\n')
    const t1Line = text.split('\n').find(line => line.includes('t1 ['))
    const t2Line = text.split('\n').find(line => line.includes('t2 ['))
    expect(t1Line).toContain('建议分配给：技术员（engineer）')
    expect(t1Line).toContain('→ 技术员')
    expect(t2Line).not.toContain('建议分配给')
  })
})

describe('门禁拦截链路 — blockedByReview → pass/reject 放行(改进4 工具级)', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness()

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-gate-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  const gatedTask = (id: string): TeamTask => task(id, {
    subject: '高风险任务',
    status: 'in_progress',
    assignee: '技术员',
    attempt: 1,
    attemptId: 'att-1',
    riskLevel: 'high',
    reviewRequired: true,
    claimedAt: 1000,
    startedAt: 1000,
    updatedAt: 1000,
  })

  it('成员完成被拦截 → blockedByReview 落盘 → 政委 pass 放行 → completed + 复盘', async () => {
    await writeTeamToDisk(stateRoot, team({ tasks: [gatedTask('t1')] }))
    const engineer = agent(workspace, ENGINEER_ID)
    const commissar = agent(workspace, COMMISSAR_ID)

    // 1) 成员尝试完成 → 门禁拦截抛错
    await expect(tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: 'att-1' },
      execOf(engineer),
    )).rejects.toThrow(/requires commissar review/)

    // 2) 中间态已落盘:blockedByReview=true,状态/attempt 未变
    let persisted = await readTeam(stateRoot, 'team-tools')
    let gated = persisted?.tasks.find(t => t.id === 't1')
    expect(gated?.blockedByReview).toBe(true)
    expect(gated?.status).toBe('in_progress')
    expect(gated?.attemptId).toBe('att-1')

    // 3) 政委磁盘邮箱收到门禁通知
    const mailbox = await readFile(join(stateRoot, 'team-tools', 'inbox', '政委.jsonl'), 'utf8')
    expect(mailbox).toContain('门禁通知')
    expect(mailbox).toContain('t1')

    // 4) 政委 pass → gate_open,blockedByReview 清除
    const review = await tool('agent_teams_review_task').execute(
      { task_id: 't1', verdict: 'pass' },
      execOf(commissar),
    ) as { gate_open: boolean; reviewer: string }
    expect(review.gate_open).toBe(true)
    expect(review.reviewer).toBe('政委')
    persisted = await readTeam(stateRoot, 'team-tools')
    gated = persisted?.tasks.find(t => t.id === 't1')
    expect(gated?.blockedByReview).toBe(false)
    expect(gated?.review?.verdict).toBe('pass')

    // 5) 成员再次完成 → completed,复盘生成,中间态不再残留
    const updated = await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: 'att-1' },
      execOf(engineer),
    ) as { status: string }
    expect(updated.status).toBe('completed')
    persisted = await readTeam(stateRoot, 'team-tools')
    gated = persisted?.tasks.find(t => t.id === 't1')
    expect(gated?.status).toBe('completed')
    expect(gated?.blockedByReview).toBe(false)
    expect(gated?.retro).toBeDefined()
  })

  it('政委 reject 保持拦截:blockedByReview 维持,任务仍不能完成', async () => {
    await writeTeamToDisk(stateRoot, team({ tasks: [gatedTask('t1')] }))
    const engineer = agent(workspace, ENGINEER_ID)
    const commissar = agent(workspace, COMMISSAR_ID)

    await expect(tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: 'att-1' },
      execOf(engineer),
    )).rejects.toThrow(/requires commissar review/)

    const review = await tool('agent_teams_review_task').execute(
      { task_id: 't1', verdict: 'reject', comment: '补充测试用例' },
      execOf(commissar),
    ) as { gate_open: boolean }
    expect(review.gate_open).toBe(false)

    const persisted = await readTeam(stateRoot, 'team-tools')
    const gated = persisted?.tasks.find(t => t.id === 't1')
    expect(gated?.blockedByReview).toBe(true) // reject 不解锁,待返工
    expect(gated?.review?.verdict).toBe('reject')
    expect(gated?.review?.comment).toBe('补充测试用例')

    await expect(tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: 'att-1' },
      execOf(engineer),
    )).rejects.toThrow(/requires commissar review/)
  })

  it('无活跃政委时门禁拦截报错且不投递', async () => {
    const noCommissar = team({
      members: team().members.filter(member => member.role !== 'commissar'),
      tasks: [gatedTask('t1')],
    })
    await writeTeamToDisk(stateRoot, noCommissar)
    await expect(tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: 'att-1' },
      execOf(agent(workspace, ENGINEER_ID)),
    )).rejects.toThrow(/no active commissar/)
    const persisted = await readTeam(stateRoot, 'team-tools')
    expect(persisted?.tasks.find(t => t.id === 't1')?.blockedByReview).toBe(true)
  })

  it('R-26:门禁 live 唤醒在锁外——慢 followup 不阻塞同队并发 status', async () => {
    // 场景:成员完成被门禁拦截,需要实时唤醒政委;若唤醒(followup,网络)
    // 在团队锁内 await,慢唤醒期间同队 status 会被锁阻塞。
    // 修复后:锁内只落盘 blockedByReview + 政委邮箱,唤醒在锁外执行。
    const tools = new Map<string, CapturedTool>()
    let releaseWake!: () => void
    const wakeGate = new Promise<void>((resolve) => { releaseWake = resolve })
    const MEMBER_IDS = new Set([COMMISSAR_ID, ENGINEER_ID])
    const fakeCtx = {
      tools: { register: (def: CapturedTool) => { tools.set(def.name, def); return def } },
      agents: {
        get: (id: string) => MEMBER_IDS.has(id)
          ? { id, status: 'running', session: { header: { cwd: '' } } }
          : // 队长在线(需要走 live 唤醒路径)。
            id === CAPTAIN_ID
            ? { id, status: 'running', session: { header: { cwd: '' } } }
            : undefined,
      },
      logger: { warn: () => undefined, debug: () => undefined },
      on: () => undefined,
      effect: () => () => undefined,
      subagents: {
        registerContinuableSetup: () => undefined,
        followup: async () => { await wakeGate },
      },
    } as unknown as Context
    registerAgentTeamsTools(fakeCtx, config)
    const localTool = (name: string) => {
      const def = tools.get(name)
      if (def === undefined) throw new Error(`tool "${name}" not registered`)
      return def
    }
    await writeTeamToDisk(stateRoot, team({ tasks: [gatedTask('t1')] }))

    // 成员尝试完成 → 门禁拦截,进入唤醒(挂起);同时立即并发 status。
    const gatePromise = localTool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: 'att-1' },
      execOf(agent(workspace, ENGINEER_ID)),
    )
    const statusPromise = localTool('agent_teams_status').execute(
      {},
      execOf(agent(workspace, ENGINEER_ID)),
    )
    const statusResult = await Promise.race([
      statusPromise.then(value => ({ value, blocked: false })),
      new Promise<{ blocked: true }>((resolve) => setTimeout(() => resolve({ blocked: true }), 150)),
    ])
    expect(statusResult.blocked).toBe(false)
    releaseWake()
    await expect(gatePromise).rejects.toThrow(/requires commissar review/)
    // 锁内已落盘:blockedByReview + 政委邮箱通知。
    const persisted = await readTeam(stateRoot, 'team-tools')
    expect(persisted?.tasks.find(t => t.id === 't1')?.blockedByReview).toBe(true)
    const mailbox = await readFile(join(stateRoot, 'team-tools', 'inbox', '政委.jsonl'), 'utf8')
    expect(mailbox).toContain('门禁通知')
  })

  it('队长不能复核(独立监督);仅活跃政委可复核', async () => {
    await writeTeamToDisk(stateRoot, team({ tasks: [gatedTask('t1')] }))
    await expect(tool('agent_teams_review_task').execute(
      { task_id: 't1', verdict: 'pass' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/只有政委可以执行门禁复核/)
  })
})
