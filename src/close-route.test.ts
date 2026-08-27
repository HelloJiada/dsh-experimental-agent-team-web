import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CLOSE_BODY_CAP_BYTES,
  handleCloseTeam,
  isTeamCloseable,
  prepareTeamForArchive,
  readJsonBody,
} from './close-route.ts'
import { readTeam } from './state.ts'
import type { ToolsConfig } from './tools.ts'
import type { TeamMember, TeamState, TeamTask } from './types.ts'

const config: ToolsConfig = {
  stateDir: '.agent-team-web',
  memberProvider: 'spawn',
  maxMembers: 8,
  stallThresholdMs: 120_000,
}

function team(overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: '测试团队',
    id: 'team-close',
    description: 'demo',
    captainSessionId: 'session-captain',
    createdAt: 1000,
    members: [
      { id: 'session-member-1', name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1000, status: 'idle' },
      { id: 'session-member-2', name: '技术员', role: 'engineer', provider: 'p', model: 'm', joinedAt: 1001, status: 'idle' },
    ],
    tasks: [],
    taskSeq: 0,
    ...overrides,
  }
}

function task(id: string, overrides: Partial<TeamTask> = {}): TeamTask {
  return {
    id,
    subject: `任务${id}`,
    status: 'pending',
    dependencies: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

/** Write a team record at `<stateRoot>/<team.id>/team.json`. */
async function writeTeamToDisk(stateRoot: string, teamState: TeamState): Promise<void> {
  const dir = join(stateRoot, teamState.id)
  await mkdir(join(dir, 'inbox'), { recursive: true })
  await writeFile(join(dir, 'team.json'), JSON.stringify(teamState, null, 2))
}

/** A minimal IncomingMessage whose body streams the given raw text. */
function request(method: string, rawBody?: string): IncomingMessage {
  const stream = new PassThrough()
  const req = stream as unknown as IncomingMessage
  req.method = method
  stream.end(rawBody ?? '')
  return req
}

interface ResState {
  status: number
  headers: Record<string, string | number | undefined>
  body: string
}

/** A minimal ServerResponse recording status/headers/body. */
function response(): { res: ServerResponse; state: ResState } {
  const state: ResState = { status: 0, headers: {}, body: '' }
  const res = {
    writeHead(status: number, headers?: Record<string, string | number>): unknown {
      state.status = status
      if (headers !== undefined) state.headers = headers
      return res
    },
    end(payload?: string): void {
      state.body = payload ?? ''
    },
  } as unknown as ServerResponse
  return { res, state }
}

/** A context stub: agents registry (offline captain by default) + logger. */
function context(overrides: { liveCaptain?: unknown } = {}): Context {
  return {
    agents: { get: () => overrides.liveCaptain },
    logger: { warn: () => undefined, debug: () => undefined },
  } as unknown as Context
}

function registry(workspaces: readonly { path: string; title: string }[]): WorkspaceRegistry {
  return { list: () => workspaces } as unknown as WorkspaceRegistry
}

describe('readJsonBody — bounded body parsing', () => {
  it('parses a valid JSON body', async () => {
    await expect(readJsonBody(request('POST', '{"a":1}'))).resolves.toEqual({ a: 1 })
  })

  it('rejects an empty body as an empty object', async () => {
    await expect(readJsonBody(request('POST', ''))).resolves.toEqual({})
  })

  it('rejects bodies over the size cap', async () => {
    const oversized = JSON.stringify({ teamId: 'x'.repeat(CLOSE_BODY_CAP_BYTES) })
    await expect(readJsonBody(request('POST', oversized))).rejects.toThrow(/exceeds/)
  })
})

describe('isTeamCloseable — host-side close gate', () => {
  it('no tasks or all completed is closeable', () => {
    expect(isTeamCloseable(team())).toBe(true)
    expect(isTeamCloseable(team({ tasks: [task('t1', { status: 'completed' })] }))).toBe(true)
  })

  it('any unfinished task blocks close', () => {
    expect(isTeamCloseable(team({ tasks: [task('t1', { status: 'in_progress' })] }))).toBe(false)
    expect(isTeamCloseable(team({ tasks: [task('t1', { status: 'failed' })] }))).toBe(false)
    expect(isTeamCloseable(team({ tasks: [task('t1', { status: 'pending' })] }))).toBe(false)
  })
})

describe('handleCloseTeam — POST /plugins/agent-team-web/close', () => {
  let workspace: string
  let stateRoot: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-close-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('405 on non-POST methods, advertising the allowed method', async () => {
    const { res, state } = response()
    await handleCloseTeam(context(), config, registry([]), request('GET'), res)
    expect(state.status).toBe(405)
    expect(state.headers.allow).toBe('POST')
  })

  it('400 on an invalid JSON body', async () => {
    const { res, state } = response()
    await handleCloseTeam(context(), config, registry([]), request('POST', '{not json'), res)
    expect(state.status).toBe(400)
    expect(JSON.parse(state.body).reason).toBe('invalid json body')
  })

  it('400 when teamId or captainSessionId is missing', async () => {
    const { res, state } = response()
    await handleCloseTeam(
      context(), config, registry([]),
      request('POST', JSON.stringify({ teamId: 'team-close' })),
      res,
    )
    expect(state.status).toBe(400)
    expect(JSON.parse(state.body).reason).toBe('teamId and captainSessionId required')
  })

  it('404 when the team does not exist anywhere', async () => {
    const { res, state } = response()
    await handleCloseTeam(
      context(), config, registry([{ path: workspace, title: 'w' }]),
      request('POST', JSON.stringify({ teamId: 'ghost', captainSessionId: 'session-captain' })),
      res,
    )
    expect(state.status).toBe(404)
  })

  it('404 when the team is already archived (only under archive/)', async () => {
    await writeTeamToDisk(join(stateRoot, 'archive'), team())
    const { res, state } = response()
    await handleCloseTeam(
      context(), config, registry([{ path: workspace, title: 'w' }]),
      request('POST', JSON.stringify({ teamId: 'team-close', captainSessionId: 'session-captain' })),
      res,
    )
    expect(state.status).toBe(404)
  })

  it('403 when the requester session does not own the team', async () => {
    await writeTeamToDisk(stateRoot, team())
    const { res, state } = response()
    await handleCloseTeam(
      context(), config, registry([{ path: workspace, title: 'w' }]),
      request('POST', JSON.stringify({ teamId: 'team-close', captainSessionId: 'session-other' })),
      res,
    )
    expect(state.status).toBe(403)
  })

  it('409 when a task is still in progress (defense in depth)', async () => {
    await writeTeamToDisk(stateRoot, team({
      tasks: [task('t1', { status: 'in_progress', assignee: '技术员' })],
    }))
    const { res, state } = response()
    await handleCloseTeam(
      context(), config, registry([{ path: workspace, title: 'w' }]),
      request('POST', JSON.stringify({ teamId: 'team-close', captainSessionId: 'session-captain' })),
      res,
    )
    expect(state.status).toBe(409)
  })

  it('400 when the team id exists under multiple workspaces (ambiguous)', async () => {
    const workspace2 = await mkdtemp(join(tmpdir(), 'agent-team-close-2-'))
    const stateRoot2 = join(workspace2, '.agent-team-web')
    try {
      await mkdir(stateRoot2, { recursive: true })
      await writeTeamToDisk(stateRoot, team())
      await writeTeamToDisk(stateRoot2, team())
      const { res, state } = response()
      await handleCloseTeam(
        context(), config,
        registry([{ path: workspace, title: 'w1' }, { path: workspace2, title: 'w2' }]),
        request('POST', JSON.stringify({ teamId: 'team-close', captainSessionId: 'session-captain' })),
        res,
      )
      expect(state.status).toBe(400)
    } finally {
      await rm(workspace2, { recursive: true, force: true })
    }
  })

  it('200 archives a fully-completed team: members removed, subagents retired, live dir moved', async () => {
    await writeTeamToDisk(stateRoot, team({
      tasks: [task('t1', { status: 'completed', assignee: '技术员', attemptId: 'att-1' })],
    }))
    const { res, state } = response()
    await handleCloseTeam(
      context(), config, registry([{ path: workspace, title: 'w' }]),
      request('POST', JSON.stringify({ teamId: 'team-close', captainSessionId: 'session-captain' })),
      res,
    )

    expect(state.status).toBe(200)
    expect(JSON.parse(state.body)).toEqual({ ok: true, team_id: 'team-close', archived: true })

    // Live team directory is gone; the archived record exists instead.
    expect(await readdir(stateRoot)).not.toContain('team-close')
    const archived = await readTeam(join(stateRoot, 'archive'), 'team-close')
    expect(archived?.name).toBe('测试团队')
    expect(archived?.members.every(member => member.status === 'removed')).toBe(true)

    // Completed tasks keep their attempt; nothing was invalidated.
    expect(archived?.tasks[0]?.attemptId).toBe('att-1')

    // Both member subagents landed in the durable retired-member deny-list.
    const retired = JSON.parse(await readFile(join(stateRoot, 'retired-members.json'), 'utf8')) as string[]
    expect(retired).toContain('session-member-1')
    expect(retired).toContain('session-member-2')
  })
})

describe('prepareTeamForArchive — locked archive preparation', () => {
  let workspace: string
  let stateRoot: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-prepare-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('marks every member removed and invalidates unfinished member-owned tasks', async () => {
    await writeTeamToDisk(stateRoot, team({
      tasks: [
        task('t1', { status: 'in_progress', assignee: '技术员', attemptId: 'att-1', attempt: 1 }),
        task('t2', { status: 'pending', assignee: '政委', attemptId: 'att-2', attempt: 1 }),
        task('t3', { status: 'completed', assignee: '技术员', attemptId: 'att-3', attempt: 1 }),
      ],
    }))

    const roster = await prepareTeamForArchive(stateRoot, 'team-close')
    expect(roster.map(member => member.name)).toEqual(['政委', '技术员'])

    const persisted = await readTeam(stateRoot, 'team-close')
    expect(persisted?.members.every(member => member.status === 'removed')).toBe(true)
    const t1 = persisted?.tasks.find(t => t.id === 't1')
    expect(t1?.status).toBe('pending')
    expect(t1?.assignee).toBeUndefined()
    expect(t1?.attemptId).toBeUndefined()
    expect(persisted?.tasks.find(t => t.id === 't2')?.attemptId).toBeUndefined()
    expect(persisted?.tasks.find(t => t.id === 't3')?.attemptId).toBe('att-3')
  })

  it('includes already-removed members in the roster (retirement completeness)', async () => {
    const removedMember: TeamMember = {
      id: 'session-member-3', name: '前成员', role: 'engineer', provider: 'p', model: 'm', joinedAt: 1000, status: 'removed',
    }
    await writeTeamToDisk(stateRoot, team({ members: [...team().members, removedMember] }))
    const roster = await prepareTeamForArchive(stateRoot, 'team-close')
    expect(roster.map(member => member.id)).toContain('session-member-3')
  })
})
