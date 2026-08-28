/**
 * Task intermediate-state helpers for the activity panel (改进 4).
 *
 * The host snapshot passes through two explicit intermediate flags per task:
 * - `blockedByReview` — the task's completion was intercepted by the
 *   commissar gate and it is now waiting for a `pass` verdict (stronger than
 *   the derived `reviewRequired`, which only says the gate *applies*).
 * - `awaitingInput` — the task is waiting for input from the captain/members
 *   (set at creation when the description carries pending questions).
 * These helpers are pure and tolerate the raw host fields.
 * @module dsh-agent-team-web/client/task-intermediate
 */

import type { ActivityTask } from './activity-monitor.ts'

/**
 * 中间态「待复核」:任务完成被政委门禁拦截,等待 pass 复核。
 * 终结状态(completed/failed/cancelled)恒为 false,兜底脏数据。
 */
export function taskBlockedByReview(task: ActivityTask): boolean {
  return task.status !== 'completed'
    && task.status !== 'failed'
    && task.status !== 'cancelled'
    && task.blockedByReview === true
}

/**
 * 中间态「待输入」:任务等待队长/成员提供输入。
 */
export function taskAwaitingInput(task: ActivityTask): boolean {
  return task.awaitingInput === true
}

/** 任务行的中间态标记(供 data-intermediate 属性与展示判定的单一来源)。 */
export function taskIntermediateFlag(task: ActivityTask): 'blockedReview' | 'awaitingInput' | undefined {
  if (taskBlockedByReview(task)) return 'blockedReview'
  if (taskAwaitingInput(task)) return 'awaitingInput'
  return undefined
}
