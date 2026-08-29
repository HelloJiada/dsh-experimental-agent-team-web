/**
 * The `agent_teams_*` model-facing tools.
 *
 * The captain (the agent that created the team) orchestrates: members are
 * continuable subagents it spawns and wakes. Members share the same tools and
 * drive their own task state, mirroring the Claude Code AgentTeams flow:
 * create team → add members → create tasks with dependencies → claim/assign →
 * work → report → status → delete.
 * @module dsh-agent-team-web/tools
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type TeamState, type TeamTask } from './types.ts';
/** Resolved plugin config consumed by the tools. */
export interface ToolsConfig {
    /** State directory name under the captain's workspace. */
    stateDir: string;
    /** Member subagent provider name. */
    memberProvider: string;
    /** Optional member model override. */
    memberModel?: string;
    /** Member delegation depth cap. */
    memberMaxDepth?: number;
    /** Team size cap in members, including captain and commissar. */
    maxMembers: number;
    /** Per executing-role member cap (default `1`): each executing role
     * (the 7 preset behavioral roles, the task-level reviewer, and any custom
     * role string) may have up to this many active members; captain/commissar
     * exempt. `maxExecPerRoleByRole` overrides per canonical role key. */
    maxExecPerRole?: number;
    /** Per-role cap overrides keyed by canonical role (e.g. `{ engineer: 2 }`). */
    maxExecPerRoleByRole?: Record<string, number>;
    /** Per-role default LLM selection for members (auto-assign model + effort),
     * overriding the built-in DEFAULT_ROLE_LLM table. */
    roleLlmDefaults?: Record<string, {
        provider?: string;
        model?: string;
        reasoningEffort?: string;
    }>;
    /** Provider 授权判定(t6 接线,settings scope 闭包):deepseek-official 恒
     * 授权,其余 provider 看设置页开关;undefined(无 settings 服务)→ 仅
     * deepseek-official 授权。 */
    providerGrantedFor?: (provider: string) => boolean;
    /** A member-owned open task is "stalled" (helppable) after this many ms. */
    stallThresholdMs: number;
}
/** One open (claimed/in-progress) work item for a member — either owned or
 * being helped by them (self-organizing dispatch). Keeps the one-worker rule
 * across both roles. */
export declare function memberOpenTask(team: TeamState, memberName: string, exceptTaskId?: string): TeamTask | undefined;
/**
 * Deliver a durable member report at the captain's nearest model boundary.
 *
 * `Agent.steer()` targets the next step while the captain is running, wakes a
 * new turn when it is idle, and lets the Agent runtime reclassify an aborted
 * activity to `next-turn`. This prevents reports from waiting behind the
 * captain's entire orchestration turn.
 */
export declare function steerCaptainReport(captain: Pick<Agent, 'steer'>, from: string, content: string): boolean;
/**
 * Register every `agent_teams_*` tool into the shared tools registry.
 * @param ctx - the plugin context (injects `tools`).
 * @param config - resolved tool config.
 */
export declare function registerAgentTeamsTools(ctx: Context, config: ToolsConfig): void;
//# sourceMappingURL=tools.d.ts.map