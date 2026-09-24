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
import { type MemberSelectionRuntime } from './members.ts';
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
    /** Legacy per-role model routing; retained only for migration diagnostics. */
    roleLlmDefaults?: Record<string, {
        provider?: string;
        model?: string;
        reasoningEffort?: string;
    }>;
    /** 模型授权判定(t13,settings scope 闭包):`${provider}/${model}` 复合 key,
     * deepseek-official 名下恒授权;undefined(无 settings 服务)→ 仅 deepseek
     * 授权。 */
    modelGrantedFor?: (provider: string, model: string) => boolean;
    /** Legacy role-route settings retained for display/migration only. */
    roleDefaultsFor?: (roleKey: string) => {
        provider?: string;
        model?: string;
        reasoningEffort?: string;
    } | undefined;
    modelCapabilitiesFor?: (provider: string, model: string) => {
        enabled: boolean;
        maxReasoningEffort?: string;
        legacy?: true;
    } | undefined;
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
export declare function steerCaptainReport(captain: Pick<Agent, 'steer' | 'id'>, from: string, content: string): boolean;
/** Process-wide AgentTeams runtime handles shared by every tool body. */
export interface AgentTeamsRuntime {
    /**
     * Service-access context for every tool body: the plugin ROOT context.
     *
     * Tool *registration* is per captain session (`agent.ctx`, see
     * {@link registerAgentTeamsTools}), but the injected services this plugin
     * declares (`tools`, `llm`, `subagents`, `systemPrompt`, `agents`) resolve
     * only on the plugin root's fiber: reading `subagents` from a session scope
     * throws `cannot get property "subagents" without inject` (observed on DSH
     * 0.1.5-rc.2 with the row's own `inject: [sessionProjections]`, which the
     * loader MERGES into — never replaces — the plugin's static `inject`). Tool
     * bodies therefore take services from this context while the schemas still
     * ride the session scope, so the token split is unchanged.
     */
    readonly serviceCtx: Context;
    /** Member model/effort selection runtime (see members.ts). */
    readonly memberSelections: MemberSelectionRuntime;
    /** Fire-and-forget team dispatch (never blocks a tool result). */
    readonly kickTeamAsync: (workspace: string, teamId: string, captain?: Agent) => void;
    /** Fire-and-forget member dispatch. */
    readonly kickMemberAsync: (workspace: string, teamId: string, memberName: string, captain?: Agent) => void;
}
/**
 * Install the process-wide AgentTeams runtime: the retired-member guard, the
 * member selection runtime, the member state-dir guard and the team
 * scheduler.
 *
 * These are runtime hooks with no model-visible cost, so a profile installs
 * them exactly once when the plugin mounts — deliberately NOT per activation:
 * the scheduler and the guards must outlive any single captain session, and a
 * second installation would double-wrap the subagent `followup` patch and
 * start a second scheduler.
 *
 * @param ctx - the installing context; pass the plugin root, not a session scope.
 * @param config - resolved tool config (state dir + stall threshold).
 * @returns the handles every tool body shares.
 */
export declare function installAgentTeamsRuntime(ctx: Context, config: ToolsConfig): AgentTeamsRuntime;
/**
 * Register every `agent_teams_*` tool into the given context's tool layer.
 *
 * The 14 schemas are the token-expensive half of this plugin (measured at
 * ~12.4k characters, about 3.1k tokens on every request that carries them),
 * so production activation calls this with the CALLING AGENT'S context
 * (`agent.ctx`): an agent-scoped registration shadows nothing globally,
 * unwinds when that agent is disposed, and is inherited by the agent's child
 * scopes — where the team members live, so members keep their team tools
 * (`packages/core/tools/tests/scoped.spec.ts` pins ancestor-scope
 * inheritance: "no model-facing row in the global layer, all of them
 * contributed by an ancestor scope the child joined").
 *
 * Passing the plugin root registers globally instead — the shape a profile
 * that wants the surface in every session uses, and what the tool-level
 * tests exercise.
 *
 * REGISTRATION vs SERVICE ACCESS — two different contexts on purpose:
 * `scopeCtx` only ever receives `tools.register` (that is what makes the
 * per-session token split work), while every service read inside the bodies
 * goes through {@link AgentTeamsRuntime.serviceCtx} (the plugin root). Using
 * `scopeCtx` for services breaks the surface: a session scope does not
 * resolve this plugin's injected `subagents`/`agents`, so the first member
 * spawn would throw `cannot get property "subagents" without inject`.
 *
 * @param scopeCtx - the context whose tool layer receives the schemas.
 * @param config - resolved tool config.
 * @param runtime - process-wide runtime from {@link installAgentTeamsRuntime};
 *   omitted, this call installs (and owns) its own — then the installing
 *   context doubles as the service context.
 */
export declare function registerAgentTeamsTools(scopeCtx: Context, config: ToolsConfig, runtime?: AgentTeamsRuntime): void;
//# sourceMappingURL=tools.d.ts.map