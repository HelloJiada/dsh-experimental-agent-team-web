/**
 * AgentTeams activity panel: the top-right floater monitoring every team.
 *
 * Modeled on the Claude Code desktop SessionActivityPanel: a shell-overlay
 * panel that docks at the conversation's top-right edge by default, can be
 * dragged into a floating window, resized, and folded into an activity badge.
 * On wide viewports the docked panel makes the conversation column yield
 * space; narrow viewports keep a simple inset overlay. It
 * polls the host `/plugins/agent-team-web/state` route for
 * server-side snapshots (durable files + live subagent activity), with a
 * collapsed badge that auto-expands once when activity appears. Archived
 * teams stay available for the owning conversation after live work ends.
 *
 * The floater mounts in ui-layout's additive `shell.overlay`; it is not a
 * conversation node — the in-conversation panel was removed in favor of this
 * always-available monitor.
 * @module dsh-agent-team-web/client/activity
 */

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  IconBranchOutline16, IconChevronDownOutline14, IconCloseOutline16, IconPanelLeftOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ObservableSnapshot, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import {
  activityPanelExpandedForSession,
  compactDagLayout,
  COMPACT_DAG_NODE_HEIGHT,
  COMPACT_DAG_NODE_WIDTH,
  dependencyFocusTaskId,
  relatedTaskIds,
  usesParallelTaskGrid,
} from './activity-model.ts'
import {
  ARCHIVE_DEFAULT_FILTER,
  ARCHIVE_RETRO_FILTERS,
  ARCHIVE_TIME_RANGES,
  archivedTeamNames,
  filterArchivedTeams,
  type ArchiveFilterState,
  type ArchiveRetroFilter,
  type ArchiveTimeRange,
} from './archive-filter.ts'
import {
  getActivityMonitorTargetsSnapshot,
  getActivitySnapshotsSnapshot,
  startActivityPolling,
  subscribeActivityMonitorTargets,
  subscribeActivitySnapshots,
  type ActivityMember,
  type ActivityTask,
  type ActivityTeam,
  agentTeamsWebToken,
} from './activity-monitor.ts'
import { TOKEN_HEADER } from '../web-auth-constants.ts'
import { ACTION_ART, LEAD_ART, memberArtUrl } from './artwork.ts'
import { isRoleName, nameTitle, roleTitle } from './roles.ts'
import { taskReviewPending, taskReviewState } from './task-review.ts'
import { taskAwaitingInput, taskBlockedByReview, taskIntermediateFlag } from './task-intermediate.ts'
import { taskHelper } from './task-helping.ts'
import {
  memberElapsedText,
  memberTimingState,
  retroDetailText,
  taskPendingCalibration,
  taskSignalsText,
  taskTimingState,
  taskTimingText,
} from './task-timing.ts'
import { OPEN_PANEL_EVENT } from './AgentTeamsCard.tsx'
import type { AgentTeamsCardData } from './agent-teams-card-definition.ts'
import type { AgentTeamsLocaleKey, AgentTeamsTranslate } from './locales.ts'
import {
  DEFAULT_PANEL_LAYOUT,
  PANEL_LAYOUT_STORAGE_KEY,
  compactPanelForBounds,
  dockPanelLayout,
  floatPanelLayout,
  movePanelLayout,
  panelMaximumHeight,
  panelUsesAutoHeight,
  parsePanelLayout,
  panelDockAnchor,
  resizePanelLayout,
  resolvePanelGeometry,
  type PanelBounds,
  type PanelLayout,
  type PanelResizeEdge,
} from './panel-geometry.ts'
import css from './ActivityPanel.module.css'

/** Grace before the panel collapses once no team remains. */
const AUTOCLOSE_GRACE_MS = 2000
/**
 * Page-settle window after mount: activity restored on page load only shows
 * the collapsed badge, so the panel never yanks the conversation column
 * right after load. New activity after this window auto-expands as usual.
 */
const AUTO_OPEN_SETTLE_MS = 4000
/** Root marker shared with the panel CSS while the shell overlay is expanded. */
const PANEL_OPEN_ATTRIBUTE = 'data-agent-team-web-panel-open'
/** Shared width concession consumed by the conversation root CSS. */
const PANEL_SHIFT_PROPERTY = '--agent-team-web-panel-shift'
const PANEL_CONVERSATION_GAP = 14
const MOVE_THRESHOLD = 4

type PanelGesture = {
  readonly kind: 'move' | 'resize'
  readonly edge?: PanelResizeEdge
  readonly pointerId: number
  readonly originX: number
  readonly originY: number
  readonly start: PanelLayout
  activated: boolean
}

function initialPanelLayout(): PanelLayout {
  if (typeof window === 'undefined') return DEFAULT_PANEL_LAYOUT
  return parsePanelLayout(window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY))
}

function initialPanelBounds(): PanelBounds {
  if (typeof window === 'undefined') return { width: 1440, height: 900, anchorRight: 1440 }
  return { width: window.innerWidth, height: window.innerHeight, anchorRight: window.innerWidth }
}

/** Initial-letter fallback for unmatched roles. */
function memberInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?'
}

function stableHash(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

const ACCENTS = [
  'var(--dsw-alias-state-business-primary)',
  'var(--dsw-alias-state-success)',
  'var(--dsw-alias-state-danger)',
  'var(--dsw-alias-state-warning)',
  'var(--dsw-alias-label-tertiary)',
] as const

function accentOf(id: string): string {
  return ACCENTS[stableHash(id) % ACCENTS.length] ?? ACCENTS[0]
}

/** Badge text follows the raw task status (finer than the 4 visual states):
 * claimed/pending/failed/cancelled keep their own labels and colors. */
const TASK_STATUS_LABEL: Record<string, AgentTeamsLocaleKey> = {
  pending: 'task.status.pending',
  claimed: 'task.status.claimed',
  in_progress: 'task.status.inProgress',
  completed: 'task.status.completed',
  failed: 'task.status.failed',
  cancelled: 'task.status.cancelled',
}

export function taskStatusLabel(status: string, t: AgentTeamsTranslate): string {
  const key = TASK_STATUS_LABEL[status]
  return key === undefined ? status : t(key)
}

export function formatTaskIds(ids: readonly string[], t: AgentTeamsTranslate): string {
  return ids.join(t('format.listSeparator'))
}

/** Badge/bar coloring key: visual state, widened for terminal statuses. */
export function taskTone(state: ActivityTask['state'], status: string): string {
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return state
}

/** 任务耗时超时档位(ok 不输出警示;warn/over 分别黄/红)。 */
export function timingData(task: ActivityTask): 'ok' | 'warn' | 'over' {
  return taskTimingState(task, Date.now())
}

function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg className={css.chevron} data-open={open} width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M3.5 2l3 3-3 3" />
    </svg>
  )
}

function WorkGlyph({ active }: { readonly active: boolean }) {
  return (
    <svg className={css.workGlyph} data-active={active} width="11" height="11" viewBox="0 0 11 11" fill="currentColor" aria-hidden>
      {[[0, 0], [4.2, 0], [8.4, 0], [0, 4.2], [4.2, 4.2], [8.4, 4.2]].map(([x, y], index) => (
        <rect key={`${x}:${y}`} x={x} y={y} width="2.6" height="2.6" rx=".6" style={{ animationDelay: `${index * 0.15}s` }} />
      ))}
    </svg>
  )
}

/** Collapsed badge: an always-visible corner pill while any team exists. */
function CollapsedBadge({ count, busy, onClick, t }: {
  readonly count: number
  readonly busy: boolean
  readonly onClick: () => void
  readonly t: AgentTeamsTranslate
}) {
  return (
    <button type="button" className={css.badge} data-agent-team-web-collapsed data-busy={busy} onClick={onClick} aria-label={t('activity.badgeAria', { count })}>
      <span className={css.badgeDot} data-busy={busy} aria-hidden />
      <span className={css.badgeCount}>{count}</span>
    </button>
  )
}

function memberStateLabel(
  member: ActivityMember,
  tasks: readonly ActivityTask[],
  historic: boolean,
  t: AgentTeamsTranslate,
): string {
  const owned = tasks.filter((task) => task.assignee === member.name)
  if (member.activity === 'working') return t('member.state.working')
  if (owned.some((task) => task.status === 'failed')) return t('member.state.failed')
  if (owned.some((task) => task.state === 'blocked')) return t('member.state.waiting')
  if (owned.length > 0 && owned.every((task) => task.status === 'completed')) return t('member.state.delivered')
  if (member.status === 'removed') return t(historic ? 'member.state.left' : 'member.state.removed')
  if (owned.length > 0) return t('member.state.pending')
  return t('member.state.unassigned')
}

function memberStatusText(
  member: ActivityMember,
  tasks: readonly ActivityTask[],
  t: AgentTeamsTranslate,
): string {
  const owned = tasks.filter((task) => task.assignee === member.name)
  const current = owned.find((task) => task.id === member.currentTask)
  const blocked = owned.find((task) => task.state === 'blocked')
  if (member.helpingTask !== undefined) return t('member.status.helping', { taskId: member.helpingTask })
  if (member.activity === 'working' && current !== undefined) return t('member.status.executing', { taskId: current.id })
  if (member.activity === 'working') return t('member.status.working')
  if (blocked !== undefined) {
    const dependency = tasks.find((task) => blocked.dependencies.includes(task.id) && task.state !== 'completed')
    if (dependency !== undefined) {
      return t('member.status.waitingOn', {
        taskId: dependency.id,
        assignee: dependency.assignee || t('task.assignee.unclaimed'),
      })
    }
    return t('member.status.waitingPrerequisite')
  }
  if (member.total === 0) return t('member.status.waitingAssignment')
  if (member.done === member.total) return t('member.status.delivered')
  return t(member.activity === 'idle' ? 'member.status.idle' : 'member.status.unknown')
}

export function compactTaskLabel(subject: string): string {
  const withoutVerb = subject.replace(/^开发\s*/u, '').replace(/^\d+[-_.、\s]*/u, '')
  const head = withoutVerb.split(/[（(·：:]/u)[0]?.trim() ?? withoutVerb
  return head.length > 18 ? `${head.slice(0, 17)}…` : head
}

export function taskSummary(team: ActivityTeam, t: AgentTeamsTranslate): string {
  const completed = team.tasks.filter((task) => task.status === 'completed')
  const running = team.tasks.filter((task) => task.state === 'running')
  const blocked = team.tasks.filter((task) => task.state === 'blocked')
  const ready = team.tasks.filter((task) => task.state === 'open' && task.status !== 'completed')
  if (team.tasks.length === 0) return t('task.summary.waitingBreakdown')
  if (completed.length === team.tasks.length) return t('task.summary.allDelivered', { count: completed.length })
  if (blocked.length > 0 && running.length > 0) {
    return t('task.summary.blockedAndRunning', {
      tasks: formatTaskIds(blocked.slice(0, 3).map((task) => task.id), t),
      more: blocked.length > 3 ? t('task.summary.more', { count: blocked.length - 3 }) : '',
    })
  }
  if (running.length > 0) return t('task.summary.running', { tasks: formatTaskIds(running.map((task) => task.id), t) })
  if (ready.length > 0) return t('task.summary.ready', { tasks: formatTaskIds(ready.map((task) => task.id), t) })
  if (blocked.length > 0) return t('task.summary.blocked', { tasks: formatTaskIds(blocked.map((task) => task.id), t) })
  return t('task.summary.waitingSchedule')
}

function ProgressOverview({ team, t }: { readonly team: ActivityTeam; readonly t: AgentTeamsTranslate }) {
  const running = team.tasks.filter((task) => task.state === 'running').length
  const blocked = team.tasks.filter((task) => task.state === 'blocked').length
  const completed = team.tasks.filter((task) => task.status === 'completed').length
  const summaryTone = blocked > 0 ? 'warning' : completed === team.tasks.length && team.tasks.length > 0 ? 'completed' : 'running'
  return (
    <section className={css.progressOverview} aria-label={t('progress.aria')} data-progress-summary>
      <span className={css.progressTitle}>{t('progress.title')}</span>
      {team.tasks.length > 0 ? (
        <span className={css.progressSegments} aria-hidden>
          {team.tasks.map((task) => <span key={task.id} data-state={taskTone(task.state, task.status)} />)}
        </span>
      ) : <span className={css.progressEmpty} />}
      <span className={css.progressLegend}>
        <span data-state="running">{t('progress.running', { count: running })}</span>
        <span data-state="blocked">{t('progress.blocked', { count: blocked })}</span>
        <span data-state="completed">{t('progress.delivered', { count: completed })}</span>
      </span>
      <span className={css.progressSummary} data-state={summaryTone}>
        <span className={css.progressSummaryDot} />
        <span>{taskSummary(team, t)}</span>
      </span>
    </section>
  )
}

/** Provider 授权中心行数据:一行一个 DSH 注册 provider,deepseek-official 恒锁定(不可关)。 */
export function providerGrantRows(providers: readonly { id: string; name: string; enabled: boolean }[] | undefined):
  readonly { id: string; name: string; enabled: boolean; locked: boolean }[] {
  if (providers === undefined) return []
  return providers.map(provider => ({
    id: provider.id,
    name: provider.name,
    enabled: provider.enabled,
    locked: provider.id === 'deepseek-official',
  }))
}

/** Provider switch 拨动请求契约:endpoint + 方法 + 载荷(enabled 取反)。R-17 token 头由调用方注入。 */
export function providerToggleRequest(provider: { id: string; enabled: boolean }): {
  method: 'POST'
  path: string
  body: { provider: string; enabled: boolean }
} {
  return {
    method: 'POST',
    path: '/plugins/agent-team-web/provider-grant',
    body: { provider: provider.id, enabled: !provider.enabled },
  }
}

/** Provider 授权中心:列出 DSH 已注册的 LLM provider,每个带 switch。
 * deepseek-official 恒启用(不可关);其余 provider 默认关闭,拨开即授权
 * (POST /plugins/agent-team-web/provider-grant, R-17 token 保护)。 */
function ProviderGrantPanel({ providers, t, compact = false }: {
  readonly providers?: readonly { id: string; name: string; enabled: boolean }[]
  readonly t: AgentTeamsTranslate
  readonly compact?: boolean
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rows = providerGrantRows(providers)
  if (rows.length === 0) return null
  const toggle = async (provider: { id: string; enabled: boolean }): Promise<void> => {
    setBusy(provider.id)
    setError(null)
    try {
      const token = agentTeamsWebToken()
      const request = providerToggleRequest(provider)
      const response = await fetch(request.path, {
        method: request.method,
        headers: {
          'content-type': 'application/json',
          ...token === undefined ? {} : { [TOKEN_HEADER]: token },
        },
        body: JSON.stringify(request.body),
      })
      if (!response.ok) {
        console.warn(`agent-team-web: provider-grant failed (${response.status})`)
        setError(t('provider.grantError'))
        return
      }
      // 成功无需本地状态:轮询快照 ~1s 内刷新 providers 列表。
    } catch (err) {
      console.warn('agent-team-web: provider-grant request failed', err)
      setError(t('provider.grantError'))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className={css.providerSection} aria-label={t('provider.aria')} data-provider-grant>
      <header className={css.sectionHead}>
        <span className={css.sectionTitle}>{t('provider.title')}</span>
        {error !== null && <span className={css.providerError}>{error}</span>}
      </header>
      <div className={css.providerList}>
        {rows.map(provider => (
          <label key={provider.id} className={css.providerRow} data-enabled={provider.enabled}>
            <span className={css.providerName} title={provider.id}>{provider.name}</span>
            <span className={css.providerId}>{provider.id}</span>
            {provider.locked
              ? <span className={css.providerLocked}>{t('provider.locked')}</span>
              : (
                <button
                  type="button"
                  role="switch"
                  aria-checked={provider.enabled}
                  className={css.providerSwitch}
                  data-on={provider.enabled}
                  disabled={busy === provider.id}
                  onClick={() => { void toggle(provider) }}
                >
                  <span className={css.providerSwitchThumb} />
                </button>
              )}
          </label>
        ))}
      </div>
      {!compact && <p className={css.providerHint}>{t('provider.hint')}</p>}
    </section>
  )
}

function DependencyMap({ tasks, t, compact = false }: {
  readonly tasks: readonly ActivityTask[]
  readonly t: AgentTeamsTranslate
  /** compact≤960:隐藏预估/信号/复盘细节,只保留耗时相关(方向决策 5)。 */
  readonly compact?: boolean
}) {
  const [open, setOpen] = useState(true)
  const [hoverTaskId, setHoverTaskId] = useState<string | null>(null)
  const [keyboardTaskId, setKeyboardTaskId] = useState<string | null>(null)
  const [pinnedTaskId, setPinnedTaskId] = useState<string | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusedTaskId = dependencyFocusTaskId(pinnedTaskId, keyboardTaskId, hoverTaskId)
  const layout = useMemo(() => compactDagLayout(tasks), [tasks])
  const parallel = useMemo(() => usesParallelTaskGrid(tasks), [tasks])
  const related = useMemo(
    () => focusedTaskId === null ? null : relatedTaskIds(focusedTaskId, tasks),
    [focusedTaskId, tasks],
  )
  const scheduleHover = (id: string | null): void => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    if (id === null) {
      setHoverTaskId(null)
      return
    }
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null
      setHoverTaskId(id)
    }, 180)
  }
  useEffect(() => () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current)
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPinnedTaskId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [])
  if (tasks.length === 0) return null
  const fallbackTask = tasks.find((task) => task.state === 'blocked')
    ?? tasks.find((task) => task.state === 'running')
    ?? tasks[0]!
  const detailTask = tasks.find((task) => task.id === focusedTaskId) ?? fallbackTask
  const waitingOn = detailTask.dependencies.filter((dependency) => (
    tasks.find((task) => task.id === dependency)?.status !== 'completed'
  ))
  const dependents = tasks.filter((task) => task.dependencies.includes(detailTask.id))
  return (
    <section className={css.dependencySection} aria-label={t('dependency.aria')} data-dependency-map>
      <header className={css.sectionHead}>
        <button type="button" className={css.sectionToggleTitle} onClick={() => { setOpen((current) => !current) }} aria-expanded={open}>
          <Chevron open={open} /><IconBranchOutline16 /> {t(parallel ? 'dependency.parallel' : 'dependency.title')}
        </button>
        <span className={css.sectionHint}>{pinnedTaskId === null
          ? t(parallel ? 'dependency.hint.parallel' : 'dependency.hint.chain')
          : t('dependency.hint.pinned', { taskId: pinnedTaskId })}</span>
      </header>
      {open && (
        <>
          <div className={css.dagViewport}>
            <div
              className={css.dagCanvas}
              data-layout={parallel ? 'parallel' : 'dependency'}
              style={parallel ? undefined : { width: layout.width, height: layout.height }}
            >
              {!parallel && <svg className={css.dagEdges} width={layout.width} height={layout.height} aria-hidden>
                {layout.edges.map((edge) => {
                  const active = related !== null && related.has(edge.from) && related.has(edge.to)
                  return <path key={`${edge.from}:${edge.to}`} d={edge.path} data-active={active} data-dimmed={related !== null && !active} />
                })}
              </svg>}
              {layout.nodes.map(({ task, x, y }) => (
                <button
                  key={task.id}
                  type="button"
                  className={css.dagNode}
                  style={parallel
                    ? { height: COMPACT_DAG_NODE_HEIGHT }
                    : { left: x, top: y, width: COMPACT_DAG_NODE_WIDTH, height: COMPACT_DAG_NODE_HEIGHT }}
                  data-task-id={task.id}
                  data-state={taskTone(task.state, task.status)}
                  data-review={taskReviewPending(task) ? 'pending' : undefined}
                  data-helping={taskHelper(task) !== undefined ? 'true' : undefined}
                  data-timing={timingData(task) === 'ok' ? undefined : timingData(task)}
                  data-focused={related?.has(task.id) ?? false}
                  data-dimmed={related !== null && !related.has(task.id)}
                  aria-pressed={pinnedTaskId === task.id}
                  title={`${task.id} · ${task.subject}${taskHelper(task) !== undefined ? ` · ${t('task.helping', { member: taskHelper(task) })}` : ''}`}
                  onClick={() => { setPinnedTaskId((current) => current === task.id ? null : task.id) }}
                  onMouseEnter={() => { scheduleHover(task.id) }}
                  onMouseLeave={() => { scheduleHover(null) }}
                  onFocus={() => { setKeyboardTaskId(task.id) }}
                  onBlur={() => { setKeyboardTaskId(null) }}
                >
                  <span className={css.dagNodeHead}><span className={css.dagNodeDot} />{task.id}</span>
                  <span className={css.dagNodeLabel}>{compactTaskLabel(task.subject)}</span>
                  {task.state === 'running' && (
                    <span className={css.dagRunningState} aria-label={t('task.runningAria')}>
                      <WorkGlyph active />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <section className={css.taskDetail} data-task-detail={detailTask.id}>
            <span className={css.taskDetailHead}>
              <span className={css.taskDetailId}>{detailTask.id}</span>
              <span className={css.taskDetailSubject} title={detailTask.subject}>{detailTask.subject.replace(/^开发\s*/u, '')}</span>
              <span className={css.taskDetailBadge} data-state={taskTone(detailTask.state, detailTask.status)}>{taskStatusLabel(detailTask.status, t)}</span>
            </span>
            <span className={css.taskDetailLine}>
              {detailTask.assignee || t('task.assignee.unclaimed')} · {detailTask.status === 'completed'
                ? t('task.detail.completed')
                : detailTask.dependencies.length === 0
                ? t('task.detail.noPrerequisite')
                : waitingOn.length === 0
                  ? t('task.detail.ready')
                  : t('task.detail.waitingOn', { tasks: formatTaskIds(waitingOn, t) })}
            </span>
            {taskTimingText(detailTask, t) !== null && !compact && (
              <span className={css.taskDetailTiming} data-timing={timingData(detailTask)}>
                {taskTimingText(detailTask, t)}
              </span>
            )}
            {taskSignalsText(detailTask, t) !== null && !compact && (
              <span className={css.taskDetailSignals} data-timing={timingData(detailTask)}>
                {taskSignalsText(detailTask, t)}
              </span>
            )}
            {retroDetailText(detailTask, t) !== null && !compact && (
              <span className={css.taskDetailRetro} data-cause={detailTask.retro?.cause}>
                {retroDetailText(detailTask, t)}
              </span>
            )}
            {taskPendingCalibration(detailTask) && !compact && (
              <span className={css.taskDetailCalibration} data-calibration="pending">
                {t('task.calibration.detail')}
              </span>
            )}
            <span className={css.taskDetailMeta}>{dependents.length === 0
              ? t('task.detail.noDownstream')
              : t('task.detail.unlocks', { tasks: formatTaskIds(dependents.map((task) => task.id), t) })}</span>
            {(taskReviewState(detailTask) !== null) && (
              <span className={css.taskDetailReview} data-verdict={detailTask.review?.verdict ?? 'pending'}>
                {detailTask.review?.verdict === 'pass'
                  ? t('task.review.passed', { reviewer: detailTask.review.reviewerName })
                  : detailTask.review?.verdict === 'reject'
                    ? t('task.review.rejected', { comment: detailTask.review.comment ?? '' })
                    : t('task.review.pending')}
              </span>
            )}
            {/* 改进 4:任务中间态详情行(等待政委复核 / 等待输入)。 */}
            {taskBlockedByReview(detailTask) && (
              <span className={css.taskDetailBlocked} data-intermediate="blockedReview">
                {t('task.intermediate.blockedReviewDetail')}
              </span>
            )}
            {taskAwaitingInput(detailTask) && (
              <span className={css.taskDetailInput} data-intermediate="awaitingInput">
                {t('task.intermediate.awaitingInputDetail')}
              </span>
            )}
          </section>
        </>
      )}
    </section>
  )
}

/** 健康档位:0-49 需要立即干预,50-79 存在风险,80+ 运行平稳。 */
export function healthLevel(score: number): 'critical' | 'warn' | 'ok' {
  if (score < 50) return 'critical'
  if (score < 80) return 'warn'
  return 'ok'
}

/** 高风险消息计数(融合分析层)。 */
export function healthRiskCount(team: ActivityTeam): number {
  return team.intelligence?.messageRisks.filter(risk => risk.riskLevel === 'high').length ?? 0
}

/** 成员负载条:active / pending / stalled / orphaned 四段。 */
export function loadBarFor(team: ActivityTeam, member: ActivityMember): JSX.Element | null {
  const load = team.intelligence?.memberLoads.find(entry => entry.memberName === member.name)
  if (load === undefined) return null
  const total = load.activeTaskCount + load.pendingOwnedTaskCount + load.stalledTaskCount + load.orphanedTaskCount
  if (total <= 0) return null
  const pct = (count: number): string => `${Math.round((count / total) * 100)}%`
  return (
    <span className={css.loadBar} role="img" title={`${member.name} load`} data-level={load.level}>
      {load.activeTaskCount > 0 && <span className={css.loadActive} style={{ width: pct(load.activeTaskCount) }} />}
      {load.pendingOwnedTaskCount > 0 && <span className={css.loadPending} style={{ width: pct(load.pendingOwnedTaskCount) }} />}
      {load.stalledTaskCount > 0 && <span className={css.loadStalled} style={{ width: pct(load.stalledTaskCount) }} />}
      {load.orphanedTaskCount > 0 && <span className={css.loadOrphaned} style={{ width: pct(load.orphanedTaskCount) }} />}
    </span>
  )
}

/** Commissar supervision-state label derived from member activity. */
function commissarStateLabel(activity: ActivityMember['activity'], t: AgentTeamsTranslate): string {
  if (activity === 'working') return t('commissar.state.supervising')
  if (activity === 'idle') return t('commissar.state.standby')
  return t('commissar.state.unknown')
}

function TeamSection({ team, onNavigate, t, historic = false, compact = false }: {
  readonly team: ActivityTeam
  /** Navigate to a member transcript (floater hides immediately). */
  readonly onNavigate: (parentId: SessionId, childId: SessionId) => void
  readonly t: AgentTeamsTranslate
  readonly historic?: boolean
  /** compact≤960:只显示耗时,隐藏预估/信号/复盘细节(方向决策 5)。 */
  readonly compact?: boolean
}) {
  const [membersOpen, setMembersOpen] = useState(true)
  // The commissar is a supervisor, not a dispatched executor: busy state,
  // summary dispatch counts, the members toggle and the delegation tree all
  // cover executing members only.
  const commissar = team.members.find((member) => member.role === 'commissar')
  const execMembers = team.members.filter((member) => member.role !== 'commissar')
  const busyCount = execMembers.filter((member) => member.activity === 'working').length
  const assignedCount = team.tasks.filter((task) => task.assignee !== '').length
  const completedCount = team.tasks.filter((task) => task.status === 'completed').length
  const allCompleted = team.tasks.length > 0 && completedCount === team.tasks.length
  return (
    <section className={css.team} data-team-id={team.teamId}>
      <header className={css.teamHead}>
        <span className={css.teamName} title={team.name}>{team.name}</span>
        {historic && <span className={css.historicPill}>{t('team.ended')}</span>}
        <span className={css.teamStats}>
          <span data-stat="members">{t('team.stats.members', { count: team.members.length })}</span>
          <span data-stat="tasks">{t('team.stats.completed', { completed: completedCount, total: team.tasks.length })}</span>
          <span data-stat="messages">{t('team.stats.messages', { count: team.messageCount })}</span>
          {team.intelligence !== undefined && healthRiskCount(team) > 0 && (
            <span data-stat="risks" className={css.riskStat}>{t('risk.high', { count: healthRiskCount(team) })}</span>
          )}
        </span>
        {team.intelligence !== undefined && (
          <span className={css.healthChip} data-level={healthLevel(team.intelligence.health.score)} title={team.intelligence.health.overview}>
            <strong>{team.intelligence.health.score}</strong>
            <em>{team.intelligence.health.statusLabel}</em>
          </span>
        )}
      </header>

      <section className={css.delegationSection} aria-label={t('delegation.aria')} data-delegation-map>
        <div className={css.commandLayer} data-leadership={commissar === undefined ? 'solo' : 'pair'}>
          <div className={css.captainNode}>
            <span className={css.captainAvatar}>
              <img className={css.leadAvatar} src={LEAD_ART} alt="" aria-hidden />
            </span>
            <span className={css.captainInfo}>
              <span className={css.captainLine}>
                <span className={css.captainName}>{t('captain.name')}</span>
                <span className={css.captainRole}>{t('captain.role')}</span>
              </span>
              <span className={css.captainSummary}>{t('captain.summary', {
                tasks: assignedCount,
                members: execMembers.length,
              })}</span>
            </span>
            <span className={css.captainState} data-busy={busyCount > 0} title={
              busyCount > 0
                ? t('captain.state.working', { count: busyCount })
                : t(allCompleted ? 'captain.state.collected' : 'captain.state.waiting')
            }>
              <WorkGlyph active={busyCount > 0} />
              {busyCount > 0
                ? t('captain.state.working', { count: busyCount })
                : t(allCompleted ? 'captain.state.collected' : 'captain.state.waiting')}
            </span>
          </div>

          {commissar !== undefined && (
            <div className={css.commissarNode} data-activity={commissar.activity}>
              <span className={css.captainAvatar}>
                {memberArtUrl(commissar.name, commissar.role) !== null ? (
                  <img className={css.leadAvatar} src={memberArtUrl(commissar.name, commissar.role) ?? ''} alt="" aria-hidden />
                ) : (
                  <span className={css.memberInitial} style={{ background: accentOf(commissar.id) }}>{memberInitial(commissar.name)}</span>
                )}
                <img className={css.stateArt} data-activity={commissar.activity} src={ACTION_ART[commissar.activity]} alt="" aria-hidden />
              </span>
              <span className={css.captainInfo}>
                <span className={css.captainLine}>
                  <span className={css.captainName}>{roleTitle(commissar.role, t)}</span>
                  <span className={css.captainRole}>{t('commissar.dutyShort')}</span>
                </span>
                <span className={css.captainSummary} title={t('commissar.dutyFull')}>{t('commissar.duty')}</span>
              </span>
              <span className={css.commissarState} data-activity={commissar.activity}>
                {commissarStateLabel(commissar.activity, t)}
              </span>
            </div>
          )}
        </div>

        <ProgressOverview team={team} t={t} />

        {team.intelligence !== undefined && team.intelligence.priorities.length > 0 && (
          <section className={css.prioritySection} aria-label={t('priority.aria')} data-priority-map>
            <span className={css.sectionTitle}>{t('priority.title')}</span>
            {team.intelligence.priorities.slice(0, 3).map((priority, index) => (
              <div key={priority.taskId} className={css.priorityCard} data-severity={priority.severity}>
                <span className={css.priorityBadge}>P{index + 1}</span>
                <span className={css.priorityBody}>
                  <span className={css.priorityTitle}>
                    <strong>{priority.subject}</strong>
                    <em className={css.chip} data-readiness={priority.readiness}>{priority.readiness}</em>
                    <em className={css.chip} data-severity={priority.severity}>{priority.severity}</em>
                  </span>
                  <span className={css.priorityReasons}>{priority.reasons.join(' ')}</span>
                </span>
              </div>
            ))}
          </section>
        )}

        {team.intelligence !== undefined && team.intelligence.milestones.latestTitle !== null && (
          <div className={css.milestoneRow}>
            <span className={css.sectionTitle}>{t('milestone.title')}</span>
            <strong title={team.intelligence.milestones.latestTitle}>{team.intelligence.milestones.latestTitle}</strong>
          </div>
        )}

        <button type="button" className={css.membersToggle} onClick={() => { setMembersOpen((current) => !current) }} aria-expanded={membersOpen} data-members-toggle>
          <span><Chevron open={membersOpen} />{t('members.toggle', { count: execMembers.length })}</span>
          <span>{t(membersOpen ? 'members.collapse' : 'members.expand')}</span>
        </button>

        {membersOpen && <div className={css.delegationTree}>
          {execMembers.length === 0 && <span className={css.emptyHint}>{t('members.empty')}</span>}
          {execMembers.map((member) => {
            const owned = team.tasks.filter((task) => task.assignee === member.name)
            return (
              <div key={member.id} className={css.memberBlock} data-activity={member.activity}>
                <span className={css.memberBranch} aria-hidden><span /></span>
                <button
                  type="button"
                  className={css.memberRow}
                  data-activity={member.activity}
                  onClick={() => {
                    if (member.id !== '') {
                      onNavigate(team.captainSessionId as SessionId, member.id as SessionId)
                    }
                  }}
                >
                  <span className={css.memberAvatar} data-unread={member.unread > 0}>
                    {memberArtUrl(member.name, member.role) !== null ? (
                      <img className={css.memberArt} src={memberArtUrl(member.name, member.role) ?? ''} alt="" aria-hidden />
                    ) : (
                      <span className={css.memberInitial} style={{ background: accentOf(member.id) }}>{memberInitial(member.name)}</span>
                    )}
                    <img className={css.stateArt} data-activity={member.activity} src={ACTION_ART[member.activity]} alt="" aria-hidden />
                  </span>
                  <span className={css.memberInfo}>
                    <span className={css.memberLine}>
                      <span className={css.memberName}>{nameTitle(member.name, t)}</span>
                      {member.role !== '' && !isRoleName(member.name) && <span className={css.memberRole}>{roleTitle(member.role, t)}</span>}
                    </span>
                    <span className={css.memberStatusLine}>
                      {memberStatusText(member, team.tasks, t)}
                      {memberElapsedText(member, t) !== null && (
                        <span className={css.memberElapsed} data-timing={memberTimingState(member, team.tasks)}>
                          {memberElapsedText(member, t)}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className={css.memberRight}>
                    <span className={css.memberState} data-activity={member.activity}>
                      <WorkGlyph active={member.activity === 'working'} />
                      {memberStateLabel(member, team.tasks, historic, t)}
                    </span>
                    {loadBarFor(team, member)}
                    <span className={css.memberCount}>{member.done}/{member.total}</span>
                  </span>
                </button>
                <div className={css.assignmentLine}>
                  <span className={css.assignmentLabel}>{t('assignment.label')}</span>
                  <span className={css.assignmentTasks}>
                    {owned.length === 0
                      ? <span className={css.taskEmpty}>{t('assignment.empty')}</span>
                      : owned.map((task) => (
                        <span key={task.id} className={css.assignmentChip} data-state={taskTone(task.state, task.status)} data-review={taskReviewPending(task) ? 'pending' : undefined} data-intermediate={taskIntermediateFlag(task)} data-helping={taskHelper(task) !== undefined ? 'true' : undefined} data-timing={timingData(task)} title={`${task.id} · ${task.subject}`}>
                          {task.id}
                          {/* 改进 4:被门禁拦截的任务显示「待复核」阻塞态(更强的中间态),
                              替代派生的「待政委复核」徽标,避免重复提示;未拦截的门禁任务仍显示后者。 */}
                          {taskBlockedByReview(task)
                            ? <span className={css.blockedChip}>{t('task.intermediate.blockedReview')}</span>
                            : taskReviewPending(task) && <span className={css.reviewChip}>{t('task.review.pending')}</span>}
                          {taskAwaitingInput(task) && <span className={css.inputChip}>{t('task.intermediate.awaitingInput')}</span>}
                          {taskPendingCalibration(task) && <span className={css.calibrationChip}>{t('task.calibration.pending')}</span>}
                          {taskHelper(task) !== undefined && <span className={css.helpingChip}>{t('task.helping', { member: taskHelper(task) })}</span>}
                          {!compact && timingData(task) !== 'ok' && <span className={css.timingChip} data-timing={timingData(task)}>{t(timingData(task) === 'over' ? 'timing.over' : 'timing.warn')}</span>}
                        </span>
                      ))}
                  </span>
                </div>
              </div>
            )
          })}
        </div>}
      </section>

      <DependencyMap tasks={team.tasks} t={t} compact={compact} />

      <ProviderGrantPanel providers={team.providers} t={t} compact={compact} />
    </section>
  )
}

/** Legacy conversation cards may outlive their host archive. Project their
 * durable roster through the same rebuilt panel instead of a second UI. */
function historicCardTeam(data: AgentTeamsCardData, owner: string): ActivityTeam {
  return {
    workspace: '',
    teamId: data.teamId,
    name: data.teamName,
    captainSessionId: data.captainSessionId || owner,
    members: data.members.map((member) => ({
      ...member,
      status: 'removed',
      activity: 'idle',
      progress: 0,
      done: 0,
      total: 0,
      currentTask: '',
      currentTaskElapsedMs: 0,
      currentTaskElapsedApprox: false,
      unread: 0,
    })),
    tasks: [],
    messageCount: 0,
    captainInbox: [],
  }
}

/** The top-right activity floater. Teams follow the current session: live
 * snapshots and historic card summaries are only shown while their captain
 * session is the one currently open. */
export type ActivityPanelProps = {
  readonly sessionsList: ObservableSnapshot<SessionListState>
  readonly openMember: (parentId: SessionId, childId: SessionId) => void
} & PropsLocale<'agentTeamWeb'>

export function ActivityPanel({ sessionsList, openMember, t }: ActivityPanelProps) {
  // Navigating to a member's subagent transcript is an explicit departure:
  // hide the floater immediately instead of waiting out the autocollapse
  // grace, so the panel never lingers over the member session.
  const navigateToSession = (parentId: SessionId, childId: SessionId): void => {
    setOpen(false)
    setWasActive(false)
    openMember(parentId, childId)
  }
  const [open, setOpen] = useState(false)
  const [openOwner, setOpenOwner] = useState<SessionId | undefined>()
  const [autoOpened, setAutoOpened] = useState(false)
  const [wasActive, setWasActive] = useState(false)
  const [historic, setHistoric] = useState<ReadonlyMap<string, { data: AgentTeamsCardData; owner: string }>>(new Map())
  const [layout, setLayout] = useState<PanelLayout>(initialPanelLayout)
  const [bounds, setBounds] = useState<PanelBounds>(initialPanelBounds)
  const [interaction, setInteraction] = useState<'dragging' | 'resizing' | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const boundsRef = useRef(bounds)
  const gestureRef = useRef<PanelGesture | null>(null)
  const frameRef = useRef<number | null>(null)
  const pendingLayoutRef = useRef<PanelLayout | null>(null)
  const current = useSyncExternalStore(
    sessionsList.subscribe,
    sessionsList.getSnapshot,
  ).current
  const monitorTargets = useSyncExternalStore(
    subscribeActivityMonitorTargets,
    getActivityMonitorTargetsSnapshot,
  )
  const { teams, archivedTeams } = useSyncExternalStore(
    subscribeActivitySnapshots,
    getActivitySnapshotsSnapshot,
  )
  const currentTargets = useMemo(
    () => current === undefined ? [] : monitorTargets.filter((target) => target.sessionId === current),
    [current, monitorTargets],
  )
  const currentRef = useRef(current)
  useEffect(() => { currentRef.current = current }, [current])
  const mountedAtRef = useRef(performance.now())
  const expanded = activityPanelExpandedForSession(open, openOwner, current)
  const geometry = useMemo(() => resolvePanelGeometry(layout, bounds), [layout, bounds])
  const compact = compactPanelForBounds(bounds)

  const commitLayout = useCallback((next: PanelLayout): void => {
    setLayout(next)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout))
  }, [layout])

  // The slot sits inside AppFrame, so all geometry is measured against the
  // shell overlay rather than the browser viewport. The conversation's real
  // right edge is the dock anchor and naturally follows sidebar/details
  // concessions without importing their hashed implementation classes.
  //
  // The anchor must track the settled conversation even when the details
  // column opens after mount. The conversation root exists across its
  // hero/settling/active phases and always fills the center column, so its
  // right edge is the dock anchor in every phase — there is no need to wait
  // for the 'active' phase, and opening the details track always resizes the
  // observed node. The root is re-queried per measure (a replaced root is
  // never measured through a stale node) and the ResizeObserver follows the
  // current root; a missing root keeps the last known anchor instead of
  // snapping to the shell's right edge (which would dock the panel on top of
  // an open details column).
  useLayoutEffect(() => {
    const overlay = document.querySelector<HTMLElement>('[data-shell-overlay]')
    if (overlay === null) return
    let frame: number | null = null
    let observed: HTMLElement | null = null
    const measure = (): void => {
      frame = null
      const conversation = document.querySelector<HTMLElement>("[data-phase]")
      if (conversation !== observed) {
        if (observed !== null) observer?.unobserve(observed)
        observed = conversation
        if (conversation !== null) observer?.observe(conversation)
      }
      const overlayRect = overlay.getBoundingClientRect()
      const conversationRect = conversation?.getBoundingClientRect()
      const next: PanelBounds = {
        width: overlayRect.width,
        height: overlayRect.height,
        anchorRight: panelDockAnchor(
          boundsRef.current.anchorRight,
          overlayRect.width,
          conversationRect === undefined ? null : conversationRect.right - overlayRect.left,
        ),
      }
      const previous = boundsRef.current
      if (previous.width === next.width
        && previous.height === next.height
        && previous.anchorRight === next.anchorRight) return
      boundsRef.current = next
      setBounds(next)
    }
    const scheduleMeasure = (): void => {
      frame ??= requestAnimationFrame(measure)
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure)
    measure()
    observer?.observe(overlay)
    window.addEventListener('resize', scheduleMeasure)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
    }
  }, [current])

  // This shell overlay survives conversation route changes. Gate expansion by its
  // owning session during render, then clear stale state before paint. This
  // removes the old panel immediately instead of waiting for the no-team
  // autoclose grace period on the destination page.
  useLayoutEffect(() => {
    if (openOwner === undefined || openOwner === current) return
    setOpen(false)
    setOpenOwner(undefined)
    setWasActive(false)
    setAutoOpened(false)
  }, [current, openOwner])

  // Only the wide docked mode asks the conversation column to yield. Floating
  // and compact modes are intentionally true overlays. The width is written as
  // one shared variable so the panel and the concession cannot drift apart.
  useLayoutEffect(() => {
    const root = document.documentElement
    const shouldYield = expanded && geometry.mode === 'docked' && !compact
    if (shouldYield) {
      root.setAttribute(PANEL_OPEN_ATTRIBUTE, '')
      root.style.setProperty(PANEL_SHIFT_PROPERTY, `${geometry.width + PANEL_CONVERSATION_GAP + 18}px`)
    } else {
      root.removeAttribute(PANEL_OPEN_ATTRIBUTE)
      root.style.removeProperty(PANEL_SHIFT_PROPERTY)
    }
    return () => {
      root.removeAttribute(PANEL_OPEN_ATTRIBUTE)
      root.style.removeProperty(PANEL_SHIFT_PROPERTY)
    }
  }, [compact, expanded, geometry.mode, geometry.width])

  useEffect(() => {
    if (current === undefined) return
    // Cards keep live teams on the normal cadence. The current-session scope
    // also performs one cold-start discovery pass so archived/cardless teams
    // survive a browser or `dsh web` restart.
    const controller = startActivityPolling(currentTargets, { discoverySessionId: current })
    return () => { controller.stop() }
  }, [current, currentTargets])

  useEffect(() => {
    const onOpenPanel = (event: Event): void => {
      const activeSession = currentRef.current
      if (activeSession === undefined) return
      setOpenOwner(activeSession)
      setOpen(true)
      const detail = (event as CustomEvent<AgentTeamsCardData>).detail
      if (detail?.teamId !== undefined) {
        // A card from a log that predates captainSessionId belongs to the
        // session that activated it (the current one at injection time).
        const owner = detail.captainSessionId !== '' ? detail.captainSessionId : currentRef.current ?? ''
        const teamKey = `${owner}:${detail.teamId}`
        setHistoric((previous) => {
          const next = new Map(previous)
          next.set(teamKey, { data: detail, owner })
          return next
        })
      }
    }
    window.addEventListener(OPEN_PANEL_EVENT, onOpenPanel)
    return () => {
      window.removeEventListener(OPEN_PANEL_EVENT, onOpenPanel)
    }
  }, [])

  // Teams follow the current session: live snapshots and historic card
  // summaries are visible only while their captain session is current.
  const visibleTeams = useMemo(
    // No current session (initial load): show nothing until one is picked,
    // so cross-session teams never leak into the floater.
    () => (current === undefined ? [] : teams.filter((team) => team.captainSessionId === current)),
    [teams, current],
  )
  const visibleHistoric = useMemo(
    () => (current === undefined ? [] : [...historic.values()].filter(({ data, owner }) =>
      owner === current && !teams.some((live) =>
        live.captainSessionId === current && live.teamId === data.teamId,
      ) && !archivedTeams.some((archived) =>
        archived.captainSessionId === current && archived.teamId === data.teamId,
      ),
    )),
    [historic, current, teams, archivedTeams],
  )
  const visibleArchived = useMemo(
    () => (current === undefined ? [] : archivedTeams.filter((team) =>
      team.captainSessionId === current && !teams.some((live) =>
        live.captainSessionId === current && live.teamId === team.teamId,
      ),
    )),
    [archivedTeams, current, teams],
  )
  // 改进方向 5:归档查询 —— 历史归档区按 团队/时间/复盘状态 筛选。
  // 纯函数计算,只影响展示层;筛选状态为面板本地 UI 状态。
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilterState>(ARCHIVE_DEFAULT_FILTER)
  const filteredArchived = useMemo(
    () => filterArchivedTeams(visibleArchived, archiveFilter),
    [visibleArchived, archiveFilter],
  )
  const visibleCount = visibleTeams.length + visibleArchived.length + visibleHistoric.length

  useEffect(() => {
    if (visibleCount > 0) {
      setWasActive(true)
      // Auto-expand only after the page-settle window: opening (and its
      // main-column yield) right after load reads as a whole-page flicker.
      const settled = performance.now() - mountedAtRef.current >= AUTO_OPEN_SETTLE_MS
      if (!autoOpened && settled) {
        setOpenOwner(current)
        setOpen(true)
        setAutoOpened(true)
      }
      return
    }
    // NOTE(user): auto-collapse disabled by request — the panel no longer
    // folds itself into the corner badge when no team remains.
    // if (!wasActive) return
    // const timer = setTimeout(() => {
    //   setOpen(false)
    //   setOpenOwner(undefined)
    //   setWasActive(false)
    //   // Re-arm auto-expand: a later activity (new team, new session) may
    //   // open the panel on its own again.
    //   setAutoOpened(false)
    // }, AUTOCLOSE_GRACE_MS)
    // return () => { clearTimeout(timer) }
  }, [visibleCount, autoOpened, wasActive])

  const busy = useMemo(
    () => visibleTeams.some((team) => team.members.some((member) => member.activity === 'working')),
    [visibleTeams],
  )
  const hasTeams = visibleCount > 0

  // Close (end & archive) control: only the current session's single live
  // team can be closed, and only when it has no unfinished work. The host
  // re-checks both facts on POST (defense in depth); these flags drive the
  // button's visibility and disabled state.
  const liveTeam = visibleTeams.length === 1 ? visibleTeams[0] : undefined
  const closeable = liveTeam !== undefined
    && (liveTeam.tasks.length === 0
        || liveTeam.tasks.every((task) => task.status === 'completed'))

  const closeTeam = useCallback(async (): Promise<void> => {
    if (liveTeam === undefined || current === undefined) return
    setClosing(true)
    setCloseError(null)
    try {
      // R-17/H-1: the /close route is token-gated; the panel echoes the boot
      // token injected into the served HTML.
      const token = agentTeamsWebToken()
      const response = await fetch('/plugins/agent-team-web/close', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...token === undefined ? {} : { [TOKEN_HEADER]: token },
        },
        body: JSON.stringify({
          teamId: liveTeam.teamId,
          captainSessionId: liveTeam.captainSessionId,
        }),
      })
      if (!response.ok) {
        console.warn(`agent-team-web: close request failed (${response.status})`)
        setCloseError(t('activity.closeError'))
        return
      }
      // Success needs no local state change: the polling monitor discovers
      // the archived team within ~1s and moves it into the archived section.
    } catch (error) {
      console.warn('agent-team-web: close request failed', error)
      setCloseError(t('activity.closeError'))
    } finally {
      setClosing(false)
    }
  }, [liveTeam, current, t])

  // Transient inline error hint; clears itself so it never lingers over work.
  useEffect(() => {
    if (closeError === null) return
    const timer = setTimeout(() => { setCloseError(null) }, 4000)
    return () => { clearTimeout(timer) }
  }, [closeError])

  // Auto-height panels do not store their live content height. Capture the
  // rendered box when a pointer gesture starts so movement and a first manual
  // resize clamp against what the user actually sees.
  const panelGeometryForGesture = useCallback((): PanelLayout => {
    const measuredHeight = panelRef.current?.getBoundingClientRect().height
    if (measuredHeight === undefined || measuredHeight <= 0) return geometry
    return { ...geometry, height: measuredHeight }
  }, [geometry])

  const flushScheduledLayout = useCallback((): void => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    const pending = pendingLayoutRef.current
    pendingLayoutRef.current = null
    if (pending !== null) commitLayout(pending)
  }, [commitLayout])

  const scheduleLayout = useCallback((next: PanelLayout): void => {
    pendingLayoutRef.current = next
    frameRef.current ??= requestAnimationFrame(() => {
      frameRef.current = null
      const pending = pendingLayoutRef.current
      pendingLayoutRef.current = null
      if (pending !== null) commitLayout(pending)
    })
  }, [commitLayout])

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
  }, [])

  const beginMove = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    if (compact || event.button !== 0 || (event.target as Element).closest('button') !== null) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gestureRef.current = {
      kind: 'move',
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      start: panelGeometryForGesture(),
      activated: false,
    }
  }, [compact, panelGeometryForGesture])

  const beginResize = useCallback((edge: PanelResizeEdge, event: ReactPointerEvent<HTMLDivElement>): void => {
    if (compact || event.button !== 0 || (geometry.mode === 'docked' && edge !== 'left')) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    gestureRef.current = {
      kind: 'resize',
      edge,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      start: panelGeometryForGesture(),
      activated: true,
    }
    setInteraction('resizing')
  }, [compact, geometry.mode, panelGeometryForGesture])

  const updateGesture = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    const gesture = gestureRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId
      || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const dx = event.clientX - gesture.originX
    const dy = event.clientY - gesture.originY
    const activeBounds = boundsRef.current
    if (gesture.kind === 'move') {
      if (!gesture.activated && Math.hypot(dx, dy) < MOVE_THRESHOLD) return
      if (!gesture.activated) {
        gesture.activated = true
        setInteraction('dragging')
      }
      scheduleLayout(movePanelLayout(
        floatPanelLayout(gesture.start, activeBounds),
        dx,
        dy,
        activeBounds,
      ))
      return
    }
    scheduleLayout(resizePanelLayout(
      gesture.start,
      gesture.edge ?? 'left',
      dx,
      dy,
      activeBounds,
    ))
  }, [scheduleLayout])

  const endGesture = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    const gesture = gestureRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId) return
    updateGesture(event)
    flushScheduledLayout()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    gestureRef.current = null
    setInteraction(null)
  }, [flushScheduledLayout, updateGesture])

  const cancelGesture = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    const gesture = gestureRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId) return
    flushScheduledLayout()
    gestureRef.current = null
    setInteraction(null)
  }, [flushScheduledLayout])

  const toggleDock = useCallback((): void => {
    const liveGeometry = panelGeometryForGesture()
    commitLayout(liveGeometry.mode === 'docked'
      ? floatPanelLayout(liveGeometry, boundsRef.current)
      : dockPanelLayout(liveGeometry, boundsRef.current))
  }, [commitLayout, panelGeometryForGesture])

  const autoHeight = panelUsesAutoHeight(geometry, bounds)

  const panelStyle: CSSProperties = {
    width: geometry.width,
    height: autoHeight ? 'auto' : geometry.height,
    maxHeight: panelMaximumHeight(geometry, bounds),
    transform: `translate3d(${geometry.x}px, ${geometry.y}px, 0)`,
  }

  if (!hasTeams && !expanded) return null

  return (
    <>
      {!expanded && (
        <CollapsedBadge count={visibleCount} busy={busy} t={t} onClick={() => {
          if (current === undefined) return
          setOpenOwner(current)
          setOpen(true)
        }} />
      )}
      {expanded && (
        <aside
          ref={panelRef}
          className={css.panel}
          style={panelStyle}
          data-agent-team-web-activity
          data-panel-mode={geometry.mode}
          data-height-mode={autoHeight ? 'auto' : 'manual'}
          data-compact={compact || undefined}
          data-dragging={interaction === 'dragging' || undefined}
          data-resizing={interaction === 'resizing' || undefined}
          aria-label={t('activity.panelAria')}
        >
          <header
            className={css.panelHead}
            onPointerDown={beginMove}
            onPointerMove={updateGesture}
            onPointerUp={endGesture}
            onPointerCancel={cancelGesture}
            data-drag-handle={!compact || undefined}
          >
            <span className={css.panelTitle}>
              {t('activity.title')}
              <span className={css.panelDot} data-busy={busy} aria-hidden />
            </span>
            <span className={css.panelControls}>
              {!compact && (
                <button
                  type="button"
                  className={css.iconButton}
                  data-control="dock"
                  data-mode={geometry.mode}
                  onClick={toggleDock}
                  aria-label={t(geometry.mode === 'docked' ? 'activity.float' : 'activity.dockRight')}
                  title={t(geometry.mode === 'docked' ? 'activity.float' : 'activity.dockRight')}
                >
                  <IconPanelLeftOutline16 />
                </button>
              )}
              <button
                type="button"
                className={css.iconButton}
                data-control="collapse"
                onClick={() => {
                  setOpen(false)
                  setOpenOwner(undefined)
                }}
                aria-label={t('activity.collapse')}
                title={t('activity.collapse')}
              >
                <IconChevronDownOutline14 />
              </button>
              {liveTeam !== undefined && (
                <button
                  type="button"
                  className={css.iconButton}
                  data-control="close"
                  disabled={!closeable || closing}
                  onClick={() => { void closeTeam() }}
                  aria-label={t(closeable ? 'activity.close' : 'activity.closeDisabled')}
                  title={!closeable
                    ? t('activity.closeDisabled')
                    : closing ? t('activity.closing') : t('activity.close')}
                >
                  <IconCloseOutline16 />
                </button>
              )}
            </span>
          </header>
          {closeError !== null && (
            <div className={css.closeError} role="alert">{closeError}</div>
          )}
          <div className={css.teams}>
            {visibleCount === 0
              ? <span className={css.emptyHint}>{t('activity.empty')}</span>
              : (
                <>
                  {visibleTeams.map((team) => (
                    <TeamSection key={team.teamId} team={team} onNavigate={navigateToSession} t={t} compact={compact} />
                  ))}
                  {visibleArchived.length > 0 && (
                    <div className={css.archiveFilterBar} data-archive-filter>
                      <label className={css.archiveFilterField}>
                        <span className={css.archiveFilterCaption}>{t('archive.filterTeam')}</span>
                        <select
                          className={css.archiveSelect}
                          data-filter="team"
                          value={archiveFilter.team}
                          onChange={(event) => setArchiveFilter({ ...archiveFilter, team: event.target.value })}
                        >
                          <option value="">{t('archive.filterTeamAll')}</option>
                          {archivedTeamNames(visibleArchived).map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                      </label>
                      <label className={css.archiveFilterField}>
                        <span className={css.archiveFilterCaption}>{t('archive.filterTime')}</span>
                        <select
                          className={css.archiveSelect}
                          data-filter="time"
                          value={archiveFilter.timeRange}
                          onChange={(event) => setArchiveFilter({ ...archiveFilter, timeRange: event.target.value as ArchiveTimeRange })}
                        >
                          {ARCHIVE_TIME_RANGES.map((range) => (
                            <option key={range} value={range}>{t(`archive.time.${range}`)}</option>
                          ))}
                        </select>
                      </label>
                      <label className={css.archiveFilterField}>
                        <span className={css.archiveFilterCaption}>{t('archive.filterRetro')}</span>
                        <select
                          className={css.archiveSelect}
                          data-filter="retro"
                          value={archiveFilter.retro}
                          onChange={(event) => setArchiveFilter({ ...archiveFilter, retro: event.target.value as ArchiveRetroFilter })}
                        >
                          {ARCHIVE_RETRO_FILTERS.map((retro) => (
                            <option key={retro} value={retro}>{t(`archive.retro.${retro}`)}</option>
                          ))}
                        </select>
                      </label>
                      <span className={css.archiveFilterCount} data-filter-count>
                        {t('archive.filterCount', { shown: filteredArchived.length, total: visibleArchived.length })}
                      </span>
                    </div>
                  )}
                  {visibleArchived.length > 0 && filteredArchived.length === 0 && (
                    <span className={css.archiveEmpty}>{t('archive.filterEmpty')}</span>
                  )}
                  {filteredArchived.map((team) => (
                    <div key={`${team.captainSessionId}:${team.teamId}`} data-team-id={team.teamId} data-historic>
                      <span className={css.archiveLabel}>{t('archive.label')}</span>
                      <TeamSection team={team} onNavigate={navigateToSession} t={t} historic compact={compact} />
                    </div>
                  ))}
                  {visibleHistoric.map(({ data: team, owner }) => {
                    const teamKey = `${owner}:${team.teamId}`
                    return (
                      <TeamSection key={teamKey} team={historicCardTeam(team, owner)} onNavigate={navigateToSession} t={t} historic compact={compact} />
                    )
                  })}
                </>
              )}
          </div>
          {!compact && (
            <div
              className={css.resizeHandle}
              data-resize-edge="left"
              onPointerDown={(event) => { beginResize('left', event) }}
              onPointerMove={updateGesture}
              onPointerUp={endGesture}
              onPointerCancel={cancelGesture}
              aria-hidden
            />
          )}
          {!compact && geometry.mode === 'floating' && (
            <>
              <div
                className={css.resizeHandle}
                data-resize-edge="bottom"
                onPointerDown={(event) => { beginResize('bottom', event) }}
                onPointerMove={updateGesture}
                onPointerUp={endGesture}
                onPointerCancel={cancelGesture}
                aria-hidden
              />
              <div
                className={css.resizeHandle}
                data-resize-edge="corner"
                onPointerDown={(event) => { beginResize('corner', event) }}
                onPointerMove={updateGesture}
                onPointerUp={endGesture}
                onPointerCancel={cancelGesture}
                aria-hidden
              />
            </>
          )}
        </aside>
      )}
    </>
  )
}
