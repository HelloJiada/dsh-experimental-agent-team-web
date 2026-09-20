/** Version-tolerant navigation into durable AgentTeams member transcripts. */
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client';
/** Current DSH navigation is owned by the workspace UI, not `ctx.sessions`. */
export interface AgentTeamsSessionNavigator {
    readonly sessions: Pick<ISessions, 'refreshSubagents' | 'subagentAddress'>;
    readonly openSession: UiWorkspace['openSession'];
}
/**
 * Open one member's persisted transcript.
 *
 * Cold subagents are intentionally absent from the ordinary session catalog.
 * Rediscover the direct-child address first, then let the workspace UI retain
 * and select that address. This preserves its lifecycle and selection ownership.
 */
export declare function openAgentTeamMember(navigator: AgentTeamsSessionNavigator, parentSessionId: SessionId, childSessionId: SessionId): Promise<'subagent'>;
//# sourceMappingURL=session-navigation.d.ts.map