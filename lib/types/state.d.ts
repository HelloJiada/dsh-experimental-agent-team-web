/**
 * Team state persistence and pure team-logic rules.
 *
 * State lives on disk under `<workspace>/<stateDir>/<teamId>/`:
 * - `team.json` — the durable {@link TeamState} record
 * - `inbox/<agentKey>.jsonl` — one JSONL mailbox per agent (`captain` or a
 *   member name), mirroring the Claude Code AgentTeams mailbox layout
 *
 * All mutations run through an in-process per-team queue so read-modify-write
 * stays serial; `fs/promises` is used directly because the plugin owns this
 * bookkeeping (host-plane state, like session persistence) and the abstract
 * `fs` service offers no directory deletion.
 * @module dsh-agent-team-web/state
 */
import type { TaskStatus, TeamMessage, TeamState, TeamTask } from './types.ts';
/** Mailbox key of the captain. */
export declare const CAPTAIN_KEY = "captain";
/**
 * Serialize mutations of one team across the whole process.
 * @param key - the team id (or any mutation scope).
 * @param fn - the mutation to run exclusively.
 * @returns the mutation's result.
 */
export declare function withTeamLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
/**
 * Fold a free-form name into a safe path/key segment.
 *
 * Unicode letters and digits survive, so CJK/Cyrillic/Greek names stay
 * distinct and readable; everything else — spaces, punctuation, path
 * separators, control characters — folds to `-`. An ASCII-only whitelist
 * mapped *every* non-Latin name onto one shared fallback, which silently
 * merged their mailboxes and rejected the second such member as a duplicate.
 *
 * A name with no letters or digits at all (pure emoji or punctuation) cannot
 * yield a readable key, so it gets a digest rather than a shared constant.
 * Over-long names are truncated with a digest appended, so names sharing a
 * long prefix stay distinct and the result stays within filesystem limits
 * (CJK costs 3 bytes per character in UTF-8).
 *
 * @param name - any user-supplied name.
 * @returns a non-empty key safe as a single path segment.
 */
export declare function sanitizeKey(name: string): string;
/** Whether a normalized (folded) name is a Windows reserved device name (with any extension). */
export declare function isWindowsReservedName(normalized: string): boolean;
/**
 * Whether `dependencies` are all satisfied (every named task exists and
 * completed) for the given task list.
 * @param tasks - the team's tasks.
 * @param dependencies - task ids the candidate depends on.
 * @returns the ids that are still unsatisfied, empty when claimable.
 */
export declare function unsatisfiedDependencies(tasks: TeamTask[], dependencies: string[]): string[];
/**
 * The allowed task status transitions, keyed by current status.
 * Terminal statuses have no outgoing transitions.
 */
export declare const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>>;
/**
 * Validate one task status transition.
 * @param current - the task's current status.
 * @param next - the requested status.
 * @returns the transition error, or undefined when allowed.
 */
export declare function transitionError(current: TaskStatus, next: TaskStatus): string | undefined;
/** Activate the task's current generation for one owner and return its capability id. */
export declare function activateTaskAttempt(task: TeamTask, assignee: string): string;
/**
 * 任务进入终结状态时结算耗时(幂等):补记 completedAt 与 actualMs,
 * 并计算 overrunMs(实际 - 预估预算,等级优先口径,与复盘超时判定同源)。
 * 旧任务(无 claimedAt)不会产生损坏数据。
 * @param task - 目标任务(需在写盘前调用)。
 * @param now - 结算时间戳。
 */
export declare function finalizeTaskTiming(task: TeamTask, now?: number): void;
/** Start a fresh task generation for one owner. */
export declare function beginTaskAttempt(task: TeamTask, assignee: string): string;
/**
 * Revoke the current worker immediately. Clearing its capability makes old
 * updates stale; a separate handoff generation serializes async quiescence.
 */
export declare function invalidateTaskAttempt(task: TeamTask, nextAssignee?: string, reassigning?: boolean): void;
/**
 * 移除成员时清理其遗留的 helper 标记(R-06):从所有任务上摘除该成员
 * 作为 helper 的引用(helper 与 helperSince 一并清除),避免
 * `isHelppableTask` 因 stale helper 永远拒绝再帮助该任务。
 * helperEver 保留作复盘审计(hasHelper 标注);attempt 级轮换语义由
 * invalidateTaskAttempt/activateTaskAttempt 处理,此处只清引用。
 */
export declare function clearMemberHelperMarks(tasks: TeamTask[], memberName: string): void;
/**
 * Create the team directory structure and the initial team record.
 * @param stateRoot - resolved absolute state root directory.
 * @param state - the initial team record.
 */
export declare function createTeamDir(stateRoot: string, state: TeamState): Promise<void>;
/**
 * Read one team record; `undefined` when absent.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team's sanitized id.
 */
export declare function readTeam(stateRoot: string, teamId: string): Promise<TeamState | undefined>;
/**
 * Synchronously read one team record while a continuable child is being
 * composed. Harness requires child setup contributions to be synchronous;
 * this narrow boundary lets a cold-resumed member restore its durable model
 * selection before its first request can be published.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team's sanitized id.
 * @returns the team record, or `undefined` when absent.
 */
export declare function readTeamSync(stateRoot: string, teamId: string): TeamState | undefined;
/**
 * Persist one team record (inside the caller's lock).
 * @param stateRoot - resolved absolute state root directory.
 * @param state - the record to persist.
 */
export declare function writeTeam(stateRoot: string, state: TeamState): Promise<void>;
/** Read the durable set of member session ids retired by remove/delete. */
export declare function readRetiredMemberIds(stateRoot: string): Promise<Set<string>>;
/** Atomically add session ids to the durable retired-member deny-list. */
export declare function recordRetiredMemberIds(stateRoot: string, memberIds: readonly string[]): Promise<void>;
/**
 * Find the team owned by one captain session (at most one per captain).
 * @param stateRoot - resolved absolute state root directory.
 * @param captainSessionId - the owning session id.
 * @param onSkipped - R-23 观察回调:某个团队目录 readTeam 失败(坏 JSON/半截写)
 *   被跳过时调用(目录 id + 原始错误),默认不传则纯函数层保持静默——与
 *   snapshot.ts 面板侧 skip+warn 语义一致,告警由调用层(tools.ts)注入。
 * @returns the team record, or undefined when the captain leads no team.
 */
export declare function findTeamByCaptain(stateRoot: string, captainSessionId: string, onSkipped?: (teamId: string, error: unknown) => void): Promise<TeamState | undefined>;
/**
 * Find the team in which one session is an active participant.
 * Captains match `captainSessionId`; members match their durable child session
 * id. Removed members no longer have access to team-scoped tools.
 * @param stateRoot - resolved absolute state root directory.
 * @param agentSessionId - calling captain/member session id.
 * @param onSkipped - R-23 观察回调:某个团队目录 readTeam 失败被跳过时调用
 *   (目录 id + 原始错误);默认不传则静默(与 findTeamByCaptain 一致)。
 * @returns the team record, or undefined when the caller belongs to no team.
 */
export declare function findTeamByParticipant(stateRoot: string, agentSessionId: string, onSkipped?: (teamId: string, error: unknown) => void): Promise<TeamState | undefined>;
/** Build a fresh message record. */
export declare function createMessage(from: string, to: string, content: string): TeamMessage;
/**
 * Append one message to an agent's mailbox (JSONL).
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 * @param agentKey - `captain` or a member name.
 * @param message - the message to append.
 */
export declare function appendMailbox(stateRoot: string, teamId: string, agentKey: string, message: TeamMessage): Promise<void>;
/**
 * Read one agent's whole mailbox, oldest first.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 * @param agentKey - `captain` or a member name.
 * @param onMalformedLine - optional diagnostic hook; malformed records are
 * skipped so one manually damaged line cannot make the whole team unreadable.
 * @returns the messages, empty when the mailbox does not exist yet.
 */
export declare function readMailbox(stateRoot: string, teamId: string, agentKey: string, onMalformedLine?: (lineNumber: number, error: unknown) => void): Promise<TeamMessage[]>;
/** Read only messages that have not been acknowledged by their recipient. */
export declare function readUnreadMailbox(stateRoot: string, teamId: string, agentKey: string, onMalformedLine?: (lineNumber: number, error: unknown) => void): Promise<TeamMessage[]>;
/** Lease selected fallback messages to one delivery path. */
export declare function claimMailboxDelivery(stateRoot: string, teamId: string, agentKey: string, messageIds: readonly string[]): Promise<void>;
/** Release a failed delivery lease so the scheduler can retry it later. */
export declare function releaseMailboxDelivery(stateRoot: string, teamId: string, agentKey: string, messageIds: readonly string[]): Promise<void>;
/**
 * Mark selected durable mailbox records delivered/read while preserving
 * malformed lines for diagnostics. Callers serialize this with the team lock.
 */
export declare function acknowledgeMailbox(stateRoot: string, teamId: string, agentKey: string, messageIds: readonly string[]): Promise<void>;
/** Filesystem primitives used by {@link replaceFileAtomicOrDirect}; injectable for tests. */
export interface AtomicReplacePrimitives {
    rename: (from: string, to: string) => Promise<void>;
    writeFile: (file: string, content: string) => Promise<void>;
    remove: (file: string) => Promise<void>;
}
/** Tuning knobs for {@link replaceFileAtomicOrDirect} (defaults match production). */
export interface AtomicReplaceOptions {
    /** Rename attempts before the direct-write fallback (default 3). */
    retries?: number;
    /** Delay between rename attempts in ms (default 50). */
    retryDelayMs?: number;
}
/**
 * Replace `file` with `content`, preferring an atomic same-directory rename of
 * an already-written temp file.
 *
 * On Windows, `rename(tmp, file)` over an existing target throws EPERM while
 * any other process keeps the target open without FILE_SHARE_DELETE (editors,
 * indexers, antivirus scans, preview panes). By that point the payload has
 * already been fully written to the temp file, so a direct overwrite of the
 * target is a content-equivalent degraded path: retry the rename a few times
 * (transient locks clear quickly), then write the target in place. Every path
 * removes the temp file; when both the atomic rename and the direct write
 * fail, the combined error surfaces as an {@link AggregateError}.
 *
 * @returns nothing once the file has been replaced by one of the two paths.
 */
export declare function replaceFileAtomicOrDirect(temporary: string, file: string, content: string, primitives: AtomicReplacePrimitives, options?: AtomicReplaceOptions): Promise<void>;
/** Whether the commissar gate applies to a task (derived at creation). */
export declare function taskRequiresReview(task: TeamTask): boolean;
/** Whether the gate is satisfied: the latest review verdict is `pass`. */
export declare function taskReviewPassed(task: TeamTask): boolean;
/**
 * 改进 4:任务描述是否含有待确认问题(等待队长/成员提供输入)。
 * 纯函数:命中显式提示词(待确认/待输入/请确认…)或独立成行的问号即判定,
 * 空描述恒为 false。create_task 以此置位 awaitingInput,快照读取时也以此派生兜底。
 *
 * 判定规则(长描述防误标):
 * 1. 独立成行的问号 → true;
 * 2. 短描述(≤120 字符,整段即问题)中提示词出现在任意位置 → true;
 * 3. 长描述中提示词须位于前部(前 60 字符,问题前置式),或后随
 *    冒号/问号(显式提问式,如「需要确认：X」),否则视为实现指令不判定。
 */
export declare function descriptionAwaitingInput(description: string | undefined): boolean;
/**
 * 改进 4:任务是否处于"等待政委复核"中间态(完成被门禁拦截)。
 * 终结状态(completed/failed/cancelled)恒为 false,兜底脏数据。
 */
export declare function taskBlockedByReview(task: TeamTask): boolean;
/**
 * 改进 4:任务是否处于"等待输入"中间态。
 * 显式置位(awaitingInput === true)或描述含待确认问题(派生兜底,旧任务免迁移)。
 * R-02:显式 false(input_answered 清除后)优先压制描述派生,清除才真正生效;
 * 终结状态不残留"待输入"中间态(与 taskBlockedByReview 同一规则)。
 */
export declare function taskAwaitingInput(task: TeamTask): boolean;
/**
 * Archive a team instead of deleting it: the whole directory (team.json with
 * tasks and dependency graph, plus the mailboxes) moves under
 * `<stateRoot>/archive/<teamId>/` so later sessions can review how tasks were
 * planned and rebuild dependency relationships. The archive directory has no
 * team.json of its own, so the live activity scan skips it naturally.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export declare function archiveTeamDir(stateRoot: string, teamId: string): Promise<void>;
/**
 * Read one archived team (already moved under `archive/`), or undefined when
 * it was never archived.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export declare function readArchivedTeam(stateRoot: string, teamId: string): Promise<TeamState | undefined>;
/**
 * List every archived team id under the state root.
 * @param stateRoot - resolved absolute state root directory.
 * @returns the archived team ids, empty when the archive does not exist.
 */
export declare function listArchivedTeamIds(stateRoot: string): Promise<string[]>;
/** Visual task state for the activity panel. */
export type VisualTaskState = 'blocked' | 'open' | 'running' | 'completed';
/**
 * The visual state of one task: `running` while in_progress, `completed`
 * when done, `blocked` while any dependency is unfinished, else `open`.
 */
export declare function taskVisualState(status: string, dependencies: readonly string[], tasks: readonly TeamTask[]): VisualTaskState;
/**
 * 有向依赖图环检测(R-04):DFS 递归栈法返回第一个环的路径
 * (含闭环回到起点,如 `['t2', 't1', 't2']`);无环返回 undefined。
 * 未知依赖 id 跳过(create_task 已做存在性校验)。taskDepthsById 对环
 * 已有兜底(返回 0),此处供 create_task 在创建时拒绝会永久死锁的环。
 */
export declare function findTaskCycle(tasks: readonly TeamTask[]): string[] | undefined;
/**
 * Longest dependency path depth per task id (each depth = one lane column).
 */
export declare function taskDepthsById(tasks: readonly TeamTask[]): Map<string, number>;
//# sourceMappingURL=state.d.ts.map