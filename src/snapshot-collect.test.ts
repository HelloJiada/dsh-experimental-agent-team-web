/**
 * R-17: snapshot 采集端补测 —— collectTeamsActivity / collectArchivedTeamsActivity。
 *
 * 覆盖盲区:采集端(读团队目录 → assembleTeamSnapshot)此前 0% 覆盖。本文件
 * 验证:正常采集、ENOENT/坏团队跳过(与面板容错一致)、归档采集(含 removed
 * 成员保留 + historic 标记)、无归档时返回空;以及 Provider 授权中心的
 * providers 快照透出(deepseek-official 恒 enabled,其余看 grants)。
 * @module dsh-agent-team-web/snapshot-collect.test
 */

import type { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectArchivedTeamsActivity, collectProviders, collectTeamsActivity } from './snapshot.ts'
import { archiveTeamDir } from './state.ts'
import type { TeamMember, TeamState } from './types.ts'

function member(name: string, overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: `session-${name}`,
    name,
    role: 'engineer',
    provider: 'p',
    model: 'm',
    joinedAt: 1000,
    status: 'idle',
    ...overrides,
  }
}

function team(id: string, overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: `团队${id}`,
    id,
    description: 'demo',
    captainSessionId: `session-captain-${id}`,
    createdAt: 1000,
    members: [member('技术员')],
    tasks: [],
    taskSeq: 0,
    ...overrides,
  }
}

function context(warns: string[] = []): Context {
  return {
    agents: { get: () => undefined },
    logger: { warn: (message: string) => { warns.push(message) }, debug: () => undefined },
  } as unknown as Context
}

async function writeTeamOnDisk(stateRoot: string, state: TeamState): Promise<void> {
  const dir = join(stateRoot, state.id)
  await mkdir(join(dir, 'inbox'), { recursive: true })
  await writeFile(join(dir, 'team.json'), JSON.stringify(state, null, 2))
}

let workspace: string
let stateRoot: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'agent-team-collect-'))
  stateRoot = join(workspace, '.agent-team-web')
  await mkdir(stateRoot, { recursive: true })
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

describe('collectTeamsActivity — 活动团队采集', () => {
  it('采集多个团队(稳定按目录序),成员/任务进快照', async () => {
    await writeTeamOnDisk(stateRoot, team('team-a', {
      tasks: [{ id: 't1', subject: '任务t1', status: 'completed', dependencies: [], createdAt: 1000, updatedAt: 1000 }],
    }))
    await writeTeamOnDisk(stateRoot, team('team-b'))

    const snapshots = await collectTeamsActivity(context(), [{ workspace, stateRoot }])
    expect(snapshots.map(s => s.teamId).sort()).toEqual(['team-a', 'team-b'])
    const teamA = snapshots.find(s => s.teamId === 'team-a')
    expect(teamA?.name).toBe('团队team-a')
    expect(teamA?.members[0]?.name).toBe('技术员')
    expect(teamA?.tasks[0]?.id).toBe('t1')
  })

  it('t7:成员快照透出落盘 LLM 路由(provider/model/reasoningEffort),旧数据缺省不输出', async () => {
    await writeTeamOnDisk(stateRoot, team('team-llm', {
      members: [
        member('技术员', { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' }),
        // 旧数据(无 model/reasoningEffort)→ 字段不输出。
        member('老兵', { provider: undefined, model: undefined, reasoningEffort: undefined }),
      ],
    }))

    const snapshots = await collectTeamsActivity(context(), [{ workspace, stateRoot }])
    const snapshot = snapshots.find(s => s.teamId === 'team-llm')
    const engineer = snapshot?.members.find(m => m.name === '技术员')
    expect(engineer?.provider).toBe('deepseek-official')
    expect(engineer?.model).toBe('deepseek-v4-flash')
    expect(engineer?.reasoningEffort).toBe('high')
    const legacy = snapshot?.members.find(m => m.name === '老兵')
    expect(legacy?.model).toBeUndefined()
    expect(legacy?.reasoningEffort).toBeUndefined()
  })

  it('非团队目录(无 team.json)被跳过,不产生快照', async () => {
    await mkdir(join(stateRoot, 'not-a-team'), { recursive: true })
    const snapshots = await collectTeamsActivity(context(), [{ workspace, stateRoot }])
    expect(snapshots).toHaveLength(0)
  })

  it('坏团队(非法 JSON)skip + warn,正常团队不受影响(与面板容错一致)', async () => {
    const warns: string[] = []
    await mkdir(join(stateRoot, 'team-broken'), { recursive: true })
    await writeFile(join(stateRoot, 'team-broken', 'team.json'), '{ "id": "team-broken", "captain', 'utf8')
    await writeTeamOnDisk(stateRoot, team('team-ok'))

    const snapshots = await collectTeamsActivity(context(warns), [{ workspace, stateRoot }])
    expect(snapshots.map(s => s.teamId)).toEqual(['team-ok'])
    expect(warns.some(w => w.includes('team-broken'))).toBe(true)
  })

  it('stateRoot 不存在(ENOENT)返回空,不抛错', async () => {
    const snapshots = await collectTeamsActivity(context(), [{ workspace, stateRoot: join(workspace, '.agent-team-web-missing') }])
    expect(snapshots).toHaveLength(0)
  })
})

describe('collectArchivedTeamsActivity — 归档团队采集', () => {
  it('采集 archive/ 下的归档团队(historic + includeRemoved 生效)', async () => {
    await writeTeamOnDisk(stateRoot, team('team-gone', {
      members: [
        member('技术员'),
        member('被移除成员', { status: 'removed' }),
      ],
    }))
    await archiveTeamDir(stateRoot, 'team-gone')

    const snapshots = await collectArchivedTeamsActivity(context(), [{ workspace, stateRoot }])
    expect(snapshots.map(s => s.teamId)).toEqual(['team-gone'])
    const archived = snapshots[0]
    // historic 快照保留 removed 成员(面板历史视角需要完整名单)。
    expect(archived?.members.some(m => m.name === '被移除成员')).toBe(true)
  })

  it('无 archive 目录返回空,不抛错', async () => {
    const snapshots = await collectArchivedTeamsActivity(context(), [{ workspace, stateRoot }])
    expect(snapshots).toHaveLength(0)
  })

  it('坏归档团队 skip + warn,正常归档不受影响', async () => {
    const warns: string[] = []
    await writeTeamOnDisk(stateRoot, team('team-good'))
    await archiveTeamDir(stateRoot, 'team-good')
    await mkdir(join(stateRoot, 'archive', 'team-broken'), { recursive: true })
    await writeFile(join(stateRoot, 'archive', 'team-broken', 'team.json'), 'not-json{', 'utf8')

    const snapshots = await collectArchivedTeamsActivity(context(warns), [{ workspace, stateRoot }])
    expect(snapshots.map(s => s.teamId)).toEqual(['team-good'])
    expect(warns.some(w => w.includes('team-broken'))).toBe(true)
  })
})

describe('collectTeamsActivity — providers 快照透出(授权中心数据源)', () => {
  /** ctx 桩携带 llm.listProviders,模拟 DSH 已注册 provider 路由。 */
  function llmContext(providers: readonly { id: string; name: string }[]): Context {
    return {
      agents: { get: () => undefined },
      logger: { warn: () => undefined, debug: () => undefined },
      llm: { listProviders: () => providers },
    } as unknown as Context
  }

  it('透出全部注册 provider;deepseek-official 恒 enabled,其余看 settings enabledProviders', async () => {
    await writeTeamOnDisk(stateRoot, team('team-prov'))

    const snapshots = await collectTeamsActivity(llmContext([
      { id: 'deepseek-official', name: 'DeepSeek Official' },
      { id: 'kimi-coding', name: 'Kimi Coding' },
      { id: 'xiaomi', name: 'Xiaomi' },
    ]), [{ workspace, stateRoot }], () => ({ 'kimi-coding': false, xiaomi: true }))
    const snapshot = snapshots.find(s => s.teamId === 'team-prov')
    expect(snapshot?.providers).toEqual([
      { id: 'deepseek-official', name: 'DeepSeek Official', enabled: true },
      { id: 'kimi-coding', name: 'Kimi Coding', enabled: false },
      { id: 'xiaomi', name: 'Xiaomi', enabled: true },
    ])
  })

  it('授权撤销后快照 enabled 立即翻转(无需重启);settings 缺席时全为未授权', async () => {
    await writeTeamOnDisk(stateRoot, team('team-prov2'))

    const granted = await collectTeamsActivity(llmContext([
      { id: 'deepseek-official', name: 'DeepSeek Official' },
      { id: 'xiaomi', name: 'Xiaomi' },
    ]), [{ workspace, stateRoot }], () => ({ xiaomi: true }))
    expect(granted.find(s => s.teamId === 'team-prov2')?.providers).toEqual([
      { id: 'deepseek-official', name: 'DeepSeek Official', enabled: true },
      { id: 'xiaomi', name: 'Xiaomi', enabled: true },
    ])

    // settings 未接线(reader undefined)→ 非 deepseek 全部未授权(单通道默认)。
    const noSettings = await collectTeamsActivity(llmContext([
      { id: 'deepseek-official', name: 'DeepSeek Official' },
      { id: 'xiaomi', name: 'Xiaomi' },
    ]), [{ workspace, stateRoot }])
    expect(noSettings.find(s => s.teamId === 'team-prov2')?.providers).toEqual([
      { id: 'deepseek-official', name: 'DeepSeek Official', enabled: true },
      { id: 'xiaomi', name: 'Xiaomi', enabled: false },
    ])
  })

  it('ctx 无 llm(头部/非 web 环境)→ providers 空数组,快照不崩', async () => {
    await writeTeamOnDisk(stateRoot, team('team-plain'))
    const snapshots = await collectTeamsActivity(context(), [{ workspace, stateRoot }])
    expect(snapshots.find(s => s.teamId === 'team-plain')?.providers).toEqual([])
  })

  it('t10:collectProviders 顶层独立可用(不依赖团队快照,空库也返回注册表)', async () => {
    // 无任何团队(stateRoot 空目录):/state 顶层 providers 仍应返回注册表。
    const providers = collectProviders(llmContext([
      { id: 'deepseek-official', name: 'DeepSeek Official' },
      { id: 'xiaomi', name: 'Xiaomi' },
    ]), () => ({ xiaomi: true }))
    expect(providers).toEqual([
      { id: 'deepseek-official', name: 'DeepSeek Official', enabled: true },
      { id: 'xiaomi', name: 'Xiaomi', enabled: true },
    ])
    // settings 缺席(reader undefined)→ 非 deepseek 全未授权。
    const noSettings = collectProviders(llmContext([
      { id: 'deepseek-official', name: 'DeepSeek Official' },
      { id: 'xiaomi', name: 'Xiaomi' },
    ]))
    expect(noSettings).toEqual([
      { id: 'deepseek-official', name: 'DeepSeek Official', enabled: true },
      { id: 'xiaomi', name: 'Xiaomi', enabled: false },
    ])
  })
})
