/**
 * R-18/H-2: member state-dir isolation at the tool dispatch boundary.
 *
 * `toolFilter` can only deny tools by *name*, not by *path* — so a member's
 * read/edit/write/bash tools are not restricted by the subagent filter alone.
 * This module installs a `tools/execute` wrapper that inspects the target
 * path of file-touching tools invoked **by a member agent** and denies any
 * call that resolves inside the team state directory (`<workspace>/<stateDir>`).
 *
 * The guard is defense-in-depth over the persona instruction: it cannot parse
 * free-form `bash` command strings reliably, so bash is checked heuristically
 * for stateRoot references; structured tools (read/write/edit/glob/grep) get
 * an exact resolved-path deny. A member that needs team state is directed to
 * `agent_teams_status`, which is the sanctioned read path.
 * @module dsh-agent-team-web/member-state-guard
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * Whether a resolved candidate path is inside the state root. Both sides are
 * resolved absolute paths; a prefix match is refused (a state dir sibling
 * like `.agent-team-web-2` must not match `.agent-team-web`).
 */
export declare function isUnderStateRoot(candidate: string, stateRoot: string): boolean;
/** The state root for one member workspace. */
export declare function stateRootOf(workspace: string, stateDir: string): string;
/**
 * One dispatch-time denial decision for a member-invoked tool.
 * @param toolName - the invoked tool name.
 * @param args - the parsed tool arguments (already deep-frozen by the registry).
 * @param workspace - the calling member's workspace root.
 * @param stateDir - the configured state directory name.
 * @returns a denial message when the call targets the state directory, else undefined.
 */
export declare function memberStateDenial(toolName: string, args: Record<string, unknown>, workspace: string, stateDir: string): string | undefined;
/** Register one member agent id (called on spawn and on cold resume). */
export declare function registerMemberAgent(id: string): void;
/** Unregister a member agent id (called on remove/delete). */
export declare function unregisterMemberAgent(id: string): void;
/** Whether a session id is a live team member the guard protects. */
export declare function isMemberAgent(id: string): boolean;
/**
 * Install the dispatch-time state-dir guard for member agents.
 * @param ctx - the plugin context (injects `tools`).
 * @param stateDir - the configured state directory name.
 * @returns a disposer removing the wrapper.
 */
export declare function installMemberStateGuard(ctx: Context, stateDir: string): () => void;
//# sourceMappingURL=member-state-guard.d.ts.map