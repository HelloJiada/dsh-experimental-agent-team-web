import type {
  AgentTeamMilestoneWindowView,
  AgentTeamTimelineEntryView,
} from './contract.js'

export interface AgentTeamMilestoneWindowOptions {
  /**
   * Window partitioning strategy.
   * - `count` (default): consecutive windows of `windowSize` coalesced rows.
   * - `time`: wall-clock buckets of `windowMs` width, keyed off entry `time`.
   */
  readonly mode?: 'count' | 'time'
  /** Rows per window in `count` mode. Default 8. */
  readonly windowSize?: number
  /** Bucket width in milliseconds for `time` mode. Default 1 hour. */
  readonly windowMs?: number
}

const toneRank: Record<AgentTeamTimelineEntryView['tone'], number> = {
  danger: 0,
  warn: 1,
  good: 2,
  neutral: 3,
}

interface WindowRows {
  readonly rows: AgentTeamTimelineEntryView[]
  readonly order: number
}

/**
 * Groups the timeline into rolling windows and returns them most-recent-first.
 * Each window carries its event distribution (member/task/message), seq range,
 * row/event counts, and a headline derived from the most significant entry
 * (danger > warn > good > neutral; ties pick the latest). This is the
 * roadmap's "rolling-window milestone summary": Captain sees what happened per
 * window without reading every row.
 *
 * This module is deliberately free of runtime dependencies (types only), so
 * both the host projection and the client dashboard can share it without
 * pulling zod or the projection stack into the browser bundle.
 */
export function timelineMilestonesView(
  timeline: readonly AgentTeamTimelineEntryView[],
  options: AgentTeamMilestoneWindowOptions = {},
): AgentTeamMilestoneWindowView[] {
  if (timeline.length === 0) return []
  const mode = options.mode ?? 'count'
  const windowSize = options.windowSize ?? 8
  const windowMs = options.windowMs ?? 3_600_000

  const sorted = [...timeline].sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0) || (left.time ?? 0) - (right.time ?? 0))

  const groups: WindowRows[] = []
  if (mode === 'time') {
    const byBucket = new Map<number, AgentTeamTimelineEntryView[]>()
    for (const row of sorted) {
      const bucket = row.time !== undefined ? Math.floor(row.time / windowMs) : Number.NEGATIVE_INFINITY
      const list = byBucket.get(bucket) ?? []
      list.push(row)
      byBucket.set(bucket, list)
    }
    const buckets = [...byBucket.keys()].sort((left, right) => left - right)
    for (const [index, bucket] of buckets.entries()) {
      groups.push({ rows: byBucket.get(bucket) ?? [], order: index })
    }
  } else {
    for (let start = 0; start < sorted.length; start += windowSize) {
      groups.push({ rows: sorted.slice(start, start + windowSize), order: groups.length })
    }
  }

  const windows: AgentTeamMilestoneWindowView[] = groups.map(({ rows }, index) => {
    const memberEvents = rows
      .filter(row => row.kind === 'member')
      .reduce((sum, row) => sum + (row.count ?? 1), 0)
    const taskEvents = rows
      .filter(row => row.kind === 'task')
      .reduce((sum, row) => sum + (row.count ?? 1), 0)
    const messageEvents = rows
      .filter(row => row.kind === 'message')
      .reduce((sum, row) => sum + (row.count ?? 1), 0)
    const seqs = rows
      .map(row => row.seq)
      .filter((seq): seq is number => seq !== undefined)

    let headline = rows[rows.length - 1] ?? rows[0]!
    for (const row of rows) {
      if (toneRank[row.tone] < toneRank[headline.tone]) headline = row
    }

    return {
      windowId: `w${index}`,
      startSeq: seqs[0] ?? null,
      endSeq: seqs[seqs.length - 1] ?? null,
      entryCount: rows.length,
      eventCount: memberEvents + taskEvents + messageEvents,
      memberEvents,
      taskEvents,
      messageEvents,
      headline: headline.title,
      headlineTone: headline.tone,
    }
  })

  return windows.reverse()
}
