/**
 * 改进 4 服务端测试:任务中间态(blockedByReview / awaitingInput)纯函数
 * 与快照透出。覆盖 descriptionAwaitingInput 检测、taskBlockedByReview /
 * taskAwaitingInput 派生规则、终结状态兜底,以及 assembleTeamSnapshot 透出。
 */
import type { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleTeamSnapshot } from './snapshot.ts'
import {
  descriptionAwaitingInput,
  taskAwaitingInput,
  taskBlockedByReview,
} from './state.ts'
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
    description: '描述',
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
    name: '中间态测试团队',
    id: 'team-intermediate',
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

function context(): Context {
  return {
    agents: { get: () => undefined },
    logger: { warn: () => undefined, debug: () => undefined },
  } as unknown as Context
}

describe('descriptionAwaitingInput — 任务描述待确认问题检测', () => {
  it('空/缺省描述恒为 false', () => {
    expect(descriptionAwaitingInput(undefined)).toBe(false)
    expect(descriptionAwaitingInput('')).toBe(false)
    expect(descriptionAwaitingInput('   ')).toBe(false)
  })

  it('命中显式提示词(中文)判定为待输入', () => {
    expect(descriptionAwaitingInput('实现导出功能，待确认输出格式')).toBe(true)
    expect(descriptionAwaitingInput('待输入：目标平台列表')).toBe(true)
    expect(descriptionAwaitingInput('请确认优先级后开工')).toBe(true)
    expect(descriptionAwaitingInput('需要确认预算范围')).toBe(true)
  })

  it('命中显式提示词(英文,不区分大小写)', () => {
    expect(descriptionAwaitingInput('Implement export, awaiting input on format')).toBe(true)
    expect(descriptionAwaitingInput('Awaiting confirmation on scope')).toBe(true)
    expect(descriptionAwaitingInput('Please confirm the target platform')).toBe(true)
  })

  it('讨论框架概念(awaitingInput 术语)不误判为等待输入', () => {
    // 任务描述在阐述中间态概念本身,而非等待输入——不得命中无空格变体。
    expect(descriptionAwaitingInput('检查 awaitingInput 中间态流转是否完备')).toBe(false)
    expect(descriptionAwaitingInput('description awaitingInput on scope')).toBe(false)
    expect(descriptionAwaitingInput('对接 blockedByReview/awaitingInput 快照字段')).toBe(false)
  })

  it('独立成行的问号视为待确认问题', () => {
    expect(descriptionAwaitingInput('拆解接口清单\n?\n按模块推进')).toBe(true)
    expect(descriptionAwaitingInput('方案 A 或 B？\n？')).toBe(true)
  })

  it('普通疑问/说明不误判为待输入', () => {
    expect(descriptionAwaitingInput('这个功能要怎么做？详细拆解后开工')).toBe(false)
    expect(descriptionAwaitingInput('为什么这样做：见历史复盘')).toBe(false)
    expect(descriptionAwaitingInput('无前置，可立即开工')).toBe(false)
  })
})

describe('taskBlockedByReview — 等待政委复核中间态', () => {
  it('仅显式置位且非终结时判定为真', () => {
    expect(taskBlockedByReview(task('t1', { blockedByReview: true }))).toBe(true)
    expect(taskBlockedByReview(task('t1', { blockedByReview: false }))).toBe(false)
    expect(taskBlockedByReview(task('t1', {}))).toBe(false)
  })

  it('终结状态兜底清除(脏数据安全)', () => {
    expect(taskBlockedByReview(task('t1', {
      blockedByReview: true,
      status: 'completed',
      review: { reviewerName: '政委', verdict: 'pass', reviewedAt: 2000 },
    }))).toBe(false)
    expect(taskBlockedByReview(task('t1', { blockedByReview: true, status: 'failed' }))).toBe(false)
    expect(taskBlockedByReview(task('t1', { blockedByReview: true, status: 'cancelled' }))).toBe(false)
  })

  it('与门禁派生 reviewRequired 正交:reviewRequired 不隐含 blockedByReview', () => {
    expect(taskBlockedByReview(task('t1', { reviewRequired: true }))).toBe(false)
  })
})

describe('taskAwaitingInput — 等待输入中间态', () => {
  it('显式置位为真', () => {
    expect(taskAwaitingInput(task('t1', { awaitingInput: true }))).toBe(true)
    expect(taskAwaitingInput(task('t1', { awaitingInput: false }))).toBe(false)
  })

  it('旧任务免迁移:描述含待确认问题即派生为真', () => {
    expect(taskAwaitingInput(task('t1', { description: '待确认：目标平台' }))).toBe(true)
    expect(taskAwaitingInput(task('t1', { description: '正常描述' }))).toBe(false)
  })

  it('显式置位优先级:描述无提示词但已置位仍为真', () => {
    expect(taskAwaitingInput(task('t1', {
      awaitingInput: true,
      description: '正常描述',
    }))).toBe(true)
  })
})

describe('快照透出 — blockedByReview / awaitingInput', () => {
  let workspace: string
  let stateRoot: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-intermediate-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(join(stateRoot, 'team-intermediate', 'inbox'), { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('中间态任务在快照中透出标记,其余任务不携带', async () => {
    const state = team({
      tasks: [
        task('t1', { blockedByReview: true, reviewRequired: true, riskLevel: 'high' }),
        task('t2', { awaitingInput: true }),
        task('t3', {}),
      ],
    })
    await writeFile(join(stateRoot, 'team-intermediate', 'team.json'), JSON.stringify(state, null, 2))
    const snapshot = await assembleTeamSnapshot(context(), stateRoot, 'w', state)
    const t1 = snapshot.tasks.find(t => t.id === 't1')
    const t2 = snapshot.tasks.find(t => t.id === 't2')
    const t3 = snapshot.tasks.find(t => t.id === 't3')
    expect(t1?.blockedByReview).toBe(true)
    expect(t2?.awaitingInput).toBe(true)
    expect(t3?.blockedByReview).toBeUndefined()
    expect(t3?.awaitingInput).toBeUndefined()
  })

  it('终结任务即使残留脏标记也不透出 blockedByReview', async () => {
    const state = team({
      tasks: [task('t1', {
        blockedByReview: true,
        status: 'completed',
        review: { reviewerName: '政委', verdict: 'pass', reviewedAt: 2000 },
      })],
    })
    await writeFile(join(stateRoot, 'team-intermediate', 'team.json'), JSON.stringify(state, null, 2))
    const snapshot = await assembleTeamSnapshot(context(), stateRoot, 'w', state)
    expect(snapshot.tasks[0]?.blockedByReview).toBeUndefined()
  })
})
