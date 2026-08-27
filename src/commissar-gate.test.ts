import type { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gateBlocksCompletion, isActiveCommissar, isCommissarRole, notifyCommissarPendingReview } from './commissar-gate.ts'
import { isTeamCloseable } from './close-route.ts'
import { assembleTeamSnapshot } from './snapshot.ts'
import type { TeamMember, TeamState, TeamTask } from './types.ts'

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
    assignee: '技术员',
    dependencies: [],
    attempt: 1,
    attemptId: `att-${id}`,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function team(overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: '门禁测试团队',
    id: 'team-gate',
    description: 'demo',
    captainSessionId: 'session-captain',
    createdAt: 1000,
    members: [
      member('政委', { role: 'commissar' }),
      member('技术员'),
    ],
    tasks: [],
    taskSeq: 0,
    ...overrides,
  }
}

function context(liveCaptains: ReadonlySet<string> = new Set()): Context {
  return {
    agents: { get: (id: string) => liveCaptains.has(id) ? { session: {}, status: 'running' } : undefined },
    logger: { warn: () => undefined, debug: () => undefined },
  } as unknown as Context
}

describe('gateBlocksCompletion — 完成门禁判定', () => {
  it('无 reviewRequired 的任务不受门禁影响', () => {
    expect(gateBlocksCompletion(task('t1', { reviewRequired: undefined }))).toBe(false)
    expect(gateBlocksCompletion(task('t1', { reviewRequired: false }))).toBe(false)
  })

  it('reviewRequired 且无 pass 记录时阻塞完成', () => {
    expect(gateBlocksCompletion(task('t1', { reviewRequired: true }))).toBe(true)
    expect(gateBlocksCompletion(task('t1', {
      reviewRequired: true,
      review: { reviewerName: '政委', verdict: 'reject', comment: '重做', reviewedAt: 2000 },
    }))).toBe(true)
  })

  it('reviewRequired 且有 pass 记录时放行', () => {
    expect(gateBlocksCompletion(task('t1', {
      reviewRequired: true,
      review: { reviewerName: '政委', verdict: 'pass', reviewedAt: 2000 },
    }))).toBe(false)
  })
})

describe('isCommissarRole / isActiveCommissar — 政委身份识别', () => {
  it('识别各种政委拼写', () => {
    expect(isCommissarRole('commissar')).toBe(true)
    expect(isCommissarRole('Commissar')).toBe(true)
    expect(isCommissarRole('政委')).toBe(true)
    expect(isCommissarRole('政治委员')).toBe(true)
    expect(isCommissarRole('engineer')).toBe(false)
    expect(isCommissarRole(undefined)).toBe(false)
  })

  it('active 政委才可复核', () => {
    expect(isActiveCommissar(member('政委', { role: 'commissar' }))).toBe(true)
    expect(isActiveCommissar(member('政委', { role: 'commissar', status: 'removed' }))).toBe(false)
    expect(isActiveCommissar(member('技术员'))).toBe(false)
    expect(isActiveCommissar(undefined)).toBe(false)
  })
})

describe('notifyCommissarPendingReview — 门禁自动通知', () => {
  let workspace: string
  let stateRoot: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-gate-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(join(stateRoot, 'team-gate', 'inbox'), { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('通知写入政委 inbox（队长离线时仍持久化）', async () => {
    const state = team({ tasks: [task('t1', { reviewRequired: true, riskLevel: 'high' })] })
    await writeFile(join(stateRoot, 'team-gate', 'team.json'), JSON.stringify(state, null, 2))

    const notified = await notifyCommissarPendingReview(context(), stateRoot, state, state.tasks[0]!, new AbortController().signal)
    expect(notified).toBe(true)

    const raw = await readFile(join(stateRoot, 'team-gate', 'inbox', '政委.jsonl'), 'utf8')
    expect(raw).toContain('门禁通知')
    expect(raw).toContain('t1')
    expect(raw).toContain('agent_teams_review_task')
  })

  it('无在任政委时返回 false 且不写任何 mailbox', async () => {
    const state = team({
      members: [member('技术员')],
      tasks: [task('t1', { reviewRequired: true })],
    })
    const notified = await notifyCommissarPendingReview(context(), stateRoot, state, state.tasks[0]!, new AbortController().signal)
    expect(notified).toBe(false)
    await expect(readFile(join(stateRoot, 'team-gate', 'inbox', '政委.jsonl'), 'utf8')).rejects.toThrow()
  })
})

describe('快照与关闭兼容 — review 字段与 isTeamCloseable', () => {
  let workspace: string
  let stateRoot: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-gate-snap-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(join(stateRoot, 'team-gate', 'inbox'), { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('快照标记待复核任务并在 pass 后携带复核记录', async () => {
    const state = team({
      tasks: [
        task('t1', { reviewRequired: true, riskLevel: 'critical' }),
        task('t2', {
          reviewRequired: true,
          riskLevel: 'high',
          status: 'in_progress',
          review: { reviewerName: '政委', verdict: 'pass', comment: 'OK', reviewedAt: 2000 },
        }),
      ],
    })
    const snapshot = await assembleTeamSnapshot(context(), stateRoot, 'w', state)
    const t1 = snapshot.tasks.find(t => t.id === 't1')
    const t2 = snapshot.tasks.find(t => t.id === 't2')
    expect(t1?.reviewRequired).toBe(true)
    expect(t1?.review).toBeUndefined()
    expect(t2?.reviewRequired).toBeUndefined()
    expect(t2?.review).toEqual({ reviewerName: '政委', verdict: 'pass', comment: 'OK', reviewedAt: 2000 })
  })

  it('待复核任务（非 completed）保持团队不可关闭；全 completed 后可关闭', () => {
    const pendingGate = team({ tasks: [task('t1', { reviewRequired: true })] })
    expect(isTeamCloseable(pendingGate)).toBe(false)

    const done = team({
      tasks: [task('t1', {
        status: 'completed',
        reviewRequired: true,
        review: { reviewerName: '政委', verdict: 'pass', reviewedAt: 2000 },
      })],
    })
    expect(isTeamCloseable(done)).toBe(true)
  })
})
