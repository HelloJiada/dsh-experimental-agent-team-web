import { describe, expect, it } from 'vitest'
import {
  SESSION_TEAM_CONFIG_EVENT_TYPES,
  registerSessionTeamConfigEventTypes,
} from './session-team-config-events.js'

describe('session Team configuration event registration', () => {
  it('registers the exact Phase 1 event vocabulary idempotently', () => {
    const catalogue = new Set<string>()
    registerSessionTeamConfigEventTypes(catalogue)
    registerSessionTeamConfigEventTypes(catalogue)
    expect([...catalogue].sort()).toEqual([...SESSION_TEAM_CONFIG_EVENT_TYPES].sort())
  })

  it('fails loud when the Host catalogue cannot retain a type', () => {
    const catalogue = { add: () => catalogue, has: () => false }
    expect(() => registerSessionTeamConfigEventTypes(catalogue))
      .toThrow(/DSH 0\.1\.1-rc\.2/)
  })
})
