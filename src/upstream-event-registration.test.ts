import { describe, expect, it } from 'vitest'
import { UPSTREAM_TEAM_EVENT_TYPES } from './upstream.js'
import {
  AgentTeamHostCompatibilityError,
  registerUpstreamAgentTeamEventTypes,
} from './upstream-event-registration.js'

describe('upstream Agent Team event registration', () => {
  it('registers every required event type idempotently', () => {
    const catalogue = new Set<string>()

    registerUpstreamAgentTeamEventTypes(catalogue)
    registerUpstreamAgentTeamEventTypes(catalogue)

    expect([...catalogue].sort()).toEqual([...UPSTREAM_TEAM_EVENT_TYPES].sort())
  })

  it('rejects a catalogue without mutable Set semantics', () => {
    expect(() => registerUpstreamAgentTeamEventTypes({ has: () => false }))
      .toThrow(AgentTeamHostCompatibilityError)
  })

  it('reports a supported Host compatibility message', () => {
    expect(() => registerUpstreamAgentTeamEventTypes({ has: () => false }))
      .toThrow(/@deepseek-ai\/dsh-experimental-agent-team-web.*@deepseek-ai\/dsh-session@0\.1\.1-rc\.2.*supported Host/)
  })

  it('rejects a catalogue that refuses to retain an event type', () => {
    const catalogue = {
      add: (_type: string) => catalogue,
      has: (_type: string) => false,
    }

    expect(() => registerUpstreamAgentTeamEventTypes(catalogue))
      .toThrow(/agent-teams\/team-created/)
  })
})
