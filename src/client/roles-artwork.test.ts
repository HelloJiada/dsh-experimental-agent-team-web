import { describe, expect, it } from 'vitest'
import { ART_BASE, memberArtUrl } from './artwork.ts'
import { zh, type AgentTeamsLocaleKey, type AgentTeamsTranslate } from './locales.ts'
import { isRoleName, nameTitle, roleTitle } from './roles.ts'

const t = ((key: AgentTeamsLocaleKey): string => zh[key] ?? key) as AgentTeamsTranslate

const SECURITY_ART = `${ART_BASE}member-security-v2.png`

describe('reviewer → 审查员 mapping', () => {
  it('roleTitle maps reviewer (and case/v2 variants) to 审查员', () => {
    expect(roleTitle('reviewer', t)).toBe('审查员')
    expect(roleTitle('Reviewer', t)).toBe('审查员')
    expect(roleTitle('reviewer-v2', t)).toBe('审查员')
  })

  it('unknown roles still fall back to the raw role text', () => {
    expect(roleTitle('链路核验员', t)).toBe('链路核验员')
    expect(roleTitle('custom-role', t)).toBe('custom-role')
  })

  it('nameTitle shows 审查员 for a reviewer-named member, keeps Chinese names as-is', () => {
    expect(nameTitle('reviewer', t)).toBe('审查员')
    expect(nameTitle('链路核验员', t)).toBe('链路核验员')
  })

  it('isRoleName recognizes reviewer as a canonical role name', () => {
    expect(isRoleName('reviewer')).toBe(true)
    expect(isRoleName('链路核验员')).toBe(false)
  })

  it('isRoleName recognizes auto-numbered names (space and legacy no-space)', () => {
    expect(isRoleName('技术员 一号')).toBe(true)
    expect(isRoleName('技术员一号')).toBe(true)
    expect(isRoleName('侦察参谋 一号')).toBe(true)
    expect(isRoleName('技术员 二号')).toBe(true)
    expect(isRoleName('张三 一号')).toBe(false)
    expect(isRoleName('')).toBe(false)
  })

  it('memberArtUrl hits the reviewer/security whale for reviewer roles', () => {
    expect(memberArtUrl('链路核验员', 'reviewer')).toBe(SECURITY_ART)
    expect(memberArtUrl('alice', 'reviewer')).toBe(SECURITY_ART)
  })

  it('compound security titles keep their existing security artwork (no regression)', () => {
    expect(memberArtUrl('alice', '安全审查员')).toBe(SECURITY_ART)
    expect(memberArtUrl('alice', 'security')).toBe(SECURITY_ART)
  })
})
