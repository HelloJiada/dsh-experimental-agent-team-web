import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => [] as string[])

vi.mock('./upstream-event-registration.js', () => ({
  registerUpstreamAgentTeamEventTypes: vi.fn(() => calls.push('events')),
}))

import { apply } from './index.js'

describe('host plugin startup', () => {
  beforeEach(() => calls.splice(0))

  it('registers event compatibility before the projection', () => {
    const ctx = {
      inject: (_requirements: readonly string[], callback: (ctx: unknown) => void) => {
        calls.push('inject')
        callback({
          sessionProjections: {
            register: () => calls.push('projection'),
          },
        })
      },
    }

    apply(ctx as never)

    expect(calls).toEqual(['events', 'inject', 'projection'])
  })
})
