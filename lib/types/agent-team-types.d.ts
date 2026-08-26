/** Vendored Agent Teams durable record types and session event map merge. */
import type { Branded } from '@deepseek-ai/dsh-brand';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { SessionId } from '@deepseek-ai/dsh-session';
/** Identifies one upstream Team entity. */
export type TeamId = Branded<'TeamId'>;
/** Brand a raw Team id string without changing its runtime representation. */
export declare function TeamId(id: string): TeamId;
/** Stable identifier for one task in a Team. */
export type TeamTaskId = Branded<'TeamTaskId'>;
/** Stable identifier for one durable peer message. */
export type TeamMessageId = Branded<'TeamMessageId'>;
/** Durable teammate lifecycle. */
export type TeamMemberPhase = 'provisioning' | 'active' | 'failed';
/** Durable task lifecycle. */
export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'deleted';
/**
 * Mapping from the upstream `dsh-agent-teams` task status vocabulary to the
 * vendored one used by this bundle's projection. `claimed` is represented as
 * `pending` with an owner; `failed` / `cancelled` are carried through so the
 * dashboard can surface terminal work honestly.
 */
export declare const UPSTREAM_TASK_STATUS: Record<string, TeamTaskStatus>;
/** Whole durable value written on every teammate lifecycle change. */
export interface TeamMemberSnapshot {
    readonly id: SessionId;
    readonly name: string;
    readonly description: string;
    readonly provider: string;
    readonly context: 'fresh' | 'fork';
    readonly phase: TeamMemberPhase;
    readonly error?: string;
}
/** Whole durable task snapshot; every mutation increments revision. */
export interface TeamTaskSnapshot {
    readonly id: TeamTaskId;
    readonly revision: number;
    readonly subject: string;
    readonly description: string;
    readonly status: TeamTaskStatus;
    readonly ownerId?: SessionId;
    readonly blockedBy: TeamTaskId[];
    readonly writeScopes: string[];
}
/** One peer message retained until its target Session records it. */
export interface TeamMessageSnapshot {
    readonly id: TeamMessageId;
    readonly senderId: SessionId;
    readonly senderName: string;
    readonly targetId: SessionId;
    readonly delivery: 'quiet' | 'wakeup';
    readonly content: ContentBlock[];
}
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /** Whole teammate lifecycle value, stored only in the Team Lead Session. */
        'team/member': {
            version: 1;
            teamId: TeamId;
            member: TeamMemberSnapshot;
        };
        /** Whole shared-task value, stored only in the Team Lead Session. */
        'team/task': {
            version: 1;
            teamId: TeamId;
            task: TeamTaskSnapshot;
        };
        /** Durable mailbox enqueue, stored before delivery is attempted. */
        'team/message/queued': {
            version: 1;
            teamId: TeamId;
            message: TeamMessageSnapshot;
        };
        /** Durable acknowledgement that the target Session recorded the message. */
        'team/message/delivered': {
            version: 1;
            teamId: TeamId;
            messageId: TeamMessageId;
            targetId: SessionId;
        };
    }
}
//# sourceMappingURL=agent-team-types.d.ts.map