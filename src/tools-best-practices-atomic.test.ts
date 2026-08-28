/**
 * R-08/R-09/R-10 修复回归测试(合并报告 §3.3 + 质检员验收点⑤)。
 *
 * R-08 经验库并发原子性:mutateBestPractices 把"读→变换→写"整体放入
 *   best-practices 锁内;工具级 Promise.all 双团队并发终结双写不丢条目。
 * R-09 upsertBestPractice verdict 重置:practice 文本变化(重试/新 attempt
 *   重新提炼)时旧校准(useful/useless/revised)不得残留污染新经验。
 * R-10 scheduler 帮助派发后 owner 通知 appendMailbox 团队锁串行化。
 *
 * 测试基建沿用 tools-suggest-gate.test.ts 同款(mkdtemp + 磁盘状态 + 真实
 * 工具定义执行 + 断言落盘);scheduler 集成沿用 scheduler.test.ts 同款。
 * @module dsh-agent-team-web/tools-best-practices-atomic
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerAgentTeamsTools, type ToolsConfig } from './tools.ts'
import { installTeamScheduler, type SchedulerConfig } from './scheduler.ts'
import { mutateBestPractices, readBestPractices, upsertBestPractice, type BestPracticeEntry } from './best-practices.ts'
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

/** 一个最小团队:仅一名执行成员(无政委、无门禁任务),id 可定制以支持双团队。 */
function team(teamId: string, memberId: string, memberName: string, overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: `团队${teamId}`,
    id: teamId,
    description: 'demo',
    captainSessionId: `${CAPTAIN_ID}-${teamId}`,
    createdAt: 1000,
    members: [
      { id: memberId, name: memberName, role: 'engineer', provider: 'p', model: 'm', joinedAt: 1001, status: 'idle' },
    ],
    tasks: [],
    taskSeq: 0,
    ...overrides,
  }
}

async function writeTeamToDisk(stateRoot: string, teamState: TeamState): Promise<void> {
  const dir = join(stateRoot, teamState.id)
  await mkdir(join(dir, 'inbox'), { recursive: true })
  await writeFile(join(dir, 'team.json'), JSON.stringify(teamState, null, 2))
}

interface CapturedTool {
  name: string
  execute(args: Record<string, unknown>, exec: { agent: Agent; signal: AbortSignal }): Promise<unknown>
  [key: string]: unknown
}

function harness(): (name: string) => CapturedTool {
  const tools = new Map<string, CapturedTool>()
  const fakeCtx = {
    tools: {
      register: (def: CapturedTool) => {
        tools.set(def.name, def)
        return def
      },
    },
    agents: { get: () => undefined },
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

describe('R-08 — 经验库并发原子性(工具级双团队并发 + RMW 锁覆盖)', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness()

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-r08-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('两团队并发终结任务各蒸馏一条经验:两条都在,不丢条目(Promise.all 双写)', async () => {
    // 团队 A(技术员甲)与团队 B(技术员乙)共享同一 stateRoot;两个任务同时
    // 完成 → 各自经 mutateBestPractices 原子入库。修复前(read 无锁+写锁只护
    // 写入段)两团队读到同一基线、后写覆盖先写,必丢一条。
    await writeTeamToDisk(stateRoot, team('team-a', 'session-eng-a', '技术员甲', {
      tasks: [task('t1', {
        subject: 'A 的任务',
        status: 'in_progress',
        assignee: '技术员甲',
        attempt: 1,
        attemptId: 'att-a',
        claimedAt: 10_000,
        startedAt: 10_000,
      })],
    }))
    await writeTeamToDisk(stateRoot, team('team-b', 'session-eng-b', '技术员乙', {
      tasks: [task('t1', {
        subject: 'B 的任务',
        status: 'in_progress',
        assignee: '技术员乙',
        attempt: 1,
        attemptId: 'att-b',
        claimedAt: 10_000,
        startedAt: 10_000,
      })],
    }))

    const [resultA, resultB] = await Promise.all([
      tool('agent_teams_update_task').execute(
        { task_id: 't1', status: 'completed', attempt_id: 'att-a', output: 'A 完成', retro_note: 'A 的经验:先读测试' },
        execOf(agent(workspace, 'session-eng-a')),
      ),
      tool('agent_teams_update_task').execute(
        { task_id: 't1', status: 'completed', attempt_id: 'att-b', output: 'B 完成', retro_note: 'B 的经验:先跑冒烟' },
        execOf(agent(workspace, 'session-eng-b')),
      ),
    ])
    expect((resultA as { status: string }).status).toBe('completed')
    expect((resultB as { status: string }).status).toBe('completed')

    // 两条经验都必须入库(并发下不丢条目)。
    const library = await readBestPractices(stateRoot)
    expect(library).toHaveLength(2)
    const practices = library.map(entry => entry.practice).sort()
    expect(practices).toEqual(['A 的经验:先读测试', 'B 的经验:先跑冒烟'])
    expect(library.map(entry => entry.sourceTeamId).sort()).toEqual(['team-a', 'team-b'])
  })

  it('高并发追加(50 路 Promise.all)全部保留——串行化确定性证明', async () => {
    // 质检员备注的确定性强化:修复前「读无锁+写锁只护写入段」下,并发越多
    // 读-改-写碰撞概率越高,50 路并发几乎必然后写覆盖先写丢条目;
    // 修复后 mutateBestPractices 将 RMW 整体串行化,50 条全部保留,确定性绿。
    const entry = (i: number): BestPracticeEntry => ({
      id: `bp-${i}`,
      sourceTeamId: 'team-x',
      sourceTaskId: `t${i}`,
      sourceTaskSubject: `任务${i}`,
      role: 'engineer',
      cause: 'on_time',
      practice: `经验 #${i}`,
      verdict: 'pending',
      createdAt: 1000,
      updatedAt: 1000,
    })
    await Promise.all(Array.from({ length: 50 }, (_, i) =>
      mutateBestPractices(stateRoot, entries => upsertBestPractice(entries, entry(i)))))

    const library = await readBestPractices(stateRoot)
    expect(library).toHaveLength(50)
    expect(new Set(library.map(e => e.practice)).size).toBe(50)
  })
})

describe('R-09 — upsertBestPractice verdict 重置(纯函数)', () => {
  function entry(overrides: Partial<BestPracticeEntry> = {}): BestPracticeEntry {
    return {
      id: 'bp-1',
      sourceTeamId: 'team-a',
      sourceTaskId: 't1',
      sourceTaskSubject: '任务t1',
      role: 'engineer',
      cause: 'underestimated',
      practice: '旧经验文本',
      verdict: 'useful',
      createdAt: 1000,
      updatedAt: 1000,
      ...overrides,
    }
  }

  it('practice 变化时旧校准不残留:verdict 重置为 pending', () => {
    const next = entry({ id: 'bp-2', practice: '新经验文本', verdict: 'pending' })
    const merged = upsertBestPractice([entry()], next)[0]!
    expect(merged.practice).toBe('新经验文本')
    expect(merged.verdict).toBe('pending')
    expect(merged.id).toBe('bp-1') // 稳定 id 保留
  })

  it('useless 旧条目同样重置:新经验不被旧否决静默过滤', () => {
    const next = entry({ id: 'bp-2', practice: '重试后的经验', verdict: 'pending' })
    const merged = upsertBestPractice([entry({ verdict: 'useless' })], next)[0]!
    expect(merged.verdict).toBe('pending')
  })

  it('practice 未变化时保留既有校准(幂等更新不误伤)', () => {
    const next = entry({ id: 'bp-2', practice: '旧经验文本', verdict: 'pending' })
    const merged = upsertBestPractice([entry()], next)[0]!
    expect(merged.verdict).toBe('useful')
  })
})

describe('R-10 — 帮助派发 owner 通知 appendMailbox 串行化(集成回归)', () => {
  let workspace: string
  let stateRoot: string
  const config: SchedulerConfig = { stateDir: '.agent-team-web', stallThresholdMs: 60_000 }

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-r10-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(join(stateRoot, 'team-sched', 'inbox'), { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('两个帮助者并发协助同一 owner 的不同任务:两条 owner 通知都在(修复前锁外 append 可能互覆盖丢消息)', async () => {
    const member = (name: string): TeamMember => ({
      id: `session-${name}`, name, role: 'engineer', provider: 'p', model: 'm', joinedAt: 1000, status: 'idle',
    })
    const stalled = (id: string): TeamTask => task(id, {
      subject: `任务${id}`,
      status: 'in_progress',
      assignee: 'B',
      attempt: 1,
      attemptId: `att-${id}`,
      updatedAt: 1000,
    })
    const state: TeamState = {
      name: '调度测试团队',
      id: 'team-sched',
      captainSessionId: 'session-captain',
      createdAt: 1000,
      members: [member('A'), member('B'), member('C')],
      tasks: [stalled('t1'), stalled('t2')],
      taskSeq: 0,
    }
    await writeFile(join(stateRoot, 'team-sched', 'team.json'), JSON.stringify(state, null, 2))

    const scheduler = installTeamScheduler({
      agents: {
        get: (id: string) => id === 'session-captain' ? { status: 'idle' } : undefined,
      },
      subagents: {
        followup: async () => undefined,
      },
      logger: { warn: () => undefined, debug: () => undefined },
      on: (): void => undefined,
    } as unknown as Context, config)

    // A 与 C 并发为同一 owner(B)的两个停滞任务派发帮助;谁帮哪个任务属竞态,
    // 但两条 owner 通知都必须落到 B 的邮箱(R-10 串行化核心断言,见下)。
    await Promise.all([
      scheduler.kickMember(workspace, 'team-sched', 'A'),
      scheduler.kickMember(workspace, 'team-sched', 'C'),
    ])

    const ownerMail = await readFile(join(stateRoot, 'team-sched', 'inbox', 'B.jsonl'), 'utf8')
    const notifications = ownerMail.trim().split('\n').filter(line => line.includes('正在协助'))
    expect(notifications).toHaveLength(2)
    expect(ownerMail).toContain('t1')
    expect(ownerMail).toContain('t2')

    // 两个帮助者并发抢单:谁先获得团队锁处理哪个任务属竞态,不保证固定配对
    // (A→t1/C→t2 只是常见顺序)——用集合断言"两任务各有 helper 且 helper 集合={A,C}"。
    const fresh = JSON.parse(await readFile(join(stateRoot, 'team-sched', 'team.json'), 'utf8')) as TeamState
    const helpers = ['t1', 't2'].map(id => fresh.tasks.find(t => t.id === id)?.helper).sort()
    expect(helpers).toEqual(['A', 'C'])
    expect(fresh.tasks.find(t => t.id === 't1')?.assignee).toBe('B')
    expect(fresh.tasks.find(t => t.id === 't2')?.assignee).toBe('B')
  })
})
