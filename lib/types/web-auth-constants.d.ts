/**
 * Wire constants shared by the host routes and the browser panel. Both halves
 * must agree on these literals, so they live in one dependency-free module
 * (no `node:*` imports) compiled into each face.
 * @module dsh-agent-team-web/web-auth-constants
 */
/** `globalThis` name the boot token rides into the served HTML (index-inject global row). */
export declare const TOKEN_GLOBAL = "__DSH_AGENT_TEAMS_TOKEN";
/** Header the browser panel echoes with the boot token. */
export declare const TOKEN_HEADER = "x-dsh-agent-teams-token";
/** Exact route path serving live and archived team snapshots. */
export declare const STATE_PATH = "/plugins/agent-team-web/state";
/** Exact route path the panel posts to end & archive a team. */
export declare const CLOSE_PATH = "/plugins/agent-team-web/close";
//# sourceMappingURL=web-auth-constants.d.ts.map