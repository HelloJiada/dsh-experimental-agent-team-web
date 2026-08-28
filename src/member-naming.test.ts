import { describe, expect, it } from 'vitest'
import { isRoleOnlyName, resolveMemberName, roleDisplayTitle, zhNumber } from './member-naming.ts'

describe('zhNumber — 中文数字', () => {
  it('1..10 映射', () => {
    expect(zhNumber(1)).toBe('一')
    expect(zhNumber(2)).toBe('二')
    expect(zhNumber(3)).toBe('三')
    expect(zhNumber(10)).toBe('十')
  })

  it('非 1-10 回退原始数字', () => {
    expect(zhNumber(0)).toBe('0')
    expect(zhNumber(11)).toBe('11')
  })
})

describe('roleDisplayTitle — 角色中文名', () => {
  it('canonical 角色 → 军职中文名', () => {
    expect(roleDisplayTitle('engineer')).toBe('技术员')
    expect(roleDisplayTitle('researcher')).toBe('侦察参谋')
    expect(roleDisplayTitle('data')).toBe('情报分析员')
    expect(roleDisplayTitle('qa')).toBe('质检员')
    expect(roleDisplayTitle('designer')).toBe('文宣干事')
    expect(roleDisplayTitle('reviewer')).toBe('审查员')
    expect(roleDisplayTitle('commissar')).toBe('政委')
  })

  it('中文角色与 -v2 变体归一', () => {
    expect(roleDisplayTitle('技术员')).toBe('技术员')
    expect(roleDisplayTitle('Engineer')).toBe('技术员')
    expect(roleDisplayTitle('engineer-v2')).toBe('技术员')
  })

  it('降级角色（security/docs/operator）仍解析中文标题（兼容显示）', () => {
    expect(roleDisplayTitle('security')).toBe('警卫员')
    expect(roleDisplayTitle('docs')).toBe('文书')
    expect(roleDisplayTitle('operator')).toBe('后勤保障员')
    expect(roleDisplayTitle('警卫员')).toBe('警卫员')
  })

  it('自定义角色回退原始文本', () => {
    expect(roleDisplayTitle('审计员')).toBe('审计员')
    expect(roleDisplayTitle('custom')).toBe('custom')
    expect(roleDisplayTitle(undefined)).toBe('')
  })
})

describe('isRoleOnlyName — 是否纯角色名', () => {
  it('空名视为角色名（触发自动编号）', () => {
    expect(isRoleOnlyName('', 'engineer')).toBe(true)
  })

  it('等于角色原文或中文名时触发', () => {
    expect(isRoleOnlyName('engineer', 'engineer')).toBe(true)
    expect(isRoleOnlyName('技术员', 'engineer')).toBe(true)
    expect(isRoleOnlyName('侦察参谋', 'researcher')).toBe(true)
  })

  it('显式自定义名不触发', () => {
    expect(isRoleOnlyName('张三', 'engineer')).toBe(false)
    expect(isRoleOnlyName('技术员 二号', 'engineer')).toBe(false)
    expect(isRoleOnlyName('张三', undefined)).toBe(false)
  })
})

describe('resolveMemberName — 角色名命名（去编号）', () => {
  it('缺省名直接使用角色标题（首名不加序号）', () => {
    expect(resolveMemberName(undefined, 'engineer', 0)).toBe('技术员')
    expect(resolveMemberName('', 'researcher', 0)).toBe('侦察参谋')
    expect(resolveMemberName(undefined, 'data', 0)).toBe('情报分析员')
    expect(resolveMemberName(undefined, 'qa', 0)).toBe('质检员')
  })

  it('纯角色名同样收敛为角色标题', () => {
    expect(resolveMemberName('技术员', 'engineer', 0)).toBe('技术员')
    expect(resolveMemberName('engineer', 'engineer', 0)).toBe('技术员')
    expect(resolveMemberName('侦察参谋', 'researcher', 0)).toBe('侦察参谋')
  })

  it('同角色第二名才加序号（每角色默认 1 人，上限可配置）', () => {
    expect(resolveMemberName(undefined, 'engineer', 1)).toBe('技术员 二号')
    expect(resolveMemberName('engineer', 'engineer', 1)).toBe('技术员 二号')
    expect(resolveMemberName('侦察参谋', 'researcher', 1)).toBe('侦察参谋 二号')
  })

  it('显式名（含旧编号名）原样保留 — 旧团队兼容', () => {
    expect(resolveMemberName('张三', 'engineer', 0)).toBe('张三')
    expect(resolveMemberName('技术员 一号', 'engineer', 0)).toBe('技术员 一号')
    expect(resolveMemberName('技术员 二号', 'engineer', 0)).toBe('技术员 二号')
    expect(resolveMemberName('王政委', 'commissar', 0)).toBe('王政委')
  })

  it('政委不加编号', () => {
    expect(resolveMemberName(undefined, 'commissar', 0)).toBe('政委')
    expect(resolveMemberName('政委', 'commissar', 1)).toBe('政委')
  })

  it('自定义角色回退原始角色文本（首名不加序号）', () => {
    expect(resolveMemberName(undefined, '审计员', 0)).toBe('审计员')
    expect(resolveMemberName('审计员', '审计员', 1)).toBe('审计员 二号')
  })

  it('无角色且无显式名时报错', () => {
    expect(() => resolveMemberName(undefined, undefined, 0)).toThrow(/name must not be empty/)
  })
})
