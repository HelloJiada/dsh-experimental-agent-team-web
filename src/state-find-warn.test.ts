/**
 * R-23 补 warn:调用层告警注入测试。
 *
 * state.ts 纯函数层对不可读团队目录(坏 JSON/半截写)静默跳过,排障时只见
 * "you do not lead or belong to any active team yet"。修复在 tools.ts 调用层
 * (requireCaptainTeam/requireParticipantTeam)注入 logger.warn 痕迹,与面板侧
 * snapshot.ts skip+warn 语义一致。本测试断言:
 * - 纯函数层:onSkipped 观察回调被调用(目录 id + 原始错误),且不影响 skip 语义
 *   (正常团队照常定位、守卫不放松、无回调时行为不变);
 * - 调用层:坏团队目录存在时 logger.warn 被调用且工具正常可用;健康工作区
 *   不产生告警(无虚假噪声)。
 * @module dsh-agent-team-web/state-find-warn
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findTeamByCaptain, findTeamByParticipant, readTeam } from './state.ts'
import { registerAgentTeamsTools, type ToolsConfig } from './tools.ts'
import type { TeamState } from './types.ts'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agent-team-find-warn-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function team(overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: '告警测试团队',
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

describe('R-23 纯函数层 onSkipped 观察回调 — 告警不改变 skip 语义', () => {
  it('findTeamByCaptain:坏团队被跳过时回调携带目录 id 与错误,正常团队仍可定位', async () => {
    await corruptTeamJson('team-b')
    await writeTeamState(team({ id: 'team-a', name: '正常团队A', captainSessionId: 'session-captain-a' }))

    const skipped: Array<{ teamId: string; error: unknown }> = []
    const found = await findTeamByCaptain(
      tempRoot,
      'session-captain-a',
      (teamId, error) => { skipped.push({ teamId, error }) },
    )

    expect(skipped).toHaveLength(1)
    expect(skipped[0]!.teamId).toBe('team-b')
    expect(skipped[0]!.error).toBeInstanceOf(Error)
    expect(found?.id).toBe('team-a')
  })

  it('findTeamByParticipant:回调同样触发,坏团队对工具不可见,正常团队不受影响', async () => {
    await corruptTeamJson('team-b')
    await writeTeamState(team({ id: 'team-a', name: '正常团队A', captainSessionId: 'session-captain-a' }))

    const skippedTeamIds: string[] = []
    const found = await findTeamByParticipant(
      tempRoot,
      'session-captain-a',
      (teamId) => { skippedTeamIds.push(teamId) },
    )

    expect(skippedTeamIds).toEqual(['team-b'])
    expect(found?.id).toBe('team-a')
  })

  it('非 JSON 目录(无 team.json → ENOENT → undefined)不触发回调:只有真损坏才告警', async () => {
    await writeTeamState(team({ id: 'team-a', name: '正常团队A', captainSessionId: 'session-captain-a' }))
    await mkdir(join(tempRoot, 'not-a-team'), { recursive: true })

    const skipped: string[] = []
    const found = await findTeamByParticipant(tempRoot, 'session-captain-a', teamId => { skipped.push(teamId) })
    expect(found?.id).toBe('team-a')
    expect(skipped).toEqual([])
  })

  it('不传回调时保持原有静默跳过语义(回归:默认行为不变)', async () => {
    await corruptTeamJson('team-b')
    await writeTeamState(team({ id: 'team-a', name: '正常团队A', captainSessionId: 'session-captain-a' }))

    const found = await findTeamByCaptain(tempRoot, 'session-captain-a')
    expect(found?.id).toBe('team-a')
    // 坏团队对工具仍不可见,而非抛错。
    expect(await findTeamByCaptain(tempRoot, 'session-captain-broken')).toBeUndefined()
  })

  it('多团队守卫不因回调而放宽(与容错修复前行为一致)', async () => {
    await writeTeamState(team({ id: 'team-a', name: '正常团队A', captainSessionId: 'session-captain-shared' }))
    await writeTeamState(team({ id: 'team-b', name: '正常团队B', captainSessionId: 'session-captain-shared' }))

    const skipped: string[] = []
    await expect(findTeamByCaptain(tempRoot, 'session-captain-shared', teamId => { skipped.push(teamId) }))
      .rejects.toThrow(/leads multiple active teams/)
    expect(skipped).toEqual([])
  })
})

describe('R-23 调用层 warn 注入 — tools.ts logger.warn 被调用且不影响工具可用性', () => {
  interface CapturedTool {
    name: string
    execute(args: Record<string, unknown>, exec: { agent: Agent; signal: AbortSignal }): Promise<unknown>
    [key: string]: unknown
  }

  const config: ToolsConfig = {
    stateDir: '.agent-team-web',
    memberProvider: 'spawn',
    maxMembers: 8,
    stallThresholdMs: 120_000,
  }
  const CAPTAIN_ID = 'session-captain-a'
  const ENGINEER_ID = 'session-member-a'

  /** 最小桩 ctx,logger.warn 为可断言 spy(其余与 tools-* 测试同款)。 */
  function harness(warnSpy: ReturnType<typeof vi.fn>): (name: string) => CapturedTool {
    const tools = new Map<string, CapturedTool>()
    const fakeCtx = {
      tools: { register: (def: CapturedTool) => { tools.set(def.name, def); return def } },
      agents: {
        get: (id: string) => id === ENGINEER_ID
          ? { id, status: 'running', whenIdle: async () => undefined }
          : undefined,
      },
      llm: { resolveCallConfig: async () => ({ provider: 'p', model: 'm' }) },
      logger: { warn: warnSpy, debug: vi.fn() },
      on: () => undefined,
      effect: () => () => undefined,
      subagents: {
        registerContinuableSetup: () => undefined,
        followup: async () => undefined,
        interrupt: () => undefined,
        list: () => ['spawn'],
        getProvider: () => ({
          prepareContinuable: {},
          capabilities: { persona: true, toolFilter: true },
        }),
        startContinuable: async () => ({ childId: 'child-1' }),
      },
    } as unknown as Context
    registerAgentTeamsTools(fakeCtx, config)
    return (name: string) => {
      const def = tools.get(name)
      if (def === undefined) throw new Error(`tool "${name}" not registered`)
      return def
    }
  }

  function agent(workspace: string, id: string): Agent {
    return {
      id,
      session: {
        header: { cwd: workspace, id },
        id,
        requestHeader: () => ({ config: {} }),
      },
      options: { provider: 'p', model: 'm' },
      steer: () => undefined,
    } as unknown as Agent
  }

  const execOf = (agentRef: Agent) => ({ agent: agentRef, signal: new AbortController().signal })

  /** 写入调用层工具实际读取的状态根(workspace/.agent-team-web)。 */
  async function writeTeamToStateRoot(state: TeamState): Promise<void> {
    const dir = join(stateRoot, state.id)
    await mkdir(join(dir, 'inbox'), { recursive: true })
    await writeFile(join(dir, 'team.json'), JSON.stringify(state, null, 2))
  }

  let workspace: string
  let stateRoot: string
  let warnSpy: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-warn-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
    warnSpy = vi.fn()
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('坏团队目录存在时:agent_teams_status 照常返回,logger.warn 记录被跳过目录', async () => {
    const tool = harness(warnSpy)
    // 坏团队目录 + 队长所属正常团队同工作区。
    const brokenDir = join(stateRoot, 'team-broken')
    await mkdir(brokenDir, { recursive: true })
    await writeFile(join(brokenDir, 'team.json'), '{ "id": "team-broken"', 'utf8')
    await writeTeamToStateRoot(team({ id: 'team-a', name: '正常团队A', captainSessionId: CAPTAIN_ID }))

    const result = await tool('agent_teams_status').execute({}, execOf(agent(workspace, CAPTAIN_ID))) as { team_id: string }
    expect(result.team_id).toBe('team-a')

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const message = String(warnSpy.mock.calls[0]![0])
    expect(message).toContain('agent-team-web: skipped unreadable team dir')
    expect(message).toContain('team-broken')
  })

  it('健康工作区:工具可用且不产生告警(无虚假噪声)', async () => {
    const tool = harness(warnSpy)
    await writeTeamToStateRoot(team({ id: 'team-a', name: '正常团队A', captainSessionId: CAPTAIN_ID }))

    const result = await tool('agent_teams_status').execute({}, execOf(agent(workspace, CAPTAIN_ID))) as { team_id: string }
    expect(result.team_id).toBe('team-a')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('坏团队对成员侧同样告警:无归属成员看不到正常团队以外的目录,但仍告警', async () => {
    const tool = harness(warnSpy)
    const brokenDir = join(stateRoot, 'team-broken')
    await mkdir(brokenDir, { recursive: true })
    await writeFile(join(brokenDir, 'team.json'), '{ "id": "team-broken"', 'utf8')
    await writeTeamToStateRoot(team({ id: 'team-a', name: '正常团队A', captainSessionId: CAPTAIN_ID }))

    const result = await tool('agent_teams_status').execute({}, execOf(agent(workspace, ENGINEER_ID))) as { team_id: string }
    expect(result.team_id).toBe('team-a')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]![0])).toContain('team-broken')
  })

  it('直接定位(agent_teams_status 不存在团队)时坏目录告警仍出现,且错误信息不变', async () => {
    const tool = harness(warnSpy)
    // 只有坏团队,没有正常团队:工具应抛"不属于任何团队"而非被坏目录毒化。
    const brokenDir = join(stateRoot, 'team-broken')
    await mkdir(brokenDir, { recursive: true })
    await writeFile(join(brokenDir, 'team.json'), '{ "id": "team-broken"', 'utf8')

    await expect(tool('agent_teams_status').execute({}, execOf(agent(workspace, CAPTAIN_ID))))
      .rejects.toThrow(/do not lead or belong to any active team yet/)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]![0])).toContain('team-broken')
  })
})

describe('R-23 一致性 — 显式 readTeam 仍诚实抛错,遍历层才跳过', () => {
  it('坏团队显式读取抛错,与遍历容错并行不悖', async () => {
    await corruptTeamJson('team-b')
    await writeTeamState(team({ id: 'team-a', name: '正常团队A', captainSessionId: 'session-captain-a' }))

    const skipped: string[] = []
    const found = await findTeamByCaptain(tempRoot, 'session-captain-a', teamId => { skipped.push(teamId) })
    expect(found?.id).toBe('team-a')
    expect(skipped).toEqual(['team-b'])
    await expect(readTeam(tempRoot, 'team-b')).rejects.toThrow()
  })
})
