import { describe, expect, it } from 'vitest'
import {
  canonicalExecRole,
  countActiveExecRoleMembers,
  DEFAULT_MAX_EXEC_PER_ROLE,
} from './role-limits.ts'
import type { TeamMember } from './types.ts'

function member(name: string, role: string | undefined, status: TeamMember['status'] = 'idle'): TeamMember {
  return { id: `id-${name}`, name, role, provider: 'p', model: 'm', joinedAt: 0, status }
}

describe('canonicalExecRole — 规范化', () => {
  it('trim / 小写 / 剥离 -v2 后缀', () => {
    expect(canonicalExecRole('engineer')).toBe('engineer')
    expect(canonicalExecRole('Engineer')).toBe('engineer')
    expect(canonicalExecRole(' engineer ')).toBe('engineer')
    expect(canonicalExecRole('engineer-v2')).toBe('engineer')
    expect(canonicalExecRole('engineer_v2')).toBe('engineer')
    expect(canonicalExecRole('engineer v2')).toBe('engineer')
  })

  it('中文军职名映射到 canonical key', () => {
    expect(canonicalExecRole('技术员')).toBe('engineer')
    expect(canonicalExecRole('侦察参谋')).toBe('researcher')
    expect(canonicalExecRole('情报分析员')).toBe('data')
    expect(canonicalExecRole('质检员')).toBe('qa')
    expect(canonicalExecRole('审查员')).toBe('reviewer')
  })

  it('空 / 未定义 → 空串', () => {
    expect(canonicalExecRole(undefined)).toBe('')
    expect(canonicalExecRole('')).toBe('')
  })
})

describe('countActiveExecRoleMembers — 每角色上限统计', () => {
  const members: readonly TeamMember[] = [
    member('技术员1', 'engineer'),
    member('技术员2', 'engineer-v2'),
    member('技术员3', 'Engineer'),
    member('参谋', 'researcher'),
    member('政委', 'commissar'),
    member('离职技术员', 'engineer', 'removed'),
    member('无角色', undefined),
  ]

  it('同角色（含大小写 / -v2 / 中文变体）归为同一上限桶', () => {
    expect(countActiveExecRoleMembers(members, 'engineer')).toBe(3)
    expect(countActiveExecRoleMembers(members, '技术员')).toBe(3)
    expect(countActiveExecRoleMembers(members, 'engineer-v2')).toBe(3)
  })

  it('removed 成员与 commissar 不计入执行角色统计', () => {
    expect(countActiveExecRoleMembers(members, 'commissar')).toBe(0)
    expect(countActiveExecRoleMembers(members, '政委')).toBe(0)
  })

  it('不同角色互不影响', () => {
    expect(countActiveExecRoleMembers(members, 'researcher')).toBe(1)
    expect(countActiveExecRoleMembers(members, 'qa')).toBe(0)
    expect(countActiveExecRoleMembers(members, 'docs')).toBe(0)
  })

  it('无角色成员不匹配任何执行角色', () => {
    expect(countActiveExecRoleMembers(members, 'engineer')).toBe(3)
    expect(countActiveExecRoleMembers(members, undefined)).toBe(1)
  })
})

describe('DEFAULT_MAX_EXEC_PER_ROLE — 每角色默认上限', () => {
  it('默认 2（同角色第 3 个活跃成员触发拒绝）', () => {
    expect(DEFAULT_MAX_EXEC_PER_ROLE).toBe(2)
    const twoEngineers = [
      member('技术员一号', 'engineer'),
      member('技术员二号', 'engineer'),
    ]
    expect(countActiveExecRoleMembers(twoEngineers, 'engineer')).toBe(DEFAULT_MAX_EXEC_PER_ROLE)
    // 第 3 个同角色成员会令统计越过上限（add_member 处拒绝）。
    const threeEngineers = [
      ...twoEngineers,
      member('技术员三号', 'engineer'),
    ]
    expect(countActiveExecRoleMembers(threeEngineers, 'engineer')).toBeGreaterThan(DEFAULT_MAX_EXEC_PER_ROLE)
  })
})
