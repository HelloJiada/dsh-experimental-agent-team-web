/**
 * POST /plugins/agent-team-web/close — the activity panel's "end & archive
 * team" endpoint.
 *
 * The browser floater has no client→host command bridge (no WebSocket, no RPC
 * channel), so closing a finished team goes through the same HTTP surface as
 * the state/assets routes. The endpoint is the host-side authority for the
 * panel button's disabled state (defense in depth): it re-checks that the
 * requester owns the team and that every task is completed before archiving.
 *
 * Close semantics match `agent_teams_delete` exactly — archive, not delete:
 * the team directory moves under `<stateRoot>/archive/<teamId>/` so tasks,
 * the dependency graph and mailboxes stay reviewable in the "Ended · Archived
 * history" section. Unlike the LLM tool it does not wait for member
 * quiescence, keeping the HTTP response fast.
 * @module dsh-agent-team-web/close-route
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { appendTeamEvent } from './events.ts'
import { interruptMember } from './members.ts'
import {
  archiveTeamDir,
  clearMemberHelperMarks,
  invalidateTaskAttempt,
  readTeam,
  recordRetiredMemberIds,
  withTeamLock,
  writeTeam,
} from './state.ts'
import type { ToolsConfig } from './tools.ts'
import type { TeamMember, TeamState } from './types.ts'
import { sendUnauthorized, webRequestAuthorized } from './web-auth.ts'

/** Hard cap for the close request body (16 KiB) — the payload is two ids. */
export const CLOSE_BODY_CAP_BYTES = 16 * 1024

/**
 * Route auth for the close endpoint: the boot capability token plus the Host
 * fence. R-17/H-1: the captainSessionId body check is no longer the write
 * credential — a caller must also present the per-boot token that was injected
 * into the served HTML, so a leaked /state response cannot derive close
 * authority. Defense in depth over the index.ts route-level check.
 */
export interface CloseRouteAuth {
  /** Per-boot capability token (see web-auth.ts `createWebToken`). */
  readonly token: string
  /** Non-loopback authorities allowed to close (default loopback-only). */
  readonly trustedHosts?: readonly string[]
}

/** Whether a close request passes the token + Host fence. */
export function closeRequestAuthorized(req: IncomingMessage, auth: CloseRouteAuth): boolean {
  return webRequestAuthorized(req, auth.token, auth.trustedHosts ?? [])
}

/**
 * The process-local team lock key, shaped exactly like the tools'
 * `teamLockKey` (src/tools.ts) so the close route and the `agent_teams_*`
 * tools serialize on the same lock and can never race each other.
 */
function teamLockKey(stateRoot: string, teamId: string): string {
  return `team:${stateRoot}:${teamId}`
}

/**
 * Collect and JSON-parse a request body under a hard size cap. A stream error,
 * oversize body or invalid JSON all reject; the caller maps them to 400/413.
 * @param req - the incoming request (consumed as an async iterable).
 * @param cap - maximum accepted byte count.
 * @returns the parsed JSON value (an empty object for an empty body).
 */
export async function readJsonBody(req: IncomingMessage, cap = CLOSE_BODY_CAP_BYTES): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    total += buffer.length
    if (total > cap) {
      throw new Error(`request body exceeds ${cap} bytes`)
    }
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw === '' ? {} : (JSON.parse(raw) as unknown)
}

/** The close request payload: the team id plus its owning captain session id. */
export interface CloseTeamRequest {
  readonly teamId: string
  readonly captainSessionId: string
}

/** A live team located under exactly one registered workspace state root. */
interface LocatedTeam {
  readonly stateRoot: string
  readonly team: TeamState
}

/**
 * Find the team under the registered workspace roots. `undefined` means the
 * team does not exist anywhere (or is already archived — archived teams live
 * under `archive/` and are not read here). A team id present under more than
 * one root is ambiguous and rejects.
 */
async function locateTeam(
  roots: readonly { stateRoot: string }[],
  teamId: string,
): Promise<LocatedTeam | undefined> {
  let found: LocatedTeam | undefined
  for (const root of roots) {
    const team = await readTeam(root.stateRoot, teamId)
    if (team === undefined) continue
    if (found !== undefined) {
      throw new Error(`team id "${teamId}" exists under multiple workspaces — ambiguous close target`)
    }
    found = { stateRoot: root.stateRoot, team }
  }
  return found
}

/** A team is closeable when it has no tasks, or every task is completed. */
export function isTeamCloseable(team: TeamState): boolean {
  return team.tasks.length === 0 || team.tasks.every((task) => task.status === 'completed')
}

/**
 * The locked half of closing a team: re-read fresh state under the team lock,
 * mark every member `removed`, invalidate unfinished member-owned tasks, and
 * persist. Returns the pre-mutation roster so the caller can retire and
 * interrupt the member subagents. Mirrors `agent_teams_delete`'s in-lock
 * mutation, including including already-removed members in the roster so the
 * durable retired-member index stays complete.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id (the caller already verified it exists).
 * @returns the roster (member records before this close).
 */
export async function prepareTeamForArchive(stateRoot: string, teamId: string): Promise<TeamMember[]> {
  return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
    const fresh = await readTeam(stateRoot, teamId)
    if (fresh === undefined) {
      throw new Error(`team "${teamId}" disappeared during close`)
    }
    const roster = fresh.members.map(member => ({ ...member }))
    for (const member of fresh.members) {
      if (member.status === 'removed') continue
      member.status = 'removed'
      for (const task of fresh.tasks) {
        if (task.assignee === member.name && task.status !== 'completed') invalidateTaskAttempt(task)
      }
      // R-06:摘除该成员在其他任务上的 helper 引用(与 remove_member/delete 一致)。
      clearMemberHelperMarks(fresh.tasks, member.name)
    }
    await writeTeam(stateRoot, fresh)
    return roster
  })
}

/** Write a JSON error/ack response. */
function sendJson(
  res: ServerResponse,
  status: number,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(JSON.stringify(payload))
}

/**
 * Handle one close request. Full security chain:
 * POST-only (405) → bounded JSON body (400) → required ids (400) → team under
 * a registered workspace state root (404 / 400 on ambiguity) → requester owns
 * the team (403) → all tasks completed (409) → team-lock serialized archive
 * with member retirement + best-effort interrupt → `team-deleted` event →
 * `archiveTeamDir` → 200.
 * @param ctx - the plugin context (for agents/logging and event emission).
 * @param config - resolved tool config (state directory name).
 * @param workspaceRegistry - registered workspaces; roots mirror the state route.
 * @param req - the incoming HTTP request.
 * @param res - the HTTP response.
 * @param auth - the route capability token + trusted hosts; the request must
 *   pass the Host fence and present the boot token before any body is read.
 */
export async function handleCloseTeam(
  ctx: Context,
  config: ToolsConfig,
  workspaceRegistry: WorkspaceRegistry,
  req: IncomingMessage,
  res: ServerResponse,
  auth?: CloseRouteAuth,
): Promise<void> {
  // R-17/H-1: token + Host fence first. When the route passes no auth (tests,
  // legacy callers), the endpoint is refused outright — the write surface must
  // never run unauthenticated.
  if (auth === undefined || !closeRequestAuthorized(req, auth)) {
    sendUnauthorized(res)
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, reason: 'method not allowed' }, { allow: 'POST' })
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch {
    sendJson(res, 400, { ok: false, reason: 'invalid json body' })
    return
  }
  const request = body as Partial<CloseTeamRequest> | null | undefined
  const teamId = request?.teamId
  const captainSessionId = request?.captainSessionId
  if (typeof teamId !== 'string' || teamId === '' || typeof captainSessionId !== 'string' || captainSessionId === '') {
    sendJson(res, 400, { ok: false, reason: 'teamId and captainSessionId required' })
    return
  }

  const roots = workspaceRegistry.list().map((workspace) => ({
    stateRoot: join(workspace.path, config.stateDir),
    workspace: workspace.title,
  }))
  let located: LocatedTeam | undefined
  try {
    located = await locateTeam(roots, teamId)
  } catch {
    sendJson(res, 400, { ok: false, reason: 'team id is ambiguous across workspaces' })
    return
  }
  if (located === undefined) {
    sendJson(res, 404, { ok: false, reason: 'team not found or already archived' })
    return
  }
  if (located.team.captainSessionId !== captainSessionId) {
    sendJson(res, 403, { ok: false, reason: 'session does not own this team' })
    return
  }
  if (!isTeamCloseable(located.team)) {
    sendJson(res, 409, { ok: false, reason: 'tasks still in progress' })
    return
  }

  const stateRoot = located.stateRoot
  // Best-effort interrupt needs the live captain agent (the members' parent);
  // when the captain session is offline, skip interrupts and the event below.
  const liveCaptain = ctx.agents.get(captainSessionId as SessionId)
  const roster = await prepareTeamForArchive(stateRoot, teamId)
  await recordRetiredMemberIds(stateRoot, roster.map(member => member.id))
  if (liveCaptain !== undefined) {
    for (const member of roster) {
      if (member.id === '') continue
      interruptMember(ctx, liveCaptain, member.id)
    }
  }

  // Archive inside the same team lock the tools use, and reuse the
  // `team-deleted` event (semantics: close the team record) when the captain
  // session is live to record into. Mirrors agent_teams_delete's second lock.
  await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
    const fresh = await readTeam(stateRoot, teamId)
    if (fresh !== undefined && liveCaptain !== undefined) {
      appendTeamEvent(ctx, liveCaptain.session, 'agent-team-web/team-deleted', { teamId: fresh.id })
    }
    await archiveTeamDir(stateRoot, teamId)
  })

  sendJson(res, 200, { ok: true, team_id: teamId, archived: true })
}
