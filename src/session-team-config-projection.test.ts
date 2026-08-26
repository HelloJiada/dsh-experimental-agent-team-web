import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  applySessionTeamConfigEvent,
  foldSessionTeamConfigEvents,
  initSessionTeamConfigProjection,
  sessionTeamConfigProjectionDefinition,
  viewSessionTeamConfig,
} from './session-team-config-projection.js'

const configured = (seq: number, requestId: string, model: string): SessionEvent => ({
  type: 'agent-team/configured', seq, time: seq, data: {
    version: 1,
    requestId,
    config: {
      version: 1,
      enabled: true,
      maxWorkers: 2,
      modelPool: [{ provider: 'deepseek', model, minReasoningEffort: 'low', maxReasoningEffort: 'high' }],
    },
  },
} as SessionEvent)

const catalogRefreshed = (seq: number): SessionEvent => ({
  type: 'agent-team/model-catalog-refreshed', seq, time: seq, data: {
    version: 1,
    requestId: 'catalog-1',
    catalog: {
      providers: [{
        id: 'deepseek',
        name: 'DeepSeek',
        models: [{
          id: 'reasoner',
          name: 'Reasoner',
          efforts: [
            { id: 'low', name: 'Low' },
            { id: 'high', name: 'High' },
          ],
          selectable: true,
        }],
      }],
      failures: [],
      childEffortCapability: { status: 'supported' },
      refreshedAt: 42,
    },
  },
} as SessionEvent)

describe('session Team configuration projection', () => {
  it('starts disabled with revision zero and no catalogue', () => {
    expect(viewSessionTeamConfig(initSessionTeamConfigProjection())).toEqual({
      revision: 0,
      config: { version: 1, enabled: false, maxWorkers: 4, modelPool: [] },
      catalog: null,
      lastMutation: null,
    })
  })

  it('returns the same state reference for unrelated events', () => {
    const state = initSessionTeamConfigProjection()
    expect(applySessionTeamConfigEvent(state, {
      type: 'user/message', seq: 1, time: 1, data: {},
    } as SessionEvent)).toBe(state)
  })

  it('replaces the complete model pool when configured again', () => {
    const state = foldSessionTeamConfigEvents([
      configured(1, 'save-1', 'first'),
      configured(2, 'save-2', 'second'),
    ])

    expect(viewSessionTeamConfig(state)).toMatchObject({
      revision: 2,
      config: { modelPool: [{ model: 'second' }] },
      lastMutation: { requestId: 'save-2', kind: 'saved' },
    })
    expect(state.config.modelPool).toHaveLength(1)
  })

  it('preserves catalogue adapter effort order', () => {
    const state = foldSessionTeamConfigEvents([catalogRefreshed(3)])

    expect(state.catalog?.providers[0]?.models[0]?.efforts.map(effort => effort.id)).toEqual(['low', 'high'])
    expect(state.lastMutation).toEqual({ requestId: 'catalog-1', kind: 'catalog-refreshed' })
  })

  it('keeps configuration and revision after rejection', () => {
    const configuredState = foldSessionTeamConfigEvents([configured(5, 'save-1', 'reasoner')])
    const rejected = applySessionTeamConfigEvent(configuredState, {
      type: 'agent-team/config-rejected', seq: 6, time: 6, data: {
        version: 1,
        requestId: 'save-2',
        code: 'unknown-model',
        message: 'Unknown model.',
        currentRevision: 5,
      },
    } as SessionEvent)

    expect(rejected.config).toBe(configuredState.config)
    expect(rejected.revision).toBe(5)
    expect(rejected.lastMutation).toEqual({ requestId: 'save-2', kind: 'rejected', message: 'Unknown model.' })
  })

  it('validates folded state and JSON-round-trippable wire view', () => {
    const state = foldSessionTeamConfigEvents([configured(1, 'save-1', 'reasoner'), catalogRefreshed(2)])
    const view = viewSessionTeamConfig(state)

    expect(sessionTeamConfigProjectionDefinition.stateSchema.safeParse(state).success).toBe(true)
    expect(sessionTeamConfigProjectionDefinition.wire.viewSchema.safeParse(view).success).toBe(true)
    expect(JSON.parse(JSON.stringify(view))).toEqual(view)
  })
})
