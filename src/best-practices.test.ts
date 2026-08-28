import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BEST_PRACTICES_FILE,
  MAX_INJECTED_PRACTICE_LENGTH,
  distillBestPractice,
  distillPracticeText,
  readBestPractices,
  selectBestPracticesForRole,
  truncatePracticeForInjection,
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
    // R-20 门控:可注入池默认用已验证 verdict(useful);pending 注入由专项用例锁定。
    verdict: 'useful',
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

  it('R-19/M-1:经验库文件 0600、目录 0700(多用户机器不世界可读)', async () => {
    await writeBestPractices(tempRoot, [entry('bp-1')])
    const { stat } = await import('node:fs/promises')
    const fileMode = (await stat(join(tempRoot, BEST_PRACTICES_FILE))).mode & 0o777
    const dirMode = (await stat(tempRoot)).mode & 0o777
    expect(fileMode).toBe(0o600)
    expect(dirMode).toBe(0o700)
  })
})

describe('selectBestPracticesForRole — 团队记忆注入(按角色匹配 + 冷启动守卫)', () => {
  it('按角色精确匹配,只返回该角色的条目', () => {
    const entries = [
      entry('bp-1', { role: 'engineer' }),
      entry('bp-2', { role: 'researcher' }),
      entry('bp-3', { role: 'engineer' }),
    ]
    const selected = selectBestPracticesForRole(entries, 'engineer')
    expect(selected.map(item => item.id)).toEqual(['bp-1', 'bp-3'])
  })

  it('冷启动守卫:角色匹配样本 <2 时不注入', () => {
    const entries = [entry('bp-1', { role: 'engineer' })]
    expect(selectBestPracticesForRole(entries, 'engineer')).toHaveLength(0)
    expect(selectBestPracticesForRole([], 'engineer')).toHaveLength(0)
  })

  it('无角色或空角色不注入', () => {
    const entries = [entry('bp-1', { role: 'engineer' }), entry('bp-2', { role: 'engineer' })]
    expect(selectBestPracticesForRole(entries, undefined)).toHaveLength(0)
    expect(selectBestPracticesForRole(entries, '  ')).toHaveLength(0)
  })

  it('R-20 门控:只注入已验证经验(useful/revised),pending 一律不注入', () => {
    // 质检员验收点③:注入门控收紧有明确决策——pending(未校准,retro_note 原文
    // 未经队长把关)不再注入;只有队长校准为 useful/revised 后才可进入成员系统提示。
    const entries = [
      entry('bp-pending-new', { verdict: 'pending', updatedAt: 3000 }),
      entry('bp-useful', { verdict: 'useful', updatedAt: 1000 }),
      entry('bp-revised', { verdict: 'revised', updatedAt: 2000 }),
      entry('bp-pending-old', { verdict: 'pending', updatedAt: 2500 }),
    ]
    const selected = selectBestPracticesForRole(entries, 'engineer')
    expect(selected.map(item => item.id)).toEqual(['bp-revised', 'bp-useful'])
  })

  it('R-20 门控:仅 pending 条目(无任何已校准样本)不注入,即使样本 ≥2', () => {
    const entries = [
      entry('bp-pending-1', { verdict: 'pending' }),
      entry('bp-pending-2', { verdict: 'pending' }),
    ]
    expect(selectBestPracticesForRole(entries, 'engineer')).toHaveLength(0)
  })

  it('注入上限:只取前 3 条,保持 persona 精简', () => {
    const entries = Array.from({ length: 5 }, (_, index) => entry(`bp-${index}`, {
      role: 'engineer',
      updatedAt: 5000 - index,
    }))
    const selected = selectBestPracticesForRole(entries, 'engineer')
    expect(selected).toHaveLength(3)
    expect(selected[0]?.updatedAt).toBeGreaterThan(selected[2]?.updatedAt ?? 0)
  })

  it('已否决经验(verdict=useless,陈旧文件残留)不注入', () => {
    const entries = [
      entry('bp-useful-1', { role: 'engineer', verdict: 'useful' }),
      entry('bp-useless', { role: 'engineer', verdict: 'useless', updatedAt: 9999 }),
      entry('bp-useful-2', { role: 'engineer', verdict: 'useful' }),
    ]
    const selected = selectBestPracticesForRole(entries, 'engineer')
    expect(selected.map(item => item.id)).toEqual(['bp-useful-1', 'bp-useful-2'])
  })
})

describe('truncatePracticeForInjection — R-20 注入文本截断', () => {
  it('短文本原样保留', () => {
    expect(truncatePracticeForInjection('先读测试再动手')).toBe('先读测试再动手')
  })

  it('超长文本截断到上限并加省略号', () => {
    const long = 'x'.repeat(MAX_INJECTED_PRACTICE_LENGTH + 50)
    const truncated = truncatePracticeForInjection(long)
    expect(truncated).toHaveLength(MAX_INJECTED_PRACTICE_LENGTH + 1) // 200 + '…'
    expect(truncated.endsWith('…')).toBe(true)
  })

  it('恰好等于上限时不截断', () => {
    const exact = 'x'.repeat(MAX_INJECTED_PRACTICE_LENGTH)
    expect(truncatePracticeForInjection(exact)).toBe(exact)
  })
})
