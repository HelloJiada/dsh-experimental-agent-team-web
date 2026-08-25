/**
 * Adapter that folds the upstream `dsh-agent-teams` runtime's session events
 * (`agent-teams/*`) into this bundle's vendored projection state.
 *
 * The upstream runtime records durable team mutations on the captain's
 * Session as best-effort events (see upstream `src/events.ts`); this module
 * lets the dashboard consume that real contract in addition to the vendored
 * `team/*` events. Where the upstream payload carries names instead of
 * session ids (`assignee`, `from`, `to`), ids are resolved against the
 * folded member map, with `captain` meaning the owning session.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { SessionEventMap } from '@deepseek-ai/dsh-session/types';
import type { AgentTeamHistoryEntry, AgentTeamProjectionState } from './projection.js';
export type UpstreamAgentTeamEventType = keyof SessionEventMap & `agent-teams/${string}`;
export declare const UPSTREAM_TEAM_EVENT_TYPES: readonly UpstreamAgentTeamEventType[];
export declare function isUpstreamTeamEventType(type: string): boolean;
interface TeamCreatedData {
    readonly teamId: string;
    readonly captainSessionId: string;
    readonly name: string;
    readonly description?: string;
}
interface MemberAddedData {
    readonly teamId: string;
    readonly memberId: string;
    readonly name: string;
    readonly role?: string;
}
interface MemberRemovedData {
    readonly teamId: string;
    readonly memberId: string;
}
interface TaskCreatedData {
    readonly teamId: string;
    readonly taskId: string;
    readonly subject: string;
    readonly dependencies: readonly string[];
    readonly assignee?: string;
}
interface TaskUpdatedData {
    readonly teamId: string;
    readonly taskId: string;
    readonly status: string;
    readonly assignee?: string;
    readonly output?: string;
    readonly attempt?: number;
    readonly attemptId?: string;
}
interface MessageSentData {
    readonly teamId: string;
    readonly messageId: string;
    readonly from: string;
    readonly to: string;
    readonly content: string;
    readonly ts: number;
}
interface TeamDeletedData {
    readonly teamId: string;
}
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /** Opens one team record. */
        'agent-teams/team-created': TeamCreatedData;
        /** Records one team member. */
        'agent-teams/member-added': MemberAddedData;
        /** Records one member removal. */
        'agent-teams/member-removed': MemberRemovedData;
        /** Records one task creation. */
        'agent-teams/task-created': TaskCreatedData;
        /** Records one task transition. */
        'agent-teams/task-updated': TaskUpdatedData;
        /** Records one mailbox message. */
        'agent-teams/message-sent': MessageSentData;
        /** Closes one team record after deletion. */
        'agent-teams/team-deleted': TeamDeletedData;
    }
}
/**
 * Applies one upstream `agent-teams/*` event to the projection state.
 * Returns `null` for unrecognized event types. History bookkeeping is left to
 * the caller (`appendHistory`), matching the vendored-event path.
 */
export declare function applyUpstreamEvent(state: AgentTeamProjectionState, event: SessionEvent): AgentTeamProjectionState | null;
/** Builds a timeline history entry for an upstream event (no state mutation). */
export declare function upstreamHistoryEntryOf(event: SessionEvent): AgentTeamHistoryEntry | null;
export {};
//# sourceMappingURL=upstream.d.ts.map