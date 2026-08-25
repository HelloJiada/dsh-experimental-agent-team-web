import type { AgentTeamDagView, AgentTeamTaskView } from './contract.js';
/**
 * Computes a layered task-dependency DAG from committed task facts.
 *
 * - `level` is the topological column (longest path from dependency sources);
 *   tasks with no resolvable dependencies sit at level 0.
 * - Cycles (an anomaly in practice) are pushed to their own trailing column so
 *   the renderer still gets a deterministic layout.
 * - Node tone is derived from status + dependency state, mirroring the
 *   snapshot-timeline tones; owner display names are resolved from the member
 *   map provided by the projection.
 *
 * This module is deliberately free of runtime dependencies (types only) so
 * both the host projection and the client dashboard can share it without
 * pulling zod or the projection stack into the browser bundle.
 */
export declare function dependencyDagView(tasks: readonly AgentTeamTaskView[], memberNames: ReadonlyMap<string, string>): AgentTeamDagView;
//# sourceMappingURL=dependency-dag.d.ts.map