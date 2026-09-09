import { mkdtemp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalWorkspaceId } from './workspace-identity.ts'

describe('canonicalWorkspaceId', () => {
  it('uses canonical realpath so symlink aliases share identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-ws-'))
    const alias = `${root}-alias`
    await symlink(root, alias)
    await expect(canonicalWorkspaceId(root)).resolves.toBe(await canonicalWorkspaceId(alias))
  })

  it('uses full ws_ sha256 token shape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-ws-'))
    const value = await canonicalWorkspaceId(root)
    expect(value).toMatch(/^ws_[A-Za-z0-9_-]{43}$/)
  })
})
