import { z } from 'zod';
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
import type { TeamMemberSnapshot, TeamMessageSnapshot, TeamTaskSnapshot } from './agent-team-types.js';
import type { AgentTeamView } from './contract.js';
export interface AgentTeamProjectionState {
    readonly teamId: SessionId | null;
    readonly hasTeamEvents: boolean;
    readonly members: Record<string, TeamMemberSnapshot>;
    readonly tasks: Record<string, TeamTaskSnapshot>;
    readonly messages: Record<string, TeamMessageSnapshot>;
    readonly delivered: Record<string, true>;
}
export declare function initAgentTeamProjection(): AgentTeamProjectionState;
export declare function applyAgentTeamEvent(state: AgentTeamProjectionState, event: SessionEvent): AgentTeamProjectionState;
export declare function viewAgentTeam(state: AgentTeamProjectionState): AgentTeamView | null;
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionStateMap {
        agentTeam: AgentTeamProjectionState;
    }
}
export declare const agentTeamProjectionDefinition: {
    key: "agentTeam";
    stateSchema: z.ZodType<AgentTeamProjectionState, unknown, z.core.$ZodTypeInternals<AgentTeamProjectionState, unknown>>;
    init: typeof initAgentTeamProjection;
    apply: typeof applyAgentTeamEvent;
    wire: {
        viewSchema: z.ZodType<AgentTeamView | null, unknown, z.core.$ZodTypeInternals<AgentTeamView | null, unknown>>;
        view: typeof viewAgentTeam;
    };
    stateVersion: number;
};
//# sourceMappingURL=projection.d.ts.map