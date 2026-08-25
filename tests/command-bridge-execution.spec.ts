import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENT_TEAM_COMMAND_KINDS } from '../src/commands.js'

const root = resolve(import.meta.dirname, '..')

describe('command bridge host execution contract', () => {
  it('exposes exactly the six documented command kinds', () => {
    expect(AGENT_TEAM_COMMAND_KINDS).toEqual([
      'task:claim',
      'task:reassign',
      'task:unblock',
      'member:restart',
      'message:redeliver',
      'message:broadcast',
    ])
    expect(new Set(AGENT_TEAM_COMMAND_KINDS).size).toBe(AGENT_TEAM_COMMAND_KINDS.length)
  })

  it('documents every command kind with execution semantics', async () => {
    const doc = await readFile(resolve(root, 'docs/command-bridge-execution.md'), 'utf8')
    for (const kind of AGENT_TEAM_COMMAND_KINDS) {
      expect(doc).toContain(kind)
    }
    expect(doc).toContain('AGENT_TEAM_COMMAND_KINDS')
    expect(doc).toContain('generatedFromTeamId')
    expect(doc).toContain('targetId')
    expect(doc).toContain('priority')
    expect(doc).toContain('rationale')
    expect(doc).toContain('readonly AgentTeamCommandKind[]')
  })
})
