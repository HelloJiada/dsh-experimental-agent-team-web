/**
 * 工具输出格式化层:status / best-practices 的紧凑文本渲染,以及
 * signals / retro 的统一 JSON 序列化(snake_case 输出形状)。
 *
 * 纯重构拆分(R-33):renderStatus / renderBestPractices 原内联于
 * tools.ts;signals/retro 的 snake_case 序列化在 update_task 输出与
 * status 输出中重复实现,统一收敛于此。不触碰 teamLockKey 字符串契约
 * (锁键仍由 tools.ts / close-route.ts / scheduler.ts 各自持有)。
 * @module dsh-agent-team-web/render
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'
import { formatDuration } from './duration.ts'
import { taskElapsedMs, taskTimingState } from './retro.ts'
import { ROLE_TITLES } from './suggest.ts'
import { ESTIMATE_LEVEL_RANGES, type TaskRetro, type TaskSignals } from './types.ts'

/**
 * 产出信号的 snake_case 序列化(update_task 输出与 status 输出共用)。
 * undefined 返回空对象,便于 `...serializeSignals(task.signals)` 展开。
 */
export function serializeSignals(
  signals: TaskSignals | undefined,
): { signals: { turns?: number; tool_calls?: number; output_bytes: number; self_report?: string } } | Record<string, never> {
  if (signals === undefined) return {}
  return {
    signals: {
      ...signals.turns !== undefined ? { turns: signals.turns } : {},
      ...signals.toolCalls !== undefined ? { tool_calls: signals.toolCalls } : {},
      output_bytes: signals.outputBytes,
      ...signals.selfReport !== undefined ? { self_report: signals.selfReport } : {},
    },
  }
}

/**
 * 复盘记录的 snake_case 序列化(update_task 输出与 status 输出共用)。
 * undefined 返回空对象,便于 `...serializeRetro(task.retro)` 展开。
 */
export function serializeRetro(
  retro: TaskRetro | undefined,
): { retro: {
    attempt: number
    actual_ms: number
    estimate_level?: string
    estimated_ms?: number
    overrun_ms?: number
    level_deviation?: number
    overran: boolean
    cause: string
    summary: string
    retro_note?: string
    captain_verdict?: string
    recommendation: string
    includes_gate_wait?: boolean
    has_helper?: boolean
    created_at: number
  } } | Record<string, never> {
  if (retro === undefined) return {}
  return {
    retro: {
      attempt: retro.attempt,
      actual_ms: retro.actualMs,
      ...retro.estimateLevel !== undefined ? { estimate_level: retro.estimateLevel } : {},
      ...retro.estimatedMs !== undefined ? { estimated_ms: retro.estimatedMs } : {},
      ...retro.overrunMs !== undefined ? { overrun_ms: retro.overrunMs } : {},
      ...retro.levelDeviation !== undefined ? { level_deviation: retro.levelDeviation } : {},
      overran: retro.overran,
      cause: retro.cause,
      summary: retro.summary,
      ...retro.retroNote !== undefined ? { retro_note: retro.retroNote } : {},
      ...retro.captainVerdict !== undefined ? { captain_verdict: retro.captainVerdict } : {},
      recommendation: retro.recommendation,
      ...retro.includesGateWait === true ? { includes_gate_wait: true } : {},
      ...retro.hasHelper === true ? { has_helper: true } : {},
      created_at: retro.createdAt,
    },
  }
}

/** Render the status snapshot as compact text for the model. */
export function renderStatus(value: JsonValue): string {
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
    tasks: { id: string; subject: string; status: string; assignee: string; dependencies: string[]; attempt: number; attempt_id: string; reassigning: boolean; risk_level?: string; milestone?: boolean; review_required?: boolean; review?: { reviewer_name: string; verdict: string; comment?: string; reviewed_at: number }; helper?: string; output?: string; estimate_level?: string; estimated_ms?: number; claimed_at?: number; started_at?: number; completed_at?: number; actual_ms?: number; overrun_ms?: number; updated_at?: number; signals?: { turns?: number; tool_calls?: number; output_bytes: number; self_report?: string }; retro?: { attempt: number; actual_ms: number; estimate_level?: string; estimated_ms?: number; overrun_ms?: number; level_deviation?: number; overran: boolean; cause: string; summary: string; retro_note?: string; captain_verdict?: string; recommendation: string; includes_gate_wait?: boolean; has_helper?: boolean; created_at: number }; suggested_role?: string; suggested_member?: string; suggestion_confidence?: string }[]
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
      // R-36:缺 claimedAt 的旧团队任务回退 updatedAt 显示近似耗时(与快照
      // 路径 currentTaskElapsedMs 的 updatedAt 回退口径一致,retro.ts:90)。
      let timing = ''
      if (task.estimate_level !== undefined) {
        timing += ` · est ${task.estimate_level}(${ESTIMATE_LEVEL_RANGES[task.estimate_level as keyof typeof ESTIMATE_LEVEL_RANGES].label})`
      } else if (task.estimated_ms !== undefined) {
        timing += ` · est ${formatDuration(task.estimated_ms)}`
      }
      if (task.status === 'in_progress' && (task.claimed_at !== undefined || task.updated_at !== undefined)) {
        const elapsed = taskElapsedMs({ claimedAt: task.claimed_at, updatedAt: task.updated_at }, Date.now())
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
export function renderBestPractices(value: JsonValue, args: { role?: string; level?: string; limit?: number }): string {
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
