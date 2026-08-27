/**
 * Self-organizing dispatch helpers for the activity panel.
 *
 * The host snapshot emits `helper` on a task when a teammate is pushing it
 * forward (ownership unchanged). These helpers tolerate both the raw host
 * field and the snapshot convention, and hide the helper once the task is
 * terminal.
 * @module dsh-agent-team-web/client/task-helping
 */

import type { ActivityTask } from './activity-monitor.ts'

/** The helper of a non-terminal task, or undefined when nobody is helping. */
export function taskHelper(task: ActivityTask): string | undefined {
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return undefined
  const helper = task.helper
  return helper === undefined || helper === '' ? undefined : helper
}
