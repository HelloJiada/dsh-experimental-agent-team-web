import { describe, expect, it } from 'vitest'
import { effectiveTeamMode, teamModeHintKey, teamModeLabelKey } from './team-mode.ts'
import { en, zh } from './locales.ts'

describe('team mode display helpers', () => {
  it('defaults unknown/absent modes to standard', () => {
    expect(effectiveTeamMode(undefined)).toBe('standard')
    expect(effectiveTeamMode('')).toBe('standard')
    expect(effectiveTeamMode('bogus')).toBe('standard')
    expect(effectiveTeamMode('light')).toBe('light')
    expect(effectiveTeamMode('governed')).toBe('governed')
  })

  it('maps each mode to its label and hint key', () => {
    expect(teamModeLabelKey('light')).toBe('team.mode.light')
    expect(teamModeLabelKey('standard')).toBe('team.mode.standard')
    expect(teamModeLabelKey('governed')).toBe('team.mode.governed')
    expect(teamModeHintKey('light')).toBe('team.mode.hint.light')
    expect(teamModeHintKey('standard')).toBe('team.mode.hint.standard')
    expect(teamModeHintKey('governed')).toBe('team.mode.hint.governed')
  })

  it('ships every mode string in both locales', () => {
    for (const key of [
      'team.mode.light', 'team.mode.standard', 'team.mode.governed', 'team.mode.aria',
      'team.mode.hint.light', 'team.mode.hint.standard', 'team.mode.hint.governed',
    ] as const) {
      expect(zh[key]).toBeTruthy()
      expect(en[key]).toBeTruthy()
    }
  })
})
