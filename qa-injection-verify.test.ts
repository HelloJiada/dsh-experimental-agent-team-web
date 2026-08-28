/**
 * QA t2 注入验证（路径 3）：用真实经验库条目（队长 agent_teams_best_practices
 * 转发，2026-08-28）对 selectBestPracticesForRole / memberPersona 做函数级断言。
 *
 * 真实数据（engineer useful/revised = 2，均来自本团队 self-growth-verify）：
 * - bp-0110aff7 useful · sourceTaskId=t3 · "typecheck 门禁是提交前最后一道防线：tsc --noEmit 零报错再交付，避免类型漂移流入发布物。"
 * - bp-69965ccd useful · sourceTaskId=t1 · "容错修复要守住既有守卫:find* 跳过坏团队时,正常团队间的多团队歧义错误不能因 try/catch 静默吞掉——用最小作用域包裹 readTeam 单点调用,守卫逻辑留在循环体…"
 * 其余 14 条 pending 不注入（含 bp-178b89b8 from t4，带真实 retro_note）。
 *
 * 断言覆盖：≥2 注入 / <2 冷启动守卫 / persona "Team memory" 段 / 溯源字段 / 截断。
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_INJECTED_PRACTICE_LENGTH,
  MIN_MEMBER_MEMORY_SAMPLES,
  selectBestPracticesForRole,
  truncatePracticeForInjection,
  type BestPracticeEntry,
} from './src/best-practices.ts'
import { memberPersona } from './src/members.ts'
import type { TeamMember, TeamState } from './src/types.ts'

const team: TeamState = {
  name: 'self-growth-verify',
  id: 'self-growth-verify',
  captainSessionId: 'c1',
  createdAt: 1,
  members: [],
  tasks: [],
  taskSeq: 0,
}

const engineerMember: TeamMember = { id: 'm-engineer', name: '工程师乙', role: 'engineer', joinedAt: 1, status: 'idle' }

/** 队长转发的真实条目（含 2 条 useful + 1 条 pending 样例 + 1 条历史 pending）。 */
function realLibrary(): BestPracticeEntry[] {
  const base = {
    sourceTeamId: 'self-growth-verify',
    role: 'engineer',
    cause: 'on_time',
    createdAt: 1,
  }
  return [
    {
      id: 'bp-0110aff7',
      ...base,
      sourceTaskId: 't3',
      sourceTaskSubject: '验证任务①：typecheck 门禁检查',
      practice: 'typecheck 门禁是提交前最后一道防线：tsc --noEmit 零报错再交付，避免类型漂移流入发布物。',
      verdict: 'useful',
      updatedAt: 3000,
    },
    {
      id: 'bp-69965ccd',
      ...base,
      sourceTaskId: 't1',
      sourceTaskSubject: 'R-23：单团队损坏不再毒化工作区工具',
      practice: '容错修复要守住既有守卫:find* 跳过坏团队时,正常团队间的多团队歧义错误不能因 try/catch 静默吞掉——用最小作用域包裹 readTeam 单点调用,守卫逻辑留在循环体…',
      verdict: 'useful',
      updatedAt: 2000,
    },
    {
      id: 'bp-178b89b8',
      ...base,
      sourceTaskId: 't4',
      sourceTaskSubject: '验证任务②：自成长模块测试检查',
      practice: '自成长模块单测全绿是闭环验证前置…',
      verdict: 'pending',
      updatedAt: 1000,
    },
    {
      id: 'bp-27621251',
      sourceTeamId: 'framework-audit',
      sourceTaskId: 't1',
      sourceTaskSubject: '改进3：调度器按角色建议',
      role: 'engineer',
      cause: 'on_time',
      practice: '关键词表避开任务命名通用词…',
      verdict: 'pending',
      createdAt: 1,
      updatedAt: 500,
    },
  ]
}

describe('C8 ≥2 样本注入（真实库数据）', () => {
  it('engineer useful=2 → selectBestPracticesForRole 返回 2 条（updatedAt 倒序、上限 3）', () => {
    const selected = selectBestPracticesForRole(realLibrary(), 'engineer')
    expect(selected).toHaveLength(2)
    expect(selected[0]!.id).toBe('bp-0110aff7') // updatedAt 3000 最新在前
    expect(selected[1]!.id).toBe('bp-69965ccd')
    // 只含 useful（pending 的 bp-178b89b8 / bp-27621251 被排除）
    expect(selected.every(entry => entry.verdict === 'useful')).toBe(true)
  })

  it('memberPersona 注入 "Team memory" 段 + 校准经验文本 + 数据引用标注', () => {
    const selected = selectBestPracticesForRole(realLibrary(), 'engineer')
    const persona = memberPersona(team, engineerMember, 'state-dir', selected)
    expect(persona).toContain('Team memory (from the global best-practices library')
    expect(persona).toContain('typecheck 门禁是提交前最后一道防线')
    expect(persona).toContain('容错修复要守住既有守卫')
    expect(persona).toContain('NOT instructions to follow')
    expect(persona).toContain('来源任务「验证任务①：typecheck 门禁检查」· 归因 on_time')
    // 溯源：来源团队 id 与任务 id
    expect(persona).toContain('self-growth-verify')
  })

  it('实践文本注入前截断 ≤200 字符（MAX_INJECTED_PRACTICE_LENGTH）', () => {
    const long: BestPracticeEntry = {
      id: 'bp-long', sourceTeamId: 'self-growth-verify', sourceTaskId: 't9',
      sourceTaskSubject: '长文本任务', role: 'engineer', cause: 'other',
      practice: 'x'.repeat(500), verdict: 'useful', createdAt: 1, updatedAt: 9,
    }
    expect(truncatePracticeForInjection(long.practice).length).toBeLessThanOrEqual(MAX_INJECTED_PRACTICE_LENGTH + 1)
    const selected = selectBestPracticesForRole([...realLibrary(), long], 'engineer')
    const persona = memberPersona(team, engineerMember, 'state-dir', selected)
    expect(persona).not.toContain('x'.repeat(500))
    expect(persona).toContain('x'.repeat(200) + '…')
  })

  it('pending（未校准）条目一律不注入（R-20/M-2 门控）', () => {
    const selected = selectBestPracticesForRole(realLibrary(), 'engineer')
    expect(selected.some(entry => entry.id === 'bp-178b89b8')).toBe(false)
    expect(selected.some(entry => entry.id === 'bp-27621251')).toBe(false)
  })
})

describe('C7 冷启动守卫（<2 样本，真实库数据）', () => {
  it('仅 1 条 useful → 返回空（MIN_MEMBER_MEMORY_SAMPLES=2 不注入）', () => {
    const oneUseful = realLibrary().filter(entry => entry.id !== 'bp-69965ccd') // 只留 bp-0110aff7 useful
    const usefulCount = oneUseful.filter(entry => entry.role === 'engineer' && entry.verdict === 'useful').length
    expect(usefulCount).toBe(1)
    expect(selectBestPracticesForRole(oneUseful, 'engineer')).toHaveLength(0)
    expect(memberPersona(team, engineerMember, 'state-dir', [])).not.toContain('Team memory')
  })

  it('0 条 useful（全 pending 基线）→ 返回空', () => {
    const allPending = realLibrary().map(entry => ({ ...entry, verdict: 'pending' as const }))
    expect(selectBestPracticesForRole(allPending, 'engineer')).toHaveLength(0)
  })

  it('无角色/空角色 → 返回空', () => {
    expect(selectBestPracticesForRole(realLibrary(), undefined)).toHaveLength(0)
    expect(selectBestPracticesForRole(realLibrary(), '  ')).toHaveLength(0)
  })
})

describe('C9 溯源字段完整（真实条目）', () => {
  it('每条 selected 条目含 sourceTeamId/sourceTaskId/sourceTaskSubject/role/createdAt', () => {
    for (const entry of selectBestPracticesForRole(realLibrary(), 'engineer')) {
      expect(typeof entry.id).toBe('string')
      expect(entry.sourceTeamId).toBe('self-growth-verify')
      expect(entry.sourceTaskId).toBeTruthy()
      expect(entry.sourceTaskSubject.length).toBeGreaterThan(0)
      expect(entry.role).toBe('engineer')
      expect(entry.cause).toBeTruthy()
      expect(typeof entry.createdAt).toBe('number')
      expect(typeof entry.updatedAt).toBe('number')
    }
  })
})
