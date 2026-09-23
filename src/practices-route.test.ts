import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { readBestPractices, writeBestPractices, selectBestPracticesForRole, type BestPracticeEntry } from './best-practices.ts'
import { applyPracticeMutation, handlePractices, parsePracticeMutation } from './practices-route.ts'

const entry = (id: string, sourceTaskId = id): BestPracticeEntry => ({
  id, sourceTeamId: 'team-a', sourceTaskId, sourceTaskSubject: 'safe', role: 'engineer',
  cause: 'on_time', practice: '先读测试', verdict: 'useful', createdAt: 1, updatedAt: 1,
})
const mutation = (id: string, action: 'edit' | 'disable' | 'restore', overrides: object = {}) => ({
  workspace: '/tmp/registered', id, expectedRevision: 0, action, reason: '人工确认原因', ...overrides,
})
let root: string | undefined
afterEach(async () => { if (root) { await rm(root, { recursive: true, force: true }); root = undefined } })

function req(method: string, url: string, body?: unknown, token = 'secret'): IncomingMessage {
  const input = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as IncomingMessage
  Object.assign(input, { method, url, headers: { host: '127.0.0.1:3080', 'x-dsh-agent-teams-token': token } })
  return input
}
function response(): ServerResponse & { code: number; data: unknown } {
  const out = { code: 0, data: undefined as unknown,
    writeHead(code: number) { out.code = code; return out },
    end(body: string) { out.data = JSON.parse(body) },
  }
  return out as unknown as ServerResponse & { code: number; data: unknown }
}
function registry(path: string): WorkspaceRegistry {
  return { list: () => [{ path, title: 'Only workspace' }] } as unknown as WorkspaceRegistry
}
const operator = { id: 'host-operator-peer' }
const auth = { token: 'secret', trustedHosts: [], connection: {
  operator,
  admit: () => ({ peer: operator }),
} }

describe('practice governance: validated revisioned transitions', () => {
  it('rejects invalid patch shapes and missing reasons', () => {
    expect(() => parsePracticeMutation(mutation('a', 'disable', { reason: '' }))).toThrow()
    expect(() => parsePracticeMutation(mutation('a', 'edit', { patch: { practice: 'ok', evidence: [] } }))).toThrow()
    expect(() => parsePracticeMutation(mutation('a', 'edit', { patch: { counterexamples: ['not structured'] } }))).toThrow()
  })
  it('expiry-only edit cannot bypass expiry gate and validates review history', () => {
    const original = entry('a')
    const updated = applyPracticeMutation(original, parsePracticeMutation(mutation('a', 'edit', {
      patch: { expiresAt: 5 },
    })), 10)
    expect(updated.revision).toBe(1)
    expect(selectBestPracticesForRole([updated, entry('b')], 'engineer', 10)).toEqual([])
    expect(updated.reviewHistory?.[0]).toMatchObject({ actor: 'local-browser-operator', action: 'edit', summary: '人工确认原因' })
  })
  it('edit resets review, disable preserves audit, restore remains pending; stale revisions conflict', () => {
    const original = entry('a')
    const edited = applyPracticeMutation(original, parsePracticeMutation(mutation('a', 'edit', {
      patch: { practice: '改进', appliesWhen: ['需审查'] },
    })), 20)
    expect(edited).toMatchObject({ practice: '改进', verdict: 'pending', revision: 1 })
    expect(() => applyPracticeMutation(edited, parsePracticeMutation(mutation('a', 'disable')), 21)).toThrow(/revision conflict/)
    const disabled = applyPracticeMutation(edited, parsePracticeMutation(mutation('a', 'disable', { expectedRevision: 1 })), 22)
    expect(disabled).toMatchObject({ disabledAt: 22, revision: 2 })
    expect(disabled.reviewHistory?.map(item => item.action)).toEqual(['edit', 'disable'])
    const restored = applyPracticeMutation(disabled, parsePracticeMutation(mutation('a', 'restore', { expectedRevision: 2 })), 23)
    expect(restored).toMatchObject({ verdict: 'pending', revision: 3 })
    expect(restored.disabledAt).toBeUndefined()
  })
})

describe('practice HTTP route: authorization, registered root, persistence', () => {
  it('valid operator admission permits only registered workspaces; boot token alone is insufficient', async () => {
    root = await mkdtemp(join(tmpdir(), 'practice-http-'))
    const dir = join(root, '.agent-team-web')
    await writeBestPractices(dir, [entry('a')])
    const listing = response()
    await handlePractices(registry(root), '.agent-team-web', req('GET', '/plugins/agent-team-web/practices'), listing, auth)
    expect(listing.code).toBe(200)
    expect(listing.data).toEqual({ workspaces: [{ path: root, title: 'Only workspace' }] })
    const noOperator = response()
    await handlePractices(registry(root), '.agent-team-web', req('GET', '/plugins/agent-team-web/practices'), noOperator, { token: 'secret', trustedHosts: [] })
    expect(noOperator.code).toBe(403)
    const denied = response()
    await handlePractices(registry(root), '.agent-team-web', req('GET', `/plugins/agent-team-web/practices?workspace=${encodeURIComponent(root)}`, undefined, 'wrong'), denied, auth)
    expect(denied.code).toBe(403)
    const other = response()
    await handlePractices(registry(root), '.agent-team-web', req('GET', '/plugins/agent-team-web/practices?workspace=%2Ftmp%2Fother'), other, auth)
    expect(other.code).toBe(403)
    const selected = response()
    await handlePractices(registry(root), '.agent-team-web', req('GET', `/plugins/agent-team-web/practices?workspace=${encodeURIComponent(root)}`), selected, auth)
    expect(selected.code).toBe(200)
    expect((selected.data as { entries: unknown[] }).entries).toHaveLength(1)
  })

  it('rejects missing browser admission, rejected cookies and a foreign peer without reading workspaces', async () => {
    root = await mkdtemp(join(tmpdir(), 'practice-http-'))
    let enumerations = 0
    const watched = { list: () => { enumerations++; return [{ path: root, title: 'Only workspace' }] } } as unknown as WorkspaceRegistry
    for (const connection of [undefined, { operator, admit: () => ({ rejection: 401 as const }) },
      { operator, admit: () => ({ peer: { id: 'foreign' } }) }]) {
      const denied = response()
      await handlePractices(watched, '.agent-team-web', req('GET', '/plugins/agent-team-web/practices'), denied,
        { token: 'secret', trustedHosts: [], connection })
      expect(denied.code).toBe(connection === undefined ? 403 : connection.admit().hasOwnProperty('rejection') ? 401 : 403)
    }
    expect(enumerations).toBe(0)
  })

  it('authenticated operator can soft-disable and restore, stale revisions conflict', async () => {
    root = await mkdtemp(join(tmpdir(), 'practice-http-'))
    const dir = join(root, '.agent-team-web')
    await writeBestPractices(dir, [entry('a'), entry('b')])
    const disable = response()
    const input = { ...mutation('a', 'disable'), workspace: root }
    await handlePractices(registry(root), '.agent-team-web', req('POST', '/plugins/agent-team-web/practices', input), disable, auth)
    expect(disable.code).toBe(200)
    const after = await readBestPractices(dir)
    expect(after.find(item => item.id === 'a')).toMatchObject({ disabledReason: '人工确认原因', revision: 1 })
    expect(after.find(item => item.id === 'a')?.reviewHistory?.at(-1)?.actor).toBe(operator.id)
    expect(selectBestPracticesForRole(after, 'engineer')).toHaveLength(0)
    const stale = response()
    await handlePractices(registry(root), '.agent-team-web', req('POST', '/plugins/agent-team-web/practices', input), stale, auth)
    expect(stale.code).toBe(409)
    const restore = response()
    await handlePractices(registry(root), '.agent-team-web', req('POST', '/plugins/agent-team-web/practices', {
      ...mutation('a', 'restore', { expectedRevision: 1 }), workspace: root,
    }), restore, auth)
    expect(restore.code).toBe(200)
    expect((await readBestPractices(dir)).find(item => item.id === 'a')).toMatchObject({ verdict: 'pending', revision: 2 })
    expect(await readFile(join(dir, 'best-practices.json'), 'utf8')).toContain('reviewHistory')
  })
})
