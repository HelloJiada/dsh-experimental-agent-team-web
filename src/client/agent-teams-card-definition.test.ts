/** Card identity parsing tests. */
import { describe, expect, it } from 'vitest'
import { parseAgentTeamsCreateResult } from './agent-teams-card-definition.ts'

describe('parseAgentTeamsCreateResult', () => {
  it('extracts exact UUID reference from rendered tool result JSON', () => {
    expect(parseAgentTeamsCreateResult(JSON.stringify({ team_id: '550e8400-e29b-41d4-a716-446655440000', team_name: '简单代码检查', captain_session_id: 'session-captain' }))).toEqual({
      teamId: '550e8400-e29b-41d4-a716-446655440000',
      name: '简单代码检查',
      captainSessionId: 'session-captain',
    })
  })

  it('walks nested tool-result content without deriving id from display name', () => {
    expect(parseAgentTeamsCreateResult([{
      type: 'tool-result',
      content: [{ type: 'text', text: JSON.stringify({ team_id: 'actual-id', team_name: '中文团队', captain_session_id: 'captain-actual' }) }],
    }])).toEqual({ teamId: 'actual-id', name: '中文团队', captainSessionId: 'captain-actual' })
  })

  it('rejects args-only and team-id-only payloads', () => {
    expect(parseAgentTeamsCreateResult({ name: '中文团队' })).toBeUndefined()
    expect(parseAgentTeamsCreateResult({ team_id: 'uuid-team', team_name: '中文团队' })).toBeUndefined()
  })

  it('keeps the exact captain binding instead of wildcard owner', () => {
    const value = parseAgentTeamsCreateResult({
      team_id: 'uuid-team', team_name: '中文团队', captain_session_id: 'captain-exact',
    })
    expect(value?.captainSessionId).toBe('captain-exact')
  })
})
