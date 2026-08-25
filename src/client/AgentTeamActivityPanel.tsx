import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-runtime/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { activityPanelView, qualifiesForActivityPanel } from './activity-panel-view.js'
import { OPEN_AGENT_TEAM_ACTIVITY_PANEL_EVENT } from './activity-panel-events.js'
import {
  DEFAULT_PANEL_LAYOUT,
  PANEL_LAYOUT_STORAGE_KEY,
  compactPanelForBounds,
  dockPanelLayout,
  floatPanelLayout,
  movePanelLayout,
  parsePanelLayout,
  resizePanelLayout,
  resolvePanelGeometry,
} from './panel-geometry.js'
import type { PanelBounds, PanelLayout, PanelResizeEdge } from './panel-geometry.js'
// @ts-expect-error CSS modules are bundled by the client build; Task 5 owns bundler/type integration.
import styles from './AgentTeamActivityPanel.module.css'

type AgentTeamActivityPanelProps = PropsRuntime<'shell.overlay'> & {
  readonly openMember: (memberId: string) => void
}

type PointerOperation = {
  readonly kind: 'drag' | 'resize'
  readonly edge?: PanelResizeEdge
  readonly pointerId: number
  readonly x: number
  readonly y: number
  readonly layout: PanelLayout
  readonly captureTarget: HTMLElement
}

const DEFAULT_BOUNDS: PanelBounds = { width: 1200, height: 800, anchorRight: 1200 }
const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, [role="button"]'

function readLayout(): PanelLayout {
  if (typeof window === 'undefined') return DEFAULT_PANEL_LAYOUT
  try {
    const value = window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY)
    return value === null ? DEFAULT_PANEL_LAYOUT : parsePanelLayout(value)
  } catch {
    return DEFAULT_PANEL_LAYOUT
  }
}

function writeLayout(layout: PanelLayout): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // Browser storage is optional; in-memory layout remains usable.
  }
}

function measuredBounds(element: HTMLElement | null): PanelBounds {
  if (element === null) return DEFAULT_BOUNDS
  const width = element.clientWidth || element.parentElement?.clientWidth || window.innerWidth || DEFAULT_BOUNDS.width
  const height = element.clientHeight || element.parentElement?.clientHeight || window.innerHeight || DEFAULT_BOUNDS.height
  return { width, height, anchorRight: width }
}

function activityKey(current: unknown, teamId: unknown): string {
  return `${String(current)}:${String(teamId)}`
}

export function AgentTeamActivityPanel({ useSessions, openMember }: AgentTeamActivityPanelProps): JSX.Element | null {
  const current = useSessions(state => state.current)
  const team = useSessions(state =>
    state.current === undefined ? undefined : state.byId[state.current]?.projectionValues?.agentTeam,
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const pointerOperation = useRef<PointerOperation | null>(null)
  const activityLifetime = useRef<string | null>(null)
  const manuallyCollapsed = useRef(false)
  const [layout, setLayout] = useState<PanelLayout>(readLayout)
  const [bounds, setBounds] = useState<PanelBounds>(DEFAULT_BOUNDS)
  const [expanded, setExpanded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)

  const qualifies = team !== undefined && team !== null && qualifiesForActivityPanel(team)
  const key = qualifies && team !== null && team !== undefined ? activityKey(current, team.teamId) : null

  useEffect(() => {
    if (key === null) {
      activityLifetime.current = null
      manuallyCollapsed.current = false
      setExpanded(false)
      return
    }
    if (activityLifetime.current !== key) {
      activityLifetime.current = key
      manuallyCollapsed.current = false
      setExpanded(true)
    }
  }, [key])

  const measure = useCallback(() => setBounds(measuredBounds(rootRef.current)), [])
  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (rootRef.current !== null) observer?.observe(rootRef.current)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, qualifies])

  useEffect(() => {
    const open = () => {
      if (qualifies) setExpanded(true)
    }
    window.addEventListener(OPEN_AGENT_TEAM_ACTIVITY_PANEL_EVENT, open)
    return () => window.removeEventListener(OPEN_AGENT_TEAM_ACTIVITY_PANEL_EVENT, open)
  }, [qualifies])

  useEffect(() => writeLayout(layout), [layout])

  const compact = compactPanelForBounds(bounds)
  const geometry = resolvePanelGeometry(layout, bounds)
  const view = useMemo(() => team === undefined || team === null || !qualifies ? null : activityPanelView(team), [qualifies, team])

  const collapse = () => {
    manuallyCollapsed.current = true
    setExpanded(false)
  }

  const updateLayout = (next: PanelLayout) => {
    setLayout(next)
    writeLayout(next)
  }

  const toggleMode = () => updateLayout(layout.mode === 'docked'
    ? floatPanelLayout(layout, bounds)
    : dockPanelLayout(layout, bounds))

  const beginPointer = (
    event: ReactPointerEvent<HTMLElement>,
    kind: PointerOperation['kind'],
    edge?: PanelResizeEdge,
  ) => {
    if (compact || event.button !== 0 || (event.target as Element).closest(INTERACTIVE_SELECTOR) !== null) return
    pointerOperation.current = { kind, edge, pointerId: event.pointerId, x: event.clientX, y: event.clientY, layout, captureTarget: event.currentTarget }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(kind === 'drag')
    setResizing(kind === 'resize')
  }

  const movePointer = (event: ReactPointerEvent<HTMLElement>) => {
    const operation = pointerOperation.current
    if (operation === null || operation.pointerId !== event.pointerId) return
    const dx = event.clientX - operation.x
    const dy = event.clientY - operation.y
    updateLayout(operation.kind === 'drag'
      ? movePanelLayout(operation.layout, dx, dy, bounds)
      : resizePanelLayout(operation.layout, operation.edge ?? 'corner', dx, dy, bounds))
  }

  const clearPointerOperation = () => {
    pointerOperation.current = null
    setDragging(false)
    setResizing(false)
  }

  const endPointer = (event: ReactPointerEvent<HTMLElement>) => {
    const operation = pointerOperation.current
    if (operation === null || operation.pointerId !== event.pointerId) return
    if (operation.captureTarget.hasPointerCapture?.(event.pointerId)) {
      operation.captureTarget.releasePointerCapture?.(event.pointerId)
    }
    clearPointerOperation()
  }

  if (!qualifies || team === undefined || team === null || view === null) return null

  if (!expanded) {
    return (
      <div ref={rootRef} className={styles.root}>
        <button type="button" className={styles.badge} aria-label="Open team activity" onClick={() => setExpanded(true)}>
          <span className={styles.statusDot} aria-hidden="true" />
          {view.overview.activeTaskCount} active · {view.overview.blockedTaskCount} blocked
        </button>
      </div>
    )
  }

  const panelStyle = {
    left: geometry.x,
    top: geometry.y,
    width: geometry.width,
    height: geometry.height,
  } satisfies CSSProperties

  return (
    <div ref={rootRef} className={styles.root}>
      <section
        ref={panelRef}
        role="complementary"
        aria-label="Team activity"
        className={styles.panel}
        style={panelStyle}
        data-panel-mode={layout.mode}
        data-compact={String(compact)}
        data-dragging={String(dragging)}
        data-resizing={String(resizing)}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <header className={styles.header}>
          {!compact && (
            <div
              className={styles.dragHandle}
              data-testid="panel-drag-handle"
              onPointerDown={event => beginPointer(event, 'drag')}
              onLostPointerCapture={clearPointerOperation}
            >
              <span className={styles.statusDot} aria-hidden="true" />
              <div><strong>Team activity</strong><small>{team.teamId}</small></div>
            </div>
          )}
          {compact && <div className={styles.title}><span className={styles.statusDot} aria-hidden="true" /><strong>Team activity</strong></div>}
          <div className={styles.headerActions}>
            {!compact && <button type="button" onClick={toggleMode}>{layout.mode === 'docked' ? 'Float' : 'Dock'}</button>}
            <button type="button" aria-label="Collapse team activity" onClick={collapse}>Collapse</button>
          </div>
        </header>

        <div className={styles.content}>
          <section className={styles.overview} aria-labelledby="activity-overview-heading">
            <h2 id="activity-overview-heading">Overview</h2>
            <p>{view.overview.overview}</p>
            <div className={styles.metrics}>
              <span><strong>{view.overview.healthScore}</strong> health</span>
              <span><strong>{view.overview.memberCount}</strong> members</span>
              <span><strong>{view.overview.activeTaskCount}</strong> active</span>
              <span><strong>{view.overview.blockedTaskCount}</strong> blocked</span>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="activity-priorities-heading">
            <h2 id="activity-priorities-heading">Priorities</h2>
            {view.priorities.map(priority => (
              <article className={styles.row} data-testid="activity-priority" key={priority.taskId}>
                <strong>{priority.subject}</strong>
                <small>{priority.readiness} · {priority.severity}</small>
              </article>
            ))}
            {view.fallback !== null && <p className={styles.fallback}>{view.fallback.message}</p>}
          </section>

          <section className={styles.section} aria-labelledby="activity-members-heading">
            <h2 id="activity-members-heading">Members</h2>
            {view.members.map(member => (
              <button
                type="button"
                className={styles.memberRow}
                aria-label={`Open member ${member.memberName}`}
                key={member.memberId}
                onClick={() => openMember(String(member.memberId))}
              >
                <span><strong>{member.memberName}</strong><small>{member.level}</small></span>
                <span>{member.activeTaskCount} active</span>
              </button>
            ))}
          </section>

          <section className={styles.section} aria-labelledby="activity-tasks-heading">
            <h2 id="activity-tasks-heading">Active and blocked tasks</h2>
            {view.tasks.map(taskRow => (
              <article className={styles.row} key={`${taskRow.category}:${taskRow.taskId}`}>
                <strong>{taskRow.subject}</strong>
                <small>{taskRow.category} · {taskRow.status}</small>
              </article>
            ))}
          </section>
        </div>

        {!compact && layout.mode === 'floating' && (
          <>
            <div className={`${styles.resizeHandle} ${styles.resizeLeft}`} data-testid="panel-resize-handle" onPointerDown={event => beginPointer(event, 'resize', 'left')} onLostPointerCapture={clearPointerOperation} />
            <div className={`${styles.resizeHandle} ${styles.resizeBottom}`} onPointerDown={event => beginPointer(event, 'resize', 'bottom')} onLostPointerCapture={clearPointerOperation} />
            <div className={`${styles.resizeHandle} ${styles.resizeCorner}`} onPointerDown={event => beginPointer(event, 'resize', 'corner')} onLostPointerCapture={clearPointerOperation} />
          </>
        )}
      </section>
    </div>
  )
}
