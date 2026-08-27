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

/** 持久化全局经验库(在调用方锁内或自行加锁)。 */
export async function writeBestPractices(
  stateRoot: string,
  entries: readonly BestPracticeEntry[],
): Promise<void> {
  await withTeamLock(`best-practices:${stateRoot}`, async () => {
    const temporary = join(stateRoot, `${BEST_PRACTICES_FILE}.${process.pid}.${randomUUID()}.tmp`)
    const { writeFile, rm, rename, mkdir } = await import('node:fs/promises')
    await mkdir(stateRoot, { recursive: true })
    await writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await replaceFileAtomicOrDirect(
      temporary,
      join(stateRoot, BEST_PRACTICES_FILE),
      `${JSON.stringify(entries, null, 2)}\n`,
      {
        rename: (from, to) => rename(from, to),
        writeFile: (target, payload) => writeFile(target, payload, 'utf8'),
        remove: (path) => rm(path, { force: true }),
      },
    )
  })
}

/** 新增或更新一条经验(同 sourceTaskId 幂等更新,不重复新增)。 */
export function upsertBestPractice(
  entries: readonly BestPracticeEntry[],
  next: BestPracticeEntry,
): BestPracticeEntry[] {
  const existingIndex = entries.findIndex(entry =>
    entry.sourceTaskId === next.sourceTaskId && entry.sourceTeamId === next.sourceTeamId)
  if (existingIndex >= 0) {
    const existing = entries[existingIndex]!
    const merged: BestPracticeEntry = {
      ...existing,
      cause: next.cause,
      practice: next.practice,
      level: next.level,
      role: next.role,
      sourceTaskSubject: next.sourceTaskSubject,
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
