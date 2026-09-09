import type { ActivityTask } from './activity-monitor.ts';
import type { AgentTeamsTranslate } from './locales.ts';
/** Build deterministic plain text for task-detail clipboard actions. */
export declare function taskDetailClipboardText(task: ActivityTask, t: AgentTeamsTranslate): string;
/** Copy one detail payload and report the observable result without throwing. */
export declare function copyTaskDetail(text: string, clipboard: Pick<Clipboard, 'writeText'> | undefined): Promise<'copied' | 'failed'>;
//# sourceMappingURL=task-detail-copy.d.ts.map