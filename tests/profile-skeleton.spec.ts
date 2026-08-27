import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('real-profile integration skeleton', () => {
  it('ships a reusable profile patch example for the web bundle', async () => {
    const patch = await readFile(resolve(root, 'examples/profile-patch.agent-team-web.yml'), 'utf8')
    expect(patch).toContain('@deepseek-ai/dsh-experimental-agent-team-web')
    expect(patch).toContain('sessionProjections')
    expect(patch).toContain('agent-team-web/*')
    expect(patch).toContain('commandPlan JSON payload')
  })

  it('ships a smoke-check guide that references the private bundle and plan envelope', async () => {
    const guide = await readFile(resolve(root, 'docs/real-profile-smoke-check.md'), 'utf8')
    expect(guide).toContain('@deepseek-ai/dsh-experimental-agent-team-web')
    expect(guide).toContain('commandPlan')
    expect(guide).toContain('verification-checklist.md')
    expect(guide).toContain('dsh --profile web --dump-config')
  })
})
