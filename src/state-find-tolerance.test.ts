/**
 * R-23: single-team corruption must not poison the whole workspace.
 *
 * findTeamByCaptain / findTeamByParticipant iterate every team directory
 * under the state root; a corrupted team.json (bad JSON / half-written file /
 * hand-edited breakage) previously made readTeam throw and aborted the whole
 * loop — every agent_teams_* tool in the workspace became unusable. The fix
 * skips + continues on a per-team read failure, mirroring the panel-side
 * tolerance in collectTeamsActivity (snapshot.ts): a broken team is simply
 * invisible to the tool layer, never a workspace-wide outage.
 * @module dsh-agent-team-web/state-find-tolerance.test
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findTeamByCaptain, findTeamByParticipant, readTeam } from './state.ts'
import type { TeamState } from './types.ts'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agent-team-find-tolerance-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function team(overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: '容错测试团队',
    id: 'team-a',
    description: 'demo',
    captainSessionId: 'session-captain-a',
    createdAt: 1000,
    members: [
      { id: 'session-member-a', name: '技术员', role: 'engineer', provider: 'p', model: 'm', joinedAt: 1000, status: 'idle' },
    ],
    tasks: [],
    taskSeq: 0,
    ...overrides,
  }
}

/** Write a team's team.json directly on disk (simulating durable state). */
async function writeTeamState(state: TeamState): Promise<void> {
  const dir = join(tempRoot, state.id)
  await mkdir(join(dir, 'inbox'), { recursive: true })
  await writeFile(join(dir, 'team.json'), JSON.stringify(state, null, 2))
}

/** Corrupt a team's team.json with invalid JSON (bad write / hand edit). */
async function corruptTeamJson(teamId: string): Promise<void> {
  const dir = join(tempRoot, teamId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'team.json'), '{ "id": "team-b", "captainSessionId": "sess', 'utf8')
}

describe('R-23 findTeamByCaptain — 单团队损坏不毒化遍历', () => {
  it('坏团队在前,仍能定位到正常团队,不抛错', async () => {
    await corruptTeamJson('team-b')
    const healthy = team({ id: 'team-a', name: '正常团队A', captainSessionId: 'session-captain-a' })
    await writeTeamState(healthy)

    const found = await findTeamByCaptain(tempRoot, 'session-captain-a')
    expect(found?.id).toBe('team-a')
    expect(found?.name).toBe('正常团队A')
  })

  it('多个正常团队中混入坏团队,坏团队对工具不可见且正常团队照常可定位', async () => {
    await writeTeamState(team({ id: 'team-a', name: '正常团队A', captainSessionId: 'session-captain-a' }))
    await corruptTeamJson('team-b')
    await writeTeamState(team({ id: 'team-c', name: '正常团队C', captainSessionId: 'session-captain-c' }))

    const foundA = await findTeamByCaptain(tempRoot, 'session-captain-a')
    const foundC = await findTeamByCaptain(tempRoot, 'session-captain-c')
    expect(foundA?.id).toBe('team-a')
    expect(foundC?.id).toBe('team-c')

    // 坏团队的队长在工具侧表现为"不存在"(不可见),而非抛错或命中坏数据。
    const brokenCaptain = await findTeamByCaptain(tempRoot, 'session-captain-broken')
    expect(brokenCaptain).toBeUndefined()
  })

  it('半截写(截断 JSON)同样被跳过,其余团队不受影响', async () => {
    await writeTeamState(team({ id: 'team-a', name: '正常团队A', captainSessionId: 'session-captain-a' }))
    // 半截写:合法前缀 + 截断。
    const dir = join(tempRoot, 'team-b')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'team.json'), JSON.stringify(team({ id: 'team-b', captainSessionId: 's' })).slice(0, 40), 'utf8')

    const found = await findTeamByCaptain(tempRoot, 'session-captain-a')
    expect(found?.id).toBe('team-a')
  })

  it('正常团队之间仍保留"队长多团队"守卫(不因容错而放宽)', async () => {
    await writeTeamState(team({ id: 'team-a', name: '正常团队A', captainSessionId: 'session-captain-shared' }))
    await writeTeamState(team({ id: 'team-b', name: '正常团队B', captainSessionId: 'session-captain-shared' }))
    await expect(findTeamByCaptain(tempRoot, 'session-captain-shared'))
      .rejects.toThrow(/leads multiple active teams/)
  })
})

describe('R-23 findTeamByParticipant — 单团队损坏不毒化遍历', () => {
  it('坏团队在前,仍能定位到成员所属的正常团队,不抛错', async () => {
    await corruptTeamJson('team-b')
    await writeTeamState(team({ id: 'team-a', name: '正常团队A', captainSessionId: 'session-captain-a' }))

    const asCaptain = await findTeamByParticipant(tempRoot, 'session-captain-a')
    expect(asCaptain?.id).toBe('team-a')
    const asMember = await findTeamByParticipant(tempRoot, 'session-member-a')
    expect(asMember?.id).toBe('team-a')
  })

  it('坏团队不可见:坏团队的队长/成员找不到所属团队,正常团队不受影响', async () => {
    await writeTeamState(team({ id: 'team-a', name: '正常团队A', captainSessionId: 'session-captain-a' }))
    await corruptTeamJson('team-b')
    await writeTeamState(team({ id: 'team-c', name: '正常团队C', captainSessionId: 'session-captain-c', members: [] }))

    expect((await findTeamByParticipant(tempRoot, 'session-captain-a'))?.id).toBe('team-a')
    expect((await findTeamByParticipant(tempRoot, 'session-member-a'))?.id).toBe('team-a')
    expect((await findTeamByParticipant(tempRoot, 'session-captain-c'))?.id).toBe('team-c')
    // 坏团队(即便其队长 id 与坏文件内容一致)对工具不可见。
    expect(await findTeamByParticipant(tempRoot, 'session-captain-broken')).toBeUndefined()
    expect(await findTeamByParticipant(tempRoot, 'session-member-broken')).toBeUndefined()
  })

  it('非 JSON 目录(如残留 lock 目录)不影响遍历', async () => {
    await writeTeamState(team({ id: 'team-a', name: '正常团队A', captainSessionId: 'session-captain-a' }))
    // 无 team.json 的目录:readTeam 返回 undefined,等效跳过。
    await mkdir(join(tempRoot, 'not-a-team'), { recursive: true })

    const found = await findTeamByParticipant(tempRoot, 'session-captain-a')
    expect(found?.id).toBe('team-a')
  })

  it('正常团队之间仍保留"多团队歧义"守卫', async () => {
    await writeTeamState(team({ id: 'team-a', name: '正常团队A', captainSessionId: 'session-captain-shared' }))
    await writeTeamState(team({ id: 'team-b', name: '正常团队B', captainSessionId: 'session-captain-shared' }))
    await expect(findTeamByParticipant(tempRoot, 'session-captain-shared'))
      .rejects.toThrow(/multiple active teams/)
  })
})

describe('R-23 工具侧一致性 — 坏团队不影响正常团队读写', () => {
  it('坏团队存在时,正常团队 readTeam 仍可用', async () => {
    await corruptTeamJson('team-b')
    await writeTeamState(team({ id: 'team-a', name: '正常团队A', captainSessionId: 'session-captain-a' }))

    const direct = await readTeam(tempRoot, 'team-a')
    expect(direct?.name).toBe('正常团队A')
    // 坏团队直接读取仍抛错(显式定位时保持诚实),但遍历查找不受影响。
    await expect(readTeam(tempRoot, 'team-b')).rejects.toThrow()
  })
})
