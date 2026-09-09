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
    expect(patch).toContain('/plugins/agent-team-web/state')
  })

  it('ships a smoke-check guide for the bundle and live state route', async () => {
    const guide = await readFile(resolve(root, 'docs/real-profile-smoke-check.md'), 'utf8')
    expect(guide).toContain('@deepseek-ai/dsh-experimental-agent-team-web')
    expect(guide).toContain('/plugins/agent-team-web/state')
    expect(guide).toContain('releasing.md')
    expect(guide).toContain('dsh --profile web --dump-config')
  })
})
