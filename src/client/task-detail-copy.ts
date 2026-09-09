import type { ActivityTask } from './activity-monitor.ts'
import type { AgentTeamsTranslate } from './locales.ts'
import { retroDetailText, taskSignalsText, taskTimingText } from './task-timing.ts'

/** Build deterministic plain text for task-detail clipboard actions. */
export function taskDetailClipboardText(task: ActivityTask, t: AgentTeamsTranslate): string {
  return [
    task.subject,
    taskTimingText(task, t),
    taskSignalsText(task, t),
    retroDetailText(task, t),
  ].filter((line): line is string => line !== null).join('\n')
}

/** Copy one detail payload and report the observable result without throwing. */
export async function copyTaskDetail(
  text: string,
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
): Promise<'copied' | 'failed'> {
  if (clipboard === undefined) return 'failed'
  try {
    await clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}
