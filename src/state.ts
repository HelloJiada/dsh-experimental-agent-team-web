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

import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskStatus, TeamMember, TeamMessage, TeamState, TeamTask } from './types.ts'
import { TERMINAL_TASK_STATUSES } from './types.ts'
import { resolveTaskTiming } from './retro.ts'

/** Mailbox key of the captain. */
export const CAPTAIN_KEY = 'captain'
/** A crashed live-delivery attempt becomes retryable after this interval. */
const MAILBOX_DELIVERY_LEASE_MS = 60_000
/** Durable deny-list for AgentTeams members that must never be resumed. */
const RETIRED_MEMBERS_FILE = 'retired-members.json'

/** In-process per-team mutation queues (promise chains). */
const locks = new Map<string, Promise<unknown>>()

/**
 * Serialize mutations of one team across the whole process.
 * @param key - the team id (or any mutation scope).
 * @param fn - the mutation to run exclusively.
 * @returns the mutation's result.
 */
export async function withTeamLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  locks.set(key, previous.then(() => gate))
  await previous
  try {
    return await fn()
  } finally {
    release()
  }
}

/** Longest key emitted before truncating and appending a digest. */
const MAX_KEY_LENGTH = 48

/** Short stable digest, used to keep otherwise-colliding keys distinct. */
function keyDigest(name: string): string {
  return createHash('sha256').update(name).digest('hex').slice(0, 8)
}

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
export function sanitizeKey(name: string): string {
  const normalized = name.normalize('NFC').trim().toLowerCase()
  const cleaned = normalized.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  if (cleaned === '') return `k-${keyDigest(name)}`
  // R-21/L-3:Windows 保留设备名(CON/NUL/AUX/COM1… 含带扩展名形式)在
  // Windows 上会命中设备语义,追加摘要后缀避免目录/邮箱文件写入异常。
  // 判定基于折叠前的规范化名(如 nul.json),摘要基于折叠后的 cleaned,
  // 保证大小写变体映射到同一 key。
  if (isWindowsReservedName(normalized)) return `${cleaned}-${keyDigest(cleaned)}`
  const points = [...cleaned]
  if (points.length > MAX_KEY_LENGTH) {
    return `${points.slice(0, MAX_KEY_LENGTH).join('')}-${keyDigest(cleaned)}`
  }
  return cleaned
}

/** Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9), with optional extension. */
const WINDOWS_RESERVED_NAMES: ReadonlySet<string> = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

/** Whether a normalized (folded) name is a Windows reserved device name (with any extension). */
export function isWindowsReservedName(normalized: string): boolean {
  const base = normalized.split('.')[0] ?? ''
  return WINDOWS_RESERVED_NAMES.has(base)
}

/**
 * Whether `dependencies` are all satisfied (every named task exists and
 * completed) for the given task list.
 * @param tasks - the team's tasks.
 * @param dependencies - task ids the candidate depends on.
 * @returns the ids that are still unsatisfied, empty when claimable.
 */
export function unsatisfiedDependencies(tasks: TeamTask[], dependencies: string[]): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  return dependencies.filter((id) => byId.get(id)?.status !== 'completed')
}

/**
 * The allowed task status transitions, keyed by current status.
 * Terminal statuses have no outgoing transitions.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['claimed', 'cancelled'],
  claimed: ['in_progress', 'failed', 'cancelled'],
  in_progress: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
}

/**
 * Validate one task status transition.
 * @param current - the task's current status.
 * @param next - the requested status.
 * @returns the transition error, or undefined when allowed.
 */
export function transitionError(current: TaskStatus, next: TaskStatus): string | undefined {
  if (current === next) return undefined
  if (!TASK_TRANSITIONS[current].includes(next)) {
    return `task status cannot move from "${current}" to "${next}"`
  }
  return undefined
}

/** Activate the task's current generation for one owner and return its capability id. */
export function activateTaskAttempt(task: TeamTask, assignee: string): string {
  const attemptId = randomUUID()
  task.status = 'claimed'
  task.assignee = assignee
  task.attemptId = attemptId
  task.handoffId = undefined
  task.reassigning = false
  task.output = undefined
  // 新 attempt 从认领时刻开始计时:claimed_at 服务于 actual_ms(完成-认领)
  // 与面板"当前任务已耗时"展示。重派/重试会重置为新 owner 的认领时间,
  // 并清空开工时间与 helper 介入标记(三节点时间戳只属于当前 attempt)。
  task.claimedAt = Date.now()
  task.startedAt = undefined
  task.helperEver = undefined
  // The owner generation rotated: any helper involvement belongs to the old
  // generation and must not leak into the new one (a stale helper would lock
  // that member as busy and permanently exclude the task from help).
  task.helper = undefined
  task.helperSince = undefined
  task.updatedAt = Date.now()
  return attemptId
}

/**
 * 任务进入终结状态时结算耗时(幂等):补记 completedAt 与 actualMs,
 * 并计算 overrunMs(实际 - 预估预算,等级优先口径,与复盘超时判定同源)。
 * 旧任务(无 claimedAt)不会产生损坏数据。
 * @param task - 目标任务(需在写盘前调用)。
 * @param now - 结算时间戳。
 */
export function finalizeTaskTiming(task: TeamTask, now = Date.now()): void {
  if (task.completedAt !== undefined) return
  const timing = resolveTaskTiming(task, now)
  task.completedAt = timing.completedAt
  if (timing.actualMs !== undefined) task.actualMs = timing.actualMs
  if (timing.overrunMs !== undefined) task.overrunMs = timing.overrunMs
}

/** Start a fresh task generation for one owner. */
export function beginTaskAttempt(task: TeamTask, assignee: string): string {
  task.attempt = (task.attempt ?? 0) + 1
  return activateTaskAttempt(task, assignee)
}

/**
 * Revoke the current worker immediately. Clearing its capability makes old
 * updates stale; a separate handoff generation serializes async quiescence.
 */
export function invalidateTaskAttempt(
  task: TeamTask,
  nextAssignee?: string,
  reassigning = false,
): void {
  task.attemptId = undefined
  task.handoffId = randomUUID()
  task.status = 'pending'
  task.assignee = nextAssignee
  task.reassigning = reassigning
  task.output = undefined
  // 旧 attempt 的耗时与复盘一并作废:重派后由新 attempt 重新计时、重新复盘。
  task.claimedAt = undefined
  task.startedAt = undefined
  task.completedAt = undefined
  task.actualMs = undefined
  task.overrunMs = undefined
  task.retro = undefined
  task.helperEver = undefined
  // R-03:中间态属 attempt 级状态,重派后不得把旧 attempt 的"等待复核/等待输入"
  // 残留污染新 attempt(blockedByReview 由门禁流、awaitingInput 由派生兜底重新判定)。
  task.blockedByReview = undefined
  task.awaitingInput = undefined
  // Same helper hygiene as activateTaskAttempt: reassign/remove/archive paths
  // all route through here and must not leave a stale helper behind.
  task.helper = undefined
  task.helperSince = undefined
  task.updatedAt = Date.now()
}

/**
 * 移除成员时清理其遗留的 helper 标记(R-06):从所有任务上摘除该成员
 * 作为 helper 的引用(helper 与 helperSince 一并清除),避免
 * `isHelppableTask` 因 stale helper 永远拒绝再帮助该任务。
 * helperEver 保留作复盘审计(hasHelper 标注);attempt 级轮换语义由
 * invalidateTaskAttempt/activateTaskAttempt 处理,此处只清引用。
 */
export function clearMemberHelperMarks(tasks: TeamTask[], memberName: string): void {
  for (const task of tasks) {
    if (task.helper === memberName) {
      task.helper = undefined
      task.helperSince = undefined
    }
  }
}

/**
 * Create the team directory structure and the initial team record.
 * @param stateRoot - resolved absolute state root directory.
 * @param state - the initial team record.
 */
export async function createTeamDir(stateRoot: string, state: TeamState): Promise<void> {
  const dir = join(stateRoot, state.id)
  await mkdir(join(dir, 'inbox'), { recursive: true, mode: 0o700 })
  await atomicWriteText(join(dir, 'team.json'), JSON.stringify(state, null, 2))
}

/**
 * Read one team record; `undefined` when absent.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team's sanitized id.
 */
export async function readTeam(stateRoot: string, teamId: string): Promise<TeamState | undefined> {
  try {
    const raw = await readFile(join(stateRoot, teamId, 'team.json'), 'utf8')
    const value: unknown = JSON.parse(stripLeadingBom(raw))
    if (!isTeamState(value, teamId)) {
      throw new Error(`invalid AgentTeams state in team "${teamId}"`)
    }
    return value
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

/**
 * Synchronously read one team record while a continuable child is being
 * composed. Harness requires child setup contributions to be synchronous;
 * this narrow boundary lets a cold-resumed member restore its durable model
 * selection before its first request can be published.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team's sanitized id.
 * @returns the team record, or `undefined` when absent.
 */
export function readTeamSync(stateRoot: string, teamId: string): TeamState | undefined {
  try {
    const raw = readFileSync(join(stateRoot, teamId, 'team.json'), 'utf8')
    const value: unknown = JSON.parse(stripLeadingBom(raw))
    if (!isTeamState(value, teamId)) {
      throw new Error(`invalid AgentTeams state in team "${teamId}"`)
    }
    return value
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

/**
 * Persist one team record (inside the caller's lock).
 * @param stateRoot - resolved absolute state root directory.
 * @param state - the record to persist.
 */
export async function writeTeam(stateRoot: string, state: TeamState): Promise<void> {
  await atomicWriteText(join(stateRoot, state.id, 'team.json'), JSON.stringify(state, null, 2))
}

/** Read the durable set of member session ids retired by remove/delete. */
export async function readRetiredMemberIds(stateRoot: string): Promise<Set<string>> {
  try {
    const parsed: unknown = JSON.parse(stripLeadingBom(
      await readFile(join(stateRoot, RETIRED_MEMBERS_FILE), 'utf8'),
    ))
    if (!Array.isArray(parsed) || parsed.some(value => typeof value !== 'string' || value === '')) {
      throw new Error('invalid AgentTeams retired member index')
    }
    return new Set(parsed)
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Set()
    }
    throw error
  }
}

/** Atomically add session ids to the durable retired-member deny-list. */
export async function recordRetiredMemberIds(stateRoot: string, memberIds: readonly string[]): Promise<void> {
  const additions = memberIds.filter(id => id !== '')
  if (additions.length === 0) return
  await withTeamLock(`retired-members:${stateRoot}`, async () => {
    const retired = await readRetiredMemberIds(stateRoot)
    for (const id of additions) retired.add(id)
    await mkdir(stateRoot, { recursive: true, mode: 0o700 })
    await atomicWriteText(
      join(stateRoot, RETIRED_MEMBERS_FILE),
      `${JSON.stringify([...retired].sort(), null, 2)}\n`,
    )
  })
}

/**
 * Find the team owned by one captain session (at most one per captain).
 * @param stateRoot - resolved absolute state root directory.
 * @param captainSessionId - the owning session id.
 * @param onSkipped - R-23 观察回调:某个团队目录 readTeam 失败(坏 JSON/半截写)
 *   被跳过时调用(目录 id + 原始错误),默认不传则纯函数层保持静默——与
 *   snapshot.ts 面板侧 skip+warn 语义一致,告警由调用层(tools.ts)注入。
 * @returns the team record, or undefined when the captain leads no team.
 */
export async function findTeamByCaptain(
  stateRoot: string,
  captainSessionId: string,
  onSkipped?: (teamId: string, error: unknown) => void,
): Promise<TeamState | undefined> {
  let entries
  try {
    entries = await readdir(stateRoot, { withFileTypes: true })
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
  let found: TeamState | undefined
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    // R-23: 单团队损坏(坏 JSON/半截写)只应让该团队不可见,不应毒化整个
    // 工作区。与面板侧 collectTeamsActivity(snapshot.ts) 的 skip 容错语义
    // 一致:readTeam 失败即跳过继续遍历。state.ts 为纯函数层无 logger 注入,
    // 此处静默跳过,损坏团队对工具侧表现为"不存在";调用层可通过 onSkipped
    // 观察被跳过的目录并补 logger.warn 排障痕迹。
    let team: TeamState | undefined
    try {
      team = await readTeam(stateRoot, entry.name)
    } catch (error: unknown) {
      onSkipped?.(entry.name, error)
      continue
    }
    if (team?.captainSessionId === captainSessionId) {
      if (found !== undefined && found.id !== team.id) {
        throw new Error(`captain session leads multiple active teams ("${found.id}", "${team.id}"); archive one before continuing`)
      }
      found = team
    }
  }
  return found
}

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
export async function findTeamByParticipant(
  stateRoot: string,
  agentSessionId: string,
  onSkipped?: (teamId: string, error: unknown) => void,
): Promise<TeamState | undefined> {
  let entries
  try {
    entries = await readdir(stateRoot, { withFileTypes: true })
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
  let found: TeamState | undefined
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    // R-23: 与 findTeamByCaptain 相同的容错——单团队损坏跳过继续遍历,
    // 损坏团队对工具侧不可见,不毒化整个工作区。
    let team: TeamState | undefined
    try {
      team = await readTeam(stateRoot, entry.name)
    } catch (error: unknown) {
      onSkipped?.(entry.name, error)
      continue
    }
    const participates = team?.captainSessionId === agentSessionId
      || team?.members.some((member) => member.id === agentSessionId && member.status !== 'removed') === true
    if (participates && team !== undefined) {
      if (found !== undefined && found.id !== team.id) {
        throw new Error(`agent session belongs to multiple active teams ("${found.id}", "${team.id}"); the target team is ambiguous`)
      }
      found = team
    }
  }
  return found
}

/** Build a fresh message record. */
export function createMessage(from: string, to: string, content: string): TeamMessage {
  return { id: randomUUID(), from, to, content, ts: Date.now() }
}

/**
 * Append one message to an agent's mailbox (JSONL).
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 * @param agentKey - `captain` or a member name.
 * @param message - the message to append.
 */
export async function appendMailbox(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  message: TeamMessage,
): Promise<void> {
  const file = join(stateRoot, teamId, 'inbox', `${sanitizeKey(agentKey)}.jsonl`)
  await mkdir(join(stateRoot, teamId, 'inbox'), { recursive: true, mode: 0o700 })
  let existing = ''
  try {
    existing = await readFile(file, 'utf8')
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
      throw error
    }
  }
  const separator = existing !== '' && !existing.endsWith('\n') ? '\n' : ''
  await atomicWriteText(file, `${existing}${separator}${JSON.stringify(message)}\n`)
}

/**
 * Read one agent's whole mailbox, oldest first.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 * @param agentKey - `captain` or a member name.
 * @param onMalformedLine - optional diagnostic hook; malformed records are
 * skipped so one manually damaged line cannot make the whole team unreadable.
 * @returns the messages, empty when the mailbox does not exist yet.
 */
export async function readMailbox(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  onMalformedLine?: (lineNumber: number, error: unknown) => void,
): Promise<TeamMessage[]> {
  const file = join(stateRoot, teamId, 'inbox', `${sanitizeKey(agentKey)}.jsonl`)
  try {
    const raw = await readFile(file, 'utf8')
    const messages: TeamMessage[] = []
    for (const [index, rawLine] of raw.split('\n').entries()) {
      const line = stripLeadingBom(rawLine)
      if (line.trim() === '') continue
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        onMalformedLine?.(index + 1, new Error('invalid JSON'))
        continue
      }
      if (!isTeamMessage(value)) {
        onMalformedLine?.(index + 1, new Error('invalid message shape'))
        continue
      }
      messages.push(value)
    }
    return messages
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

/** Read only messages that have not been acknowledged by their recipient. */
export async function readUnreadMailbox(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  onMalformedLine?: (lineNumber: number, error: unknown) => void,
): Promise<TeamMessage[]> {
  const now = Date.now()
  return (await readMailbox(stateRoot, teamId, agentKey, onMalformedLine))
    .filter(message => message.readAt === undefined
      && (message.deliveryClaimedAt === undefined
        || now - message.deliveryClaimedAt >= MAILBOX_DELIVERY_LEASE_MS))
}

async function mutateMailbox(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  messageIds: readonly string[],
  mutate: (message: TeamMessage) => TeamMessage,
): Promise<void> {
  if (messageIds.length === 0) return
  const file = join(stateRoot, teamId, 'inbox', `${sanitizeKey(agentKey)}.jsonl`)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const selected = new Set(messageIds)
  const lines = raw.split('\n').map((rawLine) => {
    const line = stripLeadingBom(rawLine)
    if (line.trim() === '') return rawLine
    try {
      const value: unknown = JSON.parse(line)
      if (!isTeamMessage(value) || !selected.has(value.id)) return rawLine
      return JSON.stringify(mutate(value))
    } catch {
      return rawLine
    }
  })
  await atomicWriteText(file, lines.join('\n'))
}

/** Lease selected fallback messages to one delivery path. */
export async function claimMailboxDelivery(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  messageIds: readonly string[],
): Promise<void> {
  const now = Date.now()
  await mutateMailbox(stateRoot, teamId, agentKey, messageIds, message => ({
    ...message,
    deliveryClaimedAt: now,
  }))
}

/** Release a failed delivery lease so the scheduler can retry it later. */
export async function releaseMailboxDelivery(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  messageIds: readonly string[],
): Promise<void> {
  await mutateMailbox(stateRoot, teamId, agentKey, messageIds, (message) => {
    const { deliveryClaimedAt: _claimed, ...released } = message
    return released
  })
}

/**
 * Mark selected durable mailbox records delivered/read while preserving
 * malformed lines for diagnostics. Callers serialize this with the team lock.
 */
export async function acknowledgeMailbox(
  stateRoot: string,
  teamId: string,
  agentKey: string,
  messageIds: readonly string[],
): Promise<void> {
  const now = Date.now()
  await mutateMailbox(stateRoot, teamId, agentKey, messageIds, (message) => {
    const { deliveryClaimedAt: _claimed, ...rest } = message
    return {
      ...rest,
      deliveredAt: message.deliveredAt ?? now,
      readAt: message.readAt ?? now,
    }
  })
}

/** Remove the optional UTF-8 BOM some editors prepend to JSON text. */
function stripLeadingBom(value: string): string {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value
}

/** Rename attempts before falling back to a direct overwrite. */
const ATOMIC_RENAME_RETRIES = 3
/** Pause between rename attempts, giving a briefly-locking owner time to finish. */
const ATOMIC_RENAME_RETRY_DELAY_MS = 50
/**
 * Rename error codes worth retrying before the direct-write fallback. On
 * Windows, replacing an existing file whose target is momentarily held open
 * without FILE_SHARE_DELETE surfaces as EPERM (or EACCES/EBUSY variants);
 * EEXIST/ENOTEMPTY cover other "target busy" edge shapes.
 */
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST', 'ENOTEMPTY'])

function isRetryableRenameError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && RETRYABLE_RENAME_CODES.has((error as NodeJS.ErrnoException).code ?? '')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Filesystem primitives used by {@link replaceFileAtomicOrDirect}; injectable for tests. */
export interface AtomicReplacePrimitives {
  rename: (from: string, to: string) => Promise<void>
  writeFile: (file: string, content: string) => Promise<void>
  remove: (file: string) => Promise<void>
}

/** Tuning knobs for {@link replaceFileAtomicOrDirect} (defaults match production). */
export interface AtomicReplaceOptions {
  /** Rename attempts before the direct-write fallback (default 3). */
  retries?: number
  /** Delay between rename attempts in ms (default 50). */
  retryDelayMs?: number
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
export async function replaceFileAtomicOrDirect(
  temporary: string,
  file: string,
  content: string,
  primitives: AtomicReplacePrimitives,
  options: AtomicReplaceOptions = {},
): Promise<void> {
  const retries = options.retries ?? ATOMIC_RENAME_RETRIES
  const retryDelayMs = options.retryDelayMs ?? ATOMIC_RENAME_RETRY_DELAY_MS
  for (let attempt = 0; ; attempt += 1) {
    try {
      await primitives.rename(temporary, file)
      return
    } catch (error: unknown) {
      if (isRetryableRenameError(error) && attempt < retries) {
        await sleep(retryDelayMs)
        continue
      }
      let fallbackError: unknown
      try {
        await primitives.writeFile(file, content)
      } catch (writeError: unknown) {
        fallbackError = writeError
      }
      await primitives.remove(temporary).catch(() => undefined)
      if (fallbackError !== undefined) {
        throw new AggregateError(
          [error, fallbackError],
          `failed to replace "${file}" atomically (${String(error)}) or by direct write (${String(fallbackError)})`,
        )
      }
      return
    }
  }
}

/**
 * R-19/M-1: state files are owner-only (`0o600`) so other local users cannot
 * read team state (session ids, message text, task outputs) on multi-user
 * machines. The temp file gets the mode before the rename — `rename` preserves
 * the temp's mode, and the direct-write fallback uses the same mode.
 * @param file - the target state file path.
 * @param content - the UTF-8 payload.
 */
async function atomicWriteText(file: string, content: string): Promise<void> {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  await replaceFileAtomicOrDirect(temporary, file, content, {
    rename: (from, to) => rename(from, to),
    writeFile: (target, payload) => writeFile(target, payload, { encoding: 'utf8', mode: 0o600 }),
    remove: (path) => rm(path, { force: true }),
  })
}

/** Whether a parsed JSON value is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a value is an optional string. */
function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

/** Whether a value is a finite timestamp/counter number. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Validate one member record at the durable JSON boundary. */
function isTeamMember(value: unknown): value is TeamMember {
  if (!isRecord(value)) return false
  return typeof value['id'] === 'string'
    && typeof value['name'] === 'string'
    && value['name'].trim() !== ''
    && isOptionalString(value['role'])
    && isOptionalString(value['provider'])
    && isOptionalString(value['model'])
    && isOptionalString(value['reasoningEffort'])
    && isFiniteNumber(value['joinedAt'])
    && (value['status'] === 'idle' || value['status'] === 'working' || value['status'] === 'removed')
}

/** Validate one task record at the durable JSON boundary. */
function isTeamTask(value: unknown): value is TeamTask {
  if (!isRecord(value)) return false
  const review = value['review']
  const validReview = review === undefined || (
    isRecord(review)
    && typeof review['reviewerName'] === 'string'
    && review['reviewerName'] !== ''
    && (review['verdict'] === 'pass' || review['verdict'] === 'reject')
    && (review['comment'] === undefined || typeof review['comment'] === 'string')
    && isFiniteNumber(review['reviewedAt'])
  )
  // 自成长耗时/复盘字段:全部可选,旧任务(无这些字段)仍合法;复盘记录按形状校验。
  const retro = value['retro']
  const validRetro = retro === undefined || (
    isRecord(retro)
    // attempt 为旧数据兼容可选(round-1 复盘无 attempt 字段)。
    && (retro['attempt'] === undefined || Number.isSafeInteger(retro['attempt']))
    && isFiniteNumber(retro['actualMs'])
    && (retro['estimateLevel'] === undefined
      || retro['estimateLevel'] === 'S'
      || retro['estimateLevel'] === 'M'
      || retro['estimateLevel'] === 'L')
    && (retro['estimatedMs'] === undefined || isFiniteNumber(retro['estimatedMs']))
    && (retro['overrunMs'] === undefined || isFiniteNumber(retro['overrunMs']))
    && (retro['levelDeviation'] === undefined || isFiniteNumber(retro['levelDeviation']))
    && typeof retro['overran'] === 'boolean'
    && typeof retro['cause'] === 'string'
    && typeof retro['summary'] === 'string'
    && (retro['retroNote'] === undefined || typeof retro['retroNote'] === 'string')
    && (retro['captainVerdict'] === undefined
      || retro['captainVerdict'] === 'useful'
      || retro['captainVerdict'] === 'useless'
      || retro['captainVerdict'] === 'revised')
    && typeof retro['recommendation'] === 'string'
    && (retro['includesGateWait'] === undefined || typeof retro['includesGateWait'] === 'boolean')
    && (retro['hasHelper'] === undefined || typeof retro['hasHelper'] === 'boolean')
    && isFiniteNumber(retro['createdAt'])
  )
  // 产出信号:outputBytes 必填、其余可选。
  const signals = value['signals']
  const validSignals = signals === undefined || (
    isRecord(signals)
    && (signals['turns'] === undefined
      || (Number.isSafeInteger(signals['turns']) && (signals['turns'] as number) >= 0))
    && (signals['toolCalls'] === undefined
      || (Number.isSafeInteger(signals['toolCalls']) && (signals['toolCalls'] as number) >= 0))
    && Number.isSafeInteger(signals['outputBytes'])
    && (signals['outputBytes'] as number) >= 0
    && (signals['selfReport'] === undefined || typeof signals['selfReport'] === 'string')
  )
  return typeof value['id'] === 'string'
    && typeof value['subject'] === 'string'
    && isOptionalString(value['description'])
    && (value['status'] === 'pending'
      || value['status'] === 'claimed'
      || value['status'] === 'in_progress'
      || value['status'] === 'completed'
      || value['status'] === 'failed'
      || value['status'] === 'cancelled')
    && isOptionalString(value['assignee'])
    && Array.isArray(value['dependencies'])
    && value['dependencies'].every((dependency) => typeof dependency === 'string')
    && isOptionalString(value['output'])
    && (value['attempt'] === undefined
      || (Number.isSafeInteger(value['attempt']) && (value['attempt'] as number) >= 0))
    && isOptionalString(value['attemptId'])
    && isOptionalString(value['handoffId'])
    && (value['reassigning'] === undefined || typeof value['reassigning'] === 'boolean')
    && (value['riskLevel'] === undefined
      || value['riskLevel'] === 'low'
      || value['riskLevel'] === 'medium'
      || value['riskLevel'] === 'high'
      || value['riskLevel'] === 'critical')
    && (value['milestone'] === undefined || typeof value['milestone'] === 'boolean')
    && (value['reviewRequired'] === undefined || typeof value['reviewRequired'] === 'boolean')
    && validReview
    && (value['blockedByReview'] === undefined || typeof value['blockedByReview'] === 'boolean')
    && (value['awaitingInput'] === undefined || typeof value['awaitingInput'] === 'boolean')
    && isOptionalString(value['helper'])
    && (value['helperSince'] === undefined || isFiniteNumber(value['helperSince']))
    && (value['helperEver'] === undefined || typeof value['helperEver'] === 'boolean')
    && (value['estimateLevel'] === undefined
      || value['estimateLevel'] === 'S'
      || value['estimateLevel'] === 'M'
      || value['estimateLevel'] === 'L')
    && (value['estimatedMs'] === undefined || isFiniteNumber(value['estimatedMs']))
    && (value['claimedAt'] === undefined || isFiniteNumber(value['claimedAt']))
    && (value['startedAt'] === undefined || isFiniteNumber(value['startedAt']))
    && (value['completedAt'] === undefined || isFiniteNumber(value['completedAt']))
    && (value['actualMs'] === undefined || isFiniteNumber(value['actualMs']))
    && (value['overrunMs'] === undefined || isFiniteNumber(value['overrunMs']))
    && validSignals
    && validRetro
    && isFiniteNumber(value['createdAt'])
    && isFiniteNumber(value['updatedAt'])
}

/** Whether the commissar gate applies to a task (derived at creation). */
export function taskRequiresReview(task: TeamTask): boolean {
  return task.reviewRequired === true
}

/** Whether the gate is satisfied: the latest review verdict is `pass`. */
export function taskReviewPassed(task: TeamTask): boolean {
  return task.review?.verdict === 'pass'
}

// ── 任务中间态(改进 4):blockedByReview / awaitingInput ──

/** 任务描述中的"待确认问题"提示词(awaitingInput 检测,不区分大小写)。 */
const AWAITING_INPUT_HINTS: readonly string[] = [
  '待确认', '待输入', '待答复', '待补充', '待队长确认', '待队长提供',
  '等待输入', '等待确认', '需要确认', '需确认', '请确认', '请提供', '请补充',
  // 注意:英文提示词仅保留带空格的自然语言形式,不收录 `awaitinginput` 等
  // 无空格变体——那会误匹配框架术语 `awaitingInput`(如任务描述在讨论该
  // 中间态概念本身),把"描述提及"误判成"等待输入"。
  'awaiting input', 'awaiting confirmation', 'pending question',
  'please confirm', 'please provide',
]

/** 独立成行的问号(单独一个 ? 或 ？)视为待确认问题。 */
const STANDALONE_QUESTION_LINE = /^[?？]\s*$/mu

/**
 * 改进 4:任务描述是否含有待确认问题(等待队长/成员提供输入)。
 * 纯函数:命中显式提示词(待确认/待输入/请确认…)或独立成行的问号即判定,
 * 空描述恒为 false。create_task 以此置位 awaitingInput,快照读取时也以此派生兜底。
 */
export function descriptionAwaitingInput(description: string | undefined): boolean {
  if (description === undefined || description === '') return false
  if (STANDALONE_QUESTION_LINE.test(description)) return true
  const normalized = description.toLowerCase()
  return AWAITING_INPUT_HINTS.some((hint) => normalized.includes(hint))
}

/**
 * 改进 4:任务是否处于"等待政委复核"中间态(完成被门禁拦截)。
 * 终结状态(completed/failed/cancelled)恒为 false,兜底脏数据。
 */
export function taskBlockedByReview(task: TeamTask): boolean {
  return task.blockedByReview === true && !TERMINAL_TASK_STATUSES.includes(task.status)
}

/**
 * 改进 4:任务是否处于"等待输入"中间态。
 * 显式置位(awaitingInput === true)或描述含待确认问题(派生兜底,旧任务免迁移)。
 * R-02:显式 false(input_answered 清除后)优先压制描述派生,清除才真正生效;
 * 终结状态不残留"待输入"中间态(与 taskBlockedByReview 同一规则)。
 */
export function taskAwaitingInput(task: TeamTask): boolean {
  if (task.awaitingInput === false) return false
  if (TERMINAL_TASK_STATUSES.includes(task.status)) return false
  return task.awaitingInput === true || descriptionAwaitingInput(task.description)
}

/** Validate the full team record before it can participate in authorization. */
function isTeamState(value: unknown, expectedId: string): value is TeamState {
  if (!isRecord(value)) return false
  const validShape = value['id'] === expectedId
    && typeof value['name'] === 'string'
    && value['name'].trim() !== ''
    && isOptionalString(value['description'])
    && typeof value['captainSessionId'] === 'string'
    && value['captainSessionId'] !== ''
    && isFiniteNumber(value['createdAt'])
    && Array.isArray(value['members'])
    && value['members'].every(isTeamMember)
    && Array.isArray(value['tasks'])
    && value['tasks'].every(isTeamTask)
    && Number.isSafeInteger(value['taskSeq'])
    && (value['taskSeq'] as number) >= 0
  if (!validShape) return false

  const members = value['members'] as TeamMember[]
  const tasks = value['tasks'] as TeamTask[]
  const memberIds = new Set<string>()
  const memberKeys = new Set<string>()
  for (const member of members) {
    const key = sanitizeKey(member.name)
    if (member.id === '' || key === CAPTAIN_KEY || memberIds.has(member.id) || memberKeys.has(key)) return false
    memberIds.add(member.id)
    memberKeys.add(key)
  }
  const taskIds = new Set<string>()
  for (const task of tasks) {
    if (task.id === '' || taskIds.has(task.id)) return false
    taskIds.add(task.id)
  }
  return true
}

/** Validate a mailbox record so later rendering cannot crash on `{}`/`null`. */
function isTeamMessage(value: unknown): value is TeamMessage {
  if (!isRecord(value)) return false
  return typeof value['id'] === 'string'
    && typeof value['from'] === 'string'
    && typeof value['to'] === 'string'
    && typeof value['content'] === 'string'
    && isFiniteNumber(value['ts'])
    && (value['deliveryClaimedAt'] === undefined || isFiniteNumber(value['deliveryClaimedAt']))
    && (value['deliveredAt'] === undefined || isFiniteNumber(value['deliveredAt']))
    && (value['readAt'] === undefined || isFiniteNumber(value['readAt']))
}

/**
 * Remove a team's whole directory (members should be interrupted first).
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export async function removeTeamDir(stateRoot: string, teamId: string): Promise<void> {
  await rm(join(stateRoot, teamId), { recursive: true, force: true })
}

/**
 * `rename` with the same transient retry policy as the state-file atomic
 * write, for paths (like archiving a whole team directory) where there is no
 * content-equivalent direct-write degradation on Windows. A short-lived
 * delete-sharing lock on any file below the renamed path is retried a few
 * times before the error propagates.
 * @param from - source path.
 * @param to - destination path.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error: unknown) {
      if (isRetryableRenameError(error) && attempt < ATOMIC_RENAME_RETRIES) {
        await sleep(ATOMIC_RENAME_RETRY_DELAY_MS)
        continue
      }
      throw error
    }
  }
}

/**
 * Archive a team instead of deleting it: the whole directory (team.json with
 * tasks and dependency graph, plus the mailboxes) moves under
 * `<stateRoot>/archive/<teamId>/` so later sessions can review how tasks were
 * planned and rebuild dependency relationships. The archive directory has no
 * team.json of its own, so the live activity scan skips it naturally.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export async function archiveTeamDir(stateRoot: string, teamId: string): Promise<void> {
  const archiveRoot = join(stateRoot, 'archive')
  await mkdir(archiveRoot, { recursive: true, mode: 0o700 })
  const source = join(stateRoot, teamId)
  const target = join(archiveRoot, teamId)
  const previous = join(archiveRoot, `.${teamId}.previous-${randomUUID()}`)
  let displaced = false
  try {
    // The same Windows EPERM-on-rename applies at the directory boundary: a
    // delete-sharing violation on any file below `target` blocks the move, so
    // retry the transient-lock case before giving up.
    await renameWithRetry(target, previous)
    displaced = true
  } catch (error: unknown) {
    // Only ENOENT means there was nothing to displace; any other failure
    // (including a persistent EPERM lock) surfaces to the caller.
    if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
      throw error
    }
  }

  try {
    await renameWithRetry(source, target)
  } catch (error: unknown) {
    if (displaced) {
      try {
        await renameWithRetry(previous, target)
      } catch (restoreError: unknown) {
        throw new AggregateError(
          [error, restoreError],
          `failed to archive team "${teamId}" and restore its previous archive`,
        )
      }
    }
    throw error
  }

  // The new generation is authoritative. A failed cleanup only leaves a
  // hidden recovery directory, which archive discovery deliberately ignores.
  if (displaced) await rm(previous, { recursive: true, force: true }).catch(() => undefined)
}

/**
 * Read one archived team (already moved under `archive/`), or undefined when
 * it was never archived.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export async function readArchivedTeam(stateRoot: string, teamId: string): Promise<TeamState | undefined> {
  return readTeam(join(stateRoot, 'archive'), teamId)
}

/**
 * List every archived team id under the state root.
 * @param stateRoot - resolved absolute state root directory.
 * @returns the archived team ids, empty when the archive does not exist.
 */
export async function listArchivedTeamIds(stateRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(join(stateRoot, 'archive'), { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

// ── activity snapshot (server-side, like the Claude Code desktop watcher) ──

/** Visual task state for the activity panel. */
export type VisualTaskState = 'blocked' | 'open' | 'running' | 'completed'

/**
 * The visual state of one task: `running` while in_progress, `completed`
 * when done, `blocked` while any dependency is unfinished, else `open`.
 */
export function taskVisualState(
  status: string,
  dependencies: readonly string[],
  tasks: readonly TeamTask[],
): VisualTaskState {
  if (status === 'completed') return 'completed'
  if (status === 'in_progress') return 'running'
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const openDependency = dependencies.some((dependencyId) => {
    const dependency = byId.get(dependencyId)
    return dependency !== undefined && dependency.status !== 'completed'
  })
  return openDependency ? 'blocked' : 'open'
}

/**
 * 有向依赖图环检测(R-04):DFS 递归栈法返回第一个环的路径
 * (含闭环回到起点,如 `['t2', 't1', 't2']`);无环返回 undefined。
 * 未知依赖 id 跳过(create_task 已做存在性校验)。taskDepthsById 对环
 * 已有兜底(返回 0),此处供 create_task 在创建时拒绝会永久死锁的环。
 */
export function findTaskCycle(tasks: readonly TeamTask[]): string[] | undefined {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const visited = new Set<string>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const dfs = (id: string): string[] | undefined => {
    if (onStack.has(id)) {
      // 回到递归栈中的某个祖先:从该祖先到当前节点即闭环。
      const start = stack.indexOf(id)
      return [...stack.slice(start), id]
    }
    if (visited.has(id)) return undefined
    visited.add(id)
    onStack.add(id)
    stack.push(id)
    const task = byId.get(id)
    if (task !== undefined) {
      for (const dependency of task.dependencies) {
        if (!byId.has(dependency)) continue
        const cycle = dfs(dependency)
        if (cycle !== undefined) return cycle
      }
    }
    stack.pop()
    onStack.delete(id)
    return undefined
  }
  for (const task of tasks) {
    const cycle = dfs(task.id)
    if (cycle !== undefined) return cycle
  }
  return undefined
}

/**
 * Longest dependency path depth per task id (each depth = one lane column).
 */
export function taskDepthsById(tasks: readonly TeamTask[]): Map<string, number> {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const depths = new Map<string, number>()
  const visiting = new Set<string>()
  const depthOf = (taskId: string): number => {
    const cached = depths.get(taskId)
    if (cached !== undefined) return cached
    if (visiting.has(taskId)) return 0
    const task = byId.get(taskId)
    if (task === undefined) return 0
    visiting.add(taskId)
    const dependencies = task.dependencies
      .filter((dependencyId) => byId.has(dependencyId))
      .sort()
    const depth = dependencies.length === 0
      ? 0
      : 1 + Math.max(...dependencies.map(depthOf))
    visiting.delete(taskId)
    depths.set(taskId, depth)
    return depth
  }
  for (const task of tasks) depthOf(task.id)
  return depths
}
