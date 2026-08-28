/**
 * R-13 通信与校准工具集成测试(send_message / retro_review / best_practices)。
 *
 * send_message:邮箱落盘(队长收件箱/成员邮箱)、from 伪造拒绝、未知收件人拒绝;
 * retro_review:队长校准落盘 + best-practices 补建、无复盘拒绝;
 * best_practices:查询返回 + 角色过滤 + 校准统计。
 *
 * 桩面与 tools-lifecycle.test.ts 同款扩展桩;队长 agent 离线(agents.get 返回
 * undefined)→ 走 mailbox-only 投递,便于断言磁盘邮箱。
 * @module dsh-agent-team-web/tools-comm
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerAgentTeamsTools, type ToolsConfig } from './tools.ts'
import { BEST_PRACTICES_FILE, type BestPracticeEntry } from './best-practices.ts'
import { readTeam } from './state.ts'
import type { TeamMember, TeamState, TeamTask } from './types.ts'

const config: ToolsConfig = {
  stateDir: '.agent-team-web',
  memberProvider: 'spawn',
  maxMembers: 8,
  stallThresholdMs: 120_000,
}

const CAPTAIN_ID = 'session-captain'
const ENGINEER_ID = 'session-engineer'
const QA_ID = 'session-qa'

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
    members: [
      { id: ENGINEER_ID, name: '技术员', role: 'engineer', provider: 'p', model: 'm', joinedAt: 1001, status: 'idle' },
      { id: QA_ID, name: '质检员', role: 'qa', provider: 'p', model: 'm', joinedAt: 1002, status: 'idle' },
    ],
    tasks: [],
    taskSeq: 0,
    ...overrides,
  }
}

interface CapturedTool {
  name: string
  execute(args: Record<string, unknown>, exec: { agent: Agent; signal: AbortSignal }): Promise<unknown>
  output?: { render(args: Record<string, unknown>, value: unknown): { type: string; text: string }[] }
  [key: string]: unknown
}

function harness(): (name: string) => CapturedTool {
  const tools = new Map<string, CapturedTool>()
  let childSeq = 0
  const runningIds = new Set([ENGINEER_ID, QA_ID])
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
      getProvider: () => ({
        prepareContinuable: {},
        capabilities: { persona: true, toolFilter: true },
      }),
      startContinuable: async () => ({ childId: `child-${++childSeq}` }),
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

describe('agent_teams_send_message — 消息与邮箱落盘', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness()

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-msg-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
    await writeTeamToDisk(stateRoot, team())
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('主路径:成员 → 队长,消息落入队长收件箱(mailbox 投递)', async () => {
    const result = await tool('agent_teams_send_message').execute(
      { to: 'captain', content: '任务完成,请验收' },
      execOf(agent(workspace, ENGINEER_ID)),
    ) as { delivered: string; to: string }
    expect(result.to).toBe('captain')
    expect(result.delivered).toBe('mailbox') // 队长离线 → mailbox-only

    const captainMail = await readFile(join(stateRoot, 'team-tools', 'inbox', 'captain.jsonl'), 'utf8')
    const message = JSON.parse(captainMail.trim().split('\n')[0]!) as { from: string; to: string; content: string }
    expect(message.from).toBe('技术员')
    expect(message.to).toBe('captain')
    expect(message.content).toBe('任务完成,请验收')
  })

  it('主路径:成员 → 成员,消息落入收件人邮箱', async () => {
    const result = await tool('agent_teams_send_message').execute(
      { to: '质检员', content: '请复核我的改动' },
      execOf(agent(workspace, ENGINEER_ID)),
    ) as { delivered: string; to: string }
    expect(result.to).toBe('质检员')

    const qaMail = await readFile(join(stateRoot, 'team-tools', 'inbox', '质检员.jsonl'), 'utf8')
    const message = JSON.parse(qaMail.trim().split('\n')[0]!) as { from: string; to: string; content: string }
    expect(message.from).toBe('技术员')
    expect(message.content).toBe('请复核我的改动')
  })

  it('错误分支:伪造 from 被拒(身份自证)', async () => {
    await expect(tool('agent_teams_send_message').execute(
      { to: 'captain', content: '伪造', from: '质检员' },
      execOf(agent(workspace, ENGINEER_ID)),
    )).rejects.toThrow(/must be your own identity/)
  })

  it('错误分支:未知收件人被拒', async () => {
    await expect(tool('agent_teams_send_message').execute(
      { to: '不存在的人', content: 'hi' },
      execOf(agent(workspace, ENGINEER_ID)),
    )).rejects.toThrow(/no active member named/)
  })
})

describe('agent_teams_retro_review — 队长复盘校准', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness()

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-retro-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  const retroTask = (id: string): TeamTask => task(id, {
    status: 'completed',
    assignee: '技术员',
    attempt: 1,
    attemptId: 'att-1',
    completedAt: 20_000,
    actualMs: 10_000,
    retro: {
      attempt: 1,
      actualMs: 10_000,
      overran: false,
      cause: 'underestimated',
      summary: '任务完成:实际 10s,预估 未预估。',
      recommendation: '同类任务下次按实际耗时预估。',
      createdAt: 20_000,
    },
  })

  it('主路径:useful 校准落盘 + best-practices 补建条目', async () => {
    await writeTeamToDisk(stateRoot, team({ tasks: [retroTask('t1')] }))
    const result = await tool('agent_teams_retro_review').execute(
      { task_id: 't1', verdict: 'useful', note: '确认有效经验' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { verdict: string; practice_updated: boolean }
    expect(result.verdict).toBe('useful')
    expect(result.practice_updated).toBe(true)

    // 任务复盘落盘:captainVerdict + retroNote。
    const persisted = await readTeam(stateRoot, 'team-tools')
    const t1 = persisted?.tasks.find(t => t.id === 't1')
    expect(t1?.retro?.captainVerdict).toBe('useful')
    expect(t1?.retro?.retroNote).toBe('确认有效经验')

    // 经验库补建(库里原本没有该任务条目)。
    const library = JSON.parse(await readFile(join(stateRoot, BEST_PRACTICES_FILE), 'utf8')) as BestPracticeEntry[]
    expect(library).toHaveLength(1)
    expect(library[0]?.verdict).toBe('useful')
    expect(library[0]?.sourceTaskId).toBe('t1')
  })

  it('错误分支:无复盘任务校准被拒', async () => {
    await writeTeamToDisk(stateRoot, team({ tasks: [task('t1', { status: 'in_progress', assignee: '技术员' })] }))
    await expect(tool('agent_teams_retro_review').execute(
      { task_id: 't1', verdict: 'useful' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/has no retrospective yet/)
  })
})

describe('agent_teams_best_practices — 经验库查询与校准统计', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness()

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-bp-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
    const library: BestPracticeEntry[] = [
      {
        id: 'bp-1', sourceTeamId: 'team-tools', sourceTaskId: 't1', sourceTaskSubject: '任务t1',
        role: 'engineer', cause: 'underestimated', practice: '先写测试再动手', verdict: 'useful',
        createdAt: 1000, updatedAt: 2000,
      },
      {
        id: 'bp-2', sourceTeamId: 'team-tools', sourceTaskId: 't2', sourceTaskSubject: '任务t2',
        role: 'qa', cause: 'on_time', practice: '验收先列检查清单', verdict: 'pending',
        createdAt: 1000, updatedAt: 2000,
      },
    ]
    await writeFile(join(stateRoot, BEST_PRACTICES_FILE), `${JSON.stringify(library, null, 2)}\n`)
    // 一名工程师已完成 1 个带耗时的任务,用于校准统计。
    await writeTeamToDisk(stateRoot, team({
      members: [
        { id: ENGINEER_ID, name: '技术员', role: 'engineer', provider: 'p', model: 'm', joinedAt: 1001, status: 'idle' },
        { id: QA_ID, name: '质检员', role: 'qa', provider: 'p', model: 'm', joinedAt: 1002, status: 'idle' },
      ],
      tasks: [task('t9', {
        status: 'completed',
        assignee: '技术员',
        attempt: 1,
        attemptId: 'att-9',
        claimedAt: 10_000,
        completedAt: 40_000,
        actualMs: 30_000,
        estimateLevel: 'S',
      })],
    }))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('主路径:返回全量经验 + 按角色过滤 + 校准统计', async () => {
    const result = await tool('agent_teams_best_practices').execute(
      {},
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as {
      total: number
      best_practices: { id: string; role: string; verdict: string }[]
      calibration: { completed_with_timing: number; by_role_level: { role: string; task_count: number }[]; hint: string }
    }
    expect(result.total).toBe(2)
    expect(result.best_practices.map(e => e.role).sort()).toEqual(['engineer', 'qa'])
    expect(result.calibration.completed_with_timing).toBe(1)
    expect(result.calibration.by_role_level).toContainEqual(expect.objectContaining({ role: 'engineer', task_count: 1 }))
    // 冷启动守卫:样本 <2 不出校准结论(正确行为)。
    expect(result.calibration.hint).toContain('样本不足')

    const filtered = await tool('agent_teams_best_practices').execute(
      { role: 'qa' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { total: number; best_practices: { role: string }[] }
    expect(filtered.total).toBe(1)
    expect(filtered.best_practices[0]?.role).toBe('qa')
  })

  it('渲染函数:renderBestPractices 输出包含条目与校准提示', async () => {
    const result = await tool('agent_teams_best_practices').execute(
      {},
      execOf(agent(workspace, CAPTAIN_ID)),
    )
    const rendered = tool('agent_teams_best_practices').output?.render?.({}, result) ?? []
    const text = rendered.map(block => block.text).join('\n')
    expect(text).toContain('Best practices (2 entries')
    expect(text).toContain('先写测试再动手')
    expect(text).toContain('Calibration:')
  })
})
