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
import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace';
import type { ToolsConfig } from './tools.ts';
import type { TeamMember, TeamState } from './types.ts';
/** Hard cap for the close request body (16 KiB) — the payload is two ids. */
export declare const CLOSE_BODY_CAP_BYTES: number;
/**
 * Collect and JSON-parse a request body under a hard size cap. A stream error,
 * oversize body or invalid JSON all reject; the caller maps them to 400/413.
 * @param req - the incoming request (consumed as an async iterable).
 * @param cap - maximum accepted byte count.
 * @returns the parsed JSON value (an empty object for an empty body).
 */
export declare function readJsonBody(req: IncomingMessage, cap?: number): Promise<unknown>;
/** The close request payload: the team id plus its owning captain session id. */
export interface CloseTeamRequest {
    readonly teamId: string;
    readonly captainSessionId: string;
}
/** A team is closeable when it has no tasks, or every task is completed. */
export declare function isTeamCloseable(team: TeamState): boolean;
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
export declare function prepareTeamForArchive(stateRoot: string, teamId: string): Promise<TeamMember[]>;
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
 */
export declare function handleCloseTeam(ctx: Context, config: ToolsConfig, workspaceRegistry: WorkspaceRegistry, req: IncomingMessage, res: ServerResponse): Promise<void>;
//# sourceMappingURL=close-route.d.ts.map