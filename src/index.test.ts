import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => [] as string[])

vi.mock('./upstream-event-registration.js', () => ({
  registerUpstreamAgentTeamEventTypes: vi.fn(() => calls.push('upstream events')),
}))

vi.mock('./session-team-config-events.js', () => ({
  registerSessionTeamConfigEventTypes: vi.fn(() => calls.push('config events')),
}))

vi.mock('./projection.js', () => ({
  agentTeamProjectionDefinition: { key: 'agentTeam' },
}))

vi.mock('./session-team-config-projection.js', () => ({
  sessionTeamConfigProjectionDefinition: { key: 'agentTeamConfig' },
}))

import { apply } from './index.js'

describe('host plugin startup', () => {
  beforeEach(() => calls.splice(0))

  it('registers both event catalogues before either projection', () => {
    const ctx = {
      inject: (_requirements: readonly string[], callback: (ctx: unknown) => void) => {
        calls.push('inject')
        callback({
          sessionProjections: {
            register: (definition: { key: string }) => calls.push(definition.key),
          },
        })
      },
    }

    apply(ctx as never)

    expect(calls).toEqual([
      'upstream events',
      'config events',
      'inject',
      'agentTeam',
      'agentTeamConfig',
    ])
  })
})
