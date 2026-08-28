/**
 * R-13/R-14 任务流工具集成测试(claim_task / reassign_task / update_task 分支)。
 *
 * R-13:claim_task(认领计时/重复认领/忙/依赖)与 reassign_task(attempt 轮换、
 * stale 拒绝)主路径 + 错误分支,断言磁盘落盘。
 * R-14:update_task 正常终结路径补测——failed/cancelled 复盘生成(含 cancelled
 * 不入经验库)、signal_note 落盘;门禁拦截路径已有 tools-suggest-gate 覆盖。
 *
 * 桩面与 tools-lifecycle.test.ts 同款扩展桩(members running 短路调度器 kick)。
 * @module dsh-agent-team-web/tools-task
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerAgentTeamsTools, type ToolsConfig } from './tools.ts'
import { readBestPractices } from './best-practices.ts'
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

describe('agent_teams_claim_task — 认领', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness()

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-claim-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('主路径:未指派任务被成员认领,计时与 attempt 落盘', async () => {
    await writeTeamToDisk(stateRoot, team({ tasks: [task('t1', { status: 'pending' })] }))
    const result = await tool('agent_teams_claim_task').execute(
      { task_id: 't1' },
      execOf(agent(workspace, ENGINEER_ID)),
    ) as { status: string; assignee: string; attempt: number; attempt_id: string }
    expect(result.status).toBe('claimed')
    expect(result.assignee).toBe('技术员')
    expect(result.attempt).toBe(1)
    expect(result.attempt_id).toBeDefined()

    const persisted = await readTeam(stateRoot, 'team-tools')
    const t1 = persisted?.tasks.find(t => t.id === 't1')
    expect(t1?.status).toBe('claimed')
    expect(t1?.assignee).toBe('技术员')
    expect(t1?.attempt).toBe(1)
    expect(t1?.attemptId).toBe(result.attempt_id)
    expect(t1?.claimedAt).toBeTypeOf('number') // 认领计时落盘
  })

  it('错误分支:依赖未完成不可认领', async () => {
    await writeTeamToDisk(stateRoot, team({
      tasks: [
        task('t0', { status: 'pending' }),
        task('t1', { status: 'pending', dependencies: ['t0'] }),
      ],
    }))
    await expect(tool('agent_teams_claim_task').execute(
      { task_id: 't1' },
      execOf(agent(workspace, ENGINEER_ID)),
    )).rejects.toThrow(/blocked by unfinished dependencies: t0/)
  })

  it('错误分支:他人已认领的任务再认领被拒', async () => {
    await writeTeamToDisk(stateRoot, team({ tasks: [task('t1', { status: 'claimed', assignee: '质检员', attemptId: 'att-1' })] }))
    await expect(tool('agent_teams_claim_task').execute(
      { task_id: 't1' },
      execOf(agent(workspace, ENGINEER_ID)),
    )).rejects.toThrow(/assigned to "质检员", not you|already claimed by/)
  })

  it('错误分支:已有未完成任务时不能认领第二件(one-worker 规则)', async () => {
    await writeTeamToDisk(stateRoot, team({
      tasks: [
        task('t1', { status: 'in_progress', assignee: '技术员', attemptId: 'att-1' }),
        task('t2', { status: 'pending' }),
      ],
    }))
    await expect(tool('agent_teams_claim_task').execute(
      { task_id: 't2' },
      execOf(agent(workspace, ENGINEER_ID)),
    )).rejects.toThrow(/is busy with t1/)
  })
})

describe('agent_teams_reassign_task — 重派与 attempt 轮换', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness()

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-reassign-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('主路径:重派后旧 attempt 作废,新 owner 用旧 attempt_id 被拒(stale)', async () => {
    await writeTeamToDisk(stateRoot, team({ tasks: [task('t1', {
      status: 'in_progress',
      assignee: '技术员',
      attempt: 1,
      attemptId: 'att-1',
      claimedAt: 10_000,
      output: '旧输出',
    })] }))

    const reassigned = await tool('agent_teams_reassign_task').execute(
      { task_id: 't1', assignee: '质检员', reason: '技术员超载' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { previous_assignee: string; assignee: string; attempt: number }
    expect(reassigned.previous_assignee).toBe('技术员')
    expect(reassigned.assignee).toBe('质检员')
    expect(reassigned.attempt).toBeGreaterThanOrEqual(1)

    // 旧 owner 的 attempt 已被作废:旧 attempt_id 更新必被拒(stale-attempt 语义)。
    const persisted = await readTeam(stateRoot, 'team-tools')
    const t1 = persisted?.tasks.find(t => t.id === 't1')
    expect(t1?.attemptId).not.toBe('att-1')
    expect(t1?.assignee).toBe('质检员')
    expect(t1?.output).toBeUndefined() // 旧输出随 attempt 作废

    await expect(tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: 'att-1' },
      execOf(agent(workspace, ENGINEER_ID)),
    )).rejects.toThrow(/assigned to "质检员", not you|stale attempt/)
  })

  it('主路径:队长接管(assignee=captain)直接取得新 attempt', async () => {
    await writeTeamToDisk(stateRoot, team({ tasks: [task('t1', {
      status: 'in_progress',
      assignee: '技术员',
      attempt: 1,
      attemptId: 'att-1',
    })] }))
    const result = await tool('agent_teams_reassign_task').execute(
      { task_id: 't1', assignee: 'captain' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { assignee: string; status: string; attempt: number; attempt_id?: string }
    expect(result.assignee).toBe('captain')
    expect(result.status).toBe('claimed')
    expect(result.attempt).toBe(2)
    expect(result.attempt_id).toBeDefined()
  })

  it('错误分支:已完成任务不可重派;目标成员忙碌被拒', async () => {
    await writeTeamToDisk(stateRoot, team({
      tasks: [
        task('t0', { status: 'completed', assignee: '技术员' }),
        task('t1', { status: 'in_progress', assignee: '质检员', attemptId: 'att-1' }),
        task('t2', { status: 'in_progress', assignee: '技术员', attemptId: 'att-2' }),
      ],
    }))
    await expect(tool('agent_teams_reassign_task').execute(
      { task_id: 't0', assignee: '质检员' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/completed task t0 is immutable/)
    // 忙检查排除目标任务自身(同 owner 重试合法),但目标持有其他在办任务时被拒。
    await expect(tool('agent_teams_reassign_task').execute(
      { task_id: 't1', assignee: '技术员' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/is busy with t2/)
  })
})

describe('agent_teams_update_task — 正常终结分支(R-14)', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness()

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-update-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  const claimedTask = (id: string, overrides: Partial<TeamTask> = {}): TeamTask => task(id, {
    status: 'claimed',
    assignee: '技术员',
    attempt: 1,
    attemptId: 'att-1',
    claimedAt: 10_000,
    ...overrides,
  })

  it('正常 failed:复盘生成、耗时结算、cancelled 之外的终结态', async () => {
    await writeTeamToDisk(stateRoot, team({ tasks: [claimedTask('t1')] }))
    const result = await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'failed', attempt_id: 'att-1', output: '实现遇到阻塞', retro_cause: 'environment', retro_note: '环境问题:沙箱缺依赖' },
      execOf(agent(workspace, ENGINEER_ID)),
    ) as { status: string; actual_ms?: number }
    expect(result.status).toBe('failed')
    expect(result.actual_ms).toBeTypeOf('number')

    const persisted = await readTeam(stateRoot, 'team-tools')
    const t1 = persisted?.tasks.find(t => t.id === 't1')
    expect(t1?.status).toBe('failed')
    expect(t1?.completedAt).toBeTypeOf('number')
    expect(t1?.actualMs).toBeTypeOf('number')
    expect(t1?.retro).toBeDefined()
    expect(t1?.retro?.cause).toBe('environment') // 显式 retro_cause 生效
    expect(t1?.retro?.retroNote).toBe('环境问题:沙箱缺依赖')
    // failed 属于"记经验"的终结态:经验应入库。
    const library = await readBestPractices(stateRoot)
    expect(library.some(e => e.practice === '环境问题:沙箱缺依赖')).toBe(true)
  })

  it('正常 cancelled:复盘记耗时不推经验(不入库),中间态兜底清除', async () => {
    await writeTeamToDisk(stateRoot, team({ tasks: [claimedTask('t1', { awaitingInput: true, blockedByReview: true })] }))
    const result = await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'cancelled', attempt_id: 'att-1' },
      execOf(agent(workspace, ENGINEER_ID)),
    ) as { status: string }
    expect(result.status).toBe('cancelled')

    const persisted = await readTeam(stateRoot, 'team-tools')
    const t1 = persisted?.tasks.find(t => t.id === 't1')
    expect(t1?.status).toBe('cancelled')
    expect(t1?.retro?.cause).toBe('other') // cancelled 归 other
    expect(t1?.retro?.recommendation).toBe('') // 不推经验
    expect(t1?.awaitingInput).toBe(false) // 终结兜底清除
    expect(t1?.blockedByReview).toBe(false)
    const library = await readBestPractices(stateRoot)
    expect(library).toHaveLength(0) // cancelled 不入经验库
  })

  it('signal_note:自报信号落盘(与 status 变更可同调)', async () => {
    await writeTeamToDisk(stateRoot, team({ tasks: [claimedTask('t1', { status: 'in_progress', startedAt: 10_000 })] }))
    await tool('agent_teams_update_task').execute(
      { task_id: 't1', signal_note: '深挖了 3000 行源码', attempt_id: 'att-1' },
      execOf(agent(workspace, ENGINEER_ID)),
    )
    const persisted = await readTeam(stateRoot, 'team-tools')
    const t1 = persisted?.tasks.find(t => t.id === 't1')
    expect(t1?.signals?.selfReport).toBe('深挖了 3000 行源码')
    expect(t1?.signals?.outputBytes).toBe(0)
  })

  it('正常 completed(非门禁):无政委在场也可完成,复盘+经验入库', async () => {
    await writeTeamToDisk(stateRoot, team({ tasks: [claimedTask('t1')] }))
    // claimed → in_progress → completed(状态机不允许 claimed 直接 completed)。
    await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'in_progress', attempt_id: 'att-1' },
      execOf(agent(workspace, ENGINEER_ID)),
    )
    const result = await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: 'att-1', output: '完成', retro_note: '先写测试再动手' },
      execOf(agent(workspace, ENGINEER_ID)),
    ) as { status: string }
    expect(result.status).toBe('completed')
    const persisted = await readTeam(stateRoot, 'team-tools')
    const t1 = persisted?.tasks.find(t => t.id === 't1')
    expect(t1?.retro).toBeDefined()
    const library = await readBestPractices(stateRoot)
    expect(library.some(e => e.practice === '先写测试再动手')).toBe(true)
  })

  it('R-30:纯 on_time 完成且无 retro_note → 不入经验库(通用按时建议低价值)', async () => {
    // claimedAt 取当前时刻前 1 分钟 + S 级预算 15m → actualMs≈1m < 15m → on_time。
    const freshClaimed = claimedTask('t1', {
      estimateLevel: 'S',
      claimedAt: Date.now() - 60_000,
    })
    await writeTeamToDisk(stateRoot, team({ tasks: [freshClaimed] }))
    await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'in_progress', attempt_id: 'att-1' },
      execOf(agent(workspace, ENGINEER_ID)),
    )
    const result = await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: 'att-1', output: '完成' },
      execOf(agent(workspace, ENGINEER_ID)),
    ) as { status: string }
    expect(result.status).toBe('completed')

    const persisted = await readTeam(stateRoot, 'team-tools')
    const t1 = persisted?.tasks.find(t => t.id === 't1')
    expect(t1?.retro?.cause).toBe('on_time')
    expect(t1?.retro?.recommendation).toBe('') // 无 note 的按时完成不留通用建议
    expect(await readBestPractices(stateRoot)).toHaveLength(0) // 不入库
  })

  it('R-30:on_time 但有 retro_note → 成员经验入库(retroNote 优先)', async () => {
    await writeTeamToDisk(stateRoot, team({ tasks: [claimedTask('t1', {
      estimateLevel: 'S',
      claimedAt: Date.now() - 60_000,
    })] }))
    await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'in_progress', attempt_id: 'att-1' },
      execOf(agent(workspace, ENGINEER_ID)),
    )
    await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: 'att-1', output: '完成', retro_note: '按时完成的秘诀:先拆步骤' },
      execOf(agent(workspace, ENGINEER_ID)),
    )
    const library = await readBestPractices(stateRoot)
    expect(library.some(e => e.practice === '按时完成的秘诀:先拆步骤')).toBe(true)
  })

  it('R-30:超预算完成(underestimated)无 note → 通用建议入库(非 on_time 归因)', async () => {
    // claimedAt 取 30 分钟前 + S 级预算 15m → actualMs≈30m > 15m → underestimated。
    await writeTeamToDisk(stateRoot, team({ tasks: [claimedTask('t1', {
      estimateLevel: 'S',
      claimedAt: Date.now() - 30 * 60_000,
    })] }))
    await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'in_progress', attempt_id: 'att-1' },
      execOf(agent(workspace, ENGINEER_ID)),
    )
    const result = await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: 'att-1', output: '完成' },
      execOf(agent(workspace, ENGINEER_ID)),
    ) as { status: string }
    expect(result.status).toBe('completed')
    const persisted = await readTeam(stateRoot, 'team-tools')
    const t1 = persisted?.tasks.find(t => t.id === 't1')
    expect(t1?.retro?.cause).toBe('underestimated')
    expect(t1?.retro?.overran).toBe(true)
    const library = await readBestPractices(stateRoot)
    expect(library.length).toBeGreaterThan(0)
    expect(library.some(e => e.cause === 'underestimated' && e.practice !== '')).toBe(true)
  })
})
