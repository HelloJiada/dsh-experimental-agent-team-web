/**
 * L3 自成长落点:bestPractice 经验库(全局,跨会话跨团队)。
 *
 * 存储:独立于团队状态,位于 `<workspace>/.agent-team-web/best-practices.json`。
 * 条目带 sourceTeamId+sourceTaskId+时间 溯源;复盘三层之成员 retro_note 是
 * 原始素材,terminal 时自动提炼入库(verdict=pending),队长用
 * agent_teams_retro_review 校准(useful/useless/revised)。
 * 读写串行:复用 state.ts 的 withTeamLock 原子写,跨团队互不干扰。
 * @module dsh-agent-team-web/best-practices
 */

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { replaceFileAtomicOrDirect, withTeamLock } from './state.ts'
import type { EstimateLevel, TaskRetro, TaskRetroCause } from './types.ts'

/** 经验条目校准状态。 */
export type BestPracticeVerdict = 'pending' | 'useful' | 'useless' | 'revised'

/** 一条经验库条目(全局,跨团队,带溯源)。 */
export interface BestPracticeEntry {
  /** 稳定 id(bp-<uuid8>)。 */
  readonly id: string
  /** 溯源:来源团队。 */
  readonly sourceTeamId: string
  /** 溯源:来源任务。 */
  readonly sourceTaskId: string
  /** 便于检索:来源任务标题。 */
  readonly sourceTaskSubject: string
  /** 执行成员角色。 */
  readonly role: string
  /** 任务预估等级。 */
  readonly level?: EstimateLevel
  /** 复盘原因。 */
  readonly cause: TaskRetroCause
  /** 提炼后的经验("这类任务下次先做什么")。 */
  readonly practice: string
  /** 队长校准状态。 */
  readonly verdict: BestPracticeVerdict
  readonly createdAt: number
  readonly updatedAt: number
}

/** 全局经验库文件名(位于 stateRoot 下)。 */
export const BEST_PRACTICES_FILE = 'best-practices.json'

/** 生成稳定的条目 id。 */
export function bestPracticeId(): string {
  return `bp-${randomUUID().slice(0, 8)}`
}

/** 从复盘提炼经验文本:retroNote 优先,其次 recommendation(空则不产经验)。 */
export function distillPracticeText(retro: TaskRetro): string {
  const note = retro.retroNote?.trim() ?? ''
  if (note !== '') return note
  return retro.recommendation.trim()
}

/** 读取全局经验库(文件不存在视为空库)。 */
export async function readBestPractices(stateRoot: string): Promise<BestPracticeEntry[]> {
  try {
    const raw = await readFile(join(stateRoot, BEST_PRACTICES_FILE), 'utf8')
    const parsed: unknown = JSON.parse(raw.startsWith('\uFEFF') ? raw.slice(1) : raw)
    if (!Array.isArray(parsed)) throw new Error('invalid AgentTeams best-practices index')
    return parsed.filter(isBestPracticeEntry)
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

/** 无锁持久化全局经验库(调用方必须已持有 `best-practices:${stateRoot}` 锁)。 */
async function persistBestPractices(stateRoot: string, entries: readonly BestPracticeEntry[]): Promise<void> {
  const temporary = join(stateRoot, `${BEST_PRACTICES_FILE}.${process.pid}.${randomUUID()}.tmp`)
  const { writeFile, rm, rename, mkdir } = await import('node:fs/promises')
  // R-19/M-1: 目录 0700、文件 0600(含 temp,rename 保留 temp mode)。
  await mkdir(stateRoot, { recursive: true, mode: 0o700 })
  await writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  await replaceFileAtomicOrDirect(
    temporary,
    join(stateRoot, BEST_PRACTICES_FILE),
    `${JSON.stringify(entries, null, 2)}\n`,
    {
      rename: (from, to) => rename(from, to),
      writeFile: (target, payload) => writeFile(target, payload, { encoding: 'utf8', mode: 0o600 }),
      remove: (path) => rm(path, { force: true }),
    },
  )
}

/** 持久化全局经验库(自行加锁;锁内调用请用 mutateBestPractices)。 */
export async function writeBestPractices(
  stateRoot: string,
  entries: readonly BestPracticeEntry[],
): Promise<void> {
  await withTeamLock(`best-practices:${stateRoot}`, () => persistBestPractices(stateRoot, entries))
}

/**
 * R-08:原子"读-改-写"全局经验库。把「读取当前条目 → fn 变换 → 写回」整体放入
 * `best-practices:${stateRoot}` 锁内,消除跨团队/跨会话并发的 TOCTOU 丢条目
 * (修复前:readBestPractices 无锁,writeBestPractices 只护写入段,两团队并发
 * 终结任务时后写覆盖先写)。fn 返回 undefined 表示不修改(跳过写盘)。
 * 注意:withTeamLock 不可重入,fn 内不得再调用 writeBestPractices。
 */
export async function mutateBestPractices(
  stateRoot: string,
  fn: (entries: readonly BestPracticeEntry[]) => readonly BestPracticeEntry[] | undefined,
): Promise<void> {
  await withTeamLock(`best-practices:${stateRoot}`, async () => {
    const entries = await readBestPractices(stateRoot)
    const next = fn(entries)
    if (next === undefined || next === entries) return
    await persistBestPractices(stateRoot, next)
  })
}

/** 新增或更新一条经验(同 sourceTaskId 幂等更新,不重复新增)。
 * R-09:practice 文本变化(任务重试/新 attempt 重新提炼)时,旧校准结论
 * (useful/useless/revised)不再适用于新经验——verdict 重置为 pending 重新走
 * 校准闭环,避免被旧 useless 静默过滤、或被旧 useful 未经复核即注入成员 persona。 */
export function upsertBestPractice(
  entries: readonly BestPracticeEntry[],
  next: BestPracticeEntry,
): BestPracticeEntry[] {
  const existingIndex = entries.findIndex(entry =>
    entry.sourceTaskId === next.sourceTaskId && entry.sourceTeamId === next.sourceTeamId)
  if (existingIndex >= 0) {
    const existing = entries[existingIndex]!
    const practiceChanged = existing.practice !== next.practice
    const merged: BestPracticeEntry = {
      ...existing,
      cause: next.cause,
      practice: next.practice,
      level: next.level,
      role: next.role,
      sourceTaskSubject: next.sourceTaskSubject,
      ...practiceChanged ? { verdict: 'pending' as const } : {},
      updatedAt: Date.now(),
    }
    return entries.map((entry, index) => index === existingIndex ? merged : entry)
  }
  return [...entries, next]
}

/** 更新一条经验的队长校准结论;revised 时可选改写原因。 */
export function updateBestPracticeVerdict(
  entries: readonly BestPracticeEntry[],
  entryId: string,
  verdict: BestPracticeVerdict,
  cause?: TaskRetroCause,
): BestPracticeEntry[] {
  return entries.map(entry => {
    if (entry.id !== entryId) return entry
    return {
      ...entry,
      cause: cause ?? entry.cause,
      verdict,
      updatedAt: Date.now(),
    }
  })
}

/** 从一次 terminal 复盘提炼入库(无经验内容不入库)。 */
export function distillBestPractice(
  retro: TaskRetro,
  source: {
    readonly sourceTeamId: string
    readonly sourceTaskId: string
    readonly sourceTaskSubject: string
    readonly role: string
  },
): BestPracticeEntry | undefined {
  const practice = distillPracticeText(retro)
  if (practice === '') return undefined
  return {
    id: bestPracticeId(),
    sourceTeamId: source.sourceTeamId,
    sourceTaskId: source.sourceTaskId,
    sourceTaskSubject: source.sourceTaskSubject,
    role: source.role,
    ...retro.estimateLevel !== undefined ? { level: retro.estimateLevel } : {},
    cause: retro.cause,
    practice,
    verdict: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/**
 * 团队记忆注入的冷启动守卫:与复盘校准口径一致,角色匹配样本 <2 时不注入,
 * 避免把孤例经验当作行为模板写进成员系统提示。
 */
export const MIN_MEMBER_MEMORY_SAMPLES = 2

/** 单成员注入的经验条目上限(保持 persona 精简,防止记忆淹没规则)。 */
export const MAX_MEMBER_MEMORY_ENTRIES = 3

/**
 * R-20/M-2 注入门控决策:只注入**已验证**经验。
 *
 * 经验文本源自成员自由填写的 retro_note(t4 M-2:跨团队持久化提示注入向量),
 * 因此 `pending`(未校准)条目一律**不注入**——只有队长通过
 * agent_teams_retro_review 明确校准为 `useful`/`revised` 后才会进入成员系统提示。
 * 这同时满足质检员验收点③:门控收紧有明确决策(pending 不注入)+ 测试锁定;
 * 被 `useless` 否决的条目同样排除。冷启动守卫(<2 样本)与数量上限保持不变。
 */
export const INJECTABLE_BEST_PRACTICE_VERDICTS: ReadonlySet<BestPracticeVerdict> = new Set(['useful', 'revised'])

/** R-20/M-2 注入文本长度上限:经验引用截断,防止巨型 retro_note 淹没 persona。 */
export const MAX_INJECTED_PRACTICE_LENGTH = 200

/**
 * 从全局经验库选出某角色的可注入记忆条目(团队记忆注入的数据源)。
 *
 * 规则:
 * - 无角色(或空角色)不注入;按 `entry.role === role` 精确匹配;
 * - **只注入已验证经验**(verdict ∈ {useful, revised});pending/useless 一律不注入
 *   (R-20/M-2 门控收紧:跨团队持久化提示注入向量需队长校准放行);
 * - 冷启动守卫:角色匹配样本 < {@link MIN_MEMBER_MEMORY_SAMPLES} 时返回空(不注入);
 * - 已校准经验按更新时间倒序,截取前 {@link MAX_MEMBER_MEMORY_ENTRIES} 条。
 *
 * @param entries - 全局经验库全量条目(读盘原样传入)。
 * @param role - 目标成员的角色(如 `engineer`、`researcher`)。
 * @returns 可注入的经验条目(空数组 = 冷启动守卫触发或无角色或无可注入经验)。
 */
export function selectBestPracticesForRole(
  entries: readonly BestPracticeEntry[],
  role: string | undefined,
): BestPracticeEntry[] {
  if (role === undefined || role.trim() === '') return []
  const normalized = role.trim()
  const matched = entries.filter(entry =>
    entry.role === normalized && INJECTABLE_BEST_PRACTICE_VERDICTS.has(entry.verdict))
  if (matched.length < MIN_MEMBER_MEMORY_SAMPLES) return []
  return [...matched]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_MEMBER_MEMORY_ENTRIES)
}

/** R-20/M-2:注入前截断经验文本,把经验限定为数据引用而非完整指令。 */
export function truncatePracticeForInjection(practice: string): string {
  if (practice.length <= MAX_INJECTED_PRACTICE_LENGTH) return practice
  return `${practice.slice(0, MAX_INJECTED_PRACTICE_LENGTH)}…`
}

/** 校验一条经验条目形状(读盘边界)。 */
function isBestPracticeEntry(value: unknown): value is BestPracticeEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry['id'] === 'string'
    && typeof entry['sourceTeamId'] === 'string'
    && typeof entry['sourceTaskId'] === 'string'
    && typeof entry['sourceTaskSubject'] === 'string'
    && typeof entry['role'] === 'string'
    && (entry['level'] === undefined
      || entry['level'] === 'S' || entry['level'] === 'M' || entry['level'] === 'L')
    && typeof entry['cause'] === 'string'
    && typeof entry['practice'] === 'string'
    && (entry['verdict'] === 'pending'
      || entry['verdict'] === 'useful'
      || entry['verdict'] === 'useless'
      || entry['verdict'] === 'revised')
    && typeof entry['createdAt'] === 'number' && Number.isFinite(entry['createdAt'])
    && typeof entry['updatedAt'] === 'number' && Number.isFinite(entry['updatedAt'])
}
