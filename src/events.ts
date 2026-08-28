/**
 * Durable AgentTeams session events and their emitter.
 *
 * Every team-state mutation appends one event to the captain's Session, so
 * the web client's Conversation Node mechanism can fold the tree view from
 * the session log deterministically (same mechanism as `tool-workflow`'s
 * `tool-workflow/*` record events). Events append to the captain's session
 * even when a member agent performed the mutation, so the captain's
 * conversation stream stays the single authoritative monitor surface.
 *
 * Types and the `SessionEventMap` merge live in `event-types.ts` (zero
 * imports) so the browser program can load them without host augmentations.
 * @module dsh-agent-team-web/events
 */

import type { Context } from '@deepseek-ai/cordis'
import * as dshSession from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionEventMap, SessionId } from '@deepseek-ai/dsh-session/types'
import type { AgentTeamsEventType } from './event-types.ts'

/** Event types already reported as unsupported, to avoid repetitive logs. */
const skippedEventTypes = new Set<AgentTeamsEventType>()

/** 累计被 harness 拒绝的事件条数(R-34 可观测指标)。 */
let skippedEventCount = 0

/**
 * 测试辅助:重置跳过事件追踪的模块态。skippedEventTypes / skippedEventCount
 * 是进程级累计指标,跨用例(或跨测试文件)会保留;单测在 beforeEach 调用
 * 以获得可重复的断言基线。生产路径不调用。
 */
export function resetSkippedEventTracking(): void {
  skippedEventTypes.clear()
  skippedEventCount = 0
}

/**
 * Append one AgentTeams event to a Session, containing failures (a broken
 * durable record must never break team tool execution).
 * @param ctx - the plugin context (for logging).
 * @param session - the session to record into (the captain's, normally).
 * @param type - the event type.
 * @param data - the event payload.
 */
export function appendTeamEvent(
  ctx: Context,
  session: Session,
  type: AgentTeamsEventType,
  data: SessionEventMap[AgentTeamsEventType],
): void {
  // Out-of-repo events are not in the harness's generated vocabulary today.
  // Mutating that ReadonlySet would make readability depend on which plugins
  // happen to be loaded. Until Session.append exposes the official
  // `ignorable: true` writer surface, omit these informational records unless
  // the running harness already recognizes them. Disk state remains the
  // authoritative source for the activity panel.
  const known = (dshSession as unknown as {
    KNOWN_SESSION_EVENT_TYPES?: ReadonlySet<string>
  }).KNOWN_SESSION_EVENT_TYPES
  if (known?.has(type) !== true) {
    // R-34:静默丢弃会让面板事件流难以排查——未识别事件至少 warn 一次
    // (按类型去重防刷屏),并累计总数作为可观测指标。
    skippedEventCount += 1
    if (!skippedEventTypes.has(type)) {
      skippedEventTypes.add(type)
      ctx.logger.warn(
        `agent-team-web: session event "${type}" omitted because this harness does not recognize it (${skippedEventCount} events skipped in total)`,
      )
    }
    return
  }
  try {
    session.append(type, data)
  } catch (error: unknown) {
    ctx.logger.warn(`agent-team-web: session record failed after ${type}: ${String(error)}`)
  }
}

/**
 * Resolve the captain's live Session for event recording. The captain agent
 * may be offline (its team outlives the session), in which case the caller's
 * own session is used as the fallback record target.
 * @param ctx - the plugin context (injects `agents`).
 * @param captainSessionId - the captain's durable session id.
 * @param fallback - the calling agent's session, used when the captain is not live.
 * @returns the session to record into.
 */
export function captainSessionOf(
  ctx: Context,
  captainSessionId: string,
  fallback: Session,
): Session {
  const captain = ctx.agents.get(captainSessionId as SessionId)
  return captain?.session ?? fallback
}
