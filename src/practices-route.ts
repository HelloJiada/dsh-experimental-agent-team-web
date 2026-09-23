/** Explicit-workspace best-practice governance API. The boot token is the local
 * browser operator capability; a workspace path must match a registered root.
 * No source-task body or evidence excerpts are returned over this API. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, join, resolve } from 'node:path'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import {
  readBestPractices,
  type BestPracticeEntry, type BestPracticeCounterexample,
} from './best-practices.ts'
import { webRequestAuthorized } from './web-auth.ts'

export interface PracticesRouteAuth { readonly token: string; readonly trustedHosts: readonly string[] }
export interface PracticePatch {
  readonly practice?: string
  readonly appliesWhen?: readonly string[]
  readonly counterexamples?: readonly BestPracticeCounterexample[]
  readonly expiresAt?: number | null
}
export interface PracticeMutation {
  readonly workspace: string
  readonly id: string
  readonly expectedRevision: number
  readonly action: 'edit' | 'disable' | 'restore'
  readonly patch?: PracticePatch
  readonly reason?: string
}

class PracticeError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const validText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max
const validConditions = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 20 && value.every(item => validText(item, 200))
const validCounterexamples = (value: unknown): value is BestPracticeCounterexample[] =>
  Array.isArray(value) && value.length <= 20 && value.every(item => isObject(item)
    && Object.keys(item).every(key => key === 'context' || key === 'reason')
    && validText(item.context, 200) && validText(item.reason, 500))
const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const patchKeys = new Set(['practice', 'appliesWhen', 'counterexamples', 'expiresAt'])

export function parsePracticeMutation(input: unknown): PracticeMutation {
  if (!isObject(input) || Object.keys(input).some(key => !['workspace', 'id', 'expectedRevision', 'action', 'patch', 'reason'].includes(key))
    || !validText(input.workspace, 4096) || !isAbsolute(input.workspace)
    || !validText(input.id, 128) || !isTimestamp(input.expectedRevision)
    || !['edit', 'disable', 'restore'].includes(String(input.action))) throw new PracticeError(400, 'invalid practice mutation')
  const action = input.action as PracticeMutation['action']
  if (action === 'edit') {
    if (!isObject(input.patch) || Object.keys(input.patch).length === 0
      || Object.keys(input.patch).some(key => !patchKeys.has(key))) throw new PracticeError(400, 'invalid practice patch')
    const patch = input.patch
    if ((patch.practice !== undefined && !validText(patch.practice, 4000))
      || (patch.appliesWhen !== undefined && !validConditions(patch.appliesWhen))
      || (patch.counterexamples !== undefined && !validCounterexamples(patch.counterexamples))
      || (patch.expiresAt !== undefined && patch.expiresAt !== null && !isTimestamp(patch.expiresAt))) {
      throw new PracticeError(400, 'invalid practice patch fields')
    }
  } else if (input.patch !== undefined) throw new PracticeError(400, 'patch only allowed for edit')
  if (!validText(input.reason, 500)) throw new PracticeError(400, 'reason required')
  return input as unknown as PracticeMutation
}

/** Restricted projection: do not expose arbitrary evidence excerpts or task output. */
export function practiceView(entry: BestPracticeEntry): Record<string, unknown> {
  return {
    id: entry.id, sourceTeamId: entry.sourceTeamId, sourceTaskId: entry.sourceTaskId,
    sourceTaskSubject: entry.sourceTaskSubject, role: entry.role, practice: entry.practice,
    verdict: entry.verdict, appliesWhen: entry.appliesWhen ?? [],
    counterexamples: entry.counterexamples ?? [], expiresAt: entry.expiresAt ?? null,
    disabledAt: entry.disabledAt ?? null, disabledReason: entry.disabledReason ?? null,
    revision: entry.revision ?? 0, reviewHistory: entry.reviewHistory ?? [],
  }
}

/** Pure transition used under the best-practices lock; changing guidance requires re-review. */
export function applyPracticeMutation(entry: BestPracticeEntry, mutation: PracticeMutation, now: number): BestPracticeEntry {
  if ((entry.revision ?? 0) !== mutation.expectedRevision) throw new PracticeError(409, 'revision conflict')
  const history = [...entry.reviewHistory ?? []]
  const changed: Record<string, unknown> = {}
  if (mutation.action === 'edit') {
    const patch = mutation.patch!
    if (patch.practice !== undefined) changed.practice = patch.practice.trim()
    if (patch.appliesWhen !== undefined) changed.appliesWhen = patch.appliesWhen
    if (patch.counterexamples !== undefined) changed.counterexamples = patch.counterexamples
    if (patch.expiresAt !== undefined) changed.expiresAt = patch.expiresAt === null ? undefined : patch.expiresAt
    if (Object.keys(changed).some(key => key !== 'expiresAt')) changed.verdict = 'pending'
  } else if (mutation.action === 'disable') {
    if (entry.disabledAt !== undefined) throw new PracticeError(409, 'already disabled')
    changed.disabledAt = now
    changed.disabledReason = mutation.reason
  } else {
    if (entry.disabledAt === undefined) throw new PracticeError(409, 'not disabled')
    changed.disabledAt = undefined
    changed.disabledReason = undefined
    // A restored item must be explicitly reviewed again before any injection.
    changed.verdict = 'pending'
  }
  return {
    ...entry, ...changed, revision: (entry.revision ?? 0) + 1, updatedAt: now,
    reviewHistory: [...history, { actor: 'local-browser-operator', action: mutation.action, at: now, summary: mutation.reason }],
  }
}

function send(res: ServerResponse, status: number, value: object): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

export async function handlePractices(
  registry: WorkspaceRegistry, stateDir: string,
  req: IncomingMessage, res: ServerResponse, auth: PracticesRouteAuth,
): Promise<void> {
  if (!webRequestAuthorized(req, auth.token, auth.trustedHosts)) {
    send(res, 403, { error: 'unauthorized' }); return
  }
  const workspaces = registry.list().map(row => ({ path: resolve(row.path), title: row.title }))
  const locate = (path: string): string | undefined => workspaces.find(row => row.path === path)?.path
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const requested = url.searchParams.get('workspace')
      if (requested === null) { send(res, 200, { workspaces }); return }
      const workspace = locate(requested)
      if (workspace === undefined) throw new PracticeError(403, 'unregistered workspace')
      const entries = await readBestPractices(join(workspace, stateDir))
      send(res, 200, { workspace, entries: entries.map(practiceView) }); return
    }
    if (req.method !== 'POST') throw new PracticeError(405, 'method not allowed')
    // The boot token grants access to this local page, NOT a verified user,
    // captain, or workspace principal. Until the host exposes an unforgeable
    // identity bridge, the sensitive write surface must fail closed even for
    // a valid token and registered workspace. Do not add a config bypass.
    throw new PracticeError(403, 'workspace identity authorization unavailable')
  } catch (error) {
    const status = error instanceof PracticeError ? error.status : 500
    send(res, status, { error: status === 500 ? 'practice operation failed' : (error as Error).message })
  }
}
