/**
 * Event-driven shared task scheduler.
 *
 * Claude Code teammates keep polling the shared task list after a turn. DSH
 * continuable agents instead expose explicit idle/running edges, so this
 * scheduler closes the same loop without keeping a polling turn alive: every
 * idle edge and every task-graph mutation attempts one atomic claim and wakes
 * the selected durable member. A resident member that becomes idle while it
 * still owns an open attempt is parked: only an explicit captain reassignment
 * may rotate that capability. Automatic retry is reserved for cold recovery,
 * when the durable owner is no longer resident in the live Agent registry.
 * @module dsh-agent-team-web/scheduler
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { join } from 'node:path'
import { deliverToMember } from './members.ts'
import { isCommissarRole } from './commissar-gate.ts'
import {
  acknowledgeMailbox,
  appendMailbox,
  beginTaskAttempt,
  CAPTAIN_KEY,
  claimMailboxDelivery,
  createMessage,
  findTeamByParticipant,
  readTeam,
  readUnreadMailbox,
  releaseMailboxDelivery,
  taskAwaitingInput,
  unsatisfiedDependencies,
  withTeamLock,
  writeTeam,
} from './state.ts'
import type { TeamMember, TeamState, TeamTask } from './types.ts'

export interface SchedulerConfig {
  readonly stateDir: string
  /** A member-owned open task is "stalled" (helppable) after this many ms. */
  readonly stallThresholdMs: number
}

export interface TeamScheduler {
  /** Try to give every genuinely idle/ready member one unit of ready work. */
  kickTeam(workspace: string, teamId: string, captain?: Agent): Promise<void>
  /** Try to flush fallback mail or give one member one ready task. */
  kickMember(workspace: string, teamId: string, memberName: string, captain?: Agent): Promise<void>
}

interface DispatchTicket {
  readonly taskId: string
  readonly memberName: string
  readonly memberId: string
  readonly attempt: number
  readonly attemptId: string
  readonly previousAssignee?: string
  readonly subject: string
  readonly description?: string
  /** Help dispatch: the member is assisting the owner, ownership unchanged. */
  readonly helping?: boolean
  /** Original owner (help mode): name + member id + unchanged attemptId. */
  readonly ownerName?: string
  readonly ownerId?: string
  /** Timestamp written to `task.helperSince` (help rollback guard). */
  readonly helperSince?: number
  /** Stand-down notice for a helper whose owner just resumed (the mailbox
   * append already happened inside the lock; live delivery runs after). */
  readonly standDown?: { readonly memberId: string; readonly text: string }
}

function stateRootOf(workspace: string, config: SchedulerConfig): string {
  return join(workspace, config.stateDir)
}

function teamLockKey(stateRoot: string, teamId: string): string {
  return `team:${stateRoot}:${teamId}`
}

function liveCaptain(ctx: Context, captainSessionId: string, supplied?: Agent): Agent | undefined {
  if (supplied !== undefined && supplied.id === captainSessionId) return supplied
  return ctx.agents.get(captainSessionId as SessionId)
}

function liveMember(ctx: Context, member: TeamMember): Agent | undefined {
  return ctx.agents.get(member.id as SessionId)
}

function isMemberAvailable(ctx: Context, member: TeamMember): boolean {
  const live = liveMember(ctx, member)
  return live === undefined || live.status === 'idle'
}

function ownedOpenTask(tasks: readonly TeamTask[], memberName: string): TeamTask | undefined {
  return tasks.find(task => task.assignee === memberName
    && (task.status === 'claimed' || task.status === 'in_progress'))
}

/** The live member id owning a task, when the owner is an active member. */
function taskOwnerId(team: TeamState, task: TeamTask): string | undefined {
  if (task.assignee === undefined) return undefined
  return team.members.find(member => member.name === task.assignee && member.status !== 'removed')?.id
}

/** The next ready task for one member: its assigned ready work first, then
 * any unassigned ready work. R-02: awaitingInput(待输入)任务不参与自动派单,
 * 等队长 input_answered 清除后才可派发(claim_task 同规则拦截)。 */
export function nextReadyTask(tasks: readonly TeamTask[], memberName: string): TeamTask | undefined {
  const ready = tasks.filter(task => task.status === 'pending'
    && task.reassigning !== true
    && !taskAwaitingInput(task)
    && unsatisfiedDependencies([...tasks], task.dependencies).length === 0)
  return ready.find(task => task.assignee === memberName)
    ?? ready.find(task => task.assignee === undefined)
}

/**
 * Whether a teammate's claimed/in-progress task is stalled enough for a
 * helper to push it forward — without transferring ownership. All conditions
 * must hold: non-terminal, owned by someone else (a live member, not the
 * captain), no helper yet, owner not actively running, owner did not
 * intentionally park this exact attempt, dependencies satisfied, and the task
 * has had no update for at least `stallThresholdMs`.
 */
export function isHelppableTask(
  task: TeamTask,
  team: TeamState,
  helperName: string,
  now: number,
  parkedAttempts: ReadonlyMap<string, string>,
  liveStatus: (memberId: string) => 'running' | 'idle' | undefined,
  stallThresholdMs: number,
): boolean {
  if (task.status !== 'claimed' && task.status !== 'in_progress') return false
  if (taskAwaitingInput(task)) return false
  if (task.assignee === undefined || task.assignee === helperName || task.assignee === CAPTAIN_KEY) return false
  if (task.helper !== undefined) return false
  const owner = team.members.find(member => member.name === task.assignee && member.status !== 'removed')
  if (owner === undefined || owner.id === '') return false
  if (liveStatus(owner.id) === 'running') return false
  if (parkedAttempts.get(owner.id) === task.attemptId) return false
  if (unsatisfiedDependencies(team.tasks, task.dependencies).length > 0) return false
  return now - task.updatedAt >= stallThresholdMs
}

/**
 * The next helppable task for one member: the oldest stalled teammate task
 * (by `updatedAt`), so the helper who comes free first takes the most urgent.
 * The commissar is never dispatched as a helper — independent oversight must
 * not execute the work it later gates (review independence).
 */
export function nextHelpTask(
  tasks: readonly TeamTask[],
  team: TeamState,
  helperName: string,
  now: number,
  parkedAttempts: ReadonlyMap<string, string>,
  liveStatus: (memberId: string) => 'running' | 'idle' | undefined,
  stallThresholdMs: number,
): TeamTask | undefined {
  const helper = team.members.find(member => member.name === helperName && member.status !== 'removed')
  if (helper === undefined || isCommissarRole(helper.role)) return undefined
  return tasks
    .filter(task => isHelppableTask(task, team, helperName, now, parkedAttempts, liveStatus, stallThresholdMs))
    .sort((a, b) => a.updatedAt - b.updatedAt)[0]
}

function helpingPrompt(ticket: DispatchTicket, stateDir: string, teamId: string): string {
  const description = ticket.description === undefined ? '' : `\n\n${ticket.description}`
  return `AgentTeams self-organizing dispatch: you are helping a teammate's stalled task.

Task: ${ticket.taskId} — ${ticket.subject}${description}
Owner: ${ticket.ownerName} — the task stays theirs; ownership is NOT transferred
Owner attempt id: ${ticket.attemptId}

Push the task forward as the helper: investigate and do the work. When done, report with agent_teams_send_message to the owner (${ticket.ownerName}) and to captain. Do NOT call agent_teams_claim_task or agent_teams_update_task on this task — the owner keeps the capability and will mark it completed (the commissar gate still applies if the task requires review). If the owner has resumed and asked you to stand down, stop and report that.

State policy: ${stateDir}/${teamId}/ is read-only diagnostics; mutate team state only through agent_teams_* tools.`
}

function assignmentPrompt(ticket: DispatchTicket, stateDir: string, teamId: string): string {
  const description = ticket.description === undefined ? '' : `\n\n${ticket.description}`
  return `AgentTeams automatic task assignment from the shared task list.

Task: ${ticket.taskId} — ${ticket.subject}${description}
Attempt: ${ticket.attempt}
Attempt id: ${ticket.attemptId}

Call agent_teams_claim_task for ${ticket.taskId}; it will return this same attempt_id. Include attempt_id=${ticket.attemptId} in every agent_teams_update_task call. If it is rejected as stale, stop work because the task was reassigned. Work only this task in this turn, report the result to the captain, then become idle so the scheduler can select your next ready task.

State policy: ${stateDir}/${teamId}/ is read-only diagnostics; mutate team state only through agent_teams_* tools.`
}

function fallbackMailboxPrompt(messages: Awaited<ReturnType<typeof readUnreadMailbox>>): string {
  return [
    'AgentTeams delivered messages that were persisted while live delivery was unavailable:',
    ...messages.map(message => `\nFrom ${message.from}:\n${message.content}`),
    '\nHandle these messages in this turn. Task assignments still require agent_teams_claim_task and the current attempt_id.',
  ].join('\n')
}

/** Install one scheduler and its member activity observer. */
export function installTeamScheduler(ctx: Context, config: SchedulerConfig): TeamScheduler {
  const memberQueues = new Map<string, Promise<unknown>>()
  // An idle edge in this process proves that the resident member ended its
  // turn while the current attempt was still open. Remember that capability
  // even after Harness disposes the continuable AgentHandle: later status or
  // graph kicks must keep it parked. A cold process starts with an empty map,
  // so durable open attempts are still recovered after restart.
  const parkedAttempts = new Map<string, string>()

  const memberQueueKey = (stateRoot: string, teamId: string, memberName: string): string => (
    `${stateRoot}\u0000${teamId}\u0000${memberName}`
  )

  const serializeMember = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const previous = memberQueues.get(key) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => gate)
    memberQueues.set(key, tail)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (memberQueues.get(key) === tail) memberQueues.delete(key)
    }
  }

  const runtime: TeamScheduler = {
    async kickTeam(workspace, teamId, suppliedCaptain) {
      const stateRoot = stateRootOf(workspace, config)
      const team = await readTeam(stateRoot, teamId)
      if (team === undefined) return
      const captain = liveCaptain(ctx, team.captainSessionId, suppliedCaptain)
      if (captain === undefined) return
      // Owners of open attempts first: after a cold restart the parked-attempt
      // memory is empty and a teammate's help kick could otherwise claim an
      // owner's still-open task before the owner resumes (two workers on one
      // task). Ordering the owner ahead closes that window.
      const hasOpenAttempt = (member: TeamMember): boolean => team.tasks.some(task =>
        task.assignee === member.name
        && (task.status === 'claimed' || task.status === 'in_progress')
        && task.attemptId !== undefined)
      const active = team.members.filter(member => member.status !== 'removed')
      const ordered = [
        ...active.filter(hasOpenAttempt),
        ...active.filter(member => !hasOpenAttempt(member)),
      ]
      for (const member of ordered) {
        await runtime.kickMember(workspace, teamId, member.name, captain)
      }
    },

    async kickMember(workspace, teamId, memberName, suppliedCaptain) {
      const stateRoot = stateRootOf(workspace, config)
      const queueKey = memberQueueKey(stateRoot, teamId, memberName)
      await serializeMember(queueKey, async () => {
        let team = await readTeam(stateRoot, teamId)
        if (team === undefined) return
        const captain = liveCaptain(ctx, team.captainSessionId, suppliedCaptain)
        if (captain === undefined) return
        let member = team.members.find(candidate => candidate.name === memberName && candidate.status !== 'removed')
        if (member === undefined || member.id === '' || !isMemberAvailable(ctx, member)) return

        // A mailbox-only fallback is real pending work. Deliver it before a
        // fresh task and acknowledge only after Harness accepts the follow-up.
        const unread = await readUnreadMailbox(stateRoot, team.id, member.name)
        if (unread.length > 0) {
          await withTeamLock(teamLockKey(stateRoot, team.id), () => (
            claimMailboxDelivery(stateRoot, team!.id, member!.name, unread.map(message => message.id))
          ))
          const accepted = await deliverToMember(
            ctx,
            captain,
            member.id,
            fallbackMailboxPrompt(unread),
            new AbortController().signal,
          )
          if (accepted) {
            await withTeamLock(teamLockKey(stateRoot, team.id), () => (
              acknowledgeMailbox(stateRoot, team!.id, member!.name, unread.map(message => message.id))
            ))
          } else {
            await withTeamLock(teamLockKey(stateRoot, team.id), () => (
              releaseMailboxDelivery(stateRoot, team!.id, member!.name, unread.map(message => message.id))
            ))
          }
          return
        }

        const ticket = await withTeamLock(teamLockKey(stateRoot, team.id), async (): Promise<DispatchTicket | undefined> => {
          const fresh = await readTeam(stateRoot, team!.id)
          if (fresh === undefined) return undefined
          const currentMember = fresh.members.find(candidate => candidate.name === memberName && candidate.status !== 'removed')
          if (currentMember === undefined || currentMember.id === '' || !isMemberAvailable(ctx, currentMember)) return undefined
          const owned = ownedOpenTask(fresh.tasks, currentMember.name)
          // A resident idle member can intentionally leave an attempt open
          // while waiting for guidance, or because the user paused its turn.
          // Re-dispatching here would revoke still-valid work on every idle
          // edge and every status kick. The idle observer remembers that exact
          // capability across normal continuable disposal; only an unobserved
          // durable capability (cold process recovery) or a legacy open task
          // with no capability is retried.
          const parkedAttemptId = parkedAttempts.get(currentMember.id)
          const recoverOwned = owned !== undefined
            && (owned.attemptId === undefined || owned.attemptId !== parkedAttemptId)
          // Priority chain: 1) recover my own open attempt (clearing any stale
          // helper — the owner is back in charge) 2) my assigned ready work
          // 3) unassigned ready work 4) a teammate's stalled task (help mode).
          if (recoverOwned) {
            let standDown: DispatchTicket['standDown']
            if (owned.helper !== undefined) {
              // The owner is back in charge: drop the helper marker and tell
              // the helper to stand down (durable mailbox + live wake), so two
              // workers never keep pushing the same task unknowingly.
              const helperName = owned.helper
              const helperMember = fresh.members.find(candidate => candidate.name === helperName && candidate.status !== 'removed')
              owned.helper = undefined
              owned.helperSince = undefined
              owned.updatedAt = Date.now()
              if (helperMember !== undefined) {
                const message = createMessage(
                  CAPTAIN_KEY,
                  helperName,
                  `成员 ${currentMember.name} 已恢复任务 ${owned.id}「${owned.subject}」，请停止协助并按需汇报已做工作。`,
                )
                await appendMailbox(stateRoot, fresh.id, helperName, message)
                if (helperMember.id !== '') {
                  standDown = { memberId: helperMember.id, text: `AgentTeams 撤出通知：\n\n${message.content}` }
                }
              }
            }
            const previousAssignee = owned.assignee
            const attemptId = beginTaskAttempt(owned, currentMember.name)
            parkedAttempts.delete(currentMember.id)
            currentMember.status = 'working'
            await writeTeam(stateRoot, fresh)
            return {
              taskId: owned.id,
              memberName: currentMember.name,
              memberId: currentMember.id,
              attempt: owned.attempt ?? 1,
              attemptId,
              previousAssignee,
              subject: owned.subject,
              description: owned.description,
              ...standDown !== undefined ? { standDown } : {},
            }
          }
          if (owned === undefined) {
            const ready = nextReadyTask(fresh.tasks, currentMember.name)
            if (ready !== undefined) {
              const previousAssignee = ready.assignee
              const attemptId = beginTaskAttempt(ready, currentMember.name)
              parkedAttempts.delete(currentMember.id)
              currentMember.status = 'working'
              await writeTeam(stateRoot, fresh)
              return {
                taskId: ready.id,
                memberName: currentMember.name,
                memberId: currentMember.id,
                attempt: ready.attempt ?? 1,
                attemptId,
                previousAssignee,
                subject: ready.subject,
                description: ready.description,
              }
            }
            // Self-organizing help: a teammate's stalled task. No ownership
            // change, no attempt rotation — the owner's capability stays valid
            // and the helper only advances the work and reports back.
            const help = nextHelpTask(
              fresh.tasks,
              fresh,
              currentMember.name,
              Date.now(),
              parkedAttempts,
              (memberId) => ctx.agents.get(memberId as SessionId)?.status,
              config.stallThresholdMs,
            )
            if (help !== undefined) {
              const helperSince = Date.now()
              help.helper = currentMember.name
              help.helperSince = helperSince
              // 自成长边界标注:本 attempt 曾有 helper 介入(复盘 hasHelper 依据),
              // 重派/认领新 attempt 时随其他计时字段一起清空。
              help.helperEver = true
              help.updatedAt = helperSince
              currentMember.status = 'working'
              await writeTeam(stateRoot, fresh)
              return {
                taskId: help.id,
                memberName: currentMember.name,
                memberId: currentMember.id,
                attempt: help.attempt ?? 1,
                attemptId: help.attemptId ?? '',
                previousAssignee: help.assignee,
                subject: help.subject,
                description: help.description,
                helping: true,
                ownerName: help.assignee ?? '',
                ownerId: taskOwnerId(fresh, help),
                helperSince,
              }
            }
          }
          if (currentMember.status !== 'idle') {
            currentMember.status = 'idle'
            await writeTeam(stateRoot, fresh)
          }
          return undefined
        })
        if (ticket === undefined) return

        // Owner-resume stand-down: wake the displaced helper (best effort) so
        // it stops pushing a task the owner has taken back.
        if (ticket.standDown !== undefined) {
          await deliverToMember(ctx, captain, ticket.standDown.memberId, ticket.standDown.text, new AbortController().signal)
        }

        const accepted = await deliverToMember(
          ctx,
          captain,
          ticket.memberId,
          ticket.helping === true
            ? helpingPrompt(ticket, config.stateDir, team.id)
            : assignmentPrompt(ticket, config.stateDir, team.id),
          new AbortController().signal,
        )
        if (accepted) {
          // A help dispatch that landed also notifies the original owner:
          // durable mailbox append + best-effort live wake (offline owner
          // still sees it via agent_teams_status).
          if (ticket.helping === true && ticket.ownerName !== undefined) {
            const message = createMessage(
              CAPTAIN_KEY,
              ticket.ownerName,
              `成员 ${ticket.memberName} 正在协助你的任务 ${ticket.taskId}「${ticket.subject}」；所有权不变，完成后仍由你标记 completed。如你已恢复推进，请通知队长撤回帮助。`,
            )
            await appendMailbox(stateRoot, team.id, ticket.ownerName, message)
            if (ticket.ownerId !== undefined && ticket.ownerId !== '') {
              const ownerLive = ctx.agents.get(ticket.ownerId as SessionId)
              if (ownerLive !== undefined) {
                await deliverToMember(ctx, captain, ticket.ownerId, `AgentTeams 协助通知：\n\n${message.content}`, new AbortController().signal)
              }
            }
          }
          return
        }

        // Roll back only our exact failed dispatch. A concurrent captain
        // handoff (or owner resume) has already changed state and wins.
        await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
          const fresh = await readTeam(stateRoot, team!.id)
          if (fresh === undefined) return
          const task = fresh.tasks.find(candidate => candidate.id === ticket.taskId)
          const currentMember = fresh.members.find(candidate => candidate.name === ticket.memberName)
          if (ticket.helping === true) {
            // Help rollback: only when our exact helper marker is still there.
            if (task?.helper !== ticket.memberName || task?.helperSince !== ticket.helperSince) return
            task.helper = undefined
            task.helperSince = undefined
            task.updatedAt = Date.now()
            if (currentMember !== undefined && currentMember.status !== 'removed') currentMember.status = 'idle'
            await writeTeam(stateRoot, fresh)
            return
          }
          if (task?.attemptId !== ticket.attemptId) return
          task.status = 'pending'
          task.assignee = ticket.previousAssignee
          task.attemptId = undefined
          task.handoffId = undefined
          task.reassigning = false
          task.updatedAt = Date.now()
          if (currentMember !== undefined && currentMember.status !== 'removed') currentMember.status = 'idle'
          await writeTeam(stateRoot, fresh)
        })
      })
    },
  }

  const syncMemberStatus = async (agent: Agent, status: AgentStatus): Promise<void> => {
    const workspace = agent.session.header.cwd ?? process.cwd()
    const stateRoot = stateRootOf(workspace, config)
    const located = await findTeamByParticipant(stateRoot, agent.id)
    if (located === undefined) {
      parkedAttempts.delete(agent.id)
      return
    }
    if (located.captainSessionId === agent.id) return
    const member = located.members.find(candidate => candidate.id === agent.id && candidate.status !== 'removed')
    if (member === undefined) {
      parkedAttempts.delete(agent.id)
      return
    }
    await withTeamLock(teamLockKey(stateRoot, located.id), async () => {
      const fresh = await readTeam(stateRoot, located.id)
      const current = fresh?.members.find(candidate => candidate.id === agent.id && candidate.status !== 'removed')
      if (fresh === undefined || current === undefined) return
      const next = status === 'running' ? 'working' : 'idle'
      if (next === 'idle') {
        const owned = ownedOpenTask(fresh.tasks, current.name)
        if (owned?.attemptId === undefined) parkedAttempts.delete(agent.id)
        else parkedAttempts.set(agent.id, owned.attemptId)
      } else {
        parkedAttempts.delete(agent.id)
      }
      if (current.status === next) return
      current.status = next
      await writeTeam(stateRoot, fresh)
    })
    if (status === 'idle') await runtime.kickMember(workspace, located.id, member.name)
  }

  ctx.on('agent/status', ({ agent, status }) => {
    void syncMemberStatus(agent, status).catch((error: unknown) => {
      ctx.logger.warn(`agent-team-web: member status scheduling failed for ${agent.id}: ${String(error)}`)
    })
  })

  return runtime
}
