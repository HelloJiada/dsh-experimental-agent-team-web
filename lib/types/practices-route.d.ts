/** Explicit-workspace best-practice governance API. The boot token is the local
 * browser operator capability; a workspace path must match a registered root.
 * No source-task body or evidence excerpts are returned over this API. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace';
import { type BestPracticeEntry, type BestPracticeCounterexample } from './best-practices.ts';
export interface PracticesRouteAuth {
    readonly token: string;
    readonly trustedHosts: readonly string[];
}
export interface PracticePatch {
    readonly practice?: string;
    readonly appliesWhen?: readonly string[];
    readonly counterexamples?: readonly BestPracticeCounterexample[];
    readonly expiresAt?: number | null;
}
export interface PracticeMutation {
    readonly workspace: string;
    readonly id: string;
    readonly expectedRevision: number;
    readonly action: 'edit' | 'disable' | 'restore';
    readonly patch?: PracticePatch;
    readonly reason?: string;
}
export declare function parsePracticeMutation(input: unknown): PracticeMutation;
/** Restricted projection: do not expose arbitrary evidence excerpts or task output. */
export declare function practiceView(entry: BestPracticeEntry): Record<string, unknown>;
/** Pure transition used under the best-practices lock; changing guidance requires re-review. */
export declare function applyPracticeMutation(entry: BestPracticeEntry, mutation: PracticeMutation, now: number): BestPracticeEntry;
export declare function handlePractices(registry: WorkspaceRegistry, stateDir: string, req: IncomingMessage, res: ServerResponse, auth: PracticesRouteAuth): Promise<void>;
//# sourceMappingURL=practices-route.d.ts.map