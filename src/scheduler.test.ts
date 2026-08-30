import type { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isHelppableTask, installTeamScheduler, nextHelpTask, type SchedulerConfig } from './scheduler.ts'
import { beginTaskAttempt, invalidateTaskAttempt } from './state.ts'
import { memberOpenTask } from './tools.ts'
import type { TeamMember, TeamState, TeamTask } from './types.ts'

const STALL = 60_000

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

function task(id: string, overrides: Partial<TeamTask> = {}): TeamTask {
  return {
    id,
    subject: `任务${id}`,
    status: 'in_progress',
    assignee: 'B',
    dependencies: [],
    attempt: 1,
    attemptId: `att-${id}`,
    createdAt: 1000,
    updatedAt: Date.now() - STALL - 1000,
    ...overrides,
  }
}

function team(overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: '调度测试团队',
    id: 'team-sched',
    description: 'demo',
    captainSessionId: 'session-captain',
    createdAt: 1000,
    members: [member('A'), member('B')],
    tasks: [],
    taskSeq: 0,
    ...overrides,
  }
}

const noParked = new Map<string, string>()

function context(options: {
  live?: Record<string, { status: 'running' | 'idle' }>
  followupThrows?: boolean
} = {}): Context {
  return {
    agents: { get: (id: string) => options.live?.[id] },
    subagents: {
      followup: async () => {
        if (options.followupThrows === true) throw new Error('delivery failed')
      },
    },
    logger: { warn: () => undefined, debug: () => undefined },
    on: (): void => undefined,
  } as unknown as Context
}

describe('isHelppableTask — 停滞任务判定', () => {
  const state = team({ tasks: [task('t1')] })
  const now = Date.now()

  it('超阈值且条件齐备时 helppable', () => {
    expect(isHelppableTask(state.tasks[0]!, state, 'A', now, noParked, () => undefined, STALL)).toBe(true)
  })

  it('非 claimed/in_progress 不可帮助', () => {
    expect(isHelppableTask(task('t1', { status: 'pending' }), state, 'A', now, noParked, () => undefined, STALL)).toBe(false)
    expect(isHelppableTask(task('t1', { status: 'completed' }), state, 'A', now, noParked, () => undefined, STALL)).toBe(false)
  })

  it('自己的任务 / 队长任务不可帮助', () => {
    expect(isHelppableTask(task('t1', { assignee: 'A' }), state, 'A', now, noParked, () => undefined, STALL)).toBe(false)
    expect(isHelppableTask(task('t1', { assignee: 'captain' }), state, 'A', now, noParked, () => undefined, STALL)).toBe(false)
  })

  it('已有 helper 的任务不重复帮助', () => {
    expect(isHelppableTask(task('t1', { helper: 'C', helperSince: now }), state, 'A', now, noParked, () => undefined, STALL)).toBe(false)
  })

  it('Owner 正在运行 / 已移除 / 无子代理 时不可帮助', () => {
    expect(isHelppableTask(state.tasks[0]!, state, 'A', now, noParked, () => 'running', STALL)).toBe(false)
    const removed = team({ tasks: [task('t1')], members: [member('A'), member('B', { status: 'removed' })] })
    expect(isHelppableTask(removed.tasks[0]!, removed, 'A', now, noParked, () => undefined, STALL)).toBe(false)
    const noChild = team({ tasks: [task('t1', { assignee: 'C' })] })
    expect(isHelppableTask(noChild.tasks[0]!, noChild, 'A', now, noParked, () => undefined, STALL)).toBe(false)
  })

  it('Owner 故意挂起（parked attempt）不可帮助', () => {
    const parked = new Map<string, string>([['session-B', 'att-t1']])
    expect(isHelppableTask(state.tasks[0]!, state, 'A', now, parked, () => undefined, STALL)).toBe(false)
  })

  it('依赖未满足不可帮助', () => {
    const blocked = team({ tasks: [task('t1', { dependencies: ['t0'] }), task('t0', { status: 'pending' })] })
    expect(isHelppableTask(blocked.tasks[0]!, blocked, 'A', now, noParked, () => undefined, STALL)).toBe(false)
  })

  it('未超阈值（刚更新）不可帮助', () => {
    const fresh = task('t1', { updatedAt: Date.now() - 1000 })
    expect(isHelppableTask(fresh, state, 'A', Date.now(), noParked, () => undefined, STALL)).toBe(false)
  })
})

describe('nextHelpTask — 最旧停滞优先', () => {
  it('按 updatedAt 升序选择', () => {
    const older = task('t-old', { updatedAt: 1000 })
    const newer = task('t-new', { updatedAt: 5000 })
    const state = team({ tasks: [newer, older] })
    expect(nextHelpTask(state.tasks, state, 'A', Date.now(), noParked, () => undefined, STALL)?.id).toBe('t-old')
  })

  it('无停滞任务时返回 undefined', () => {
    const state = team({ tasks: [task('t1', { updatedAt: Date.now() - 1000 })] })
    expect(nextHelpTask(state.tasks, state, 'A', Date.now(), noParked, () => undefined, STALL)).toBeUndefined()
  })

  it('政委不会被派为帮助者（监督独立性，审查 #3）', () => {
    const state = team({
      members: [member('政委', { role: 'commissar' }), member('A'), member('B')],
      tasks: [task('t1')],
    })
    expect(nextHelpTask(state.tasks, state, '政委', Date.now(), noParked, () => undefined, STALL)).toBeUndefined()
    expect(nextHelpTask(state.tasks, state, 'A', Date.now(), noParked, () => undefined, STALL)?.id).toBe('t1')
  })
})

describe('任务轮换路径清 helper（审查 #1 回归）', () => {
  it('beginTaskAttempt 清 helper/helperSince', () => {
    const t = task('t1', { helper: 'A', helperSince: 1000 })
    beginTaskAttempt(t, 'B')
    expect(t.helper).toBeUndefined()
    expect(t.helperSince).toBeUndefined()
  })

  it('invalidateTaskAttempt 清 helper/helperSince', () => {
    const t = task('t1', { helper: 'A', helperSince: 1000 })
    invalidateTaskAttempt(t)
    expect(t.helper).toBeUndefined()
    expect(t.helperSince).toBeUndefined()
  })
})

describe('kickMember 集成 — 自组织帮助派发', () => {
  let workspace: string
  let stateRoot: string
  const config: SchedulerConfig = { stateDir: '.agent-team-web', stallThresholdMs: STALL }

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-sched-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(join(stateRoot, 'team-sched', 'inbox'), { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  async function writeState(state: TeamState): Promise<void> {
    await writeFile(join(stateRoot, 'team-sched', 'team.json'), JSON.stringify(state, null, 2))
  }

  async function readState(): Promise<TeamState> {
    return JSON.parse(await readFile(join(stateRoot, 'team-sched', 'team.json'), 'utf8')) as TeamState
  }

  it('A 空闲时自动帮助停滞的队友任务：helper 落盘、A working、Owner 收到通知', async () => {
    const state = team({ tasks: [task('t1')] })
    await writeState(state)
    const scheduler = installTeamScheduler(context({ live: { 'session-captain': { status: 'idle' } } }), config)

    await scheduler.kickMember(workspace, 'team-sched', 'A')

    const fresh = await readState()
    const helped = fresh.tasks.find(t => t.id === 't1')
    expect(helped?.helper).toBe('A')
    expect(helped?.helperSince).toBeTypeOf('number')
    expect(helped?.assignee).toBe('B') // 所有权不变
    expect(helped?.attemptId).toBe('att-t1') // attempt 不变
    expect(fresh.members.find(m => m.name === 'A')?.status).toBe('working')

    const ownerMail = await readFile(join(stateRoot, 'team-sched', 'inbox', 'B.jsonl'), 'utf8')
    expect(ownerMail).toContain('正在协助')
    expect(ownerMail).toContain('t1')
  })

  it('自己有 ready 任务时优先派自己，不帮助队友（优先级 1-3 > 4）', async () => {
    const state = team({
      members: [member('A'), member('B')],
      tasks: [
        task('t-mine', { assignee: 'A', status: 'pending', updatedAt: 1 }),
        task('t-stalled', { assignee: 'B', status: 'in_progress' }),
      ],
    })
    await writeState(state)
    const scheduler = installTeamScheduler(context({ live: { 'session-captain': { status: 'idle' } } }), config)

    await scheduler.kickMember(workspace, 'team-sched', 'A')

    const fresh = await readState()
    const mine = fresh.tasks.find(t => t.id === 't-mine')
    const stalled = fresh.tasks.find(t => t.id === 't-stalled')
    expect(mine?.status).toBe('claimed')
    expect(mine?.assignee).toBe('A')
    expect(stalled?.helper).toBeUndefined()
  })

  it('帮助派发失败时回滚 helper 并恢复 A 为 idle', async () => {
    const state = team({ tasks: [task('t1')] })
    await writeState(state)
    const scheduler = installTeamScheduler(context({
      live: { 'session-captain': { status: 'idle' } },
      followupThrows: true,
    }), config)

    await scheduler.kickMember(workspace, 'team-sched', 'A')

    const fresh = await readState()
    expect(fresh.tasks.find(t => t.id === 't1')?.helper).toBeUndefined()
    expect(fresh.tasks.find(t => t.id === 't1')?.helperSince).toBeUndefined()
    expect(fresh.members.find(m => m.name === 'A')?.status).toBe('idle')
  })

  it('帮助派发失败时复位 helperEver(R-06:投递失败=从未介入,复盘不虚标 hasHelper)', async () => {
    const state = team({ tasks: [task('t1')] })
    await writeState(state)
    const scheduler = installTeamScheduler(context({
      live: { 'session-captain': { status: 'idle' } },
      followupThrows: true,
    }), config)

    await scheduler.kickMember(workspace, 'team-sched', 'A')

    const fresh = await readState()
    expect(fresh.tasks.find(t => t.id === 't1')?.helperEver).toBeUndefined()
  })

  it('普通派发失败时完整复位 attempt 级字段(R-05:claimedAt/attemptId 清除,任务回 pending)', async () => {
    const state = team({
      members: [member('A')],
      tasks: [task('t-pending', {
        subject: '待派任务',
        status: 'pending',
        assignee: undefined,
        attempt: 0,
        attemptId: undefined,
        claimedAt: undefined,
        startedAt: undefined,
        updatedAt: 1,
      })],
    })
    await writeState(state)
    const scheduler = installTeamScheduler(context({
      live: { 'session-captain': { status: 'idle' } },
      followupThrows: true,
    }), config)

    // 派发前:任务干净 pending,无 claimedAt。
    let fresh = await readState()
    expect(fresh.tasks[0]?.claimedAt).toBeUndefined()

    await scheduler.kickMember(workspace, 'team-sched', 'A')

    // R-05 修复前:回滚只还原 status/assignee/attemptId,claimedAt 残留,
    // 后续 actualMs = completedAt - claimedAt 会含入派发死时间。
    fresh = await readState()
    const rolled = fresh.tasks[0]
    expect(rolled?.status).toBe('pending')
    expect(rolled?.claimedAt).toBeUndefined()
    expect(rolled?.startedAt).toBeUndefined()
    expect(rolled?.attemptId).toBeUndefined()
    expect(rolled?.assignee).toBeUndefined()
    expect(fresh.members.find(m => m.name === 'A')?.status).toBe('idle')
  })

  it('Owner 恢复时清除 helper（Owner 接管回）', async () => {
    const state = team({
      members: [member('A'), member('B')],
      tasks: [task('t1', { helper: 'A', helperSince: 1000 })],
    })
    await writeState(state)
    const scheduler = installTeamScheduler(context({
      live: { 'session-captain': { status: 'idle' }, 'session-B': { status: 'idle' } },
    }), config)

    await scheduler.kickMember(workspace, 'team-sched', 'B')

    const fresh = await readState()
    const owned = fresh.tasks.find(t => t.id === 't1')
    expect(owned?.helper).toBeUndefined()
    expect(owned?.helperSince).toBeUndefined()
    expect(owned?.assignee).toBe('B')
  })
})

describe('memberOpenTask — one-worker 规则扩展', () => {
  it('owner 与 helper 都算占用，帮助者不能接第二活', () => {
    const state = team({
      tasks: [
        task('t-owned', { assignee: 'A' }),
        task('t-helping', { assignee: 'B', helper: 'A' }),
        task('t-done', { status: 'completed', assignee: 'A' }),
      ],
    })
    expect(memberOpenTask(state, 'A', 't-owned')?.id).toBe('t-helping')
    expect(memberOpenTask(state, 'A')).toBeDefined()
    expect(memberOpenTask(state, 'B')).toBeDefined()
    expect(memberOpenTask(state, 'A', 't-helping')?.id).toBe('t-owned')
  })
})

describe('kickTeam 集成 — Owner 优先与撤出通知（审查 #2 回归）', () => {
  let workspace: string
  let stateRoot: string
  const config: SchedulerConfig = { stateDir: '.agent-team-web', stallThresholdMs: STALL }

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-sched-order-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(join(stateRoot, 'team-sched', 'inbox'), { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  async function writeState(state: TeamState): Promise<void> {
    await writeFile(join(stateRoot, 'team-sched', 'team.json'), JSON.stringify(state, null, 2))
  }

  it('冷启动 kickTeam：持有 open attempt 的 Owner 先于帮助者恢复（不产生双干活）', async () => {
    // 冷启动：parkedAttempts 内存为空、B 的 agent 未驻留（liveStatus undefined）
    // → B 的 open 任务立即 helppable；A 空闲无 ready → 帮助路径候选。
    const state = team({
      members: [member('A'), member('B')],
      tasks: [task('t1')],
    })
    await writeState(state)
    const calls: string[] = []
    const scheduler = installTeamScheduler({
      agents: { get: (id: string) => id === 'session-captain' ? { status: 'idle' } : undefined },
      subagents: {
        followup: async (_captain: unknown, childId: string) => { calls.push(childId) },
      },
      logger: { warn: () => undefined, debug: () => undefined },
      on: (): void => undefined,
    } as unknown as Context, config)

    await scheduler.kickTeam(workspace, 'team-sched')

    // 第一次唤醒必须是 Owner B（恢复），A 不应被派为帮助者。
    expect(calls[0]).toBe('session-B')
    expect(calls).not.toContain('session-A')
    const fresh = JSON.parse(await readFile(join(stateRoot, 'team-sched', 'team.json'), 'utf8')) as TeamState
    expect(fresh.tasks.find(t => t.id === 't1')?.helper).toBeUndefined()
  })

  it('Owner 恢复时向帮助者发送撤出通知（mailbox 持久）', async () => {
    const state = team({
      members: [member('A'), member('B')],
      tasks: [task('t1', { helper: 'A', helperSince: 1000 })],
    })
    await writeState(state)
    const scheduler = installTeamScheduler(context({
      live: { 'session-captain': { status: 'idle' }, 'session-B': { status: 'idle' } },
    }), config)

    await scheduler.kickMember(workspace, 'team-sched', 'B')

    const helperMail = await readFile(join(stateRoot, 'team-sched', 'inbox', 'A.jsonl'), 'utf8')
    expect(helperMail).toContain('已恢复任务')
    expect(helperMail).toContain('停止协助')
    expect(helperMail).toContain('t1')
  })
})

describe('kickMember 延迟重试 — t3 成员暂不可用不卡 pending', () => {
  let workspace: string
  let stateRoot: string
  const config: SchedulerConfig = { stateDir: '.agent-team-web', stallThresholdMs: STALL }

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-retry-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(join(stateRoot, 'team-sched', 'inbox'), { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('成员暂不可用(running)→ 安排重试;延迟后成员 idle → 重试成功派单', async () => {
    const state = team({ members: [member('A')], tasks: [task('t1', { assignee: 'A' })] })
    await writeFile(join(stateRoot, 'team-sched', 'team.json'), JSON.stringify(state, null, 2))

    // 可变 live 状态:首次 running(暂不可用),延迟后 idle(可派单)。
    const liveState: Record<string, { status: 'idle' | 'running' }> = {
      'session-captain': { status: 'idle' },
      'session-A': { status: 'running' },
    }
    const scheduler = installTeamScheduler(context({ live: liveState }), config)

    // 首次 kick:成员 A running → 暂不可用 → 安排重试(不派单)。
    await scheduler.kickMember(workspace, 'team-sched', 'A')
    let fresh = JSON.parse(await readFile(join(stateRoot, 'team-sched', 'team.json'), 'utf8'))
    expect(fresh.members.find((m: { name: string }) => m.name === 'A')?.status).not.toBe('working')

    // 成员变 idle 后等待真实 600ms 重试窗口 → 重试执行 → 成功派单。
    liveState['session-A'] = { status: 'idle' }
    await new Promise(resolve => setTimeout(resolve, 700))
    fresh = JSON.parse(await readFile(join(stateRoot, 'team-sched', 'team.json'), 'utf8'))
    expect(fresh.members.find((m: { name: string }) => m.name === 'A')?.status).toBe('working')
    expect(fresh.tasks.find((t: { id: string }) => t.id === 't1')?.status).toBe('claimed')
  })

  it('重试有上限:成员持续不可用则有限次重试后放弃,不无限打扰', async () => {
    const state = team({ members: [member('A')], tasks: [task('t1', { assignee: 'A' })] })
    await writeFile(join(stateRoot, 'team-sched', 'team.json'), JSON.stringify(state, null, 2))

    const liveState: Record<string, { status: 'idle' | 'running' }> = {
      'session-captain': { status: 'idle' },
      'session-A': { status: 'running' }, // 始终不可用
    }
    const scheduler = installTeamScheduler(context({ live: liveState }), config)

    await scheduler.kickMember(workspace, 'team-sched', 'A')
    // 等待多次重试窗口(超上限),成员始终 running → 不应被派单,且重试最终停止。
    for (let i = 0; i < 5; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 700))
    }
    const fresh = JSON.parse(await readFile(join(stateRoot, 'team-sched', 'team.json'), 'utf8'))
    expect(fresh.members.find((m: { name: string }) => m.name === 'A')?.status).not.toBe('working')
  })
})
