/** v0.1.13 collaboration-mode tests: additive mode, light fail-closed, governed guard. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerAgentTeamsTools, type ToolsConfig } from './tools.ts'
import { readTeam, teamMode } from './state.ts'
import type { TeamState } from './types.ts'

const config: ToolsConfig = {
  stateDir: '.agent-team-web',
  memberProvider: 'spawn',
  maxMembers: 8,
  stallThresholdMs: 120_000,
}
const CAPTAIN_ID = 'session-captain'

interface CapturedTool {
  name: string
  execute(args: Record<string, unknown>, exec: { agent: Agent; signal: AbortSignal }): Promise<unknown>
  [key: string]: unknown
}

interface HarnessOverrides {
  resolveCallConfig?: (args: { provider?: string; model?: string; reasoningEffort?: string }) => Promise<{ provider: string; model: string; reasoningEffort?: string }>
  startContinuable?: (options: unknown, seq: number) => Promise<{ childId: string }>
}

function harness(spawned: unknown[] = [], overrides: HarnessOverrides = {}, interrupted: string[] = []): (name: string) => CapturedTool {
  const tools = new Map<string, CapturedTool>()
  let childSeq = 0
  const ctx = {
    tools: { register: (def: CapturedTool) => { tools.set(def.name, def); return def } },
    agents: { get: () => undefined },
    logger: { warn: () => undefined, debug: () => undefined },
    on: () => undefined,
    effect: () => () => undefined,
    llm: {
      // DSH 0.1.7-rc.1 LlmService owns resolveModelInfo; the commissar spawn
      // reads its reasoning metadata, so this stub must expose it.
      resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: model }),
      resolveCallConfig: overrides.resolveCallConfig ?? (async (args: { provider?: string; model?: string; reasoningEffort?: string }) => ({
        provider: args.provider ?? 'deepseek-official',
        model: args.model ?? 'deepseek-v4-flash',
        reasoningEffort: args.reasoningEffort,
      })),
    },
    subagents: {
      registerContinuableSetup: () => undefined,
      followup: async () => undefined,
      interrupt: (childId: string) => { interrupted.push(childId) },
      list: () => ['spawn'],
      getProvider: () => ({ prepareContinuable: {}, capabilities: { persona: true, toolFilter: true } }),
      startContinuable: async (options: unknown) => {
        spawned.push(options)
        const seq = ++childSeq
        return overrides.startContinuable === undefined
          ? { childId: `child-${seq}` }
          : await overrides.startContinuable(options, seq)
      },
    },
  } as unknown as Context
  registerAgentTeamsTools(ctx, config)
  return (name: string) => {
    const def = tools.get(name)
    if (def === undefined) throw new Error(`tool "${name}" not registered`)
    return def
  }
}

function agent(workspace: string): Agent {
  return {
    id: CAPTAIN_ID,
    session: {
      header: { cwd: workspace, id: CAPTAIN_ID },
      id: CAPTAIN_ID,
      requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }),
    },
    options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    steer: () => undefined,
  } as unknown as Agent
}

const execOf = (ref: Agent) => ({ agent: ref, signal: new AbortController().signal })

async function writeTeamToDisk(stateRoot: string, teamState: TeamState): Promise<void> {
  const dir = join(stateRoot, teamState.id)
  await mkdir(join(dir, 'inbox'), { recursive: true })
  await writeFile(join(dir, 'team.json'), JSON.stringify(teamState, null, 2))
}

function legacyTeam(overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: 'legacy team',
    id: 'team-mode',
    captainSessionId: CAPTAIN_ID,
    createdAt: 1000,
    members: [],
    tasks: [],
    taskSeq: 0,
    ...overrides,
  }
}

describe('teamMode helper', () => {
  it('defaults absent/unknown modes to standard', () => {
    expect(teamMode({})).toBe('standard')
    expect(teamMode({ mode: undefined })).toBe('standard')
    expect(teamMode({ mode: 'light' })).toBe('light')
    expect(teamMode({ mode: 'governed' })).toBe('governed')
  })
})

describe('agent_teams_create — mode policy', () => {
  let workspace: string
  let stateRoot: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-mode-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })
  afterEach(async () => { await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) })

  it('light mode creates no commissar and reports the mode', async () => {
    const spawned: unknown[] = []
    const tool = harness(spawned)
    const result = await tool('agent_teams_create').execute(
      { name: 'light team', mode: 'light' },
      execOf(agent(workspace)),
    ) as { mode: string; team_id: string }
    expect(result.mode).toBe('light')
    expect(spawned).toHaveLength(0)
    const persisted = await readTeam(stateRoot, result.team_id)
    expect(persisted?.mode).toBe('light')
    expect(persisted?.members).toHaveLength(0)
  })

  it('default mode still creates the commissar', async () => {
    const spawned: unknown[] = []
    const tool = harness(spawned)
    const result = await tool('agent_teams_create').execute(
      { name: 'standard team' },
      execOf(agent(workspace)),
    ) as { mode: string; team_id: string }
    expect(result.mode).toBe('standard')
    expect(spawned).toHaveLength(1)
    const persisted = await readTeam(stateRoot, result.team_id)
    expect(persisted?.mode).toBe('standard')
    expect(persisted?.members.map(m => m.role)).toEqual(['commissar'])
  })
})

describe('agent_teams_create_task — light mode fail-closed', () => {
  let workspace: string
  let stateRoot: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-mode-task-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })
  afterEach(async () => { await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) })

  it('refuses gated tasks in light mode without persisting anything', async () => {
    await writeTeamToDisk(stateRoot, legacyTeam({ mode: 'light' }))
    const tool = harness()
    await expect(tool('agent_teams_create_task').execute(
      { subject: 'risky', risk: 'high' },
      execOf(agent(workspace)),
    )).rejects.toThrow(/light mode and cannot create a task that needs commissar review/)
    await expect(tool('agent_teams_create_task').execute(
      { subject: 'milestone', milestone: true },
      execOf(agent(workspace)),
    )).rejects.toThrow(/light mode/)
    const persisted = await readTeam(stateRoot, 'team-mode')
    expect(persisted?.tasks).toHaveLength(0)
  })

  it('allows gated tasks in standard mode and marks them reviewRequired', async () => {
    await writeTeamToDisk(stateRoot, legacyTeam({
      mode: 'standard',
      members: [{ id: 'child-1', name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1, status: 'idle' }],
    }))
    const tool = harness()
    await tool('agent_teams_create_task').execute(
      { subject: 'risky', risk: 'critical' },
      execOf(agent(workspace)),
    )
    const persisted = await readTeam(stateRoot, 'team-mode')
    expect(persisted?.tasks[0]?.reviewRequired).toBe(true)
  })

  it('never stamps a mode onto a legacy team during read-only tools', async () => {
    await writeTeamToDisk(stateRoot, legacyTeam({
      members: [{ id: 'child-1', name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1, status: 'idle' }],
    }))
    const file = join(stateRoot, 'team-mode', 'team.json')
    const before = await readFile(file, 'utf8')
    const tool = harness()
    // Read-only tool: no scheduler kick, so any byte change would prove a
    // silent mode stamp rather than unrelated async writes.
    await tool('agent_teams_best_practices').execute({}, execOf(agent(workspace)))
    const after = await readFile(file, 'utf8')
    expect(after).toBe(before)
    expect(JSON.parse(after).mode).toBeUndefined()
  })

  it('treats a legacy team without mode as standard', async () => {
    await writeTeamToDisk(stateRoot, legacyTeam({
      members: [{ id: 'child-1', name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1, status: 'idle' }],
    }))
    const tool = harness()
    await tool('agent_teams_create_task').execute(
      { subject: 'risky', risk: 'high' },
      execOf(agent(workspace)),
    )
    const persisted = await readTeam(stateRoot, 'team-mode')
    expect(persisted?.mode).toBeUndefined()
    expect(persisted?.tasks[0]?.reviewRequired).toBe(true)
  })
})

describe('agent_teams_set_mode — upgrade only', () => {
  let workspace: string
  let stateRoot: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-mode-set-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })
  afterEach(async () => { await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) })

  it('upgrades light to governed and creates the commissar', async () => {
    await writeTeamToDisk(stateRoot, legacyTeam({ mode: 'light' }))
    const spawned: unknown[] = []
    const tool = harness(spawned)
    const result = await tool('agent_teams_set_mode').execute(
      { mode: 'governed' },
      execOf(agent(workspace)),
    ) as { mode: string; changed: boolean; commissar_created: boolean }
    expect(result).toMatchObject({ mode: 'governed', changed: true, commissar_created: true })
    expect(spawned).toHaveLength(1)
    const persisted = await readTeam(stateRoot, 'team-mode')
    expect(persisted?.mode).toBe('governed')
    expect(persisted?.members.some(m => m.role === 'commissar')).toBe(true)
  })

  it('refuses downgrading to light', async () => {
    await writeTeamToDisk(stateRoot, legacyTeam({ mode: 'standard' }))
    const tool = harness()
    await expect(tool('agent_teams_set_mode').execute(
      { mode: 'light' },
      execOf(agent(workspace)),
    )).rejects.toThrow(/cannot be downgraded to light mode/)
    const persisted = await readTeam(stateRoot, 'team-mode')
    expect(persisted?.mode).toBe('standard')
  })

  it('refuses every downgrade, including governed → standard', async () => {
    await writeTeamToDisk(stateRoot, legacyTeam({
      mode: 'governed',
      members: [{ id: 'child-1', name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1, status: 'idle' }],
    }))
    const tool = harness()
    await expect(tool('agent_teams_set_mode').execute(
      { mode: 'standard' },
      execOf(agent(workspace)),
    )).rejects.toThrow(/cannot switch from governed to standard mode/)
    const persisted = await readTeam(stateRoot, 'team-mode')
    expect(persisted?.mode).toBe('governed')
  })

  it('keeps the previous mode when the commissar cannot be created', async () => {
    await writeTeamToDisk(stateRoot, legacyTeam({ mode: 'light' }))
    const tool = harness([], {
      resolveCallConfig: async () => { throw new Error('no usable member route') },
    })
    await expect(tool('agent_teams_set_mode').execute(
      { mode: 'governed' },
      execOf(agent(workspace)),
    )).rejects.toThrow(/no usable member route/)
    const persisted = await readTeam(stateRoot, 'team-mode')
    expect(persisted?.mode).toBe('light')
    expect(persisted?.members).toHaveLength(0)
  })

  it('lands mode and commissar atomically so no gated window opens', async () => {
    await writeTeamToDisk(stateRoot, legacyTeam({ mode: 'light' }))
    const tool = harness()
    await tool('agent_teams_set_mode').execute({ mode: 'standard' }, execOf(agent(workspace)))
    const persisted = await readTeam(stateRoot, 'team-mode')
    expect(persisted?.mode).toBe('standard')
    expect(persisted?.members.filter(m => m.role === 'commissar' && m.status !== 'removed')).toHaveLength(1)
  })

  it('concurrent upgrades keep exactly one commissar and retire the loser', async () => {
    await writeTeamToDisk(stateRoot, legacyTeam({ mode: 'light' }))
    const spawned: unknown[] = []
    const interrupted: string[] = []
    const tool = harness(spawned, {
      // Both upgrades resolve their child before either attaches.
      startContinuable: async (_options, seq) => ({ childId: `child-${seq}` }),
    }, interrupted)
    const results = await Promise.allSettled([
      tool('agent_teams_set_mode').execute({ mode: 'governed' }, execOf(agent(workspace))),
      tool('agent_teams_set_mode').execute({ mode: 'governed' }, execOf(agent(workspace))),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2)
    const persisted = await readTeam(stateRoot, 'team-mode')
    expect(persisted?.mode).toBe('governed')
    const commissars = persisted?.members.filter(m => m.role === 'commissar' && m.status !== 'removed') ?? []
    expect(commissars).toHaveLength(1)
    const retired = JSON.parse(await readFile(join(stateRoot, 'retired-members.json'), 'utf8')) as string[]
    expect(retired.length).toBeGreaterThanOrEqual(1)
    expect(retired).not.toContain(commissars[0]?.id)
    expect(interrupted.length).toBeGreaterThanOrEqual(1)
    expect(interrupted).not.toContain(commissars[0]?.id)
  })

  it('refuses gated tasks when a standard/governed team has no active commissar', async () => {
    await writeTeamToDisk(stateRoot, legacyTeam({ mode: 'standard' }))
    const tool = harness()
    await expect(tool('agent_teams_create_task').execute(
      { subject: 'risky', risk: 'high' },
      execOf(agent(workspace)),
    )).rejects.toThrow(/has no active commissar/)
    const persisted = await readTeam(stateRoot, 'team-mode')
    expect(persisted?.tasks).toHaveLength(0)
  })

  it('retires and interrupts the child when the attach phase fails', async () => {
    await writeTeamToDisk(stateRoot, legacyTeam({ mode: 'light' }))
    const spawned: unknown[] = []
    const interrupted: string[] = []
    const tool = harness(spawned, {
      startContinuable: async () => {
        // Remove the durable team between spawn and attach so the second
        // locked pass fails after the child already exists.
        await rm(stateRoot, { recursive: true, force: true })
        return { childId: 'child-orphan' }
      },
    }, interrupted)
    await expect(tool('agent_teams_set_mode').execute(
      { mode: 'governed' },
      execOf(agent(workspace)),
    )).rejects.toThrow()
    expect(spawned).toHaveLength(1)
    expect(interrupted).toContain('child-orphan')
  })

  it('is a no-op when already in the target mode with a commissar', async () => {
    await writeTeamToDisk(stateRoot, legacyTeam({
      mode: 'governed',
      members: [{ id: 'child-1', name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1, status: 'idle' }],
    }))
    const tool = harness()
    const result = await tool('agent_teams_set_mode').execute(
      { mode: 'governed' },
      execOf(agent(workspace)),
    ) as { changed: boolean; commissar_created: boolean }
    expect(result).toMatchObject({ changed: false, commissar_created: false })
  })
})

describe('agent_teams_remove_member — governed commissar guard', () => {
  let workspace: string
  let stateRoot: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-mode-remove-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })
  afterEach(async () => { await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) })

  it('refuses removing the commissar in governed mode', async () => {
    await writeTeamToDisk(stateRoot, legacyTeam({
      mode: 'governed',
      members: [{ id: 'child-1', name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1, status: 'idle' }],
    }))
    const tool = harness()
    await expect(tool('agent_teams_remove_member').execute(
      { name: '政委' },
      execOf(agent(workspace)),
    )).rejects.toThrow(/governed mode: the commissar provides the required independent review/)
    const persisted = await readTeam(stateRoot, 'team-mode')
    expect(persisted?.members[0]?.status).toBe('idle')
  })

  it('still allows removing the commissar in standard mode', async () => {
    await writeTeamToDisk(stateRoot, legacyTeam({
      mode: 'standard',
      members: [{ id: 'child-1', name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1, status: 'idle' }],
    }))
    const tool = harness()
    await tool('agent_teams_remove_member').execute({ name: '政委' }, execOf(agent(workspace)))
    const persisted = await readTeam(stateRoot, 'team-mode')
    expect(persisted?.members[0]?.status).toBe('removed')
  })
})
