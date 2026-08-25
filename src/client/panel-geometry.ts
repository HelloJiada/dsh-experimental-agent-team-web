export type PanelMode = 'docked' | 'floating'
export type PanelResizeEdge = 'left' | 'bottom' | 'corner'

export interface PanelBounds {
  readonly width: number
  readonly height: number
  readonly anchorRight: number
}

export interface PanelLayout {
  readonly mode: PanelMode
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly manualHeight: boolean
}

export interface PanelGeometry {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export const PANEL_LAYOUT_STORAGE_KEY = 'dsh-agent-team:activity-panel:v1'
export const PANEL_COMPACT_BREAKPOINT = 960
export const PANEL_DEFAULT_WIDTH = 388
export const PANEL_DEFAULT_HEIGHT = 640
export const PANEL_MIN_WIDTH = 320
export const PANEL_MAX_WIDTH = 640
export const PANEL_MIN_HEIGHT = 360
export const PANEL_DOCK_TOP = 64
export const PANEL_DOCK_RIGHT = 18
export const PANEL_DOCK_BOTTOM = 48
export const PANEL_FLOAT_MARGIN = 12

export const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  mode: 'docked',
  x: 0,
  y: 0,
  width: PANEL_DEFAULT_WIDTH,
  height: PANEL_DEFAULT_HEIGHT,
  manualHeight: false,
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max))

export function parsePanelLayout(value: string): PanelLayout {
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed === null || typeof parsed !== 'object') return DEFAULT_PANEL_LAYOUT
    const candidate = parsed as Record<string, unknown>
    if (
      (candidate.mode !== 'docked' && candidate.mode !== 'floating') ||
      !isFiniteNumber(candidate.x) ||
      !isFiniteNumber(candidate.y) ||
      !isFiniteNumber(candidate.width) ||
      !isFiniteNumber(candidate.height) ||
      typeof candidate.manualHeight !== 'boolean'
    ) return DEFAULT_PANEL_LAYOUT
    return {
      mode: candidate.mode,
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: candidate.height,
      manualHeight: candidate.manualHeight,
    }
  } catch {
    return DEFAULT_PANEL_LAYOUT
  }
}

export function compactPanelForBounds(bounds: PanelBounds): boolean {
  return bounds.width <= PANEL_COMPACT_BREAKPOINT
}

export function panelUsesAutoHeight(layout: PanelLayout): boolean {
  return !layout.manualHeight
}

export function panelMaximumHeight(layout: PanelLayout, bounds: PanelBounds): number {
  if (compactPanelForBounds(bounds)) return Math.max(1, bounds.height - PANEL_FLOAT_MARGIN * 2)
  if (layout.mode === 'docked') return Math.max(1, bounds.height - PANEL_DOCK_TOP - PANEL_DOCK_BOTTOM - PANEL_FLOAT_MARGIN)
  return Math.max(1, bounds.height - PANEL_FLOAT_MARGIN * 2)
}

function visibleGeometry(geometry: PanelGeometry, bounds: PanelBounds): PanelGeometry {
  const maxWidth = Math.max(1, bounds.width - PANEL_FLOAT_MARGIN * 2)
  const maxHeight = Math.max(1, bounds.height - PANEL_FLOAT_MARGIN * 2)
  const width = clamp(geometry.width, 1, maxWidth)
  const height = clamp(geometry.height, 1, maxHeight)
  return {
    width,
    height,
    x: clamp(geometry.x, PANEL_FLOAT_MARGIN, bounds.width - PANEL_FLOAT_MARGIN - width),
    y: clamp(geometry.y, PANEL_FLOAT_MARGIN, bounds.height - PANEL_FLOAT_MARGIN - height),
  }
}

export function resolvePanelGeometry(layout: PanelLayout, bounds: PanelBounds): PanelGeometry {
  if (compactPanelForBounds(bounds)) {
    return {
      x: PANEL_FLOAT_MARGIN,
      y: PANEL_FLOAT_MARGIN,
      width: Math.max(1, bounds.width - PANEL_FLOAT_MARGIN * 2),
      height: Math.max(1, bounds.height - PANEL_FLOAT_MARGIN * 2),
    }
  }
  if (layout.mode === 'docked') {
    const width = clamp(layout.width, PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, bounds.width - PANEL_FLOAT_MARGIN * 2))
    const height = panelUsesAutoHeight(layout)
      ? Math.max(1, bounds.height - PANEL_DOCK_TOP - PANEL_DOCK_BOTTOM - PANEL_FLOAT_MARGIN)
      : clamp(layout.height, PANEL_MIN_HEIGHT, panelMaximumHeight(layout, bounds))
    return visibleGeometry({
      x: bounds.anchorRight - PANEL_DOCK_RIGHT - width,
      y: PANEL_DOCK_TOP,
      width,
      height,
    }, bounds)
  }
  const width = clamp(layout.width, PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, bounds.width - PANEL_FLOAT_MARGIN * 2))
  const height = panelUsesAutoHeight(layout)
    ? Math.max(1, bounds.height - PANEL_FLOAT_MARGIN * 2)
    : clamp(layout.height, PANEL_MIN_HEIGHT, panelMaximumHeight(layout, bounds))
  return visibleGeometry({ x: layout.x, y: layout.y, width, height }, bounds)
}

export function floatPanelLayout(layout: PanelLayout, bounds: PanelBounds): PanelLayout {
  const geometry = resolvePanelGeometry(layout, bounds)
  return { ...layout, mode: 'floating', ...geometry }
}

export function dockPanelLayout(layout: PanelLayout, bounds: PanelBounds): PanelLayout {
  const geometry = resolvePanelGeometry({ ...layout, mode: 'docked' }, bounds)
  return { ...layout, mode: 'docked', x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height }
}

export function movePanelLayout(layout: PanelLayout, dx: number, dy: number, bounds: PanelBounds): PanelLayout {
  const current = resolvePanelGeometry(layout, bounds)
  const geometry = visibleGeometry({ ...current, x: current.x + dx, y: current.y + dy }, bounds)
  return { ...layout, mode: 'floating', ...geometry }
}

export function resizePanelLayout(
  layout: PanelLayout,
  edge: PanelResizeEdge,
  dx: number,
  dy: number,
  bounds: PanelBounds,
): PanelLayout {
  const current = resolvePanelGeometry({ ...layout, mode: 'floating' }, bounds)
  let geometry: PanelGeometry
  if (edge === 'left') {
    const right = current.x + current.width
    const width = clamp(current.width - dx, 1, Math.min(PANEL_MAX_WIDTH, right - PANEL_FLOAT_MARGIN))
    geometry = { x: right - width, y: current.y, width, height: current.height }
  } else if (edge === 'bottom') {
    geometry = { ...current, height: clamp(current.height + dy, 1, bounds.height - PANEL_FLOAT_MARGIN - current.y) }
  } else {
    geometry = {
      ...current,
      width: clamp(current.width + dx, 1, bounds.width - PANEL_FLOAT_MARGIN - current.x),
      height: clamp(current.height + dy, 1, bounds.height - PANEL_FLOAT_MARGIN - current.y),
    }
  }
  return { ...layout, mode: 'floating', manualHeight: edge !== 'left' || layout.manualHeight, ...visibleGeometry(geometry, bounds) }
}
