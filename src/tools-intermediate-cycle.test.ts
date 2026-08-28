/**
 * R-02/R-03/R-04 修复回归测试(合并报告 §3.2 + t2 报告 P2-6/P2-3 同源)。
 *
 * R-02 awaitingInput 清除闭环:update_task(input_answered=true) 显式清除,
 *   显式 false 压制描述派生;claim_task 与 scheduler nextReadyTask 跳过待输入任务。
 * R-03 invalidateTaskAttempt 清中间态:重派后 blockedByReview/awaitingInput
 *   不得残留污染新 attempt。
 * R-04 create_task 依赖环检测:自环/互环/传递环命中即拒绝并报环路径。
 *
 * 测试基建沿用 tools-suggest-gate.test.ts 同款:「mkdtemp 工作区 + 磁盘状态 +
 * 真实工具定义执行 + 断言落盘」;成员 agent 一律 running 使调度器 kick 短路。
 * @module dsh-agent-team-web/tools-intermediate-cycle
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerAgentTeamsTools, type ToolsConfig } from './tools.ts'
import { findTaskCycle, invalidateTaskAttempt, readTeam, taskAwaitingInput } from './state.ts'
import { isHelppableTask, nextReadyTask } from './scheduler.ts'
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

/** Write a team record at `<stateRoot>/<team.id>/team.json`(同款基建)。 */
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

describe('R-02 — awaitingInput 清除闭环(工具级 + 纯函数)', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness()

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-r02-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('待确认描述任务:创建置位 → 成员认领被拦 → input_answered 清除落盘 → 可认领', async () => {
    await writeTeamToDisk(stateRoot, team())
    const captain = agent(workspace, CAPTAIN_ID)
    const engineer = agent(workspace, ENGINEER_ID)

    // 1) create_task 描述含"待确认" → awaitingInput 置位落盘
    const created = await tool('agent_teams_create_task').execute(
      { subject: '实现筛选功能', description: '待确认：目标平台是 Web 还是 CLI' },
      execOf(captain),
    ) as { task_id: string }
    expect(created.task_id).toBe('t1')
    let persisted = await readTeam(stateRoot, 'team-tools')
    let t1 = persisted?.tasks.find(t => t.id === 't1')
    expect(t1?.awaitingInput).toBe(true)

    // 2) 调度器 nextReadyTask 跳过待输入任务(纯函数)
    expect(nextReadyTask(persisted!.tasks, '技术员')).toBeUndefined()

    // 3) 成员认领被拦(R-02 认领拦截)
    await expect(tool('agent_teams_claim_task').execute(
      { task_id: 't1' },
      execOf(engineer),
    )).rejects.toThrow(/awaiting input \(待输入\)/)

    // 4) 队长 input_answered=true 清除,同步落盘
    const cleared = await tool('agent_teams_update_task').execute(
      { task_id: 't1', input_answered: true },
      execOf(captain),
    )
    expect(cleared).toBeDefined()
    persisted = await readTeam(stateRoot, 'team-tools')
    t1 = persisted?.tasks.find(t => t.id === 't1')
    expect(t1?.awaitingInput).toBe(false)
    // 显式 false 压制描述派生:描述仍含"待确认",但派生恒为 false。
    expect(taskAwaitingInput(t1!)).toBe(false)

    // 5) 清除后调度器可派单、成员可认领
    expect(nextReadyTask(persisted!.tasks, '技术员')?.id).toBe('t1')
    const claimed = await tool('agent_teams_claim_task').execute(
      { task_id: 't1' },
      execOf(engineer),
    ) as { attempt: number; attempt_id?: string }
    expect(claimed.attempt).toBe(1)
    expect(claimed.attempt_id).toBeDefined()
  })

  it('nextReadyTask 跳过派生型(无显式标记但描述含待确认)与显式 true 任务,放行显式 false 任务', () => {
    const tasks = [
      task('t1', { subject: 'a', awaitingInput: true }),
      task('t2', { subject: 'b', description: '请确认：接口路径' }), // 派生型
      task('t3', { subject: 'c', awaitingInput: false, description: '请确认：接口路径' }), // 已答
      task('t4', { subject: 'd' }), // 普通
    ]
    const ready = nextReadyTask(tasks, '技术员')
    expect(ready?.id).toBe('t3') // t1/t2 被跳过;t3 显式 false 优先于 t4(数组顺序,未派单取第一个 ready)
    expect(nextReadyTask([tasks[0]!, tasks[1]!], '技术员')).toBeUndefined()
  })

  it('终结状态不残留"待输入"派生(R-02 派生兜底规则)', () => {
    const done = task('t1', { status: 'completed', awaitingInput: true, description: '待确认：X' })
    expect(taskAwaitingInput(done)).toBe(false)
  })

  it('helper 派单(isHelppableTask)同样跳过 awaitingInput 任务', () => {
    const helperTeam = team({
      members: [
        { id: COMMISSAR_ID, name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1000, status: 'idle' },
        { id: ENGINEER_ID, name: '技术员', role: 'engineer', provider: 'p', model: 'm', joinedAt: 1001, status: 'idle' },
        { id: 'session-qa', name: '质检员一号', role: 'qa', provider: 'p', model: 'm', joinedAt: 1002, status: 'idle' },
      ],
      tasks: [task('t1', {
        subject: '停滞任务',
        status: 'in_progress',
        assignee: '技术员',
        attempt: 1,
        attemptId: 'att-1',
        updatedAt: 1000,
        awaitingInput: true, // 等待输入:即使停滞也不应被 helper 推
      })],
    })
    const now = Date.now()
    const helppable = isHelppableTask(
      helperTeam.tasks[0]!,
      helperTeam,
      '质检员一号',
      now,
      new Map<string, string>(),
      () => undefined,
      60_000,
    )
    expect(helppable).toBe(false)
    // 对照:同样停滞但非等待输入的任务仍可被 helper 推(不误伤)。
    const normal = team({
      tasks: [task('t1', {
        subject: '停滞任务',
        status: 'in_progress',
        assignee: '技术员',
        attempt: 1,
        attemptId: 'att-1',
        updatedAt: 1000,
      })],
    })
    expect(isHelppableTask(
      normal.tasks[0]!,
      normal,
      '质检员一号',
      now,
      new Map<string, string>(),
      () => undefined,
      60_000,
    )).toBe(true)
  })
})

describe('R-03 — invalidateTaskAttempt 清空中间态(纯函数)', () => {
  it('重派后 blockedByReview/awaitingInput 不残留污染新 attempt', () => {
    const owned = task('t1', {
      status: 'in_progress',
      assignee: '技术员',
      attempt: 1,
      attemptId: 'att-1',
      claimedAt: 1000,
      startedAt: 2000,
      output: '旧输出',
      blockedByReview: true,
      awaitingInput: true,
      helper: '质检员一号',
      helperSince: 3000,
      helperEver: true,
      retro: {
        attempt: 1, actualMs: 1000, overran: false, cause: 'on_time',
        summary: '旧复盘', recommendation: '', createdAt: 4000,
      },
    })
    invalidateTaskAttempt(owned, '质检员一号', true)
    expect(owned.blockedByReview).toBeUndefined()
    expect(owned.awaitingInput).toBeUndefined()
    expect(owned.attemptId).toBeUndefined()
    expect(owned.status).toBe('pending')
    expect(owned.assignee).toBe('质检员一号')
    expect(owned.reassigning).toBe(true)
    expect(owned.output).toBeUndefined()
    expect(owned.claimedAt).toBeUndefined()
    expect(owned.retro).toBeUndefined()
    expect(owned.helper).toBeUndefined()
  })
})

describe('R-04 — create_task 依赖环检测(工具级)', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness()

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-r04-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('自环:新任务依赖自身 id 被拒绝', async () => {
    await writeTeamToDisk(stateRoot, team({ tasks: [task('t1')], taskSeq: 1 }))
    await expect(tool('agent_teams_create_task').execute(
      { subject: '自环任务', dependencies: ['t2'] },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/dependency cycle detected: t2 → t2/)
    // 拒绝后不落盘:任务数不变。
    const persisted = await readTeam(stateRoot, 'team-tools')
    expect(persisted?.tasks).toHaveLength(1)
    expect(persisted?.taskSeq).toBe(1)
  })

  it('互环(预置损坏数据)命中即拒绝并报环路径;正常链放行', async () => {
    // 预置 t1→t2、t2→t1 互环(手工损坏场景),创建 t3 应被拒绝。
    await writeTeamToDisk(stateRoot, team({
      tasks: [
        task('t1', { dependencies: ['t2'] }),
        task('t2', { dependencies: ['t1'] }),
      ],
      taskSeq: 2,
    }))
    await expect(tool('agent_teams_create_task').execute(
      { subject: '在环上新建任务' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/dependency cycle detected: t1 → t2 → t1/)
    let persisted = await readTeam(stateRoot, 'team-tools')
    expect(persisted?.tasks).toHaveLength(2)

    // 正常链 t1 → t2(无环)放行。
    await writeTeamToDisk(stateRoot, team({ tasks: [task('t1')], taskSeq: 1 }))
    const created = await tool('agent_teams_create_task').execute(
      { subject: '正常依赖', dependencies: ['t1'] },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { task_id: string; status: string }
    expect(created.task_id).toBe('t2')
    expect(created.status).toBe('pending')
    persisted = await readTeam(stateRoot, 'team-tools')
    expect(persisted?.tasks.find(t => t.id === 't2')?.dependencies).toEqual(['t1'])
  })

  it('findTaskCycle:间接环(a→b→c→a)命中并报完整路径;深链合法 DAG 无环', () => {
    // 间接环:a→b→c→a(三节点传递环)。
    const indirect = [
      task('a', { dependencies: ['b'] }),
      task('b', { dependencies: ['c'] }),
      task('c', { dependencies: ['a'] }),
      task('d', {}),
    ]
    expect(findTaskCycle(indirect)).toEqual(['a', 'b', 'c', 'a'])

    // 深链合法 DAG:a→b→c→d(无回边)无环。
    const dag = [
      task('a', {}),
      task('b', { dependencies: ['a'] }),
      task('c', { dependencies: ['b'] }),
      task('d', { dependencies: ['c'] }),
    ]
    expect(findTaskCycle(dag)).toBeUndefined()
    // 未知依赖 id 不参与成环判定(create_task 已做存在性校验)。
    const withUnknown = [
      task('a', { dependencies: ['ghost'] }),
      task('b', {}),
    ]
    expect(findTaskCycle(withUnknown)).toBeUndefined()
  })
})

describe('R-06 — helper 标记清理(工具级)', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness()

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-r06-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('remove_member 摘除被移除成员在其他任务上的 helper 引用(helperEver 保留作审计)', async () => {
    const withHelper = team({
      members: [
        { id: COMMISSAR_ID, name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1000, status: 'idle' },
        { id: ENGINEER_ID, name: '技术员', role: 'engineer', provider: 'p', model: 'm', joinedAt: 1001, status: 'idle' },
        { id: 'session-qa', name: '质检员一号', role: 'qa', provider: 'p', model: 'm', joinedAt: 1002, status: 'idle' },
      ],
      tasks: [task('t1', {
        subject: '被帮助的任务',
        status: 'in_progress',
        assignee: '技术员',
        attempt: 1,
        attemptId: 'att-1',
        updatedAt: 1000,
        helper: '质检员一号',
        helperSince: 2000,
        helperEver: true,
      })],
    })
    await writeTeamToDisk(stateRoot, withHelper)

    // 移除作为 helper 的质检员一号:任务不归其所有(assignee=技术员),不 requeue,
    // 但 helper 引用必须摘除(R-06 修复前残留,isHelppableTask 将永远拒绝再帮助 t1)。
    const removed = await tool('agent_teams_remove_member').execute(
      { name: '质检员一号' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { requeued_tasks: string[] }
    expect(removed.requeued_tasks).toEqual([])

    const persisted = await readTeam(stateRoot, 'team-tools')
    const t1 = persisted?.tasks.find(t => t.id === 't1')
    expect(t1?.helper).toBeUndefined()
    expect(t1?.helperSince).toBeUndefined()
    // helperEver 保留作复盘审计(hasHelper 标注),不被移除路径误伤。
    expect(t1?.helperEver).toBe(true)
    expect(persisted?.members.find(m => m.name === '质检员一号')?.status).toBe('removed')
  })

  it('任务终结时清除 helper 引用但保留 helperEver(R-06)', async () => {
    await writeTeamToDisk(stateRoot, team({
      tasks: [task('t1', {
        subject: '普通任务',
        status: 'in_progress',
        assignee: '技术员',
        attempt: 1,
        attemptId: 'att-1',
        claimedAt: 10_000,
        startedAt: 15_000,
        updatedAt: 20_000,
        helper: '质检员一号',
        helperSince: 16_000,
        helperEver: true,
      })],
    }))

    const updated = await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: 'att-1', output: '完成' },
      execOf(agent(workspace, ENGINEER_ID)),
    ) as { status: string }
    expect(updated.status).toBe('completed')

    const persisted = await readTeam(stateRoot, 'team-tools')
    const t1 = persisted?.tasks.find(t => t.id === 't1')
    expect(t1?.helper).toBeUndefined()
    expect(t1?.helperSince).toBeUndefined()
    expect(t1?.helperEver).toBe(true) // 复盘 hasHelper 标注不受清理误伤
    expect(t1?.retro?.hasHelper).toBe(true)
  })
})

describe('R-07 — signals.turns 保真(工具级)', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness()

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-r07-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('output-only 更新不重置 turns;组合序列 turns 正确累计(R-07)', async () => {
    await writeTeamToDisk(stateRoot, team({
      tasks: [task('t1', {
        subject: '普通任务',
        status: 'claimed',
        assignee: '技术员',
        attempt: 1,
        attemptId: 'att-1',
        claimedAt: 10_000,
      })],
    }))
    const engineer = agent(workspace, ENGINEER_ID)

    // in_progress → turns=1
    await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'in_progress', attempt_id: 'att-1' },
      execOf(engineer),
    )
    // 仅 output(两次):R-07 修复前 turns 被整体重置为 undefined。
    await tool('agent_teams_update_task').execute(
      { task_id: 't1', output: '第一版', attempt_id: 'att-1' },
      execOf(engineer),
    )
    await tool('agent_teams_update_task').execute(
      { task_id: 't1', output: '第二版', attempt_id: 'att-1' },
      execOf(engineer),
    )
    // completed → turns=2;outputBytes=最后一次 output 长度
    const done = await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: 'att-1', output: '最终版' },
      execOf(engineer),
    ) as { signals?: { turns?: number; output_bytes: number } }
    expect(done.signals?.turns).toBe(2)
    expect(done.signals?.output_bytes).toBe('最终版'.length)

    const persisted = await readTeam(stateRoot, 'team-tools')
    const t1 = persisted?.tasks.find(t => t.id === 't1')
    expect(t1?.signals?.turns).toBe(2)
    expect(t1?.signals?.outputBytes).toBe('最终版'.length)
  })

  it('signal_note 分支保留 turns 与 outputBytes;无先验 signals 时 output-only 语义明确', async () => {
    await writeTeamToDisk(stateRoot, team({
      tasks: [task('t1', {
        subject: '普通任务',
        status: 'in_progress',
        assignee: '技术员',
        attempt: 1,
        attemptId: 'att-1',
        claimedAt: 10_000,
        startedAt: 10_000,
        signals: { turns: 3, outputBytes: 12, selfReport: '已有自报' },
      })],
    }))
    const engineer = agent(workspace, ENGINEER_ID)

    const withNote = await tool('agent_teams_update_task').execute(
      { task_id: 't1', output: '补充输出', signal_note: '深挖了 1400 行 CSS', attempt_id: 'att-1' },
      execOf(engineer),
    ) as { signals?: { turns?: number; output_bytes: number; self_report?: string } }
    expect(withNote.signals?.turns).toBe(3) // 保留
    expect(withNote.signals?.output_bytes).toBe('补充输出'.length)
    expect(withNote.signals?.self_report).toBe('深挖了 1400 行 CSS')

    // 无先验 signals 的任务:仅 output → turns 键缺省(undefined 语义),outputBytes 正常。
    await writeTeamToDisk(stateRoot, team({
      tasks: [task('t2', {
        subject: '无信号任务',
        status: 'in_progress',
        assignee: '技术员',
        attempt: 1,
        attemptId: 'att-2',
        claimedAt: 10_000,
        startedAt: 10_000,
      })],
    }))
    const bare = await tool('agent_teams_update_task').execute(
      { task_id: 't2', output: '首次输出', attempt_id: 'att-2' },
      execOf(engineer),
    ) as { signals?: { turns?: number; output_bytes: number } }
    expect(bare.signals?.turns).toBeUndefined()
    expect(bare.signals?.output_bytes).toBe('首次输出'.length)
  })
})
