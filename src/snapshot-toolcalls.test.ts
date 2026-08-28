/**
 * R-32/F-14: toolCalls 派生的扫描窗口与提前终止回归测试。
 *
 * deriveTaskToolCalls 旧实现读整个邮箱全文并对每条消息做全任务正则匹配
 * (O(邮箱×任务)),长邮箱/大团队下开销随面板轮询放大。修复后:
 * - 每个邮箱只扫描最近 MAX_TOOLCALL_SCAN_MESSAGES(100)条消息;
 * - 所有任务都已被提及后提前结束(不再扫其余邮箱/其余消息)。
 * 本文件通过 assembleTeamSnapshot 的集成入口断言派生行为。
 * @module dsh-agent-team-web/snapshot-toolcalls.test
 */

import type { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleTeamSnapshot } from './snapshot.ts'
import { appendMailbox } from './state.ts'
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
    status: 'pending',
    dependencies: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function team(overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: '扫描测试团队',
    id: 'team-scan',
    description: 'demo',
    captainSessionId: 'session-captain',
    createdAt: 1000,
    members: [member('技术员')],
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

let workspace: string
let stateRoot: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'agent-team-toolcalls-'))
  stateRoot = join(workspace, '.agent-team-web')
  await mkdir(join(stateRoot, 'team-scan', 'inbox'), { recursive: true })
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

describe('R-32 toolCalls 派生 — 窗口上限 + 提前终止', () => {
  // 派生信号只在任务已有 signals 时并入快照(与既有语义一致),故夹具带
  // 基础 signals 以观察 toolCalls 派生值。
  const baseSignals = { turns: 2, outputBytes: 42 }

  it('窗口外(超 100 条)的旧消息不计入 toolCalls', async () => {
    const state = team({
      members: [member('技术员')],
      tasks: [
        task('t1', { status: 'in_progress', assignee: '技术员', signals: baseSignals }),
        // t2 永不提及:不会触发提前终止,扫描走满整个窗口 → 隔离窗口上限。
        task('t2', { status: 'pending', signals: baseSignals }),
      ],
    })
    await writeFile(join(stateRoot, 'team-scan', 'team.json'), JSON.stringify(state, null, 2))
    // 121 条消息全部提及 t1:窗口=最近 100 条 → t1 计数=100(非 121)。
    for (let i = 0; i < 121; i += 1) {
      await appendMailbox(stateRoot, 'team-scan', '技术员', {
        id: `m-${i}`, from: '技术员', to: 'captain', content: `消息 ${i} 提及 t1`, ts: 1000 + i,
      })
    }

    const snapshot = await assembleTeamSnapshot(context(), stateRoot, 'w', state)
    const t1 = snapshot.tasks.find(t => t.id === 't1')
    // 窗口=最近 100 条(全含 t1)→ 计数 = 100,而非 121。
    expect(t1?.signals?.toolCalls).toBe(100)
    expect(snapshot.tasks.find(t => t.id === 't2')?.signals?.toolCalls).toBeUndefined()
  })

  it('所有任务都已被提及后提前结束(不扫全部邮箱)', async () => {
    const state = team({
      members: [member('技术员'), member('质检员')],
      tasks: [task('t1', { status: 'in_progress', assignee: '技术员', signals: baseSignals })],
    })
    await writeFile(join(stateRoot, 'team-scan', 'team.json'), JSON.stringify(state, null, 2))
    // 队长邮箱已提及 t1 → 扫描应在读成员邮箱前结束(单任务场景)。
    await appendMailbox(stateRoot, 'team-scan', 'captain', {
      id: 'c1', from: '技术员', to: 'captain', content: '队长邮箱提及 t1', ts: 1000,
    })
    // 成员邮箱也有提及(若提前终止未生效会额外 +1;生效则保持 1)。
    await appendMailbox(stateRoot, 'team-scan', '技术员', {
      id: 'm1', from: '技术员', to: 'captain', content: '成员邮箱也提及 t1', ts: 1000,
    })

    const snapshot = await assembleTeamSnapshot(context(), stateRoot, 'w', state)
    const t1 = snapshot.tasks.find(t => t.id === 't1')
    expect(t1?.signals?.toolCalls).toBe(1)
  })

  it('无提及时不产生 toolCalls 字段', async () => {
    const state = team({
      members: [member('技术员')],
      tasks: [task('t1', { status: 'in_progress', assignee: '技术员', signals: baseSignals })],
    })
    await writeFile(join(stateRoot, 'team-scan', 'team.json'), JSON.stringify(state, null, 2))
    await appendMailbox(stateRoot, 'team-scan', 'captain', {
      id: 'c1', from: '技术员', to: 'captain', content: '完全无关的内容', ts: 1000,
    })
    const snapshot = await assembleTeamSnapshot(context(), stateRoot, 'w', state)
    const t1 = snapshot.tasks.find(t => t.id === 't1')
    expect(t1?.signals?.toolCalls).toBeUndefined()
    expect(t1?.signals?.turns).toBe(2)
  })
})
