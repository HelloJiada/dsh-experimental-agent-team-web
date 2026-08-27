/** Shared, demand-driven state for the AgentTeams browser monitor. */

import type { TeamIntelligence } from '../intelligence.ts'

/** One member row of a host snapshot. */
export interface ActivityMember {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly status?: 'idle' | 'working' | 'removed'
  readonly activity: 'working' | 'idle' | 'unknown'
  readonly progress: number
  readonly done: number
  readonly total: number
  readonly currentTask: string
  /** 当前进行中任务的已用耗时(ms);无当前任务为 0(自成长)。 */
  readonly currentTaskElapsedMs: number
  /** The id of a task this member is helping on, when any (self-organizing). */
  readonly helpingTask?: string
  readonly unread: number
}

/** One task row of a host snapshot. */
export interface ActivityTask {
  readonly id: string
  readonly subject: string
  readonly status: string
  readonly state: 'blocked' | 'open' | 'running' | 'completed'
  readonly assignee: string
  readonly dependencies: readonly string[]
  readonly depth: number
  /** True while the task awaits a commissar `pass` (commissar gate). */
  readonly reviewRequired?: boolean
  /** Latest commissar review record, when one exists. */
  readonly review?: {
    readonly reviewerName: string
    readonly verdict: 'pass' | 'reject'
    readonly comment?: string
    readonly reviewedAt: number
  }
  /** Helper member currently pushing this task forward (ownership unchanged). */
  readonly helper?: string
  /** 预估工作量等级(对外口径,自成长)。 */
  readonly estimateLevel?: 'S' | 'M' | 'L'
  /** 预估耗时(ms)(自成长)。 */
  readonly estimatedMs?: number
  /** 认领时间(自成长)。 */
  readonly claimedAt?: number
  /** 开工时间(自成长)。 */
  readonly startedAt?: number
  /** 终结时间(自成长)。 */
  readonly completedAt?: number
  /** 实际耗时(ms)(自成长)。 */
  readonly actualMs?: number
  /** 实际 - 预估 偏差(ms)(自成长)。 */
  readonly overrunMs?: number
  /** 产出信号(自成长,L1)。 */
  readonly signals?: {
    readonly turns?: number
    readonly toolCalls?: number
    readonly outputBytes: number
    readonly selfReport?: string
  }
  /** 复盘记录(自成长)。 */
  readonly retro?: {
    readonly attempt: number
    readonly actualMs: number
    readonly estimateLevel?: 'S' | 'M' | 'L'
    readonly estimatedMs?: number
    readonly overrunMs?: number
    readonly levelDeviation?: number
    readonly overran: boolean
    readonly cause: string
    readonly summary: string
    readonly retroNote?: string
    readonly captainVerdict?: 'useful' | 'useless' | 'revised'
    readonly recommendation: string
    readonly includesGateWait?: boolean
    readonly hasHelper?: boolean
    readonly createdAt: number
  }
}

/** One captain-inbox preview row. */
export interface ActivityMessage {
  readonly from: string
  readonly content: string
}

/** One team snapshot (mirrors the host TeamActivitySnapshot). */
export interface ActivityTeam {
  readonly workspace: string
  readonly teamId: string
  readonly name: string
  readonly description?: string
  readonly captainSessionId: string
  readonly members: readonly ActivityMember[]
  readonly tasks: readonly ActivityTask[]
  readonly messageCount: number
  readonly captainInbox: readonly ActivityMessage[]
  /** 融合分析层输出(服务端快照附加)。 */
  readonly intelligence?: TeamIntelligence
  /** 自成长:全局经验库最近条目。 */
  readonly bestPractices?: readonly {
    readonly id: string
    readonly sourceTeamId: string
    readonly sourceTaskId: string
    readonly sourceTaskSubject: string
    readonly role: string
    readonly level?: 'S' | 'M' | 'L'
    readonly cause: string
    readonly practice: string
    readonly verdict: 'pending' | 'useful' | 'useless' | 'revised'
    readonly createdAt: number
    readonly updatedAt: number
  }[]
  /** 自成长:(角色×等级)校准统计。 */
  readonly calibration?: {
    readonly completedWithTiming: number
    readonly byRoleLevel: readonly {
      readonly role: string
      readonly level: string
      readonly taskCount: number
      readonly avgActualMs?: number
      readonly overrunRatio?: number
    }[]
  }
}

/** A successfully-created conversation card that currently needs updates. */
export interface ActivityMonitorTarget {
  readonly key: string
  readonly sessionId: string
  readonly teamId: string
}

/** Latest shared response data for both the floater and conversation cards. */
export interface ActivitySnapshots {
  readonly teams: readonly ActivityTeam[]
  readonly archivedTeams: readonly ActivityTeam[]
}

interface RegisteredTarget extends ActivityMonitorTarget {
  refs: number
  active: boolean
}

const targets = new Map<string, RegisteredTarget>()
const targetListeners = new Set<() => void>()
const snapshotListeners = new Set<() => void>()
let targetSnapshot: readonly ActivityMonitorTarget[] = []
let activitySnapshots: ActivitySnapshots = { teams: [], archivedTeams: [] }

function targetKey(sessionId: string, teamId: string): string {
  return `${sessionId}\u0000${teamId}`
}

function publishTargets(): void {
  targetSnapshot = [...targets.values()]
    .filter((target) => target.active)
    .map(({ key, sessionId, teamId }) => ({ key, sessionId, teamId }))
  for (const listener of targetListeners) listener()
}

/** Subscribe to the active monitor-target list (React external-store shape). */
export function subscribeActivityMonitorTargets(listener: () => void): () => void {
  targetListeners.add(listener)
  return () => { targetListeners.delete(listener) }
}

/** Read the stable active-target snapshot. */
export function getActivityMonitorTargetsSnapshot(): readonly ActivityMonitorTarget[] {
  return targetSnapshot
}

/**
 * Register one successful AgentTeams card as a monitoring demand.
 *
 * The returned cleanup is reference-counted so multiple cards and React
 * StrictMode remounts cannot stop another card's monitor.
 */
export function monitorAgentTeam(sessionId: string, teamId: string): () => void {
  const owner = sessionId.trim()
  const id = teamId.trim()
  if (owner === '' || id === '') return () => {}
  const key = targetKey(owner, id)
  const existing = targets.get(key)
  if (existing === undefined) {
    targets.set(key, { key, sessionId: owner, teamId: id, refs: 1, active: true })
    publishTargets()
  } else {
    existing.refs += 1
    if (!existing.active) {
      existing.active = true
      publishTargets()
    }
  }
  let released = false
  return () => {
    if (released) return
    released = true
    const current = targets.get(key)
    if (current === undefined) return
    current.refs -= 1
    if (current.refs <= 0) {
      targets.delete(key)
      if (current.active) publishTargets()
    }
  }
}

/** Stop polling targets whose final archived snapshot has been captured. */
export function settleActivityMonitorTargets(keys: ReadonlySet<string>): void {
  let changed = false
  for (const key of keys) {
    const target = targets.get(key)
    if (target?.active !== true) continue
    target.active = false
    changed = true
  }
  if (changed) publishTargets()
}

/** Subscribe to the shared live/archive snapshot. */
export function subscribeActivitySnapshots(listener: () => void): () => void {
  snapshotListeners.add(listener)
  return () => { snapshotListeners.delete(listener) }
}

/** Read the stable shared live/archive snapshot. */
export function getActivitySnapshotsSnapshot(): ActivitySnapshots {
  return activitySnapshots
}

/** Publish one or both successful state-route responses. */
export function updateActivitySnapshots(update: Partial<ActivitySnapshots>): void {
  const next = {
    teams: update.teams ?? activitySnapshots.teams,
    archivedTeams: update.archivedTeams ?? activitySnapshots.archivedTeams,
  }
  if (next.teams === activitySnapshots.teams && next.archivedTeams === activitySnapshots.archivedTeams) return
  activitySnapshots = next
  for (const listener of snapshotListeners) listener()
}

/** Poll cadence for the live host snapshot route. */
export const ACTIVITY_POLL_MS = 1000
/**
 * Low-frequency probe cadence while a cardless discovery session still owns
 * no team. The probe keeps the panel able to pick up a team created later in
 * that session (e.g. a run_code-wrapped agent_teams_create) without turning
 * every ordinary session into a one-second filesystem scan.
 */
export const ACTIVITY_PROBE_MS = 5000
/** Host route serving live and archived team snapshots. */
export const ACTIVITY_STATE_URL = '/plugins/agent-team-web/state'

interface ActivityFetchResponse {
  readonly ok: boolean
  json(): Promise<unknown>
}

/** Injectable browser primitives used by the poll controller and its tests. */
export interface ActivityPollingRuntime {
  /**
   * Current captain session to discover after a cold client/host restart.
   * This one-time scope restores teams whose older conversation log has no
   * AgentTeams card capable of registering an explicit monitor target.
   */
  readonly discoverySessionId?: string
  readonly fetchState?: (
    url: string,
    init: { readonly cache: 'no-store'; readonly signal: AbortSignal },
  ) => Promise<ActivityFetchResponse>
  readonly schedule?: (callback: () => void, intervalMs: number) => unknown
  readonly cancel?: (timer: unknown) => void
  readonly publishSnapshots?: (update: Partial<ActivitySnapshots>) => void
  readonly settleTargets?: (keys: ReadonlySet<string>) => void
}

/** Handle returned by one current-session polling loop. */
export interface ActivityPollingController {
  /** The immediate first pass, exposed so offline verification can await it. */
  readonly firstTick: Promise<void>
  /** Idempotently stop the timer and abort the current request. */
  stop(): void
}

/**
 * Start the single polling loop for the current session's requested targets.
 *
 * With neither targets nor a discovery session this is deliberately inert.
 * Explicit card targets poll at the live cadence from the start. A discovery
 * session performs an immediate live+archive restore pass, then — while it
 * still owns no team — probes on a low-frequency cadence, so a team created
 * later in that session (e.g. a run_code-wrapped agent_teams_create) is
 * discovered without a manual reload, without turning every ordinary session
 * into a one-second filesystem scan. The moment a team for the discovery
 * session appears, the controller upgrades to the live one-second cadence for
 * the rest of its lifetime. The caller — the session view, which stops the
 * controller when the session is no longer current — bounds the lifetime, and
 * archive state is refreshed when a target or a previously discovered live
 * team disappears.
 */
export function startActivityPolling(
  monitorTargets: readonly ActivityMonitorTarget[],
  runtime: ActivityPollingRuntime = {},
): ActivityPollingController {
  const discoverySessionId = runtime.discoverySessionId?.trim()
  if (monitorTargets.length === 0 && (discoverySessionId === undefined || discoverySessionId === '')) {
    return { firstTick: Promise.resolve(), stop: () => {} }
  }
  const fetchState = runtime.fetchState ?? ((url, init) => fetch(url, init))
  const schedule = runtime.schedule ?? ((callback, intervalMs) => setInterval(callback, intervalMs))
  const cancel = runtime.cancel ?? ((timer) => { clearInterval(timer as ReturnType<typeof setInterval>) })
  const publishSnapshots = runtime.publishSnapshots ?? updateActivitySnapshots
  const settleTargets = runtime.settleTargets ?? settleActivityMonitorTargets
  let cancelled = false
  let inFlight = false
  // Explicit card targets are demanded work: start at the live cadence. A
  // discovery session starts probing low-frequency and upgrades on detection.
  let hot = monitorTargets.length > 0
  let discoveryComplete = false
  let discoveredLiveKeys = new Set<string>()
  let controller: AbortController | undefined
  let timer: unknown
  const intervalMs = (): number => (hot ? ACTIVITY_POLL_MS : ACTIVITY_PROBE_MS)
  const reschedule = (): void => {
    cancel(timer)
    timer = schedule(() => { void tick() }, intervalMs())
  }
  const tick = async (): Promise<void> => {
    if (inFlight || cancelled) return
    inFlight = true
    controller = new AbortController()
    try {
      const liveResponse = await fetchState(ACTIVITY_STATE_URL, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!liveResponse.ok) return
      const body = (await liveResponse.json()) as { teams?: unknown }
      if (cancelled || !Array.isArray(body.teams)) return
      const liveTeams = body.teams as readonly ActivityTeam[]
      publishSnapshots({ teams: liveTeams })
      const previousDiscoveredKeys = discoveredLiveKeys
      discoveredLiveKeys = new Set(discoverySessionId === undefined || discoverySessionId === ''
        ? []
        : liveTeams
          .filter((team) => team.captainSessionId === discoverySessionId)
          .map((team) => team.teamId))
      // A discovery session found its first team: upgrade from the low-frequency
      // probe to the live cadence for the rest of the controller lifetime.
      if (!hot && discoveredLiveKeys.size > 0) {
        hot = true
        reschedule()
      }
      const discoveredTeamArchived = [...previousDiscoveredKeys]
        .some((teamId) => !discoveredLiveKeys.has(teamId))
      const missing = monitorTargets.filter((target) => !liveTeams.some((team) =>
        team.captainSessionId === target.sessionId && team.teamId === target.teamId,
      ))
      const needsDiscoveryArchive = discoverySessionId !== undefined
        && discoverySessionId !== ''
        && !discoveryComplete
      if (missing.length === 0 && !needsDiscoveryArchive && !discoveredTeamArchived) return

      // Archives are immutable per team generation. A successful fallback
      // retires every missing explicit target, including legacy cards whose
      // host archive no longer exists; a discovery session that already
      // upgraded keeps polling, and a still-probing one keeps probing, so a
      // team created later in the same session stays discoverable.
      const archivedResponse = await fetchState(`${ACTIVITY_STATE_URL}?archived=1`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!archivedResponse.ok) return
      const archivedBody = (await archivedResponse.json()) as { teams?: unknown }
      if (cancelled || !Array.isArray(archivedBody.teams)) return
      publishSnapshots({ archivedTeams: archivedBody.teams as readonly ActivityTeam[] })
      discoveryComplete = true
      settleTargets(new Set(missing.map((target) => target.key)))
    } catch (error: unknown) {
      if ((error as { name?: unknown })?.name === 'AbortError') return
      // Host restarting; keep the last snapshot and retry on the next tick.
    } finally {
      inFlight = false
    }
  }
  const firstTick = tick()
  if (timer === undefined) timer = schedule(() => { void tick() }, intervalMs())
  return {
    firstTick,
    stop: () => {
      if (cancelled) return
      cancelled = true
      controller?.abort()
      cancel(timer)
    },
  }
}
