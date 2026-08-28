import { describe, expect, it } from 'vitest'
import {
  ARCHIVE_DEFAULT_FILTER,
  ARCHIVE_TIME_RANGE_MS,
  archiveTeamMatches,
  archiveTeamRetroProfile,
  archiveTeamTimeMs,
  archivedTeamNames,
  filterArchivedTeams,
  type ArchiveFilterState,
  type ArchiveTeamView,
} from './archive-filter.ts'
import { en, zh, type AgentTeamsLocaleKey } from './locales.ts'

const NOW = 1_000_000_000_000

const team = (overrides: Partial<ArchiveTeamView> = {}): ArchiveTeamView => ({
  teamId: 'team-1',
  name: '团队A',
  tasks: [],
  ...overrides,
})

const task = (overrides: Partial<ArchiveTeamView['tasks'][number]> = {}): ArchiveTeamView['tasks'][number] => ({
  id: 't1',
  status: 'completed',
  ...overrides,
})

describe('archiveTeamTimeMs — 团队时间锚点', () => {
  it('取最晚的 completedAt', () => {
    expect(archiveTeamTimeMs(team({
      tasks: [task({ id: 't1', completedAt: 100 }), task({ id: 't2', completedAt: 300 })],
    }))).toBe(300)
  })

  it('无 completedAt 时回退 retro.createdAt', () => {
    expect(archiveTeamTimeMs(team({
      tasks: [task({ id: 't1', completedAt: 100 }), task({ id: 't2', retro: { overran: false, createdAt: 500 } })],
    }))).toBe(500)
  })

  it('无任何时间字段 → undefined', () => {
    expect(archiveTeamTimeMs(team({ tasks: [task({ id: 't1' })] }))).toBeUndefined()
  })
})

describe('archiveTeamRetroProfile — 复盘画像', () => {
  it('有复盘 / 超时复盘 / 缺复盘 三态独立判定', () => {
    const profile = archiveTeamRetroProfile(team({
      tasks: [
        task({ id: 't1', retro: { overran: true, createdAt: 1 } }),
        task({ id: 't2' }),
      ],
    }))
    expect(profile).toEqual({ hasRetro: true, overran: true, missingRetro: true })
  })

  it('全部任务有复盘且未超时 → hasRetro=true,其余 false', () => {
    const profile = archiveTeamRetroProfile(team({
      tasks: [task({ id: 't1', retro: { overran: false, createdAt: 1 } })],
    }))
    expect(profile).toEqual({ hasRetro: true, overran: false, missingRetro: false })
  })

  it('无任务 → 全 false', () => {
    expect(archiveTeamRetroProfile(team())).toEqual({ hasRetro: false, overran: false, missingRetro: false })
  })

  it('非完成态且无复盘的任务不视为缺复盘', () => {
    const profile = archiveTeamRetroProfile(team({
      tasks: [task({ id: 't1', status: 'pending' })],
    }))
    expect(profile.missingRetro).toBe(false)
  })
})

describe('filterArchivedTeams — 团队/时间/复盘 组合筛选', () => {
  const teams: readonly ArchiveTeamView[] = [
    team({
      teamId: 'a',
      name: '团队A',
      tasks: [task({ id: 't1', completedAt: NOW - 2 * 24 * 3600 * 1000, retro: { overran: true, createdAt: NOW - 2 * 24 * 3600 * 1000 } })],
    }),
    team({
      teamId: 'b',
      name: '团队B',
      tasks: [
        task({ id: 't1', completedAt: NOW - 60 * 24 * 3600 * 1000, retro: { overran: false, createdAt: NOW - 60 * 24 * 3600 * 1000 } }),
        task({ id: 't2', completedAt: NOW - 1 * 24 * 3600 * 1000 }),
      ],
    }),
    team({
      teamId: 'c',
      name: '团队C',
      tasks: [task({ id: 't1' })], // 无时间锚点
    }),
  ]

  it('默认筛选 → 全部团队、顺序不变', () => {
    expect(filterArchivedTeams(teams, ARCHIVE_DEFAULT_FILTER, NOW).map(t => t.teamId))
      .toEqual(['a', 'b', 'c'])
  })

  it('按团队筛选:只留同名团队', () => {
    const filtered = filterArchivedTeams(teams, { ...ARCHIVE_DEFAULT_FILTER, team: '团队B' }, NOW)
    expect(filtered.map(t => t.teamId)).toEqual(['b'])
  })

  it('按时间筛选:近 7 天只留 7 天内终结的团队;无锚点团队被排除', () => {
    const filtered = filterArchivedTeams(teams, { ...ARCHIVE_DEFAULT_FILTER, timeRange: '7d' }, NOW)
    expect(filtered.map(t => t.teamId)).toEqual(['a', 'b']) // b 有 1 天前的任务
    const thirty = filterArchivedTeams(teams, { ...ARCHIVE_DEFAULT_FILTER, timeRange: '30d' }, NOW)
    expect(thirty.map(t => t.teamId)).toEqual(['a', 'b'])
    const ninety = filterArchivedTeams(teams, { ...ARCHIVE_DEFAULT_FILTER, timeRange: '90d' }, NOW)
    expect(ninety.map(t => t.teamId)).toEqual(['a', 'b'])
  })

  it('时间边界:恰好等于窗口上限的团队仍保留', () => {
    const atEdge = team({
      teamId: 'edge',
      name: '边界团队',
      tasks: [task({ id: 't1', completedAt: NOW - ARCHIVE_TIME_RANGE_MS['7d'] })],
    })
    const filtered = filterArchivedTeams([atEdge], { ...ARCHIVE_DEFAULT_FILTER, timeRange: '7d' }, NOW)
    expect(filtered.map(t => t.teamId)).toEqual(['edge'])
  })

  it('无锚点团队在「全部时间」下可见,在具体区间下被排除', () => {
    const noAnchor = team({ teamId: 'c', name: '团队C', tasks: [task({ id: 't1' })] })
    expect(filterArchivedTeams([noAnchor], ARCHIVE_DEFAULT_FILTER, NOW).length).toBe(1)
    expect(filterArchivedTeams([noAnchor], { ...ARCHIVE_DEFAULT_FILTER, timeRange: '7d' }, NOW).length).toBe(0)
  })

  it('按复盘筛选:有复盘 / 超时复盘 / 缺复盘', () => {
    const hasRetro = filterArchivedTeams(teams, { ...ARCHIVE_DEFAULT_FILTER, retro: 'hasRetro' }, NOW)
    expect(hasRetro.map(t => t.teamId)).toEqual(['a', 'b'])
    const overran = filterArchivedTeams(teams, { ...ARCHIVE_DEFAULT_FILTER, retro: 'overran' }, NOW)
    expect(overran.map(t => t.teamId)).toEqual(['a'])
    const noRetro = filterArchivedTeams(teams, { ...ARCHIVE_DEFAULT_FILTER, retro: 'noRetro' }, NOW)
    expect(noRetro.map(t => t.teamId)).toEqual(['b', 'c']) // b/c 都有已完成但缺复盘的任务
  })

  it('noRetro 语义钉死:真无完成态任务的团队不算「缺复盘」', () => {
    const noCompleted = team({
      teamId: 'd',
      name: '团队D',
      tasks: [task({ id: 't1', status: 'pending' }), task({ id: 't2', status: 'in_progress' })],
    })
    // 无完成态任务 → missingRetro=false → 不命中 noRetro;但默认筛选可见。
    expect(archiveTeamRetroProfile(noCompleted).missingRetro).toBe(false)
    expect(filterArchivedTeams([noCompleted], { ...ARCHIVE_DEFAULT_FILTER, retro: 'noRetro' }, NOW)).toEqual([])
    expect(filterArchivedTeams([noCompleted], ARCHIVE_DEFAULT_FILTER, NOW)).toHaveLength(1)
  })

  it('组合筛选:团队 × 时间 × 复盘 同时生效', () => {
    const filtered = filterArchivedTeams(teams, {
      ...ARCHIVE_DEFAULT_FILTER,
      team: '团队B',
      timeRange: '7d',
      retro: 'noRetro',
    }, NOW)
    expect(filtered.map(t => t.teamId)).toEqual(['b'])
    const none = filterArchivedTeams(teams, {
      ...ARCHIVE_DEFAULT_FILTER,
      team: '团队A',
      timeRange: '7d',
      retro: 'noRetro',
    }, NOW)
    expect(none).toEqual([])
  })

  it('确定性:同一输入两次结果一致', () => {
    const filter: ArchiveFilterState = { team: '团队A', timeRange: '7d', retro: 'overran' }
    expect(filterArchivedTeams(teams, filter, NOW)).toEqual(filterArchivedTeams(teams, filter, NOW))
  })
})

describe('archivedTeamNames — 团队下拉候选', () => {
  it('按出现顺序去重', () => {
    expect(archivedTeamNames([
      team({ name: '团队A' }),
      team({ name: '团队B' }),
      team({ name: '团队A' }),
    ])).toEqual(['团队A', '团队B'])
  })

  it('空列表 → 空候选', () => {
    expect(archivedTeamNames([])).toEqual([])
  })
})

describe('archive-filter 本地化键(zh + en)', () => {
  it('新增 archive.filter.* 与 archive.time.* / archive.retro.* 键在 zh/en 中齐全', () => {
    const zhKeys: readonly AgentTeamsLocaleKey[] = [
      'archive.filterTeam', 'archive.filterTeamAll', 'archive.filterTime', 'archive.filterRetro',
      'archive.time.all', 'archive.time.7d', 'archive.time.30d', 'archive.time.90d',
      'archive.retro.all', 'archive.retro.hasRetro', 'archive.retro.overran', 'archive.retro.noRetro',
      'archive.filterCount', 'archive.filterEmpty',
    ]
    for (const key of zhKeys) {
      expect(zh[key]).toBeTruthy()
      expect(en[key]).toBeTruthy()
    }
    expect(zh['archive.filterCount']).toContain('{shown}')
    expect(zh['archive.filterCount']).toContain('{total}')
  })
})
