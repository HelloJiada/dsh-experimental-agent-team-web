import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerAgentTeamsTools, type ToolsConfig } from './tools.ts'
import { readTeam } from './state.ts'
import type { TeamMember, TeamState, TeamTask } from './types.ts'

const config: ToolsConfig = { stateDir: '.agent-team-web', memberProvider: 'spawn', maxMembers: 8, stallThresholdMs: 120_000 }
const CAPTAIN_ID = 'session-captain'
const COMMISSAR_ID = 'session-commissar'
const ENGINEER_ID = 'session-engineer'

function team(overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: 'workflow team', id: 'workflow-team', description: 'legacy description',
    captainSessionId: CAPTAIN_ID, createdAt: 1,
    members: [
      { id: COMMISSAR_ID, name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1, status: 'idle' },
      { id: ENGINEER_ID, name: '技术员', role: 'engineer', provider: 'p', model: 'm', joinedAt: 2, status: 'idle' },
    ],
    tasks: [], taskSeq: 0, ...overrides,
  }
}

function task(id: string, overrides: Partial<TeamTask> = {}): TeamTask {
  return { id, subject: id, status: 'pending', dependencies: [], createdAt: 1, updatedAt: 1, ...overrides }
}

async function writeTeamToDisk(root: string, value: TeamState): Promise<void> {
  await mkdir(join(root, value.id, 'inbox'), { recursive: true })
  await writeFile(join(root, value.id, 'team.json'), JSON.stringify(value, null, 2))
}

interface CapturedTool { name: string; execute(args: Record<string, unknown>, exec: { agent: Agent; signal: AbortSignal }): Promise<unknown> }
function harness(): (name: string) => CapturedTool {
  const tools = new Map<string, CapturedTool>()
  const ctx = {
    tools: { register: (def: CapturedTool) => { tools.set(def.name, def); return def } },
    agents: { get: (id: string) => [COMMISSAR_ID, ENGINEER_ID].includes(id) ? { id, status: 'running', session: { header: { cwd: '' } }, whenIdle: async () => undefined } : undefined },
    logger: { warn: () => undefined, debug: () => undefined },
    on: () => undefined, effect: () => () => undefined,
    subagents: { registerContinuableSetup: () => undefined, followup: async () => undefined },
  } as unknown as Context
  registerAgentTeamsTools(ctx, config)
  return (name: string) => {
    const found = tools.get(name)
    if (found === undefined) throw new Error(`tool ${name} missing`)
    return found
  }
}
function agent(workspace: string, id: string): Agent {
  return { id, session: { header: { cwd: workspace }, id }, steer: () => undefined } as unknown as Agent
}
const execOf = (value: Agent) => ({ agent: value, signal: new AbortController().signal })

describe('workflow guardrails — tool integration', () => {
  let workspace = ''
  let stateRoot = ''
  const tool = harness()
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-workflow-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })
  afterEach(async () => { await rm(workspace, { recursive: true, force: true }) })

  it('rejects duplicate active writers including normalized root files and terminal releases lock', async () => {
    await writeTeamToDisk(stateRoot, team())
    const captain = agent(workspace, CAPTAIN_ID)
    const first = await tool('agent_teams_create_task').execute(
      { subject: 'writer', description: 'writes readme', deliverable: 'README.md' }, execOf(captain),
    ) as { task_id: string }
    await expect(tool('agent_teams_create_task').execute(
      { subject: 'duplicate', description: 'same output', deliverable: './README.md' }, execOf(captain),
    )).rejects.toThrow(/already has an active writer/)
    const persisted = await readTeam(stateRoot, 'workflow-team')
    const current = persisted!.tasks.find((item) => item.id === first.task_id)!
    current.status = 'completed'
    await writeTeamToDisk(stateRoot, persisted!)
    await expect(tool('agent_teams_create_task').execute(
      { subject: 'followup', description: 'terminal writer releases path', deliverable: './README.md' }, execOf(captain),
    )).resolves.toMatchObject({ task_id: 't2' })
  })

  it('enforces four impact classes, decision budget exceptions, and transitive maintenance blockers', async () => {
    await writeTeamToDisk(stateRoot, team({ goal: 'decide', workflowMode: 'decision', mainChainTaskBudget: 1 }))
    const captain = agent(workspace, CAPTAIN_ID)
    await tool('agent_teams_create_task').execute(
      { subject: 'maintenance first', description: 'does not consume decision budget', impact: 'maintenance' }, execOf(captain),
    )
    let persisted = await readTeam(stateRoot, 'workflow-team')
    expect(persisted?.mainChainTaskUsed ?? 0).toBe(0)
    const first = await tool('agent_teams_create_task').execute({ subject: 'main 1', description: 'decision', impact: 'changes-decision' }, execOf(captain)) as { task_id: string }
    persisted = await readTeam(stateRoot, 'workflow-team')
    expect(persisted?.tasks.find((item) => item.id === first.task_id)?.impact).toBe('changes-decision')
    await expect(tool('agent_teams_create_task').execute(
      { subject: 'main 2', description: 'over budget', impact: 'blocks-execution' }, execOf(captain),
    )).rejects.toThrow(/budget exhausted/)
    const exception = await tool('agent_teams_create_task').execute(
      { subject: 'main exception', description: 'changes decision', impact: 'evidence-quality', over_budget_decision_impact: 'changes final decision' }, execOf(captain),
    ) as { task_id: string }
    persisted = await readTeam(stateRoot, 'workflow-team')
    expect(persisted?.tasks.find((item) => item.id === exception.task_id)?.budgetException?.decisionImpact).toBe('changes final decision')

    await writeTeamToDisk(stateRoot, team({
      tasks: [task('t1', { impact: 'maintenance' }), task('t2', { dependencies: ['t1'] })], taskSeq: 2,
    }))
    await expect(tool('agent_teams_create_task').execute(
      { subject: 'decision chain', description: 'must not wait on maintenance', impact: 'changes-decision', dependencies: ['t2'] }, execOf(captain),
    )).rejects.toThrow(/cannot depend on maintenance task path/)
  })

  it('projects legacy task impact as blocks-execution in status', async () => {
    await writeTeamToDisk(stateRoot, team({ tasks: [task('t1')], taskSeq: 1 }))
    const status = await tool('agent_teams_status').execute({}, execOf(agent(workspace, CAPTAIN_ID))) as {
      tasks: Array<{ id: string; impact: string }>
    }
    expect(status.tasks.find((item) => item.id === 't1')?.impact).toBe('blocks-execution')
  })

  it('lets governance-maintenance mode exceed decision budget while status exposes real workflow values', async () => {
    await writeTeamToDisk(stateRoot, team({
      goal: 'governance cleanup', workflowMode: 'governance-maintenance', mainChainTaskBudget: 1,
    }))
    const captain = agent(workspace, CAPTAIN_ID)
    await tool('agent_teams_create_task').execute(
      { subject: 'first evidence', description: 'first', impact: 'evidence-quality' }, execOf(captain),
    )
    await expect(tool('agent_teams_create_task').execute(
      { subject: 'second evidence', description: 'budget is observable but not a governance reject', impact: 'blocks-execution' }, execOf(captain),
    )).resolves.toMatchObject({ task_id: 't2' })
    const status = await tool('agent_teams_status').execute({}, execOf(captain)) as {
      goal: string; workflow_mode: string; main_chain_task_budget: number; main_chain_task_used: number
    }
    expect(status).toMatchObject({
      goal: 'governance cleanup', workflow_mode: 'governance-maintenance', main_chain_task_budget: 1, main_chain_task_used: 2,
    })
  })

  it('reassigns acceptance in place, archives the review, and persists verification boundaries', async () => {
    const current = task('t1', {
      status: 'in_progress', assignee: '技术员', attempt: 1, attemptId: 'attempt-1',
      acceptance: 'old acceptance', acceptanceRevision: 1, contractRevision: 1,
      review: { reviewerName: '政委', verdict: 'pass', reviewedAt: 1, attempt: 1, contractRevision: 1 },
      verification: { checked: ['fixture'], unchecked: ['network'] },
    })
    await writeTeamToDisk(stateRoot, team({ tasks: [current], taskSeq: 1 }))
    const result = await tool('agent_teams_reassign_task').execute(
      { task_id: 't1', assignee: 'captain', acceptance: 'new acceptance', reason: 'scope changed' },
      execOf(agent(workspace, CAPTAIN_ID)),
    ) as { task_id: string }
    expect(result.task_id).toBe('t1')
    const persisted = await readTeam(stateRoot, 'workflow-team')
    const updated = persisted!.tasks[0]!
    expect(updated?.acceptance).toBe('new acceptance')
    expect(updated?.acceptanceRevision).toBe(2)
    expect(updated?.contractRevision).toBe(2)
    expect(updated?.acceptanceHistory?.[0]?.reason).toBe('scope changed')
    expect(updated?.review).toBeUndefined()
    expect(updated?.reviewHistory?.[0]?.verdict).toBe('pass')
    expect(updated?.verification).toEqual({ checked: ['fixture'], unchecked: ['network'] })
  })
})

describe('政委排除 — 政委不得拥有或执行任务（P1 回归）', () => {
  let workspace = ''
  let stateRoot = ''
  const tool = harness()
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-commissar-tools-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })
  afterEach(async () => { await rm(workspace, { recursive: true, force: true }) })

  it('create_task 不得把任务指派给政委', async () => {
    await writeTeamToDisk(stateRoot, team())
    await expect(tool('agent_teams_create_task').execute(
      { subject: 'becomes commissar work', description: 'should be refused', assignee: '政委' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/is the commissar and cannot own task work/)
    // 拒绝不落盘
    const persisted = await readTeam(stateRoot, 'workflow-team')
    expect(persisted?.tasks).toHaveLength(0)
  })

  it('reassign_task 不得把任务转派给政委', async () => {
    await writeTeamToDisk(stateRoot, team({
      tasks: [task('t1', { status: 'pending', assignee: '技术员' })], taskSeq: 1,
    }))
    await expect(tool('agent_teams_reassign_task').execute(
      { task_id: 't1', assignee: '政委', reason: 'move to commissar' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/is the commissar and cannot own task work/)
  })

  it('政委不能 claim 任务（含无人认领的 ready 任务）', async () => {
    await writeTeamToDisk(stateRoot, team({
      tasks: [task('t1', { status: 'pending' })], taskSeq: 1,
    }))
    await expect(tool('agent_teams_claim_task').execute(
      { task_id: 't1' },
      execOf(agent(workspace, COMMISSAR_ID)),
    )).rejects.toThrow(/the commissar cannot claim tasks/)
    const persisted = await readTeam(stateRoot, 'workflow-team')
    expect(persisted?.tasks[0]?.status).toBe('pending')
    expect(persisted?.tasks[0]?.assignee).toBeUndefined()
  })

  it('队长也不能代政委认领任务', async () => {
    await writeTeamToDisk(stateRoot, team({
      tasks: [task('t1', { status: 'pending' })], taskSeq: 1,
    }))
    await expect(tool('agent_teams_claim_task').execute(
      { task_id: 't1', assignee: '政委' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )).rejects.toThrow(/is the commissar and cannot own task work/)
  })

  it('政委不能 update 任务状态（即使该任务仍登记在其名下）', async () => {
    // 修复前已产生的脏状态：任务 owner 是政委。政委也不得自行驱动它，
    // 必须由队长 reassign 移走，避免"执行自己稍后要批次复核的工作"。
    await writeTeamToDisk(stateRoot, team({
      tasks: [task('t1', {
        status: 'in_progress', assignee: '政委', attempt: 1, attemptId: 'att-1',
      })], taskSeq: 1,
    }))
    await expect(tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: 'att-1', output: 'done by commissar' },
      execOf(agent(workspace, COMMISSAR_ID)),
    )).rejects.toThrow(/the commissar cannot update task state/)
  })

  it('对照：执行成员仍可正常 claim 与 update（未误伤）', async () => {
    await writeTeamToDisk(stateRoot, team({
      tasks: [task('t1', { status: 'pending', assignee: '技术员' })], taskSeq: 1,
    }))
    const claimed = await tool('agent_teams_claim_task').execute(
      { task_id: 't1' },
      execOf(agent(workspace, ENGINEER_ID)),
    ) as { status: string; assignee: string; attempt_id?: string }
    expect(claimed.status).toBe('claimed')
    expect(claimed.assignee).toBe('技术员')
    expect(claimed.attempt_id).toBeTypeOf('string')

    const started = await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'in_progress', attempt_id: claimed.attempt_id, output: 'engineer working' },
      execOf(agent(workspace, ENGINEER_ID)),
    ) as { status: string }
    expect(started.status).toBe('in_progress')

    const updated = await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: claimed.attempt_id, output: 'engineer done' },
      execOf(agent(workspace, ENGINEER_ID)),
    ) as { status: string }
    expect(updated.status).toBe('completed')
  })
})
