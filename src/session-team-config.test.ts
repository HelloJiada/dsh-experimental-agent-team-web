import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SESSION_TEAM_CONFIG,
  sessionTeamConfigSnapshotSchema,
  sessionTeamConfigViewSchema,
  validateSessionTeamConfig,
} from './session-team-config.js'

const catalog = {
  providers: [{
    id: 'anthropic',
    name: 'Anthropic',
    models: [{
      id: 'claude-opus-5',
      name: 'Claude Opus 5',
      efforts: [
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
        { id: 'max', name: 'Max' },
      ],
      selectable: true,
    }],
  }],
  failures: [],
  childEffortCapability: { status: 'supported' as const },
  refreshedAt: 0,
}

const validEnabledConfig = {
  version: 1 as const,
  enabled: true,
  maxWorkers: 4,
  modelPool: [{
    provider: 'anthropic',
    model: 'claude-opus-5',
    minReasoningEffort: 'medium',
    maxReasoningEffort: 'max',
  }],
}

describe('session Team configuration contract', () => {
  it('defaults every session to disabled with four workers and no models', () => {
    expect(DEFAULT_SESSION_TEAM_CONFIG).toEqual({
      version: 1,
      enabled: false,
      maxWorkers: 4,
      modelPool: [],
    })
  })

  it('round-trips a JSON-safe complete snapshot', () => {
    const config = validEnabledConfig
    expect(sessionTeamConfigSnapshotSchema.parse(JSON.parse(JSON.stringify(config))))
      .toEqual(config)
  })

  it.each([0, 9, 1.5])('rejects invalid worker limit %s', (maxWorkers) => {
    expect(sessionTeamConfigSnapshotSchema.safeParse({
      ...DEFAULT_SESSION_TEAM_CONFIG,
      maxWorkers,
    }).success).toBe(false)
  })

  it('does not admit secret-shaped fields into the strict wire schema', () => {
    expect(sessionTeamConfigViewSchema.safeParse({
      revision: 0,
      config: DEFAULT_SESSION_TEAM_CONFIG,
      catalog: null,
      lastMutation: null,
      apiKey: 'secret',
    }).success).toBe(false)
  })

  it('accepts an enabled configuration with a selectable ordered model effort range', () => {
    expect(validateSessionTeamConfig(validEnabledConfig, catalog)).toEqual({ ok: true })
  })

  it('rejects an enabled configuration without models', () => {
    expect(validateSessionTeamConfig({ ...validEnabledConfig, modelPool: [] }, catalog))
      .toMatchObject({ ok: false, code: 'empty-model-pool' })
  })

  it('rejects a configuration with an unknown model', () => {
    expect(validateSessionTeamConfig({
      ...validEnabledConfig,
      modelPool: [{ ...validEnabledConfig.modelPool[0], model: 'unknown' }],
    }, catalog)).toMatchObject({ ok: false, code: 'unknown-model' })
  })

  it('rejects a configuration with an unsupported effort', () => {
    expect(validateSessionTeamConfig({
      ...validEnabledConfig,
      modelPool: [{ ...validEnabledConfig.modelPool[0], minReasoningEffort: 'ultra' }],
    }, catalog)).toMatchObject({ ok: false, code: 'unsupported-effort' })
  })

  it('rejects a configuration whose minimum effort follows its maximum effort', () => {
    expect(validateSessionTeamConfig({
      ...validEnabledConfig,
      modelPool: [{
        ...validEnabledConfig.modelPool[0],
        minReasoningEffort: 'max',
        maxReasoningEffort: 'medium',
      }],
    }, catalog)).toMatchObject({ ok: false, code: 'invalid-effort-range' })
  })

  it('rejects model selections when child effort selection is unsupported', () => {
    expect(validateSessionTeamConfig(validEnabledConfig, {
      ...catalog,
      childEffortCapability: { status: 'unsupported', reason: 'missing installModelSelection' },
    })).toMatchObject({ ok: false, code: 'child-effort-unsupported' })
  })

  it('allows a disabled draft with no selected models', () => {
    expect(validateSessionTeamConfig(DEFAULT_SESSION_TEAM_CONFIG, catalog)).toEqual({ ok: true })
  })
})
