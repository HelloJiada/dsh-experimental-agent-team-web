import { describe, expect, it } from 'vitest'
import {
  detectChildEffortCapability,
  loadSessionTeamModelCatalog,
  type SessionTeamLlmDirectory,
} from './session-team-models.js'

describe('detectChildEffortCapability', () => {
  it('supports a callable create-time effort installer', () => {
    expect(detectChildEffortCapability(() => undefined)).toEqual({ status: 'supported' })
  })

  it('reports when the create-time effort installer is unavailable', () => {
    expect(detectChildEffortCapability(undefined)).toEqual({
      status: 'unsupported',
      reason: expect.stringContaining('installModelSelection'),
    })
  })

  it('detects create-time effort installation on DSH 0.1.1-rc.2', () => {
    expect(detectChildEffortCapability()).toEqual({ status: 'supported' })
  })
})

describe('loadSessionTeamModelCatalog', () => {
  it('keeps usable providers ordered while sanitizing isolated provider failures', async () => {
    const llm: SessionTeamLlmDirectory = {
      listProviders: () => [
        { id: 'anthropic', name: 'Anthropic', apiKey: 'provider-secret' },
        { id: 'broken', name: 'Broken', endpoint: 'https://private.example' },
      ],
      listModels: provider => {
        if (provider === 'broken') throw new Error('offline')
        return [
          { id: 'opus', name: 'Opus', settings: { token: 'model-secret' } },
          { id: 'plain', name: 'Plain', apiKey: 'another-secret' },
        ]
      },
      resolveModelInfo: (_provider, model) => {
        if (model === 'opus') {
          return {
            id: 'opus',
            name: 'Opus',
            reasoning: {
              efforts: [
                { id: 'medium', name: 'Medium', endpoint: 'effort-secret' },
                { id: 'max', name: 'Maximum', apiKey: 'effort-secret' },
              ],
              defaultEffort: 'medium',
            },
            settings: { apiKey: 'resolved-secret' },
          }
        }
        return { id: 'plain', name: 'Plain', endpoint: 'https://private.example' }
      },
    }

    const catalog = await loadSessionTeamModelCatalog(llm, {
      now: () => 1_725_000_000_000,
      childEffortCandidate: () => undefined,
    })

    expect(catalog).toEqual({
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: [
            {
              id: 'opus',
              name: 'Opus',
              efforts: [
                { id: 'medium', name: 'Medium' },
                { id: 'max', name: 'Maximum' },
              ],
              defaultEffort: 'medium',
              selectable: true,
            },
            {
              id: 'plain',
              name: 'Plain',
              efforts: [],
              selectable: false,
              unavailableReason: expect.stringContaining('reasoning'),
            },
          ],
        },
      ],
      failures: [{ provider: 'broken', message: expect.stringContaining('unavailable') }],
      childEffortCapability: { status: 'supported' },
      refreshedAt: 1_725_000_000_000,
    })
    expect(JSON.stringify(catalog)).not.toContain('apiKey')
    expect(JSON.stringify(catalog)).not.toContain('endpoint')
    expect(JSON.stringify(catalog)).not.toContain('settings')
  })

  it('sanitizes a model resolution failure without losing its provider', async () => {
    const llm: SessionTeamLlmDirectory = {
      listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }],
      listModels: () => [
        { id: 'usable', name: 'Usable' },
        { id: 'unavailable', name: 'Unavailable' },
      ],
      resolveModelInfo: (_provider, model) => {
        if (model === 'unavailable') throw new Error('credential=secret')
        return {
          id: 'usable',
          name: 'Usable',
          reasoning: { efforts: [{ id: 'medium', name: 'Medium' }] },
        }
      },
    }

    await expect(loadSessionTeamModelCatalog(llm, { now: () => 0, childEffortCandidate: () => undefined })).resolves.toEqual({
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: [
            { id: 'usable', name: 'Usable', efforts: [{ id: 'medium', name: 'Medium' }], selectable: true },
            {
              id: 'unavailable',
              name: 'Unavailable',
              efforts: [],
              selectable: false,
              unavailableReason: expect.stringContaining('unavailable'),
            },
          ],
        },
      ],
      failures: [],
      childEffortCapability: { status: 'supported' },
      refreshedAt: 0,
    })
  })
})
