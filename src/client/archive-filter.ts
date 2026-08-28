/**
 * 面板归档查询(改进方向 5):历史归档区按 团队 / 时间 / 复盘状态 筛选。
 *
 * 设计约束:
 * - 纯函数、只读、无 I/O、确定性:同一输入永远同一输出,可单测;
 * - 筛选只作用于展示层(归档团队列表),不修改任何状态;
 * - 时间锚点:团队的最晚终结时间(任务 completedAt,回退 retro.createdAt),
 *   归档团队(close 路由要求全部任务完成)通常都有锚点;无锚点团队在
 *   选择具体时间区间时被排除(无法确定归属),「全部时间」始终可见。
 *
 * @module dsh-agent-team-web/client/archive-filter
 */

/** 时间区间选项。 */
export type ArchiveTimeRange = 'all' | '7d' | '30d' | '90d'

/** 复盘状态筛选选项。 */
export type ArchiveRetroFilter = 'all' | 'hasRetro' | 'overran' | 'noRetro'

/** 归档区筛选中枢(展示层本地状态)。 */
export interface ArchiveFilterState {
  /** 选中的归档团队名;'' = 全部团队。 */
  readonly team: string
  readonly timeRange: ArchiveTimeRange
  readonly retro: ArchiveRetroFilter
}

/** 默认筛选:全部团队 / 全部时间 / 全部复盘。 */
export const ARCHIVE_DEFAULT_FILTER: ArchiveFilterState = {
  team: '',
  timeRange: 'all',
  retro: 'all',
}

/** 时间区间毫秒数(近 N 天)。 */
export const ARCHIVE_TIME_RANGE_MS: Readonly<Record<Exclude<ArchiveTimeRange, 'all'>, number>> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
}

/** 下拉候选顺序(稳定展示)。 */
export const ARCHIVE_TIME_RANGES: readonly ArchiveTimeRange[] = ['all', '7d', '30d', '90d']
export const ARCHIVE_RETRO_FILTERS: readonly ArchiveRetroFilter[] = ['all', 'hasRetro', 'overran', 'noRetro']

/** 任务的最小可筛选形状(与 ActivityTask 兼容)。 */
export interface ArchiveTaskView {
  readonly id: string
  readonly status: string
  readonly completedAt?: number
  readonly retro?: { readonly overran?: boolean; readonly createdAt?: number } | null
}

/** 团队的最小可筛选形状(与 ActivityTeam 兼容)。 */
export interface ArchiveTeamView {
  readonly teamId: string
  readonly name: string
  readonly tasks: readonly ArchiveTaskView[]
}

/** 团队时间锚点:最晚的终结时间(completedAt 优先,回退 retro.createdAt)。 */
export function archiveTeamTimeMs(team: ArchiveTeamView): number | undefined {
  let latest: number | undefined
  for (const task of team.tasks) {
    const candidate = task.completedAt ?? task.retro?.createdAt
    if (candidate !== undefined && (latest === undefined || candidate > latest)) latest = candidate
  }
  return latest
}

/** 团队复盘画像:有复盘 / 有超时复盘 / 有已完成但缺复盘的任务。 */
export interface ArchiveTeamRetroProfile {
  readonly hasRetro: boolean
  readonly overran: boolean
  readonly missingRetro: boolean
}

/** 扫描团队任务的复盘状态,派生画像(纯函数)。 */
export function archiveTeamRetroProfile(team: ArchiveTeamView): ArchiveTeamRetroProfile {
  let hasRetro = false
  let overran = false
  let missingRetro = false
  for (const task of team.tasks) {
    if (task.retro !== undefined && task.retro !== null) {
      hasRetro = true
      if (task.retro.overran === true) overran = true
    } else if (task.status === 'completed') {
      missingRetro = true
    }
  }
  return { hasRetro, overran, missingRetro }
}

/** 单团队是否通过筛选(纯函数)。 */
export function archiveTeamMatches(
  team: ArchiveTeamView,
  filter: ArchiveFilterState,
  now: number,
): boolean {
  if (filter.team !== '' && filter.team !== team.name) return false
  if (filter.timeRange !== 'all') {
    const anchor = archiveTeamTimeMs(team)
    if (anchor === undefined) return false
    if (now - anchor > ARCHIVE_TIME_RANGE_MS[filter.timeRange]) return false
  }
  if (filter.retro !== 'all') {
    const profile = archiveTeamRetroProfile(team)
    if (filter.retro === 'hasRetro' && !profile.hasRetro) return false
    if (filter.retro === 'overran' && !profile.overran) return false
    if (filter.retro === 'noRetro' && !profile.missingRetro) return false
  }
  return true
}

/**
 * 按筛选状态过滤归档团队(保持原顺序)。纯函数。
 * 泛型保留具体团队类型(如 ActivityTeam),调用方无需窄化。
 * `now` 显式传入以便测试边界;默认取当前时刻。
 */
export function filterArchivedTeams<T extends ArchiveTeamView>(
  teams: readonly T[],
  filter: ArchiveFilterState,
  now: number = Date.now(),
): readonly T[] {
  return teams.filter(team => archiveTeamMatches(team, filter, now))
}

/** 全部归档团队的团队名候选(用于团队下拉),按出现顺序去重。 */
export function archivedTeamNames(teams: readonly ArchiveTeamView[]): readonly string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const team of teams) {
    if (seen.has(team.name)) continue
    seen.add(team.name)
    names.push(team.name)
  }
  return names
}
