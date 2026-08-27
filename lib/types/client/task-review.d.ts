/**
 * Commissar-gate review state helpers for the activity panel.
 *
 * Contract follows design-commissar-gate.md §3/§4/§8: the host snapshot emits
 * `reviewRequired` (derived: under the gate and no `pass` verdict yet) plus the
 * latest `review` record. These helpers also tolerate the raw host fields, so
 * the badge condition is robust to either convention.
 * @module dsh-agent-team-web/client/task-review
 */
import type { ActivityTask } from './activity-monitor.ts';
/** Display state of a task under the commissar gate. */
export type TaskReviewState = 'pending' | 'passed' | 'rejected';
/**
 * Badge condition: the task is under the commissar gate and has no `pass`
 * verdict yet, and is not completed. True for `pending` and `rejected`
 * (rejected tasks are still awaiting a passing review).
 */
export declare function taskReviewPending(task: ActivityTask): boolean;
/**
 * Detail-line state for the gate review line: `null` when the task is not
 * under the gate; `'pending'` awaiting review; `'passed'` after a pass
 * verdict; `'rejected'` after a reject verdict (task stays in progress).
 */
export declare function taskReviewState(task: ActivityTask): TaskReviewState | null;
//# sourceMappingURL=task-review.d.ts.map