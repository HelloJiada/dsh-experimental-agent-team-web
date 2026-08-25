import type { AgentTeamMilestoneWindowView, AgentTeamTimelineEntryView } from './contract.js';
export interface AgentTeamMilestoneWindowOptions {
    /**
     * Window partitioning strategy.
     * - `count` (default): consecutive windows of `windowSize` coalesced rows.
     * - `time`: wall-clock buckets of `windowMs` width, keyed off entry `time`.
     */
    readonly mode?: 'count' | 'time';
    /** Rows per window in `count` mode. Default 8. */
    readonly windowSize?: number;
    /** Bucket width in milliseconds for `time` mode. Default 1 hour. */
    readonly windowMs?: number;
}
/**
 * Groups the timeline into rolling windows and returns them most-recent-first.
 * Each window carries its event distribution (member/task/message), seq range,
 * row/event counts, and a headline derived from the most significant entry
 * (danger > warn > good > neutral; ties pick the latest). This is the
 * roadmap's "rolling-window milestone summary": Captain sees what happened per
 * window without reading every row.
 *
 * This module is deliberately free of runtime dependencies (types only), so
 * both the host projection and the client dashboard can share it without
 * pulling zod or the projection stack into the browser bundle.
 */
export declare function timelineMilestonesView(timeline: readonly AgentTeamTimelineEntryView[], options?: AgentTeamMilestoneWindowOptions): AgentTeamMilestoneWindowView[];
//# sourceMappingURL=timeline-milestones.d.ts.map