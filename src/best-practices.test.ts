import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BEST_PRACTICES_FILE,
  distillBestPractice,
  distillPracticeText,
  readBestPractices,
  updateBestPracticeVerdict,
  upsertBestPractice,
  writeBestPractices,
  type BestPracticeEntry,
} from '../src/best-practices.ts'
import type { TaskRetro } from '../src/types.ts'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agent-team-bp-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function retro(overrides: Partial<TaskRetro> = {}): TaskRetro {
  return {
    attempt: 1,
    actualMs: 40 * 60_000,
    estimateLevel: 'S',
    overran: true,
    cause: 'underestimated',
    summary: '任务超时完成。',
    recommendation: '同类任务下次按 1.3~1.5 倍给出预估。',
    createdAt: 1000,
    ...overrides,
  }
}

function entry(id: string, overrides: Partial<BestPracticeEntry> = {}): BestPracticeEntry {
  return {
    id,
    sourceTeamId: 'team-a',
    sourceTaskId: 't1',
    sourceTaskSubject: '任务t1',
    role: 'engineer',
    cause: 'underestimated',
    practice: '先读测试再动手',
    verdict: 'pending',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

describe('distillPracticeText / distillBestPractice — 经验提炼', () => {
  it('retroNote 优先作为经验文本', () => {
    const practice = distillBestPractice(retro({ retroNote: '先读测试再动手' }), {
      sourceTeamId: 'team-a', sourceTaskId: 't1', sourceTaskSubject: '任务t1', role: 'engineer',
    })
    expect(practice?.practice).toBe('先读测试再动手')
    expect(practice?.sourceTeamId).toBe('team-a')
    expect(practice?.sourceTaskId).toBe('t1')
    expect(practice?.level).toBe('S')
    expect(practice?.verdict).toBe('pending')
  })

  it('无 retroNote 时用 recommendation 兜底', () => {
    expect(distillPracticeText(retro())).toBe('同类任务下次按 1.3~1.5 倍给出预估。')
  })

  it('cancelled 复盘(recommendation 空、无 retroNote)不入库', () => {
    const practice = distillBestPractice(retro({ cause: 'other', recommendation: '' }), {
      sourceTeamId: 'team-a', sourceTaskId: 't1', sourceTaskSubject: '任务t1', role: 'engineer',
    })
    expect(practice).toBeUndefined()
  })
})

describe('upsertBestPractice / updateBestPracticeVerdict — 去重与校准', () => {
  it('同 sourceTaskId 幂等更新而非重复新增', () => {
    const first = entry('bp-1')
    const second = entry('bp-2', { practice: '更新后的经验', cause: 'on_time' })
    const upserted = upsertBestPractice([first], second)
    expect(upserted).toHaveLength(1)
    expect(upserted[0]?.id).toBe('bp-1')
    expect(upserted[0]?.practice).toBe('更新后的经验')
    expect(upserted[0]?.cause).toBe('on_time')
  })

  it('不同任务可并存', () => {
    const a = entry('bp-1')
    const b = entry('bp-2', { sourceTaskId: 't2' })
    expect(upsertBestPractice([a], b)).toHaveLength(2)
  })

  it('verdict 流转:useful 确认 / revised 改原因', () => {
    const base = entry('bp-1')
    const useful = updateBestPracticeVerdict([base], 'bp-1', 'useful')
    expect(useful[0]?.verdict).toBe('useful')
    const revised = updateBestPracticeVerdict([base], 'bp-1', 'revised', 'requirement-change')
    expect(revised[0]?.verdict).toBe('revised')
    expect(revised[0]?.cause).toBe('requirement-change')
  })
})

describe('全局库文件读写', () => {
  it('写入后读回完整条目;文件不存在时为空库', async () => {
    expect(await readBestPractices(tempRoot)).toHaveLength(0)
    const entries = [entry('bp-1'), entry('bp-2', { sourceTaskId: 't2', role: 'researcher' })]
    await writeBestPractices(tempRoot, entries)
    const roundTrip = await readBestPractices(tempRoot)
    expect(roundTrip).toHaveLength(2)
    expect(roundTrip[1]?.role).toBe('researcher')
  })

  it('文件命名为 .agent-team-web/best-practices.json', async () => {
    await writeBestPractices(tempRoot, [entry('bp-1')])
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(join(tempRoot, BEST_PRACTICES_FILE), 'utf8')
    expect(raw).toContain('bp-1')
  })
})
