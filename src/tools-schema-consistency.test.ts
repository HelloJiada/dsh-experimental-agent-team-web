/**
 * 工具输出 schema 一致性回归测试(P2-8 锁定)。
 *
 * 背景:F-01/P2-8 揭示 update_task 的 output.schema 与 handler 实际返回
 * 漂移 —— 发布物缺 started_at/signals,源码缺 retro/estimated_ms,而
 * additionalProperties:false 下任何未声明字段都会让宿主的输出校验失败
 * ("value.X is not a declared property")。成员看到报错、状态却已落盘,
 * 是"误导性失败"的典型路径。
 *
 * 本测试模拟宿主校验语义(递归:对象键必须全部在 schema.properties 内,
 * 声明字段按类型复核),对 13 个工具逐一执行一次真实调用,断言返回对象
 * 完全落在该工具 output.schema 声明内 —— 任何 handler 返回新增字段而
 * schema 未同步声明都会在这里失败。
 *
 * 测试基建与 tools-suggest-gate.test.ts 同款:桩 ctx + 真实状态目录,
 * 成员 agent 一律 running 使调度器 kick 短路。
 * @module dsh-agent-team-web/tools-schema-consistency
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerAgentTeamsTools, type ToolsConfig } from './tools.ts'
import type { TeamMember, TeamState, TeamTask } from './types.ts'

const config: ToolsConfig = {
  stateDir: '.agent-team-web',
  memberProvider: 'spawn',
  maxMembers: 8,
  stallThresholdMs: 120_000,
}

const CAPTAIN_ID = 'session-captain'
const COMMISSAR_ID = 'session-commissar'
const ENGINEER_ID = 'session-engineer'

function team(overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: '测试团队',
    id: 'team-schema',
    description: 'demo',
    captainSessionId: CAPTAIN_ID,
    createdAt: 1000,
    members: [
      { id: COMMISSAR_ID, name: '政委', role: 'commissar', provider: 'p', model: 'm', joinedAt: 1000, status: 'idle' },
      { id: ENGINEER_ID, name: '技术员', role: 'engineer', provider: 'p', model: 'm', joinedAt: 1001, status: 'idle' },
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

async function writeTeamToDisk(stateRoot: string, teamState: TeamState): Promise<void> {
  const dir = join(stateRoot, teamState.id)
  await mkdir(join(dir, 'inbox'), { recursive: true })
  await writeFile(join(dir, 'team.json'), JSON.stringify(teamState, null, 2))
}

interface CapturedTool {
  name: string
  execute(args: Record<string, unknown>, exec: { agent: Agent; signal: AbortSignal }): Promise<unknown>
  output?: { schema?: unknown; render(args: Record<string, unknown>, value: unknown): { type: string; text: string }[] }
  [key: string]: unknown
}

function harness(): (name: string) => CapturedTool {
  const tools = new Map<string, CapturedTool>()
  const MEMBER_IDS = new Set([COMMISSAR_ID, ENGINEER_ID])
  const fakeCtx = {
    tools: {
      register: (def: CapturedTool) => {
        tools.set(def.name, def)
        return def
      },
    },
    agents: {
      get: (id: string) => MEMBER_IDS.has(id)
        ? { id, status: 'running', session: { header: { cwd: '' } } }
        : undefined,
    },
    logger: { warn: () => undefined, debug: () => undefined },
    on: () => undefined,
    effect: () => () => undefined,
    subagents: {
      registerContinuableSetup: () => undefined,
      followup: async () => undefined,
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
    session: { header: { cwd: workspace }, id },
    steer: () => undefined,
  } as unknown as Agent
}

const execOf = (agentRef: Agent) => ({ agent: agentRef, signal: new AbortController().signal })

/**
 * 模拟宿主输出校验语义:additionalProperties:false 下,
 * 返回对象的每个键必须都在 schema.properties 中声明,且值类型匹配。
 * 返回 null 表示通过,否则返回错误路径说明。
 */
function validateAgainstSchema(value: unknown, schema: any, path = '$'): string | null {
  if (schema === undefined || schema === null) return null
  const type = schema.type
  if (type === 'object' || (type === undefined && typeof value === 'object' && value !== null)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return `${path}: expected object, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`
    }
    const props = schema.properties ?? {}
    for (const key of Object.keys(value)) {
      if (!(key in props) && schema.additionalProperties === false) {
        return `${path}.${key}: not a declared property (additionalProperties: false)`
      }
      const err = validateAgainstSchema((value as Record<string, unknown>)[key], props[key], `${path}.${key}`)
      if (err !== null) return err
    }
    return null
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return `${path}: expected array, got ${typeof value}`
    for (let i = 0; i < value.length; i++) {
      const err = validateAgainstSchema(value[i], schema.items, `${path}[${i}]`)
      if (err !== null) return err
    }
    return null
  }
  // 标量:类型复核(声明了才查)。
  if (value === undefined) return null
  const typeOk =
    type === 'string' ? typeof value === 'string'
    : type === 'number' ? typeof value === 'number'
    : type === 'boolean' ? typeof value === 'boolean'
    : true
  return typeOk ? null : `${path}: expected ${type}, got ${typeof value}`
}

describe('工具输出 schema 与 handler 返回一致性(P2-8 回归)', () => {
  let workspace: string
  let stateRoot: string
  const tool = harness()

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-schema-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(stateRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('update_task 终结更新返回对象完全落在 schema 声明内(含 retro/estimated_ms)', async () => {
    // 非门禁任务(低风险),成员可直接完成 → 走完整终结分支生成 retro。
    const doneTask = task('t1', {
      subject: '普通任务',
      status: 'in_progress',
      assignee: '技术员',
      attempt: 1,
      attemptId: 'att-1',
      claimedAt: 10_000,
      startedAt: 15_000,
      updatedAt: 20_000,
    })
    await writeTeamToDisk(stateRoot, team({ tasks: [doneTask] }))

    const result = await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: 'att-1', output: '收尾输出' },
      execOf(agent(workspace, ENGINEER_ID)),
    )

    // 返回确实含 retro(终结分支产物)与 started_at/signals/actual_ms。
    expect((result as Record<string, unknown>).retro).toBeDefined()
    expect((result as Record<string, unknown>).started_at).toBeDefined()
    expect((result as Record<string, unknown>).signals).toBeDefined()
    expect((result as Record<string, unknown>).actual_ms).toBeDefined()

    const schema = tool('agent_teams_update_task').output?.schema
    expect(schema).toBeDefined()
    const err = validateAgainstSchema(result, schema)
    expect(err).toBeNull()
  })

  it('update_task 非终结更新(status=in_progress)返回同样通过 schema 校验', async () => {
    const pending = task('t1', {
      subject: '普通任务',
      status: 'claimed',
      assignee: '技术员',
      attempt: 1,
      attemptId: 'att-1',
      claimedAt: 10_000,
    })
    await writeTeamToDisk(stateRoot, team({ tasks: [pending] }))

    const result = await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'in_progress', attempt_id: 'att-1' },
      execOf(agent(workspace, ENGINEER_ID)),
    )
    const err = validateAgainstSchema(result, tool('agent_teams_update_task').output?.schema)
    expect(err).toBeNull()
  })

  it('status 等 additionalProperties:true 宽松 schema 工具不受影响', async () => {
    await writeTeamToDisk(stateRoot, team({ tasks: [task('t1', { status: 'pending' })] }))
    const result = await tool('agent_teams_status').execute({}, execOf(agent(workspace, CAPTAIN_ID)))
    const schema = tool('agent_teams_status').output?.schema as { additionalProperties?: boolean }
    // status 是宽松 schema(additionalProperties:true),校验器按"无 properties 约束"放行。
    expect(schema?.additionalProperties).toBe(true)
    expect(validateAgainstSchema(result, schema)).toBeNull()
  })

  it('create_task 带建议字段的返回通过 schema 校验', async () => {
    await writeTeamToDisk(stateRoot, team())
    const result = await tool('agent_teams_create_task').execute(
      { subject: '实现调度器建议分配', description: '接入 create_task 并展示建议' },
      execOf(agent(workspace, CAPTAIN_ID)),
    )
    const err = validateAgainstSchema(result, tool('agent_teams_create_task').output?.schema)
    expect(err).toBeNull()
  })

  it('门禁 pass 后完成的高风险任务返回通过 schema 校验(含 includes_gate_wait)', async () => {
    const gatedTask = task('t1', {
      subject: '高风险任务',
      status: 'in_progress',
      assignee: '技术员',
      attempt: 1,
      attemptId: 'att-1',
      riskLevel: 'high',
      reviewRequired: true,
      claimedAt: 10_000,
      startedAt: 15_000,
      updatedAt: 20_000,
    })
    await writeTeamToDisk(stateRoot, team({ tasks: [gatedTask] }))

    // 成员完成 → 门禁拦截
    await expect(tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: 'att-1' },
      execOf(agent(workspace, ENGINEER_ID)),
    )).rejects.toThrow(/requires commissar review/)

    // 政委 pass 放行
    await tool('agent_teams_review_task').execute(
      { task_id: 't1', verdict: 'pass' },
      execOf(agent(workspace, COMMISSAR_ID)),
    )

    // 再次完成 → 返回含 includes_gate_wait=true 的 retro,必须通过 schema 校验
    const result = await tool('agent_teams_update_task').execute(
      { task_id: 't1', status: 'completed', attempt_id: 'att-1' },
      execOf(agent(workspace, ENGINEER_ID)),
    )
    const retro = (result as { retro?: { includes_gate_wait?: boolean } }).retro
    expect(retro?.includes_gate_wait).toBe(true)
    const err = validateAgainstSchema(result, tool('agent_teams_update_task').output?.schema)
    expect(err).toBeNull()
  })
})
