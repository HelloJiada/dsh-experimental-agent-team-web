/**
 * The `agent_teams_*` model-facing tools.
 *
 * The captain (the agent that created the team) orchestrates: members are
 * continuable subagents it spawns and wakes. Members share the same tools and
 * drive their own task state, mirroring the Claude Code AgentTeams flow:
 * create team → add members → create tasks with dependencies → claim/assign →
 * work → report → status → delete.
 * @module dsh-agent-team-web/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { appendTeamEvent, captainSessionOf } from './events.ts'
import {
  gateBlocksCompletion,
  isActiveCommissar,
  isCommissarRole,
  notifyCommissarPendingReview,
} from './commissar-gate.ts'
import {
  countActiveExecRoleMembers,
  DEFAULT_MAX_EXEC_PER_ROLE,
} from './role-limits.ts'
import { resolveMemberName } from './member-naming.ts'
import {
  acknowledgeMailbox,
  appendMailbox,
  archiveTeamDir,
  beginTaskAttempt,
  CAPTAIN_KEY,
  createMessage,
  createTeamDir,
  descriptionAwaitingInput,
  finalizeTaskTiming,
  findTaskCycle,
  findTeamByCaptain,
  findTeamByParticipant,
  invalidateTaskAttempt,
  readUnreadMailbox,
  recordRetiredMemberIds,
  releaseMailboxDelivery,
  readTeam,
  sanitizeKey,
  taskAwaitingInput,
  taskBlockedByReview,
  transitionError,
  unsatisfiedDependencies,
  withTeamLock,
  writeTeam,
} from './state.ts'
import {
  deliverToMember,
  installRetiredMemberGuard,
  installMemberSelectionRuntime,
  interruptMember,
  memberActivity,
  resolveMemberLlmSelection,
  spawnMember,
  type MemberRuntimeConfig,
} from './members.ts'
import { TERMINAL_TASK_STATUSES, TASK_RETRO_CAUSES, ESTIMATE_LEVEL_RANGES, type TeamMember, type TeamState, type TeamTask, type TaskRetroCause } from './types.ts'
import { installTeamScheduler } from './scheduler.ts'
import {
  buildTaskRetro,
  retroCalibrationHint,
  retroRecommendationFor,
  summarizeTeamRetro,
  taskElapsedMs,
  taskTimingState,
  type RetroTaskFacts,
} from './retro.ts'
import {
  distillBestPractice,
  readBestPractices,
  selectBestPracticesForRole,
  updateBestPracticeVerdict,
  upsertBestPractice,
  writeBestPractices,
  type BestPracticeEntry,
} from './best-practices.ts'
import { formatDuration } from './duration.ts'
import {
  ROLE_TITLES,
  suggestAssignments,
  suggestAssigneeForTask,
  type TaskAssigneeSuggestion,
} from './suggest.ts'

/** Resolved plugin config consumed by the tools. */
export interface ToolsConfig {
  /** State directory name under the captain's workspace. */
  stateDir: string
  /** Member subagent provider name. */
  memberProvider: string
  /** Optional member model override. */
  memberModel?: string
  /** Member delegation depth cap. */
  memberMaxDepth?: number
  /** Team size cap in members, including captain and commissar. */
  maxMembers: number
  /** Per executing-role member cap (default `1`): each executing role
   * (the 5 preset behavioral roles, the task-level reviewer, and any custom
   * role string) may have up to this many active members; captain/commissar
   * exempt. */
  maxExecPerRole?: number
  /** A member-owned open task is "stalled" (helppable) after this many ms. */
  stallThresholdMs: number
}

/** The caller agent, or a loud failure for non-agent callers. */
function requireCaptain(exec: ToolRunContext): Agent {
  if (!exec.agent) {
    throw new Error('agent_teams tools require a calling agent (exec.agent was undefined)')
  }
  return exec.agent
}

/**
 * 任务建议字段(改进方向 3 —— 队长负载缓解):纯函数按任务内容推断
 * 「建议角色/成员」。只建议、不派单:不写状态、不自动认领,队长确认后
 * 仍走现有 assignee 流程。无关键词命中时返回空对象(不瞎猜)。
 */
function suggestionFieldsOf(
  subject: string,
  description: string | undefined,
  members: readonly TeamMember[],
  tasks: readonly TeamTask[],
): { suggestedRole?: string; suggestedAssignee?: string; suggestionConfidence?: string } {
  // 把已有任务一并传入,让成员挑选按当前负载最少者优先。
  const assignment = suggestAssignments(
    [...tasks, { id: '_new', subject, description, status: 'pending' }],
    members,
  ).at(-1)
  if (assignment?.suggestedRole === undefined || assignment.suggestedRole === null) return {}
  return {
    suggestedRole: assignment.suggestedRole,
    ...assignment.suggestedMember !== null ? { suggestedAssignee: assignment.suggestedMember } : {},
    suggestionConfidence: assignment.confidence ?? undefined,
  }
}

/** The captain's workspace directory (team state root parent). */
function workspaceOf(agent: Agent): string {
  return agent.session.header.cwd ?? process.cwd()
}

/** Resolved absolute state root. */
function stateRootOf(workspace: string, config: ToolsConfig): string {
  return join(workspace, config.stateDir)
}

/**
 * 自成长团队记忆:按角色从全局 best-practices 库选出可注入的经验条目。
 * 无角色(或空角色)直接返回空;冷启动守卫(角色样本 <2)由
 * {@link selectBestPracticesForRole} 内部处理,返回空即不注入。
 */
async function roleMemoriesFor(
  stateRoot: string,
  role: string | undefined,
): Promise<readonly BestPracticeEntry[]> {
  if (role === undefined || role.trim() === '') return []
  return selectBestPracticesForRole(await readBestPractices(stateRoot), role.trim())
}

/** Process-local lock key scoped by workspace state root and team id. */
function teamLockKey(stateRoot: string, teamId: string): string {
  return `team:${stateRoot}:${teamId}`
}

/** Process-local lock key enforcing one active team per captain session. */
function captainLockKey(stateRoot: string, captainId: string): string {
  return `captain:${stateRoot}:${captainId}`
}

/** The team this captain currently leads, or a loud failure. */
async function requireCaptainTeam(workspace: string, config: ToolsConfig, captain: Agent): Promise<TeamState> {
  const team = await findTeamByCaptain(stateRootOf(workspace, config), captain.id)
  if (team === undefined) {
    throw new Error('you are not leading any team yet — call agent_teams_create first')
  }
  return team
}

/** The team this captain or active member currently participates in. */
async function requireParticipantTeam(workspace: string, config: ToolsConfig, caller: Agent): Promise<TeamState> {
  const team = await findTeamByParticipant(stateRootOf(workspace, config), caller.id)
  if (team === undefined) {
    throw new Error('you do not lead or belong to any active team yet')
  }
  return team
}

type ParticipantIdentity =
  | { kind: 'captain'; name: typeof CAPTAIN_KEY }
  | { kind: 'member'; name: string }

/** Re-derive a caller's role from fresh state while holding the team lock. */
function participantIdentityOf(team: TeamState, agentId: string): ParticipantIdentity | undefined {
  if (team.captainSessionId === agentId) return { kind: 'captain', name: CAPTAIN_KEY }
  const member = team.members.find((candidate) => candidate.id === agentId && candidate.status !== 'removed')
  return member === undefined ? undefined : { kind: 'member', name: member.name }
}

/** Fresh state for a team that still exists; never falls back to stale lookup data. */
async function requireFreshTeam(stateRoot: string, teamId: string): Promise<TeamState> {
  const fresh = await readTeam(stateRoot, teamId)
  if (fresh === undefined) throw new Error(`team "${teamId}" is no longer active`)
  return fresh
}

/** Fresh state with captain authorization rechecked inside the lock. */
async function requireFreshCaptainTeam(
  stateRoot: string,
  teamId: string,
  captainId: string,
): Promise<TeamState> {
  const fresh = await requireFreshTeam(stateRoot, teamId)
  if (fresh.captainSessionId !== captainId) {
    throw new Error(`only the captain of team "${fresh.name}" may perform this operation`)
  }
  return fresh
}

/** Fresh state and caller identity rechecked inside the lock. */
async function requireFreshParticipant(
  stateRoot: string,
  teamId: string,
  callerId: string,
): Promise<{ team: TeamState; identity: ParticipantIdentity }> {
  const fresh = await requireFreshTeam(stateRoot, teamId)
  const identity = participantIdentityOf(fresh, callerId)
  if (identity === undefined) throw new Error(`you are no longer an active participant in team "${fresh.name}"`)
  return { team: fresh, identity }
}

/** Look up one live (non-removed) member by display name. */
function requireMember(team: TeamState, name: string): TeamMember {
  const member = team.members.find((candidate) => candidate.name === name && candidate.status !== 'removed')
  if (member === undefined) {
    throw new Error(`no active member named "${name}" in team "${team.name}"`)
  }
  return member
}

/** Look up one task by id. */
function requireTask(team: TeamState, taskId: string): TeamTask {
  const task = team.tasks.find((candidate) => candidate.id === taskId)
  if (task === undefined) {
    throw new Error(`no task "${taskId}" in team "${team.name}" — use agent_teams_status to list tasks`)
  }
  return task
}

/** One open (claimed/in-progress) work item for a member — either owned or
 * being helped by them (self-organizing dispatch). Keeps the one-worker rule
 * across both roles. */
export function memberOpenTask(team: TeamState, memberName: string, exceptTaskId?: string): TeamTask | undefined {
  return team.tasks.find(task => task.id !== exceptTaskId
    && (task.assignee === memberName || task.helper === memberName)
    && (task.status === 'claimed' || task.status === 'in_progress'))
}

async function waitForMemberIdle(ctx: Context, member: TeamMember, signal: AbortSignal): Promise<void> {
  if (member.id === '') return
  const live = ctx.agents.get(member.id as SessionId)
  if (live === undefined) return
  if (signal.aborted) throw signal.reason
  let onAbort!: () => void
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('task reassignment was cancelled'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    await Promise.race([live.whenIdle(), aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Deliver a durable member report at the captain's nearest model boundary.
 *
 * `Agent.steer()` targets the next step while the captain is running, wakes a
 * new turn when it is idle, and lets the Agent runtime reclassify an aborted
 * activity to `next-turn`. This prevents reports from waiting behind the
 * captain's entire orchestration turn.
 */
export function steerCaptainReport(captain: Pick<Agent, 'steer'>, from: string, content: string): boolean {
  try {
    captain.steer(createUserMessage({
      content: [{ type: 'text', text: `AgentTeams message from member ${from}:\n\n${content}` }],
      source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-experimental-agent-team-web' },
    }))
    return true
  } catch {
    // The plugin mailbox was persisted before this best-effort live delivery.
    return false
  }
}

/**
 * Register every `agent_teams_*` tool into the shared tools registry.
 * @param ctx - the plugin context (injects `tools`).
 * @param config - resolved tool config.
 */
export function registerAgentTeamsTools(ctx: Context, config: ToolsConfig): void {
  installRetiredMemberGuard(ctx, config.stateDir)
  const memberSelections = installMemberSelectionRuntime(ctx, config.stateDir)
  const scheduler = installTeamScheduler(ctx, { stateDir: config.stateDir, stallThresholdMs: config.stallThresholdMs })

  ctx.tools.register(defineTool({
    name: 'agent_teams_create',
    description: 'Create a new AgentTeams team: you (the calling agent) become the captain. A commissar (政委) member for independent oversight is auto-created with the team; do not add a second one. A captain leads one team at a time; create tasks and additional members afterwards with agent_teams_add_member and agent_teams_create_task.',
    parameters: {
      name: { type: 'string', required: true, description: 'Name for the new team (used as its stable id).' },
      description: { type: 'string', description: 'Team purpose / the goal the team will work on.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          team_id: { type: 'string', required: true },
          team_name: { type: 'string', required: true },
          state_dir: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Team "${value.team_name}" created (id ${value.team_id}) under ${value.state_dir}. You are the captain.`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const teamName = args.name.trim()
      if (teamName === '') throw new Error('team name must not be empty')
      const teamId = sanitizeKey(teamName)
      return withTeamLock(captainLockKey(stateRoot, captain.id), async () => {
        const current = await findTeamByParticipant(stateRoot, captain.id)
        if (current !== undefined) {
          const relationship = current.captainSessionId === captain.id ? 'lead' : 'belong to'
          throw new Error(`you already ${relationship} team "${current.name}" — end or leave it before creating another`)
        }
        return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
          const existing = await readTeam(stateRoot, teamId)
          if (existing !== undefined) {
            throw new Error(`team id "${teamId}" is taken by another captain — pick a different team name`)
          }
          const state: TeamState = {
            name: teamName,
            id: teamId,
            description: args.description,
            captainSessionId: captain.id,
            createdAt: Date.now(),
            members: [],
            tasks: [],
            taskSeq: 0,
          }
          // Every team is born with its commissar: a deterministic oversight
          // member (independent monitoring, risk/quality gate, disagreement
          // escalation — docs/team-roles-and-responsibilities.md §5). It rides
          // the exact same spawn path as agent_teams_add_member, so its fields
          // and lifecycle match a manually added member. The usage prompt tells
          // the captain not to add a second one, and add_member guards it too.
          const commissarSelection = await resolveMemberLlmSelection(ctx, captain, {
            defaultModel: config.memberModel,
          }, exec.signal)
          const commissar: TeamMember = {
            id: '',
            name: '政委',
            role: 'commissar',
            provider: commissarSelection.provider,
            model: commissarSelection.model,
            reasoningEffort: commissarSelection.reasoningEffort,
            joinedAt: Date.now(),
            status: 'idle',
          }
          // 与 add_member 同一记忆注入路径:按角色取全局 best-practices 经验,
          // 冷启动守卫触发时为空(不注入)。
          const commissarMemories = await roleMemoriesFor(stateRoot, commissar.role)
          await spawnMember(
            ctx,
            memberRuntime(config),
            memberSelections,
            commissarSelection,
            captain,
            state,
            commissar,
            config.stateDir,
            exec.signal,
            commissarMemories,
          )
          state.members.push(commissar)
          try {
            await createTeamDir(stateRoot, state)
          } catch (error: unknown) {
            // The continuable child is already live, but the durable team
            // record never saw it. Retire the orphan so it disappears from
            // subagent listings and cannot be resumed, then surface the
            // write failure (mirrors add_member's rollback).
            if (commissar.id !== '') {
              await recordRetiredMemberIds(stateRoot, [commissar.id]).catch(() => undefined)
              interruptMember(ctx, captain, commissar.id)
            }
            throw error
          }
          appendTeamEvent(ctx, captain.session, 'agent-team-web/team-created', {
            teamId: state.id,
            captainSessionId: captain.id,
            name: state.name,
            ...state.description !== undefined ? { description: state.description } : {},
          })
          appendTeamEvent(ctx, captain.session, 'agent-team-web/member-added', {
            teamId: state.id,
            memberId: commissar.id,
            name: commissar.name,
            role: commissar.role,
          })
          return { team_id: state.id, team_name: state.name, state_dir: join(stateRoot, state.id) }
        })
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_add_member',
    description: 'Add a durable continuable member. When name is omitted (or given as just the role), the member is named after the role title itself (技术员, 侦察参谋, …); only a second member of the same role gets a numbered suffix (技术员 二号). By default it snapshots the captain\'s current LLM route and effort. Supply provider/model only for an explicitly requested role-specific route; a changed provider or model automatically uses the target model\'s default effort. Set reasoning_effort only to request one of the target model\'s supported ids explicitly (or "default" to force its default). The member waits for messages, works on assigned tasks, and can message the team.',
    parameters: {
      name: { type: 'string', description: 'Unique member name inside the team; when omitted (or just the role name) the member is named after the role title itself (e.g. 技术员); a second member of the same role gets a numbered suffix (e.g. 技术员 二号).' },
      role: { type: 'string', description: 'Role of the member — 6 preset behavioral roles: researcher 侦察参谋 (想清楚: read first → root cause + plan → hand off) / engineer 技术员 (做出来: implement per plan → self-test → diff summary) / qa 质检员 (验明白: checklist → verify → pass/reject with evidence) / designer 文宣干事 (好看: visual plan with concrete values) / data 情报分析员 (算清楚: metrics → collect → reviewable report) / docs 文书 (写明白: structure first → write with spec → sync-check against reality); reviewer 审查员 is a task-level dynamic role (add when dedicated review is needed). security 警卫员 / operator 后勤保障员 are not preset — pass them as custom role strings only when the goal really needs them (no dedicated seat or behavior template, still subject to the per-role cap, default 1). A commissar (政委) is auto-created with the team and must not be added.' },
      provider: { type: 'string', description: 'Optional LLM provider route. Use only when the user explicitly requests a different provider; requires model.' },
      model: { type: 'string', description: 'Optional model override. Omit for the captain\'s current model (or the configured memberModel default).' },
      reasoning_effort: { type: 'string', description: 'Optional reasoning effort override: one of the target model\'s supported effort ids, or "default" to force its default. When omitted, the captain\'s effort is inherited only for the same provider/model; a changed route uses the target default.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          member_name: { type: 'string', required: true },
          member_id: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          reasoning_effort: { type: 'string' },
          status: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Member "${value.member_name}" added (subagent id ${value.member_id}, ${value.provider}/${value.model}${value.reasoning_effort === undefined ? '' : `, reasoning ${value.reasoning_effort}`}, status ${value.status}).`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const created = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        // Role-based naming: an omitted or role-only name becomes the role
        // title itself (技术员) — no ordinal, since each role defaults to a
        // single member; a second member of the same canonical role gets a
        // numbered suffix (技术员 二号). Explicit custom names, including
        // legacy numbered ones like 技术员 一号, are respected unchanged.
        const memberName = resolveMemberName(args.name, args.role, countActiveExecRoleMembers(fresh.members, args.role))
        if (memberName === '') throw new Error('member name must not be empty')
        const memberKey = sanitizeKey(memberName)
        if (memberKey === CAPTAIN_KEY) {
          throw new Error(`member name "${args.name}" is reserved for the captain`)
        }
        if (fresh.members.some((candidate) => sanitizeKey(candidate.name) === memberKey)) {
          throw new Error(`member name "${args.name}" has already been used in team "${fresh.name}"`)
        }
        if (isCommissarRole(args.role) && fresh.members.some((candidate) =>
          candidate.status !== 'removed' && isCommissarRole(candidate.role))) {
          throw new Error(`team "${fresh.name}" already has a commissar (政委) — the commissar is auto-created with the team, do not add another`)
        }
        if (fresh.members.filter((candidate) => candidate.status !== 'removed').length >= config.maxMembers) {
          throw new Error(`team "${fresh.name}" is at its member cap (${config.maxMembers})`)
        }
        // Executing-role cap: each executing role may have at most
        // `maxExecPerRole` (default 1) active members. The captain (never via
        // add_member) and the commissar (uniqueness-gated above) are exempt;
        // members without a role are not an executing role and stay uncapped
        // here (the maxMembers cap still applies).
        const roleText = args.role?.trim() ?? ''
        if (roleText !== '' && !isCommissarRole(roleText)) {
          const execCap = config.maxExecPerRole ?? DEFAULT_MAX_EXEC_PER_ROLE
          if (countActiveExecRoleMembers(fresh.members, roleText) >= execCap) {
            throw new Error(`executing role "${args.role}" already has ${execCap} active members — 该执行角色已达上限（每个执行角色最多 ${execCap} 名成员）`)
          }
        }
        const selection = await resolveMemberLlmSelection(ctx, captain, {
          provider: args.provider,
          model: args.model,
          defaultModel: config.memberModel,
          reasoningEffort: args.reasoning_effort,
        }, exec.signal)
        const member: TeamMember = {
          id: '',
          name: memberName,
          role: args.role,
          provider: selection.provider,
          model: selection.model,
          reasoningEffort: selection.reasoningEffort,
          joinedAt: Date.now(),
          status: 'idle',
        }
        // 自成长团队记忆注入:按成员角色从全局 best-practices 库取经验,
        // 冷启动守卫(角色样本 <2)时返回空,memberPersona 不注入。
        const memories = await roleMemoriesFor(stateRoot, args.role)
        await spawnMember(
          ctx,
          memberRuntime(config),
          memberSelections,
          selection,
          captain,
          fresh,
          member,
          config.stateDir,
          exec.signal,
          memories,
        )
        fresh.members.push(member)
        try {
          await writeTeam(stateRoot, fresh)
        } catch (error: unknown) {
          // The continuable child is already live, but the durable team record
          // never saw it. Retire the orphan so it disappears from subagent
          // listings and cannot be resumed, then surface the write failure.
          if (member.id !== '') {
            await recordRetiredMemberIds(stateRoot, [member.id]).catch(() => undefined)
            interruptMember(ctx, captain, member.id)
          }
          throw error
        }
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-team-web/member-added', {
          teamId: fresh.id,
          memberId: member.id,
          name: member.name,
          ...member.role !== undefined ? { role: member.role } : {},
        })
        return {
          member_name: member.name,
          member_id: member.id,
          provider: selection.provider,
          model: selection.model,
          ...selection.reasoningEffort === undefined
            ? {}
            : { reasoning_effort: selection.reasoningEffort },
          status: member.status,
        }
      })
      await scheduler.kickMember(workspace, team.id, created.member_name, captain)
      return created
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_remove_member',
    description: 'Remove a member safely: revoke its current attempts, return all unfinished owned tasks to the shared pending pool, interrupt its live turn, and mark it removed.',
    parameters: {
      name: { type: 'string', required: true, description: 'Name of the member to remove.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          member_name: { type: 'string', required: true },
          status: { type: 'string', required: true },
          requeued_tasks: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Member "${value.member_name}" removed (status ${value.status}); requeued tasks: ${value.requeued_tasks.join(', ') || 'none'}.`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const revoked = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const member = requireMember(fresh, args.name)
        const requeued: string[] = []
        for (const task of fresh.tasks) {
          if (task.assignee !== member.name || task.status === 'completed') continue
          invalidateTaskAttempt(task)
          task.reassigning = false
          requeued.push(task.id)
        }
        member.status = 'removed'
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-team-web/member-removed', {
          teamId: fresh.id,
          memberId: member.id,
        })
        return { member: { ...member }, requeued }
      })
      if (revoked.member.id !== '') {
        await recordRetiredMemberIds(stateRoot, [revoked.member.id])
        interruptMember(ctx, captain, revoked.member.id)
        await waitForMemberIdle(ctx, revoked.member, exec.signal)
      }
      await scheduler.kickTeam(workspace, team.id, captain)
      return {
        member_name: revoked.member.name,
        status: revoked.member.status,
        requeued_tasks: revoked.requeued,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_create_task',
    description: 'Create a task in your team\'s task list. Tasks can depend on other tasks (dependencies): a task is only claimable once every dependency is completed. Optionally assign it to a member, who still claims it before working. Mark risk=high/critical or milestone=true to put the task under the commissar gate: it can only be marked completed after the commissar passes it with agent_teams_review_task. When no assignee is given, the result carries a suggested_role/assignee (keyword-based, purely advisory) for your confirmation — you keep the assignee decision.',
    parameters: {
      subject: { type: 'string', required: true, description: 'Brief title for the task.' },
      description: { type: 'string', description: 'What needs to be done, in detail.' },
      dependencies: {
        type: 'array',
        items: { type: 'string' },
        description: 'Task ids this task depends on (must be completed before this task can be claimed).',
      },
      assignee: { type: 'string', description: 'Optional member name this task is intended for.' },
      risk: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'critical'],
        description: 'Optional risk level; high/critical puts the task under the commissar gate (review before completion).',
      },
      milestone: {
        type: 'boolean',
        description: 'Optional final-milestone marker; true puts the task under the commissar gate.',
      },
      estimate_level: {
        type: 'string',
        enum: ['S', 'M', 'L'],
        description: 'Optional workload estimate level (对外口径): S ≤15m / M ≤45m / L >45m. Drives overrun warnings (yellow over budget, red over 1.5×) and the retrospective level-deviation used to calibrate future estimates.',
      },
      estimate_ms: {
        type: 'number',
        description: 'Optional internal estimated effort in milliseconds (e.g. 30 * 60 * 1000 = 30m). Prefer estimate_level; this is kept for internal conversion and compatibility. Drives elapsed tracking and overrun warnings when no level is set.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          subject: { type: 'string', required: true },
          status: { type: 'string', required: true },
          assignee: { type: 'string' },
          review_required: { type: 'boolean' },
          estimate_level: { type: 'string' },
          estimate_ms: { type: 'number' },
          suggested_role: { type: 'string' },
          suggested_assignee: { type: 'string' },
          suggestion_confidence: { type: 'string' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Task "${value.subject}" created as ${value.task_id} (status ${value.status}${value.assignee ? `, assigned to ${value.assignee}` : ''}${value.review_required === true ? ', commissar review required' : ''}${value.estimate_level !== undefined ? `, estimate ${value.estimate_level}(${ESTIMATE_LEVEL_RANGES[value.estimate_level as keyof typeof ESTIMATE_LEVEL_RANGES].label})` : value.estimate_ms !== undefined ? `, estimate ${formatDuration(value.estimate_ms)}` : ''}${value.suggested_role !== undefined ? ` · 建议分配给：${ROLE_TITLES[value.suggested_role as keyof typeof ROLE_TITLES] ?? value.suggested_role}（${value.suggested_role}）${value.suggested_assignee !== undefined ? ` → ${value.suggested_assignee}` : ''}${value.suggestion_confidence !== undefined ? ` [${value.suggestion_confidence}]` : ''}` : ''}).`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const created = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const dependencies = args.dependencies ?? []
        // R-04:自环(新任务依赖自身 id)在存在性校验前先报清晰错误。
        const newTaskId = `t${fresh.taskSeq + 1}`
        if (dependencies.includes(newTaskId)) {
          throw new Error(`dependency cycle detected: ${newTaskId} → ${newTaskId} — a task cannot depend on itself`)
        }
        for (const dependency of dependencies) {
          if (!fresh.tasks.some((task) => task.id === dependency)) {
            throw new Error(`dependency "${dependency}" does not exist in team "${fresh.name}"`)
          }
        }
        if (args.assignee !== undefined) requireMember(fresh, args.assignee)
        const milestone = args.milestone === true
        // Derived gate flag persisted here so snapshots and the completion
        // gate share one source of truth: high/critical risk or a milestone.
        const reviewRequired = args.risk === 'high' || args.risk === 'critical' || milestone
        const task: TeamTask = {
          id: `t${fresh.taskSeq + 1}`,
          subject: args.subject,
          description: args.description,
          status: 'pending',
          assignee: args.assignee,
          dependencies,
          attempt: 0,
          ...args.risk !== undefined ? { riskLevel: args.risk } : {},
          ...milestone ? { milestone: true } : {},
          ...reviewRequired ? { reviewRequired: true } : {},
          // 改进 4:任务描述含待确认问题(待输入/待确认…)时置位中间态 awaitingInput。
          ...descriptionAwaitingInput(args.description) ? { awaitingInput: true } : {},
          ...(args.estimate_level === 'S' || args.estimate_level === 'M' || args.estimate_level === 'L')
            ? { estimateLevel: args.estimate_level }
            : {},
          ...args.estimate_ms !== undefined && Number.isFinite(args.estimate_ms) && args.estimate_ms > 0
            ? { estimatedMs: Math.round(args.estimate_ms) }
            : {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        // R-04:创建前对有向依赖图(现有任务 + 新任务)做环检测(自环/互环/传递环),
        // 命中即拒绝并报环路径——环内任务永不可认领,静默死锁。
        const cycle = findTaskCycle([...fresh.tasks, task])
        if (cycle !== undefined) {
          throw new Error(`dependency cycle detected: ${cycle.join(' → ')} — every task in a cycle would block claiming forever; fix the dependencies first`)
        }
        fresh.taskSeq += 1
        fresh.tasks.push(task)
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-team-web/task-created', {
          teamId: fresh.id,
          taskId: task.id,
          subject: task.subject,
          dependencies: task.dependencies,
          ...task.assignee !== undefined ? { assignee: task.assignee } : {},
          ...task.estimateLevel !== undefined ? { estimateLevel: task.estimateLevel } : {},
          ...task.estimatedMs !== undefined ? { estimateMs: task.estimatedMs } : {},
        })
        const suggestion = args.assignee === undefined
          ? suggestionFieldsOf(task.subject, task.description, fresh.members, fresh.tasks)
          : {}
        return {
          task_id: task.id,
          subject: task.subject,
          status: task.status,
          ...task.assignee !== undefined ? { assignee: task.assignee } : {},
          ...reviewRequired ? { review_required: true } : {},
          ...task.estimateLevel !== undefined ? { estimate_level: task.estimateLevel } : {},
          ...task.estimatedMs !== undefined ? { estimate_ms: task.estimatedMs } : {},
          ...suggestion.suggestedRole !== undefined ? { suggested_role: suggestion.suggestedRole } : {},
          ...suggestion.suggestedAssignee !== undefined ? { suggested_assignee: suggestion.suggestedAssignee } : {},
          ...suggestion.suggestionConfidence !== undefined ? { suggestion_confidence: suggestion.suggestionConfidence } : {},
        }
      })
      await scheduler.kickTeam(workspace, team.id, captain)
      return created
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_reassign_task',
    description: 'Atomically retry, reassign, or let the captain take over any unfinished/failed task. The old attempt is revoked before its member is interrupted, so late updates cannot overwrite the new owner. Use assignee="captain" for captain takeover.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Task to retry/reassign.' },
      assignee: { type: 'string', required: true, description: 'Active member name, or "captain" for captain takeover.' },
      reason: { type: 'string', description: 'Why the task is being retried or reassigned.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          previous_assignee: { type: 'string', required: true },
          assignee: { type: 'string', required: true },
          status: { type: 'string', required: true },
          attempt: { type: 'number', required: true },
          attempt_id: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} reassigned ${value.previous_assignee || 'unassigned'} → ${value.assignee} (attempt ${value.attempt}, status ${value.status}${value.attempt_id ? `, attempt_id ${value.attempt_id}` : ''}).`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const target = args.assignee.trim()
      if (target === '') throw new Error('reassignment assignee must not be empty')

      const revoked = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const task = requireTask(fresh, args.task_id)
        if (task.status === 'completed') throw new Error(`completed task ${task.id} is immutable and cannot be reassigned`)
        if (task.reassigning === true) throw new Error(`task ${task.id} is already being reassigned`)
        const targetMember = target === CAPTAIN_KEY ? undefined : requireMember(fresh, target)
        if (targetMember !== undefined) {
          const busy = memberOpenTask(fresh, targetMember.name, task.id)
          if (busy !== undefined) {
            throw new Error(`member "${targetMember.name}" is busy with ${busy.id}; finish or reassign it first`)
          }
        }
        const previousAssignee = task.assignee ?? ''
        const previousMember = (task.status !== 'claimed' && task.status !== 'in_progress')
          || task.assignee === undefined || task.assignee === CAPTAIN_KEY
          ? undefined
          : fresh.members.find(member => member.name === task.assignee && member.status !== 'removed')
        invalidateTaskAttempt(task, target, true)
        await writeTeam(stateRoot, fresh)
        return {
          previousAssignee,
          previousMember: previousMember === undefined ? undefined : { ...previousMember },
          handoffId: task.handoffId,
        }
      })

      let quiescenceError: unknown
      if (revoked.previousMember !== undefined) {
        interruptMember(ctx, captain, revoked.previousMember.id)
        try {
          await waitForMemberIdle(ctx, revoked.previousMember, exec.signal)
        } catch (error: unknown) {
          quiescenceError = error
        }
      }

      await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const task = requireTask(fresh, args.task_id)
        if (task.handoffId !== revoked.handoffId || task.assignee !== target || task.reassigning !== true) {
          throw new Error(`task ${task.id} changed during reassignment; refusing to overwrite the newer state`)
        }
        task.reassigning = false
        if (quiescenceError === undefined && target === CAPTAIN_KEY) beginTaskAttempt(task, CAPTAIN_KEY)
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captain.session, 'agent-team-web/task-updated', {
          teamId: fresh.id,
          taskId: task.id,
          status: task.status,
          assignee: task.assignee,
          ...args.reason === undefined ? {} : { output: `Reassigned: ${args.reason}` },
        })
      })
      if (quiescenceError !== undefined) throw quiescenceError
      if (target !== CAPTAIN_KEY) await scheduler.kickMember(workspace, team.id, target, captain)
      const current = await readTeam(stateRoot, team.id)
      const task = current === undefined ? undefined : requireTask(current, args.task_id)
      if (task === undefined) throw new Error(`team "${team.name}" ended during reassignment`)
      return {
        task_id: task.id,
        previous_assignee: revoked.previousAssignee,
        assignee: task.assignee ?? '',
        status: task.status,
        attempt: task.attempt ?? 0,
        ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_claim_task',
    description: 'Claim one ready task for a member (or yourself). A member cannot own a second unfinished task. The returned attempt_id is required for that member\'s updates and becomes stale after retry/reassignment.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'The task id to claim.' },
      assignee: { type: 'string', description: 'Member to claim for (captain only; defaults to the task\'s assignee).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          assignee: { type: 'string', required: true },
          attempt: { type: 'number', required: true },
          attempt_id: { type: 'string' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} claimed by ${value.assignee} (attempt ${value.attempt}${value.attempt_id ? `, attempt_id ${value.attempt_id}` : ''}, status ${value.status}).`,
      }],
    },
    async execute(args, exec) {
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireParticipantTeam(workspace, config, caller)
      return withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id)
        const task = requireTask(fresh, args.task_id)
        if (task.reassigning === true) {
          throw new Error(`task ${task.id} is being reassigned; wait for the handoff to finish`)
        }
        let assignee = task.assignee
        if (identity.kind === 'captain') {
          if (args.assignee !== undefined) {
            requireMember(fresh, args.assignee)
            assignee = args.assignee
          }
        } else {
          if (args.assignee !== undefined) {
            throw new Error('members cannot set assignee when claiming a task')
          }
          if (assignee !== undefined && assignee !== identity.name) {
            throw new Error(`task ${task.id} is assigned to "${assignee}", not you`)
          }
          assignee = identity.name
        }
        // Authorization must happen before the idempotent return: another
        // member must not receive a false success for somebody else's task.
        if (task.status === 'claimed' || task.status === 'in_progress') {
          if (assignee === undefined || task.assignee !== assignee) {
            throw new Error(`task ${task.id} is already claimed by "${task.assignee ?? 'nobody'}"`)
          }
          return {
            task_id: task.id,
            status: task.status,
            assignee,
            attempt: task.attempt ?? 0,
            ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
          }
        }
        // R-02:待输入任务不可认领(调度器同样跳过)——先回答待确认问题
        // (update_task input_answered=true 清除)再派单,避免成员缺输入停滞。
        if (taskAwaitingInput(task)) {
          throw new Error(`task ${task.id} is awaiting input (待输入) — answer the pending question first (update_task with input_answered=true) before it can be claimed`)
        }
        const pending = unsatisfiedDependencies(fresh.tasks, task.dependencies)
        if (pending.length > 0) {
          throw new Error(`task ${task.id} is blocked by unfinished dependencies: ${pending.join(', ')} — complete them first`)
        }
        const transition = transitionError(task.status, 'claimed')
        if (transition !== undefined) throw new Error(transition)
        if (assignee === undefined) {
          throw new Error('claiming an unassigned task needs an assignee (claim on behalf of a member)')
        }
        const busy = memberOpenTask(fresh, assignee, task.id)
        if (busy !== undefined) {
          throw new Error(`member "${assignee}" is busy with ${busy.id}; finish or reassign it first`)
        }
        const attemptId = beginTaskAttempt(task, assignee)
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-team-web/task-updated', {
          teamId: fresh.id,
          taskId: task.id,
          status: task.status,
          assignee: task.assignee,
        })
        return {
          task_id: task.id,
          status: task.status,
          assignee: task.assignee ?? '',
          attempt: task.attempt ?? 0,
          attempt_id: attemptId,
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_update_task',
    description: 'Update a task status/output. Members must supply the current attempt_id returned by claim_task; stale attempts are rejected after takeover/reassignment. Terminal results are immutable. A captain must use reassign_task(assignee="captain") before updating member-owned work.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'The task id to update.' },
      status: {
        type: 'string',
        enum: ['in_progress', 'completed', 'failed', 'cancelled'],
        description: 'New status (in_progress, completed, failed, cancelled).',
      },
      output: { type: 'string', description: 'Result summary; set when completing or failing.' },
      attempt_id: { type: 'string', description: 'Current execution capability returned by claim_task (required for members when present on the task).' },
      retro_cause: {
        type: 'string',
        enum: [...TASK_RETRO_CAUSES],
        description: 'Optional attribution for the auto-generated retrospective when the task reaches a terminal status (completed/failed/cancelled). When omitted, it is derived from the numbers: over budget → "underestimated", on time → "on_time", cancelled → "other".',
      },
      retro_note: {
        type: 'string',
        description: 'Optional one-line lesson from the member (复盘三层之第二层, bestPractice 原始素材). Stored on the retrospective and distilled into the global best-practices library (unless the task was cancelled).',
      },
      signal_note: {
        type: 'string',
        description: 'Optional self-reported output signal (L1): evidence of work beyond wall-clock time, e.g. "深挖了 1400 行 CSS". Stored on the task signals; never required.',
      },
      input_answered: {
        type: 'boolean',
        description: 'R-02: mark the task\'s pending question as answered — clears the awaitingInput (待输入) intermediate state so the task can be dispatched and claimed. Set by the captain (or the task owner) once the required input has been provided; persisted immediately.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          output: { type: 'string' },
          attempt: { type: 'number', required: true },
          attempt_id: { type: 'string' },
          estimate_level: { type: 'string' },
          started_at: { type: 'number' },
          signals: {
            type: 'object',
            additionalProperties: false,
            properties: {
              turns: { type: 'number' },
              tool_calls: { type: 'number' },
              output_bytes: { type: 'number' },
              self_report: { type: 'string' },
            },
          },
          actual_ms: { type: 'number' },
          estimated_ms: { type: 'number' },
          overrun_ms: { type: 'number' },
          retro_cause: { type: 'string' },
          overran: { type: 'boolean' },
          // P2-8 修复:handler 恒返回 retro(终结时),schema 必须声明,
          // 否则 additionalProperties:false 下每次终结更新都校验失败。
          retro: {
            type: 'object',
            additionalProperties: false,
            properties: {
              attempt: { type: 'number' },
              actual_ms: { type: 'number' },
              estimate_level: { type: 'string' },
              estimated_ms: { type: 'number' },
              overrun_ms: { type: 'number' },
              level_deviation: { type: 'number' },
              overran: { type: 'boolean' },
              cause: { type: 'string' },
              summary: { type: 'string' },
              retro_note: { type: 'string' },
              captain_verdict: { type: 'string' },
              recommendation: { type: 'string' },
              includes_gate_wait: { type: 'boolean' },
              has_helper: { type: 'boolean' },
              created_at: { type: 'number' },
            },
          },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} attempt ${value.attempt} → ${value.status}${value.output !== undefined ? `\nOutput: ${value.output}` : ''}`,
      }],
    },
    async execute(args, exec) {
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireParticipantTeam(workspace, config, caller)
      const updated = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id)
        const task = requireTask(fresh, args.task_id)
        if (identity.kind === 'captain'
          && task.assignee !== undefined
          && task.assignee !== CAPTAIN_KEY) {
          throw new Error(`task ${task.id} is owned by member "${task.assignee}"; call agent_teams_reassign_task with assignee="captain" before takeover`)
        }
        if (identity.kind === 'member') {
          if (task.assignee !== identity.name) {
            throw new Error(`task ${task.id} is assigned to "${task.assignee ?? 'nobody'}", not you`)
          }
          if (task.attemptId !== undefined && args.attempt_id !== task.attemptId) {
            throw new Error(`stale attempt for task ${task.id}: expected the current attempt_id; stop work and request fresh assignment`)
          }
        }
        if (TERMINAL_TASK_STATUSES.includes(task.status)) {
          const sameStatus = args.status === undefined || args.status === task.status
          const sameOutput = args.output === undefined || args.output === task.output
          if (!sameStatus || !sameOutput) {
            throw new Error(`terminal task ${task.id} is immutable; use agent_teams_reassign_task to retry failed/cancelled work`)
          }
          return {
            task_id: task.id,
            status: task.status,
            attempt: task.attempt ?? 0,
            ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
            ...task.output !== undefined ? { output: task.output } : {},
          }
        }
        // Commissar gate: a task under review (high/critical risk or
        // milestone) may only be marked completed after the commissar passed
        // it. Rejecting keeps the task in_progress/claimed and notifies the
        // commissar; without an active commissar the gate still holds hard.
        // 改进 4:被拦截的完成请求置位中间态 blockedByReview(等待政委复核),
        // 并先落盘再抛错,让面板/快照能立即看到任务的"待复核"阻塞态。
        if (args.status === 'completed' && gateBlocksCompletion(task)) {
          task.blockedByReview = true
          task.updatedAt = Date.now()
          await writeTeam(stateRoot, fresh)
          const notified = await notifyCommissarPendingReview(ctx, stateRoot, fresh, task, exec.signal)
          if (!notified) {
            throw new Error(`task ${task.id} requires commissar review (需要政委复核) before completing, but the team has no active commissar — add one with agent_teams_add_member(role=commissar) first`)
          }
          throw new Error(`task ${task.id} requires commissar review (需要政委复核) before completing — the commissar has been notified; retry after agent_teams_review_task(verdict=pass)`)
        }
        if (args.status !== undefined) {
          const transition = transitionError(task.status, args.status)
          if (transition !== undefined) throw new Error(transition)
          task.status = args.status
        }
        if (args.output !== undefined) task.output = args.output
        // R-02:输入已答 → 显式清除 awaitingInput 中间态(显式 false 压制描述派生),
        // 随本调用末尾 writeTeam 一并落盘;配合调度器/认领跳过,任务立即可派单。
        if (args.input_answered === true) task.awaitingInput = false
        // 自成长:
        // - 三节点时间戳之"开工":进入 in_progress 时幂等记录 startedAt。
        // - 产出信号 turns:每次状态变更增量 +1;outputBytes 随 output 写入。
        // - 终结状态结算耗时(claimed→completed),并自动生成复盘摘要(三层之服务端自动主体)。
        if (task.status === 'in_progress') task.startedAt ??= Date.now()
        if (args.status !== undefined) {
          const selfReport = task.signals?.selfReport
          task.signals = {
            turns: (task.signals?.turns ?? 0) + 1,
            outputBytes: task.output !== undefined ? task.output.length : (task.signals?.outputBytes ?? 0),
            ...selfReport !== undefined ? { selfReport } : {},
          }
        } else if (args.output !== undefined) {
          const selfReport = task.signals?.selfReport
          task.signals = {
            ...selfReport !== undefined ? { selfReport } : {},
            outputBytes: args.output.length,
          }
        }
        if (args.signal_note !== undefined && args.signal_note.trim() !== '') {
          task.signals = {
            turns: task.signals?.turns,
            outputBytes: task.signals?.outputBytes ?? 0,
            selfReport: args.signal_note.trim(),
          }
        }
        if (TERMINAL_TASK_STATUSES.includes(task.status)) {
          // 改进 4:终结状态不存在"等待复核/等待输入"中间态,兜底清除脏标记。
          task.blockedByReview = false
          task.awaitingInput = false
          finalizeTaskTiming(task)
          if (task.retro === undefined && task.actualMs !== undefined && task.claimedAt !== undefined) {
            const facts: RetroTaskFacts = {
              attempt: task.attempt ?? 0,
              estimateLevel: task.estimateLevel,
              estimatedMs: task.estimatedMs,
              claimedAt: task.claimedAt,
              completedAt: task.completedAt,
              actualMs: task.actualMs,
              status: task.status,
              retroNote: args.retro_note,
              // 边界标注(方向决策 6):政委门禁等待不拆分,只注明"含等待"。
              includesGateWait: task.reviewRequired === true
                && task.review?.verdict === 'pass'
                && (task.review.reviewedAt ?? 0) >= (task.claimedAt ?? 0),
              // helper 介入算进总耗时,只注明"有 helper 介入"(本 attempt 曾有 helper)。
              hasHelper: task.helperEver === true || task.helper !== undefined,
            }
            task.retro = buildTaskRetro(facts, args.retro_cause)
            // L3:提炼入库(除 cancelled —— 记耗时不推经验)。bestPractice 全局库跨团队。
            if (task.status !== 'cancelled') {
              if (task.retro.retroNote !== undefined || task.retro.recommendation !== '') {
                const practice = distillBestPractice(task.retro, {
                  sourceTeamId: fresh.id,
                  sourceTaskId: task.id,
                  sourceTaskSubject: task.subject,
                  role: roleOfTask(fresh, task),
                })
                if (practice !== undefined) {
                  const entries = upsertBestPractice(await readBestPractices(stateRoot), practice)
                  await writeBestPractices(stateRoot, entries)
                }
              }
            }
          }
        }
        task.updatedAt = Date.now()
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-team-web/task-updated', {
          teamId: fresh.id,
          taskId: task.id,
          status: task.status,
          ...task.assignee !== undefined ? { assignee: task.assignee } : {},
          ...task.output !== undefined ? { output: task.output } : {},
          ...task.estimateLevel !== undefined ? { estimateLevel: task.estimateLevel } : {},
          ...task.signals !== undefined ? { signals: task.signals } : {},
          ...task.actualMs !== undefined ? { actualMs: task.actualMs } : {},
          ...task.retro !== undefined ? { retroCause: task.retro.cause, overran: task.retro.overran } : {},
        })
        return {
          task_id: task.id,
          status: task.status,
          attempt: task.attempt ?? 0,
          ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
          ...task.output !== undefined ? { output: task.output } : {},
          ...task.estimateLevel !== undefined ? { estimate_level: task.estimateLevel } : {},
          ...task.startedAt !== undefined ? { started_at: task.startedAt } : {},
          ...task.signals === undefined ? {} : {
            signals: {
              ...task.signals.turns !== undefined ? { turns: task.signals.turns } : {},
              ...task.signals.toolCalls !== undefined ? { tool_calls: task.signals.toolCalls } : {},
              output_bytes: task.signals.outputBytes,
              ...task.signals.selfReport !== undefined ? { self_report: task.signals.selfReport } : {},
            },
          },
          ...task.actualMs !== undefined ? { actual_ms: task.actualMs } : {},
          ...task.estimatedMs !== undefined ? { estimated_ms: task.estimatedMs } : {},
          ...task.overrunMs !== undefined ? { overrun_ms: task.overrunMs } : {},
          ...task.retro === undefined ? {} : {
            retro: {
              attempt: task.retro.attempt,
              actual_ms: task.retro.actualMs,
              ...task.retro.estimateLevel !== undefined ? { estimate_level: task.retro.estimateLevel } : {},
              ...task.retro.estimatedMs !== undefined ? { estimated_ms: task.retro.estimatedMs } : {},
              ...task.retro.overrunMs !== undefined ? { overrun_ms: task.retro.overrunMs } : {},
              ...task.retro.levelDeviation !== undefined ? { level_deviation: task.retro.levelDeviation } : {},
              overran: task.retro.overran,
              cause: task.retro.cause,
              summary: task.retro.summary,
              ...task.retro.retroNote !== undefined ? { retro_note: task.retro.retroNote } : {},
              ...task.retro.captainVerdict !== undefined ? { captain_verdict: task.retro.captainVerdict } : {},
              recommendation: task.retro.recommendation,
              ...task.retro.includesGateWait === true ? { includes_gate_wait: true } : {},
              ...task.retro.hasHelper === true ? { has_helper: true } : {},
              created_at: task.retro.createdAt,
            },
          },
        }
      })
      await scheduler.kickTeam(workspace, team.id, team.captainSessionId === caller.id ? caller : undefined)
      return updated
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_review_task',
    description: 'Commissar gate review: only an active commissar (role=commissar) member may call this — the captain cannot review (independent oversight). Records a pass/reject verdict on a task; a task under review can only be marked completed after a pass verdict. Pass releases the completion gate; reject keeps the task in progress for rework.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'The task id to review.' },
      verdict: {
        type: 'string',
        enum: ['pass', 'reject'],
        required: true,
        description: 'pass opens the completion gate; reject keeps the task in progress.',
      },
      comment: { type: 'string', description: 'Review comment (recommended when rejecting).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          verdict: { type: 'string', required: true },
          reviewer: { type: 'string', required: true },
          reviewed_at: { type: 'number', required: true },
          gate_open: { type: 'boolean', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} reviewed by ${value.reviewer}: ${value.verdict}${value.gate_open ? ' — completion gate open, owner may now mark it completed' : ' — task stays in progress for rework'}.`,
      }],
    },
    async execute(args, exec) {
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireParticipantTeam(workspace, config, caller)
      const reviewed = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id)
        if (identity.kind !== 'member') {
          throw new Error('只有政委可以执行门禁复核 — the captain cannot review tasks (independent oversight)')
        }
        const commissar = fresh.members.find((member) => member.name === identity.name)
        if (!isActiveCommissar(commissar)) {
          throw new Error(`member "${identity.name}" is not the commissar — only an active commissar (role=commissar) member can review tasks`)
        }
        const task = requireTask(fresh, args.task_id)
        if (TERMINAL_TASK_STATUSES.includes(task.status)) {
          throw new Error(`terminal task ${task.id} is immutable and needs no review`)
        }
        // Review independence: the commissar must not gate work it executed.
        // The scheduler never dispatches a commissar as helper (nextHelpTask),
        // so this is defense in depth against any residual helper marker.
        if (task.helper === identity.name) {
          throw new Error(`政委不能复核自己协助过的任务（独立监督）— task ${task.id} is currently helped by you; ask the captain to reassign the help first`)
        }
        task.review = {
          reviewerName: identity.name,
          verdict: args.verdict,
          ...args.comment !== undefined && args.comment.trim() !== '' ? { comment: args.comment } : {},
          reviewedAt: Date.now(),
        }
        // 改进 4:pass 解除"等待复核"中间态;reject 保持 in_progress 待返工,
        // blockedByReview 维持不变(任务仍被门禁拦截,直到出现 pass)。
        if (args.verdict === 'pass') task.blockedByReview = false
        task.updatedAt = Date.now()
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-team-web/task-reviewed', {
          teamId: fresh.id,
          taskId: task.id,
          verdict: task.review.verdict,
          ...task.review.comment !== undefined ? { comment: task.review.comment } : {},
        })
        return {
          task_id: task.id,
          verdict: task.review.verdict,
          reviewer: task.review.reviewerName,
          reviewed_at: task.review.reviewedAt,
          gate_open: task.review.verdict === 'pass',
        }
      })
      return reviewed
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_send_message',
    description: 'Send a message to the captain or to a teammate. Messages go straight into the recipient\'s mailbox; when the captain agent is online the plugin also schedules live delivery (member recipients get the message as their next turn; a running captain sees it at the nearest model step). No relay is involved: teammates talk to each other directly, exactly like the Claude Code AgentTeams mailbox model.',
    parameters: {
      to: { type: 'string', required: true, description: 'Recipient: "captain" or a member name.' },
      content: { type: 'string', required: true, description: 'The message text.' },
      from: { type: 'string', description: 'Sender (defaults to the caller: the captain, or the calling member).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          message_id: { type: 'string', required: true },
          from: { type: 'string', required: true },
          to: { type: 'string', required: true },
          delivered: { type: 'string', required: true, description: 'live (accepted by the live captain), wake (member recipient woken), or mailbox (durable inbox only).' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Message ${value.message_id} ${value.from} → ${value.to} delivered via ${value.delivered}.`,
      }],
    },
    async execute(args, exec) {
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireParticipantTeam(workspace, config, caller)
      const to = args.to.trim()
      const prepared = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id)
        const from = identity.name
        // `from` may only be the caller's own identity: impersonating another
        // member (or the captain) would poison the mailbox and event records.
        if (args.from !== undefined && args.from !== from) {
          throw new Error(`agent_teams_send_message: "from" must be your own identity ("${from}"), not "${args.from}"`)
        }
        if (to === CAPTAIN_KEY) {
          const message = { ...createMessage(from, CAPTAIN_KEY, args.content), deliveryClaimedAt: Date.now() }
          await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, message)
          appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-team-web/message-sent', {
            teamId: fresh.id,
            messageId: message.id,
            from,
            to: CAPTAIN_KEY,
            content: args.content,
            ts: message.ts,
          })
          return { kind: 'captain' as const, fresh, identity, message, from }
        }
        const recipient = requireMember(fresh, to)
        const message = { ...createMessage(from, recipient.name, args.content), deliveryClaimedAt: Date.now() }
        await appendMailbox(stateRoot, fresh.id, recipient.name, message)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-team-web/message-sent', {
          teamId: fresh.id,
          messageId: message.id,
          from,
          to: recipient.name,
          content: args.content,
          ts: message.ts,
        })
        return { kind: 'member' as const, fresh, identity, message, from, recipient }
      })

      // Resolve the exact live captain only after releasing the state lock.
      // The plugin mailbox is already durable if live delivery cannot proceed.
      const captain = ctx.agents.get(prepared.fresh.captainSessionId as SessionId)
      if (prepared.kind === 'captain') {
        let delivered: 'live' | 'mailbox' = 'mailbox'
        if (captain !== undefined && prepared.identity.kind === 'member') {
          delivered = steerCaptainReport(captain, prepared.from, args.content) ? 'live' : 'mailbox'
        }
        if (delivered === 'live') {
          await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
            acknowledgeMailbox(stateRoot, prepared.fresh.id, CAPTAIN_KEY, [prepared.message.id])
          ))
        } else {
          await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
            releaseMailboxDelivery(stateRoot, prepared.fresh.id, CAPTAIN_KEY, [prepared.message.id])
          ))
        }
        return { message_id: prepared.message.id, from: prepared.from, to: CAPTAIN_KEY, delivered }
      }
      let delivered: 'wake' | 'mailbox' = 'mailbox'
      if (captain !== undefined && prepared.recipient.id !== '') {
        const senderText = prepared.from === CAPTAIN_KEY
          ? args.content
          : `Message from team member ${prepared.from}:\n\n${args.content}`
        const text = `AgentTeams state policy: inspect ${config.stateDir}/${prepared.fresh.id}/ read-only; never edit team.json or inbox files directly. Use agent_teams_* tools for team state.\n\n${senderText}`
        const accepted = await deliverToMember(ctx, captain, prepared.recipient.id, text, exec.signal)
        delivered = accepted ? 'wake' : 'mailbox'
        if (accepted) {
          await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
            acknowledgeMailbox(stateRoot, prepared.fresh.id, prepared.recipient.name, [prepared.message.id])
          ))
        }
      }
      if (delivered === 'mailbox') {
        await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
          releaseMailboxDelivery(stateRoot, prepared.fresh.id, prepared.recipient.name, [prepared.message.id])
        ))
      }
      return {
        message_id: prepared.message.id,
        from: prepared.from,
        to: prepared.recipient.name,
        delivered,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_status',
    description: 'Team snapshot: members with live activity and tasks with status/assignee/dependencies/output. Captains also see every team mailbox; members see only their own inbox. Poll this to watch progress. Non-terminal tasks may carry a suggested_role/assignee (keyword-based, advisory only) so the captain can confirm or override before assigning.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
    },
    async execute(_args, exec) {
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller)
      const stateRoot = stateRootOf(workspace, config)
      const located = await requireParticipantTeam(workspace, config, caller)
      if (located.captainSessionId === caller.id) {
        await scheduler.kickTeam(workspace, located.id, caller)
      }
      const { team, identity } = await withTeamLock(
        teamLockKey(stateRoot, located.id),
        () => requireFreshParticipant(stateRoot, located.id, caller.id),
      )
      const activity = memberActivity(ctx, team.members.map((member) => member.id))
      const members = team.members
        .filter((member) => member.status !== 'removed')
        .map((member) => ({
          name: member.name,
          role: member.role ?? '',
          provider: member.provider ?? '',
          model: member.model ?? '',
          reasoning_effort: member.reasoningEffort ?? '',
          status: member.status,
          activity: member.id !== '' ? (activity.get(member.id) ?? 'unknown') : 'unspawned',
        }))
      // 改进方向 3:按任务内容推断「建议角色/成员」(纯函数,仅建议不派单),
      // 队长在状态里直接可见,确认后仍走现有 assignee 流程。
      const suggestionByTask = new Map<string, TaskAssigneeSuggestion>()
      for (const suggestion of suggestAssignments(team.tasks, team.members)) {
        suggestionByTask.set(suggestion.taskId, suggestion)
      }
      const tasks = team.tasks.map((task) => {
        const suggestion = suggestionByTask.get(task.id)
        return {
        id: task.id,
        subject: task.subject,
        status: task.status,
        assignee: task.assignee ?? '',
        dependencies: task.dependencies,
        attempt: task.attempt ?? 0,
        attempt_id: task.attemptId ?? '',
        reassigning: task.reassigning === true,
        ...task.riskLevel !== undefined ? { risk_level: task.riskLevel } : {},
        ...task.milestone === true ? { milestone: true } : {},
        ...task.reviewRequired === true ? { review_required: true } : {},
        // 改进 4:任务中间态(等待政委复核 / 等待输入)显式透出给模型。
        ...taskBlockedByReview(task) ? { blocked_by_review: true } : {},
        ...taskAwaitingInput(task) ? { awaiting_input: true } : {},
        ...task.review === undefined ? {} : {
          review: {
            reviewer_name: task.review.reviewerName,
            verdict: task.review.verdict,
            ...task.review.comment !== undefined ? { comment: task.review.comment } : {},
            reviewed_at: task.review.reviewedAt,
          },
        },
        ...task.helper !== undefined ? { helper: task.helper } : {},
        ...task.output !== undefined ? { output: task.output } : {},
        // 自成长字段:预估等级/预估毫秒/认领/开工/完成/实际/偏差/信号/复盘(旧任务缺省)。
        ...task.estimateLevel !== undefined ? { estimate_level: task.estimateLevel } : {},
        ...task.estimatedMs !== undefined ? { estimated_ms: task.estimatedMs } : {},
        ...task.claimedAt !== undefined ? { claimed_at: task.claimedAt } : {},
        ...task.startedAt !== undefined ? { started_at: task.startedAt } : {},
        ...task.completedAt !== undefined ? { completed_at: task.completedAt } : {},
        ...task.actualMs !== undefined ? { actual_ms: task.actualMs } : {},
        ...task.overrunMs !== undefined ? { overrun_ms: task.overrunMs } : {},
        ...task.signals === undefined ? {} : {
          signals: {
            ...task.signals.turns !== undefined ? { turns: task.signals.turns } : {},
            ...task.signals.toolCalls !== undefined ? { tool_calls: task.signals.toolCalls } : {},
            output_bytes: task.signals.outputBytes,
            ...task.signals.selfReport !== undefined ? { self_report: task.signals.selfReport } : {},
          },
        },
        ...task.retro === undefined ? {} : {
          retro: {
            attempt: task.retro.attempt,
            actual_ms: task.retro.actualMs,
            ...task.retro.estimateLevel !== undefined ? { estimate_level: task.retro.estimateLevel } : {},
            ...task.retro.estimatedMs !== undefined ? { estimated_ms: task.retro.estimatedMs } : {},
            ...task.retro.overrunMs !== undefined ? { overrun_ms: task.retro.overrunMs } : {},
            ...task.retro.levelDeviation !== undefined ? { level_deviation: task.retro.levelDeviation } : {},
            overran: task.retro.overran,
            cause: task.retro.cause,
            summary: task.retro.summary,
            ...task.retro.retroNote !== undefined ? { retro_note: task.retro.retroNote } : {},
            ...task.retro.captainVerdict !== undefined ? { captain_verdict: task.retro.captainVerdict } : {},
            recommendation: task.retro.recommendation,
            ...task.retro.includesGateWait === true ? { includes_gate_wait: true } : {},
            ...task.retro.hasHelper === true ? { has_helper: true } : {},
            created_at: task.retro.createdAt,
          },
        },
        ...suggestion === undefined ? {} : {
          ...suggestion.suggestedRole === null ? {} : { suggested_role: suggestion.suggestedRole },
          ...suggestion.suggestedMember === null ? {} : { suggested_member: suggestion.suggestedMember },
          ...suggestion.confidence === null ? {} : { suggestion_confidence: suggestion.confidence },
        },
      }})
      const mailboxWarnings: string[] = []
      let mailboxWarningCount = 0
      const reportMalformed = (agentKey: string) => (lineNumber: number): void => {
        mailboxWarningCount += 1
        if (mailboxWarnings.length < 10) {
          mailboxWarnings.push(`${agentKey} mailbox line ${lineNumber}`)
        }
      }
      const captainInbox = identity.kind === 'captain'
        ? await readUnreadMailbox(stateRoot, team.id, CAPTAIN_KEY, reportMalformed(CAPTAIN_KEY))
        : []
      const memberInboxes: Record<string, { count: number; latest: string }> = {}
      const visibleMembers = identity.kind === 'captain'
        ? members
        : members.filter((member) => member.name === identity.name)
      for (const member of visibleMembers) {
        const messages = await readUnreadMailbox(
          stateRoot,
          team.id,
          member.name,
          reportMalformed(member.name),
        )
        if (messages.length > 0) {
          memberInboxes[member.name] = {
            count: messages.length,
            latest: messages[messages.length - 1]?.content.slice(0, 200) ?? '',
          }
        }
      }
      const result = {
        team_id: team.id,
        team_name: team.name,
        description: team.description ?? '',
        viewer: identity.name,
        members,
        tasks,
        captain_inbox: captainInbox.slice(-10).map((message) => ({
          from: message.from,
          content: message.content,
          ts: message.ts,
        })),
        member_inboxes: memberInboxes,
        mailbox_warnings: mailboxWarnings,
        mailbox_warning_count: mailboxWarningCount,
      }
      const acknowledged = identity.kind === 'captain'
        ? captainInbox.map(message => message.id)
        : await readUnreadMailbox(stateRoot, team.id, identity.name).then(messages => messages.map(message => message.id))
      if (acknowledged.length > 0) {
        await withTeamLock(teamLockKey(stateRoot, team.id), () => (
          acknowledgeMailbox(stateRoot, team.id, identity.kind === 'captain' ? CAPTAIN_KEY : identity.name, acknowledged)
        ))
      }
      return result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_retro_review',
    description: 'Captain calibration of a task retrospective (复盘三层之第三层): mark it useful (confirmed into the best-practices library), useless (remove from the library), or revised (re-attribute the cause and re-distill). Updates both the task retro and the global best-practices entry.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'The task whose retrospective to calibrate.' },
      verdict: {
        type: 'string',
        enum: ['useful', 'useless', 'revised'],
        required: true,
        description: 'useful = confirmed into the library; useless = marked invalid and removed from the library; revised = re-attribute cause and re-distill.',
      },
      cause: {
        type: 'string',
        enum: [...TASK_RETRO_CAUSES],
        description: 'Optional new cause when verdict=revised.',
      },
      note: { type: 'string', description: 'Optional calibration note (stored on the retro).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          verdict: { type: 'string', required: true },
          practice_updated: { type: 'boolean', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} retro calibrated: ${value.verdict}${value.practice_updated ? ' · best-practices entry updated' : ' · no library entry to update'}.`,
      }],
    },
    async execute(args, exec) {
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, caller)
      return withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, caller.id)
        const task = requireTask(fresh, args.task_id)
        if (task.retro === undefined) {
          throw new Error(`task ${task.id} has no retrospective yet — it is generated automatically when a claimed task reaches a terminal status`)
        }
        task.retro = {
          ...task.retro,
          cause: args.verdict === 'revised' && (args.cause as TaskRetroCause | undefined) !== undefined
            ? args.cause as TaskRetroCause
            : task.retro.cause,
          ...args.verdict === 'revised' && args.cause !== undefined
            ? { recommendation: retroRecommendationFor(args.cause as TaskRetroCause) }
            : {},
          ...args.note !== undefined && args.note.trim() !== ''
            ? { retroNote: args.note.trim() }
            : {},
          captainVerdict: args.verdict,
        }
        task.updatedAt = Date.now()
        await writeTeam(stateRoot, fresh)
        // 同步全局经验库:useless 剔除;useful/revised 更新(重新提炼)。
        const library = await readBestPractices(stateRoot)
        const entryIndex = library.findIndex(entry =>
          entry.sourceTeamId === fresh.id && entry.sourceTaskId === task.id)
        let practiceUpdated = false
        if (entryIndex >= 0) {
          let next: BestPracticeEntry[] = library
          if (args.verdict === 'useless') {
            next = library.filter((entry, index) => index !== entryIndex)
          } else {
            next = updateBestPracticeVerdict(library, library[entryIndex]!.id, args.verdict, task.retro.cause)
          }
          await writeBestPractices(stateRoot, next)
          practiceUpdated = true
        } else if (args.verdict !== 'useless') {
          // 库里没有(可能被剔过或从未入库):revised/useful 时按当前 retro 补建。
          const practice = distillBestPractice(task.retro, {
            sourceTeamId: fresh.id,
            sourceTaskId: task.id,
            sourceTaskSubject: task.subject,
            role: roleOfTask(fresh, task),
          })
          if (practice !== undefined) {
            await writeBestPractices(stateRoot, upsertBestPractice(library, { ...practice, verdict: args.verdict }))
            practiceUpdated = true
          }
        }
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-team-web/retro-reviewed', {
          teamId: fresh.id,
          taskId: task.id,
          verdict: args.verdict,
          cause: task.retro.cause,
        })
        return { task_id: task.id, verdict: args.verdict, practice_updated: practiceUpdated }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_best_practices',
    description: 'Read the global best-practices library (L3, cross-team) with optional role/level filtering, plus per-(role × level) calibration of this team\'s completed tasks (average actual duration, overrun ratio) to calibrate future estimate_level. Cold start: with fewer than 2 settled samples the calibration concludes "insufficient samples" instead of guessing.',
    parameters: {
      role: { type: 'string', description: 'Optional filter: only entries for this role.' },
      level: { type: 'string', enum: ['S', 'M', 'L'], description: 'Optional filter: only entries for this estimate level.' },
      limit: { type: 'number', description: 'Optional max entries to return (default 20).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          team_id: { type: 'string', required: true },
          total: { type: 'number', required: true },
          best_practices: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                source_team_id: { type: 'string', required: true },
                source_task_id: { type: 'string', required: true },
                source_task_subject: { type: 'string', required: true },
                role: { type: 'string', required: true },
                level: { type: 'string' },
                cause: { type: 'string', required: true },
                practice: { type: 'string', required: true },
                verdict: { type: 'string', required: true },
                created_at: { type: 'number', required: true },
                updated_at: { type: 'number', required: true },
              },
            },
          },
          calibration: {
            type: 'object',
            additionalProperties: false,
            properties: {
              completed_with_timing: { type: 'number', required: true },
              by_role_level: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    role: { type: 'string', required: true },
                    level: { type: 'string', required: true },
                    task_count: { type: 'number', required: true },
                    avg_actual_ms: { type: 'number' },
                    overrun_ratio: { type: 'number' },
                  },
                },
              },
              hint: { type: 'string', required: true },
            },
          },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: renderBestPractices(value, args),
      }],
    },
    async execute(args, exec) {
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, caller)
      const fresh = await withTeamLock(
        teamLockKey(stateRoot, team.id),
        () => requireFreshCaptainTeam(stateRoot, team.id, caller.id),
      )
      const library = await readBestPractices(stateRoot)
      const roleFilter = args.role?.trim()
      const levelFilter = args.level === 'S' || args.level === 'M' || args.level === 'L'
        ? args.level
        : undefined
      const limit = args.limit !== undefined && Number.isSafeInteger(args.limit) && args.limit > 0
        ? args.limit
        : 20
      const filtered = library
        .filter(entry => roleFilter === undefined || entry.role === roleFilter)
        .filter(entry => levelFilter === undefined || entry.level === levelFilter)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, limit)
      const summary = summarizeTeamRetro(fresh.tasks, fresh.members)
      return {
        team_id: fresh.id,
        total: filtered.length,
        best_practices: filtered.map(entry => ({
          id: entry.id,
          source_team_id: entry.sourceTeamId,
          source_task_id: entry.sourceTaskId,
          source_task_subject: entry.sourceTaskSubject,
          role: entry.role,
          ...entry.level !== undefined ? { level: entry.level } : {},
          cause: entry.cause,
          practice: entry.practice,
          verdict: entry.verdict,
          created_at: entry.createdAt,
          updated_at: entry.updatedAt,
        })),
        calibration: {
          completed_with_timing: summary.completedWithTiming,
          by_role_level: summary.byRoleLevel.map(entry => ({
            role: entry.role,
            level: entry.level,
            task_count: entry.taskCount,
            ...entry.avgActualMs !== undefined ? { avg_actual_ms: entry.avgActualMs } : {},
            ...entry.overrunRatio !== undefined ? { overrun_ratio: entry.overrunRatio } : {},
          })),
          hint: retroCalibrationHint(summary),
        },
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'agent_teams_delete',
    description: 'End your team: interrupts all members (best effort) and deletes the team\'s state directory (team file, tasks, mailboxes). Use when the team\'s work is done or abandoned.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deleted: { type: 'boolean', required: true },
          team_name: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Team "${value.team_name}" deleted.`,
      }],
    },
    async execute(_args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const members = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        // Include previously removed members so deleting a pre-fix team also
        // retires durable catalog entries left behind by remove_member.
        const roster = fresh.members.map(member => ({ ...member }))
        for (const member of fresh.members) {
          if (member.status === 'removed') continue
          member.status = 'removed'
          for (const task of fresh.tasks) {
            if (task.assignee === member.name && task.status !== 'completed') invalidateTaskAttempt(task)
          }
        }
        await writeTeam(stateRoot, fresh)
        return roster
      })
      await recordRetiredMemberIds(stateRoot, members.map(member => member.id))
      for (const member of members) {
        if (member.id === '') continue
        interruptMember(ctx, captain, member.id)
      }
      const quiescence = await Promise.allSettled(members.map(member => waitForMemberIdle(ctx, member, exec.signal)))
      for (const result of quiescence) {
        if (result.status === 'rejected') {
          ctx.logger.warn(`agent-team-web: member did not quiesce cleanly before team archive: ${String(result.reason)}`)
        }
      }
      await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-team-web/team-deleted', {
          teamId: fresh.id,
        })
        // Archive, not delete: tasks (with their dependency graph) and the
        // mailboxes stay on disk for later review and dependency rebuilds.
        await archiveTeamDir(stateRoot, fresh.id)
      })
      return { deleted: true, team_name: team.name }
    },
  }))
}

/** Build the `memberRuntime` config handed to member helpers. */
function memberRuntime(config: ToolsConfig): MemberRuntimeConfig {
  return {
    provider: config.memberProvider,
    maxDepth: config.memberMaxDepth,
  }
}

/** 任务的执行成员角色(bestPractice 溯源用);无 owner 或非成员时回退姓名。 */
function roleOfTask(team: TeamState, task: TeamTask): string {
  if (task.assignee === undefined || task.assignee === CAPTAIN_KEY) return 'captain'
  return team.members.find(member => member.name === task.assignee && member.status !== 'removed')?.role
    ?? task.assignee
}

/** Render the status snapshot as compact text for the model. */
function renderStatus(value: JsonValue): string {
  const team = value as {
    team_name: string
    description?: string
    viewer: string
    members: {
      name: string
      role: string
      provider: string
      model: string
      reasoning_effort: string
      status: string
      activity: string
    }[]
    tasks: { id: string; subject: string; status: string; assignee: string; dependencies: string[]; attempt: number; attempt_id: string; reassigning: boolean; risk_level?: string; milestone?: boolean; review_required?: boolean; review?: { reviewer_name: string; verdict: string; comment?: string; reviewed_at: number }; helper?: string; output?: string; estimate_level?: string; estimated_ms?: number; claimed_at?: number; started_at?: number; completed_at?: number; actual_ms?: number; overrun_ms?: number; signals?: { turns?: number; tool_calls?: number; output_bytes: number; self_report?: string }; retro?: { attempt: number; actual_ms: number; estimate_level?: string; estimated_ms?: number; overrun_ms?: number; level_deviation?: number; overran: boolean; cause: string; summary: string; retro_note?: string; captain_verdict?: string; recommendation: string; includes_gate_wait?: boolean; has_helper?: boolean; created_at: number }; suggested_role?: string; suggested_member?: string; suggestion_confidence?: string }[]
    captain_inbox: { from: string; content: string }[]
    member_inboxes: Record<string, { count: number; latest: string }>
    mailbox_warnings: string[]
    mailbox_warning_count: number
  }
  const lines: string[] = [
    `Team "${team.team_name}"${team.description ? ` — ${team.description}` : ''}`,
    `Viewing as: ${team.viewer}`,
    `Members (${team.members.length}):`,
    ...team.members.map((member) => {
      const route = member.provider && member.model ? ` · ${member.provider}/${member.model}` : ''
      const effort = member.reasoning_effort ? ` · reasoning ${member.reasoning_effort}` : ''
      return `  - ${member.name} [${member.role}] ${member.status}/${member.activity}${route}${effort}`
    }),
    `Tasks (${team.tasks.length}):`,
    ...team.tasks.map((task) => {
      const deps = task.dependencies.length > 0 ? ` (deps: ${task.dependencies.join(',')})` : ''
      const output = task.output !== undefined ? `\n      output: ${task.output.slice(0, 300)}` : ''
      const handoff = task.reassigning ? ' (reassigning)' : ''
      const risk = task.risk_level !== undefined || task.milestone === true
        ? ` [${task.risk_level ?? 'milestone'}${task.milestone === true ? ', milestone' : ''}]`
        : ''
      const gate = task.review_required === true
        ? task.review?.verdict === 'pass'
          ? ' · review passed'
          : ` · review pending (政委待复核)${task.review !== undefined ? ` · last verdict ${task.review.verdict}` : ''}`
        : ''
      const helping = task.helper !== undefined ? ` · helped by ${task.helper}` : ''
      // 自成长耗时:预估等级优先、已用/实际、超时状态(与面板同一套阈值)。
      let timing = ''
      if (task.estimate_level !== undefined) {
        timing += ` · est ${task.estimate_level}(${ESTIMATE_LEVEL_RANGES[task.estimate_level as keyof typeof ESTIMATE_LEVEL_RANGES].label})`
      } else if (task.estimated_ms !== undefined) {
        timing += ` · est ${formatDuration(task.estimated_ms)}`
      }
      if (task.status === 'in_progress' && task.claimed_at !== undefined) {
        const elapsed = taskElapsedMs({ claimedAt: task.claimed_at }, Date.now())
        const state = taskTimingState(
          task.estimate_level as 'S' | 'M' | 'L' | undefined,
          task.estimated_ms,
          elapsed,
        )
        timing += ` · used ${formatDuration(elapsed)}${state !== 'ok' ? ` [${state}]` : ''}`
      }
      if (task.actual_ms !== undefined) {
        const state = taskTimingState(
          task.estimate_level as 'S' | 'M' | 'L' | undefined,
          task.estimated_ms,
          task.actual_ms,
        )
        timing += ` · actual ${formatDuration(task.actual_ms)}${state !== 'ok' ? ` [${state}]` : ''}`
      }
      const signals = task.signals !== undefined
        ? ` · signals(turns ${task.signals.turns ?? 0} · out ${task.signals.output_bytes}${task.signals.self_report !== undefined ? ` · "${task.signals.self_report.slice(0, 40)}"` : ''})`
        : ''
      const retro = task.retro !== undefined
        ? ` · retro: ${task.retro.summary.slice(0, 120)}`
        : ''
      // 改进方向 3:建议角色/成员(纯函数推断,仅建议)。已派给建议成员时不再
      // 重复提示;未派或派给他人时提示,队长确认后仍走现有 assignee 流程。
      const suggestion = task.suggested_role !== undefined && task.suggested_role !== ''
        && (task.assignee === '' || (task.suggested_member !== undefined && task.suggested_member !== '' && task.assignee !== task.suggested_member))
        ? ` · 建议分配给：${ROLE_TITLES[task.suggested_role as keyof typeof ROLE_TITLES] ?? task.suggested_role}（${task.suggested_role}）${task.suggested_member !== undefined && task.suggested_member !== '' ? ` → ${task.suggested_member}` : ''}${task.suggestion_confidence !== undefined ? ` [${task.suggestion_confidence}]` : ''}`
        : ''
      return `  - ${task.id} [${task.status}] attempt ${task.attempt}${handoff}${risk}${gate}${helping}${suggestion}${timing}${signals}${retro} ${task.subject} → ${task.assignee || 'unassigned'}${deps}${output}`
    }),
    `Captain inbox (${team.captain_inbox.length}):`,
    ...team.captain_inbox.map((message) => `  - [${message.from}] ${message.content.slice(0, 200)}`),
  ]
  for (const [name, inbox] of Object.entries(team.member_inboxes)) {
    lines.push(`Member inbox ${name} (${inbox.count}): latest — ${inbox.latest.slice(0, 120)}`)
  }
  if (team.mailbox_warning_count > 0) {
    lines.push(
      `Mailbox warnings (${team.mailbox_warning_count}; malformed lines were skipped; showing up to 10):`,
      ...team.mailbox_warnings.map((warning) => `  - ${warning}`),
    )
  }
  return lines.join('\n')
}

/** Render the best-practices library + calibration as compact text. */
function renderBestPractices(value: JsonValue, args: { role?: string; level?: string; limit?: number }): string {
  const data = value as {
    team_id: string
    total: number
    best_practices: {
      id: string
      source_team_id: string
      source_task_id: string
      source_task_subject: string
      role: string
      level?: string
      cause: string
      practice: string
      verdict: string
      created_at: number
      updated_at: number
    }[]
    calibration: {
      completed_with_timing: number
      by_role_level: { role: string; level: string; task_count: number; avg_actual_ms?: number; overrun_ratio?: number }[]
      hint: string
    }
  }
  const filter = `${args.role !== undefined ? ` role=${args.role}` : ''}${args.level !== undefined ? ` level=${args.level}` : ''}${args.limit !== undefined ? ` limit=${args.limit}` : ''}`
  const lines: string[] = [`Best practices (${data.total} entries${filter}):`]
  if (data.best_practices.length === 0) {
    lines.push('  (empty library — experiences are distilled automatically when members add retro_note or complete tasks with recommendations)')
  }
  for (const entry of data.best_practices) {
    lines.push(
      `  - ${entry.id} [${entry.verdict}] ${entry.role}${entry.level !== undefined ? ` × ${entry.level}` : ''} · ${entry.cause} · from ${entry.source_task_id}(${entry.source_task_subject.slice(0, 40)})`,
      `      ${entry.practice.slice(0, 160)}`,
    )
  }
  lines.push(`  Calibration: ${data.calibration.hint}`)
  return lines.join('\n')
}
