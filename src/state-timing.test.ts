import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  activateTaskAttempt,
  finalizeTaskTiming,
  invalidateTaskAttempt,
  readTeam,
} from './state.ts'
import type { TeamState, TeamTask } from './types.ts'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agent-team-timing-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function task(overrides: Partial<TeamTask> = {}): TeamTask {
  return {
    id: 't1',
    subject: '任务t1',
    status: 'pending',
    dependencies: [],
    attempt: 0,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

describe('activateTaskAttempt — 认领计时', () => {
  it('认领时记录 claimedAt(新 attempt 重置)', () => {
    const before = Date.now()
    const target = task()
    activateTaskAttempt(target, '技术员一号')
    expect(target.status).toBe('claimed')
    expect(target.claimedAt).toBeGreaterThanOrEqual(before)
    expect(target.claimedAt).toBeLessThanOrEqual(Date.now())
  })

  it('重派/重试通过 invalidate → activate 重置 claimedAt 并清掉旧计时', () => {
    const target = task({ status: 'in_progress', assignee: '技术员一号' })
    activateTaskAttempt(target, '技术员一号')
    target.status = 'in_progress'
    target.startedAt = 20_000
    target.helperEver = true
    invalidateTaskAttempt(target, '质检员一号')
    expect(target.claimedAt).toBeUndefined()
    expect(target.startedAt).toBeUndefined()
    expect(target.completedAt).toBeUndefined()
    expect(target.actualMs).toBeUndefined()
    expect(target.overrunMs).toBeUndefined()
    expect(target.retro).toBeUndefined()
    expect(target.helperEver).toBeUndefined()
    // 手工塞入旧时间戳,验证 activate 会重置为当前时刻而非沿用旧值。
    target.claimedAt = 12345
    activateTaskAttempt(target, '质检员一号')
    expect(target.claimedAt).not.toBe(12345)
    expect(target.claimedAt).toBeDefined()
    expect(target.startedAt).toBeUndefined()
  })

  it('activateTaskAttempt 清空上个 attempt 的 startedAt', () => {
    const target = task({ status: 'in_progress', startedAt: 50_000 })
    activateTaskAttempt(target, '技术员一号')
    expect(target.startedAt).toBeUndefined()
    expect(target.claimedAt).toBeDefined()
  })
})

describe('finalizeTaskTiming — 完成结算', () => {
  it('claimed→completed 计算 actualMs 与 overrunMs', () => {
    const target = task({ estimatedMs: 60_000, claimedAt: 10_000, status: 'in_progress' })
    finalizeTaskTiming(target, 100_000)
    expect(target.completedAt).toBe(100_000)
    expect(target.actualMs).toBe(90_000)
    expect(target.overrunMs).toBe(30_000)
  })

  it('幂等:重复结算不覆盖首次结果', () => {
    const target = task({ estimatedMs: 60_000, claimedAt: 10_000, status: 'in_progress' })
    finalizeTaskTiming(target, 100_000)
    finalizeTaskTiming(target, 500_000)
    expect(target.completedAt).toBe(100_000)
    expect(target.actualMs).toBe(90_000)
  })

  it('无 claimedAt 的旧任务不产生损坏数据', () => {
    const target = task({ status: 'in_progress' })
    finalizeTaskTiming(target, 100_000)
    expect(target.completedAt).toBe(100_000)
    expect(target.actualMs).toBeUndefined()
    expect(target.overrunMs).toBeUndefined()
  })

  it('提前完成时 overrunMs 为负值(表示节省)', () => {
    const target = task({ estimatedMs: 120_000, claimedAt: 10_000, status: 'in_progress' })
    finalizeTaskTiming(target, 40_000)
    expect(target.actualMs).toBe(30_000)
    expect(target.overrunMs).toBe(-90_000)
  })
})

describe('isTeamTask 向后兼容 — 旧/新字段均合法,损坏复盘被拒', () => {
  async function writeTeam(state: TeamState): Promise<void> {
    const dir = join(tempRoot, state.id)
    await mkdir(join(dir, 'inbox'), { recursive: true })
    await writeFile(join(dir, 'team.json'), JSON.stringify(state, null, 2))
  }

  function baseTeam(tasks: TeamTask[]): TeamState {
    return {
      name: '测试团队',
      id: 'team-timing',
      captainSessionId: 'session-captain',
      createdAt: 1000,
      members: [],
      tasks,
      taskSeq: 1,
    }
  }

  it('旧任务(无自成长字段)照常读取', async () => {
    const legacy = task()
    await writeTeam(baseTeam([legacy]))
    const team = await readTeam(tempRoot, 'team-timing')
    expect(team?.tasks[0]?.id).toBe('t1')
    expect(team?.tasks[0]?.claimedAt).toBeUndefined()
  })

  it('新字段(等级/预估/认领/开工/完成/实际/偏差/信号/复盘)可持久化读取', async () => {
    const modern = task({
      estimateLevel: 'S',
      estimatedMs: 60_000,
      claimedAt: 10_000,
      startedAt: 12_000,
      completedAt: 100_000,
      actualMs: 90_000,
      overrunMs: 30_000,
      signals: { turns: 3, outputBytes: 240, selfReport: '深挖了 1400 行 CSS' },
      retro: {
        attempt: 1,
        actualMs: 90_000,
        estimateLevel: 'S',
        estimatedMs: 60_000,
        overrunMs: 30_000,
        levelDeviation: 2,
        overran: true,
        cause: 'underestimated',
        summary: '任务超时完成:实际 1h 30m,预估 S(≤15m)。',
        retroNote: '先读测试再动手',
        recommendation: '下次按 1.3~1.5 倍预估。',
        includesGateWait: true,
        hasHelper: false,
        createdAt: 100_000,
      },
    })
    await writeTeam(baseTeam([modern]))
    const team = await readTeam(tempRoot, 'team-timing')
    expect(team?.tasks[0]?.estimateLevel).toBe('S')
    expect(team?.tasks[0]?.startedAt).toBe(12_000)
    expect(team?.tasks[0]?.signals?.turns).toBe(3)
    expect(team?.tasks[0]?.signals?.selfReport).toBe('深挖了 1400 行 CSS')
    expect(team?.tasks[0]?.retro?.levelDeviation).toBe(2)
    expect(team?.tasks[0]?.retro?.captainVerdict).toBeUndefined()
  })

  it('损坏的复盘记录(缺 actualMs)导致读取失败而非静默', async () => {
    const broken = task({
      retro: { overran: true, cause: 'other', summary: 'x', recommendation: 'y', createdAt: 1 } as unknown as TeamTask['retro'],
    })
    await writeTeam(baseTeam([broken]))
    await expect(readTeam(tempRoot, 'team-timing')).rejects.toThrow(/invalid AgentTeams state/)
  })
})
