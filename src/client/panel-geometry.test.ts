import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PANEL_LAYOUT,
  PANEL_MAX_WIDTH,
  compactPanelForBounds,
  dockPanelLayout,
  floatPanelLayout,
  movePanelLayout,
  panelMaximumHeight,
  panelUsesAutoHeight,
  parsePanelLayout,
  resizePanelLayout,
  resolvePanelGeometry,
} from './panel-geometry.js'

const wide = { width: 1440, height: 900, anchorRight: 1200 }

describe('activity panel geometry', () => {
  it('falls back for malformed persisted state', () => {
    expect(parsePanelLayout('{')).toEqual(DEFAULT_PANEL_LAYOUT)
    expect(parsePanelLayout(JSON.stringify({ mode: 'docked' }))).toEqual(DEFAULT_PANEL_LAYOUT)
  })

  it('uses safe-margin compact geometry at or below 960px', () => {
    expect(compactPanelForBounds({ width: 960, height: 800, anchorRight: 960 })).toBe(true)
    const compact = resolvePanelGeometry(DEFAULT_PANEL_LAYOUT, { width: 960, height: 800, anchorRight: 960 })
    expect(compact).toMatchObject({ x: 12, y: 12, width: 936, height: 776 })
  })

  it('clamps floating moves and every resize edge inside bounds', () => {
    const floating = floatPanelLayout(DEFAULT_PANEL_LAYOUT, wide)
    expect(movePanelLayout(floating, 10000, 10000, wide).x).toBeLessThanOrEqual(wide.width - 12)
    for (const edge of ['left', 'bottom', 'corner'] as const) {
      const resized = resizePanelLayout(floating, edge, 10000, 10000, wide)
      expect(resized.width).toBeGreaterThanOrEqual(1)
      expect(resized.height).toBeGreaterThanOrEqual(1)
      expect(resizePanelLayout(floating, edge, -10000, -10000, wide).x).toBeGreaterThanOrEqual(12)
    }
  })

  it('uses automatic height for docked and initially floating layouts', () => {
    expect(panelUsesAutoHeight(DEFAULT_PANEL_LAYOUT)).toBe(true)
    expect(panelUsesAutoHeight(dockPanelLayout(floatPanelLayout(DEFAULT_PANEL_LAYOUT, wide), wide))).toBe(true)
    expect(panelMaximumHeight(DEFAULT_PANEL_LAYOUT, wide)).toBe(wide.height - 64 - 48 - 12)
  })

  it('keeps automatic height until bottom or corner resize', () => {
    const floating = floatPanelLayout(DEFAULT_PANEL_LAYOUT, wide)
    expect(panelUsesAutoHeight(movePanelLayout(floating, 20, 20, wide))).toBe(true)
    expect(panelUsesAutoHeight(resizePanelLayout(floating, 'left', 20, 20, wide))).toBe(true)
    expect(panelUsesAutoHeight(resizePanelLayout(floating, 'bottom', 20, 20, wide))).toBe(false)
    expect(panelUsesAutoHeight(resizePanelLayout(floating, 'corner', 20, 20, wide))).toBe(false)
  })

  it('restores automatic height when docking a manually resized floating panel', () => {
    const manuallyResized = resizePanelLayout(floatPanelLayout(DEFAULT_PANEL_LAYOUT, wide), 'bottom', 20, 20, wide)
    expect(manuallyResized.manualHeight).toBe(true)
    const docked = dockPanelLayout(manuallyResized, wide)
    expect(docked.manualHeight).toBe(false)
    expect(panelUsesAutoHeight({ ...docked, manualHeight: true })).toBe(true)
  })

  it('caps corner resize width at the panel maximum', () => {
    const extraWide = { width: 1800, height: 900, anchorRight: 1600 }
    const starting = floatPanelLayout({ ...DEFAULT_PANEL_LAYOUT, mode: 'floating', x: 100, y: 100 }, extraWide)
    const resized = resizePanelLayout(starting, 'corner', 10000, 0, extraWide)
    expect(resized.width).toBe(PANEL_MAX_WIDTH)
  })

  it('uses reduced compact margins when a full safe margin cannot fit', () => {
    const compact = resolvePanelGeometry(DEFAULT_PANEL_LAYOUT, { width: 20, height: 18, anchorRight: 20 })
    expect(compact.x).toBeGreaterThanOrEqual(0)
    expect(compact.y).toBeGreaterThanOrEqual(0)
    expect(compact.x + compact.width).toBeLessThanOrEqual(20)
    expect(compact.y + compact.height).toBeLessThanOrEqual(18)
  })

  it('preserves a visible rectangle when converting between docked and floating modes', () => {
    const floating = floatPanelLayout(DEFAULT_PANEL_LAYOUT, wide)
    const redocked = dockPanelLayout(floating, wide)
    const refloated = floatPanelLayout(redocked, wide)
    expect(redocked.x).toBeGreaterThanOrEqual(12)
    expect(redocked.y).toBeGreaterThanOrEqual(12)
    expect(refloated.x).toBeGreaterThanOrEqual(12)
    expect(refloated.y).toBeGreaterThanOrEqual(12)
    expect(refloated.x + refloated.width).toBeLessThanOrEqual(wide.width - 12)
    expect(refloated.y + refloated.height).toBeLessThanOrEqual(wide.height - 12)
  })
})
