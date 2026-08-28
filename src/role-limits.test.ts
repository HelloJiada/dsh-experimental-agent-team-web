import { describe, expect, it } from 'vitest'
import {
  canonicalExecRole,
  countActiveExecRoleMembers,
  DEFAULT_MAX_EXEC_PER_ROLE,
  execRoleCap,
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
  it('默认 1（同角色第 2 个活跃成员触发拒绝）', () => {
    expect(DEFAULT_MAX_EXEC_PER_ROLE).toBe(1)
    const oneEngineer = [
      member('技术员', 'engineer'),
    ]
    expect(countActiveExecRoleMembers(oneEngineer, 'engineer')).toBe(DEFAULT_MAX_EXEC_PER_ROLE)
    // 第 2 个同角色成员会令统计越过上限（add_member 处拒绝）。
    const twoEngineers = [
      ...oneEngineer,
      member('技术员 二号', 'engineer'),
    ]
    expect(countActiveExecRoleMembers(twoEngineers, 'engineer')).toBeGreaterThan(DEFAULT_MAX_EXEC_PER_ROLE)
  })
})

describe('execRoleCap — 按角色覆盖上限（全局默认 + per-role override）', () => {
  it('无覆盖时回退全局默认 1', () => {
    expect(execRoleCap('engineer', undefined, 1)).toBe(1)
    expect(execRoleCap('engineer', {}, 1)).toBe(1)
    expect(execRoleCap('技术员', {}, 1)).toBe(1) // 中文军职归一化后同样回退
  })

  it('engineer 覆盖为 2、其他角色保持默认 1（技术员展开 2 个）', () => {
    const byRole = { engineer: 2 }
    expect(execRoleCap('engineer', byRole, 1)).toBe(2)
    expect(execRoleCap('技术员', byRole, 1)).toBe(2) // 中文军职命中同一 canonical key
    expect(execRoleCap('技术员-v2', byRole, 1)).toBe(2) // 版本后缀归一化
    expect(execRoleCap('qa', byRole, 1)).toBe(1) // 未列出的角色保持默认
    expect(execRoleCap('researcher', byRole, 1)).toBe(1)
    expect(execRoleCap('security', byRole, 1)).toBe(1)
  })

  it('全局默认非 1 时覆盖与回退都正确', () => {
    const byRole = { qa: 3 }
    expect(execRoleCap('qa', byRole, 2)).toBe(3) // 覆盖优先
    expect(execRoleCap('engineer', byRole, 2)).toBe(2) // 未覆盖回退全局
  })

  it('空/未知角色回退全局默认', () => {
    expect(execRoleCap(undefined, { engineer: 2 }, 1)).toBe(1)
    expect(execRoleCap('', { engineer: 2 }, 1)).toBe(1)
    expect(execRoleCap('custom-role', { engineer: 2 }, 1)).toBe(1)
  })
})
