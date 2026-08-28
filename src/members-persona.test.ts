import { describe, expect, it } from 'vitest'
import { memberPersona } from './members.ts'
import type { TeamMember, TeamState } from './types.ts'
import type { BestPracticeEntry } from './best-practices.ts'

function member(name: string, role: string | undefined): TeamMember {
  return { id: `id-${name}`, name, role, provider: 'p', model: 'm', joinedAt: 0, status: 'idle' }
}

function team(members: TeamMember[]): TeamState {
  return { name: 'test-team', id: 'test-team', captainSessionId: 'captain', createdAt: 0, members, tasks: [], taskSeq: 0 }
}

const memory: BestPracticeEntry = {
  id: 'bp-abc',
  sourceTeamId: 't',
  sourceTaskId: 't1',
  sourceTaskSubject: '样本任务',
  role: 'engineer',
  cause: 'on_time',
  practice: '这类任务先读 README 再动手',
  verdict: 'useful',
  createdAt: 0,
  updatedAt: 0,
}

describe('memberPersona — 角色差异化行为模板注入', () => {
  it('engineer 成员注入"做出来"行为模板', () => {
    const persona = memberPersona(team([]), member('技术员', 'engineer'), '.agent-team-web')
    expect(persona).toContain('with the role: engineer')
    expect(persona).toContain('Your role is 技术员 (engineer) — you build it')
    expect(persona).toContain('diff summary')
  })

  it('researcher 成员注入"想清楚"行为模板', () => {
    const persona = memberPersona(team([]), member('侦察参谋', 'researcher'), '.agent-team-web')
    expect(persona).toContain('Your role is 侦察参谋 (researcher) — you think things through')
    expect(persona).toContain('Deliver the root cause of the problem, then a concrete plan')
    expect(persona).toContain('Do not jump straight to implementation')
  })

  it('qa 成员注入"验明白"行为模板', () => {
    const persona = memberPersona(team([]), member('质检员', 'qa'), '.agent-team-web')
    expect(persona).toContain('Your role is 质检员 (qa) — you verify it')
    expect(persona).toContain('verification checklist')
  })

  it('designer 成员注入"好看"行为模板', () => {
    const persona = memberPersona(team([]), member('文宣干事', 'designer'), '.agent-team-web')
    expect(persona).toContain('Your role is 文宣干事 (designer) — you make it look good')
    expect(persona).toContain('concrete values')
  })

  it('data 成员注入"算清楚"行为模板', () => {
    const persona = memberPersona(team([]), member('情报分析员', 'data'), '.agent-team-web')
    expect(persona).toContain('Your role is 情报分析员 (data) — you compute it')
    expect(persona).toContain('reviewable report')
  })

  it('docs 成员注入"写明白"行为模板(R-16:4a182f2 恢复 docs 后补用例)', () => {
    const persona = memberPersona(team([]), member('文书', 'docs'), '.agent-team-web')
    expect(persona).toContain('Your role is 文书 (docs) — you write it down clearly')
    expect(persona).toContain('STRUCTURE FIRST')
    expect(persona).toContain('WRITE WITH SPEC')
    expect(persona).toContain('SYNC CHECK')
  })

  it('reviewer 成员注入审查模板', () => {
    const persona = memberPersona(team([]), member('审查员', 'reviewer'), '.agent-team-web')
    expect(persona).toContain('Your role is 审查员 (reviewer, task-level)')
    expect(persona).toContain('pass/reject verdict')
  })

  it('中文角色名同样命中模板（canonical 归一）', () => {
    const persona = memberPersona(team([]), member('技术员', '技术员'), '.agent-team-web')
    expect(persona).toContain('Your role is 技术员 (engineer) — you build it')
  })

  it('commissar 成员注入监督模板且不再称为 worker', () => {
    const persona = memberPersona(team([]), member('政委', 'commissar'), '.agent-team-web')
    expect(persona).toContain('independent oversight, not task execution')
    expect(persona).toContain('agent_teams_review_task')
    expect(persona).toContain('not a task executor')
    expect(persona).not.toContain('you are a worker member')
  })

  it('自定义/降级角色不注入模板（保持通用 worker 人设）', () => {
    const persona = memberPersona(team([]), member('警卫员', 'security'), '.agent-team-web')
    expect(persona).toContain('you are a worker member')
    expect(persona).not.toContain('Role behavior:')
  })

  it('无角色成员不注入模板', () => {
    const persona = memberPersona(team([]), member('无名', undefined), '.agent-team-web')
    expect(persona).not.toContain('Role behavior:')
  })

  it('团队成员记忆注入保留（与 t3 兼容）', () => {
    const persona = memberPersona(team([]), member('技术员', 'engineer'), '.agent-team-web', [memory])
    expect(persona).toContain('Team memory (from the global best-practices library')
    expect(persona).toContain('先读 README 再动手')
    expect(persona).toContain('Your role is 技术员 (engineer) — you build it')
  })
})
