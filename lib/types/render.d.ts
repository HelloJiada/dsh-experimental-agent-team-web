/**
 * 工具输出格式化层:status / best-practices 的紧凑文本渲染,以及
 * signals / retro 的统一 JSON 序列化(snake_case 输出形状)。
 *
 * 纯重构拆分(R-33):renderStatus / renderBestPractices 原内联于
 * tools.ts;signals/retro 的 snake_case 序列化在 update_task 输出与
 * status 输出中重复实现,统一收敛于此。不触碰 teamLockKey 字符串契约
 * (锁键仍由 tools.ts / close-route.ts / scheduler.ts 各自持有)。
 * @module dsh-agent-team-web/render
 */
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import { type TaskRetro, type TaskSignals } from './types.ts';
/**
 * Bounded preview length for a task output inside the status text.
 *
 * The status view is polled often, so a full task output cannot be inlined.
 * The cut is deliberately **explicit**: a reviewer who reads a shortened output
 * must be able to tell that the text continues, otherwise they may certify an
 * artifact they never saw in full (this happened in practice — a long QA report
 * was reviewed against a different rendition than the persisted one).
 */
export declare const STATUS_TEXT_PREVIEW_CHARS = 300;
/**
 * Shorten `text` to `limit` characters while saying so.
 * @param text - the full text.
 * @param limit - maximum characters kept.
 * @returns the text unchanged when short enough, otherwise a marked preview.
 */
export declare function previewStatusText(text: string, limit: number): string;
/**
 * 产出信号的 snake_case 序列化(update_task 输出与 status 输出共用)。
 * undefined 返回空对象,便于 `...serializeSignals(task.signals)` 展开。
 */
export declare function serializeSignals(signals: TaskSignals | undefined): {
    signals: {
        turns?: number;
        tool_calls?: number;
        output_bytes: number;
        self_report?: string;
    };
} | Record<string, never>;
/**
 * 复盘记录的 snake_case 序列化(update_task 输出与 status 输出共用)。
 * undefined 返回空对象,便于 `...serializeRetro(task.retro)` 展开。
 */
export declare function serializeRetro(retro: TaskRetro | undefined): {
    retro: {
        attempt: number;
        actual_ms: number;
        estimate_level?: string;
        estimated_ms?: number;
        overrun_ms?: number;
        level_deviation?: number;
        overran: boolean;
        cause: string;
        summary: string;
        retro_note?: string;
        captain_verdict?: string;
        recommendation: string;
        includes_gate_wait?: boolean;
        has_helper?: boolean;
        created_at: number;
    };
} | Record<string, never>;
/** Render the status snapshot as compact text for the model. */
export declare function renderStatus(value: JsonValue): string;
/** Render the best-practices library + calibration as compact text. */
export declare function renderBestPractices(value: JsonValue, args: {
    role?: string;
    level?: string;
    limit?: number;
}): string;
//# sourceMappingURL=render.d.ts.map