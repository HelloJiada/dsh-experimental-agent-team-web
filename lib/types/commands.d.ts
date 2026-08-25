import type { AgentTeamCommandKind, AgentTeamCommandPlanView, AgentTeamCommandSuggestion, AgentTeamMemberLoadView, AgentTeamMemberView, AgentTeamMessageRiskView, AgentTeamTaskInsightView } from './contract.js';
import type { SessionId } from '@deepseek-ai/dsh-session';
export type { AgentTeamCommandKind, AgentTeamCommandPlanView, AgentTeamCommandSuggestion, } from './contract.js';
/**
 * Single source of truth for the command vocabulary. The union type
 * `AgentTeamCommandKind` lives in `contract.ts`; this runtime list is
 * compile-time checked against it, so host consumers (and the zod schema)
 * always see the exact same set.
 */
export declare const AGENT_TEAM_COMMAND_KINDS: readonly AgentTeamCommandKind[];
/**
 * The slice of the Team view the command bridge derives from. Deliberately
 * narrower than `AgentTeamView` so the projection can build the plan before
 * the full view object (which contains the plan itself) is assembled.
 */
export interface AgentTeamCommandPlanSource {
    readonly teamId: SessionId;
    readonly members: AgentTeamMemberView[];
    readonly taskInsights: AgentTeamTaskInsightView[];
    readonly memberLoads: AgentTeamMemberLoadView[];
    readonly messageRisks: AgentTeamMessageRiskView[];
}
/**
 * Wraps the derived command suggestions into a stable, host-consumable plan
 * envelope. The plan is a pure read-only projection of committed Team facts:
 * a runtime tool layer may consume `commands` (each with a concrete targetId)
 * and execute them; this bundle never executes anything itself.
 */
export declare function commandPlanView(view: AgentTeamCommandPlanSource): AgentTeamCommandPlanView;
/**
 * Derives actionable command suggestions from committed Team facts. These are
 * recommendations for a host runtime tool layer: this bundle does not execute
 * them (the Team surface stays read-only), but it exposes the bridge contract
 * and the concrete target ids any executor would need.
 */
export declare function suggestCommands(view: AgentTeamCommandPlanSource): AgentTeamCommandSuggestion[];
//# sourceMappingURL=commands.d.ts.map