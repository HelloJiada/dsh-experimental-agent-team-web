/** Version-tolerant navigation into durable AgentTeams member transcripts. */
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client';
/** Current DSH navigation is owned by the workspace UI, not `ctx.sessions`. */
export interface AgentTeamsSessionNavigator {
    readonly sessions: Pick<ISessions, 'subagentAddress'>;
    readonly openSession: UiWorkspace['openSession'];
}
/**
 * Open one member's persisted transcript.
 *
 * The workspace UI resolves and retains direct-child addresses as it opens
 * them, preserving its lifecycle and selection ownership.
 */
export declare function openAgentTeamMember(navigator: AgentTeamsSessionNavigator, parentSessionId: SessionId, childSessionId: SessionId): Promise<'subagent'>;
//# sourceMappingURL=session-navigation.d.ts.map