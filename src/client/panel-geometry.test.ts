import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PANEL_LAYOUT,
  PANEL_DOCK_RIGHT,
  panelDockAnchor,
  resolvePanelGeometry,
} from './panel-geometry.ts'

describe('panelDockAnchor — docked 右锚点（details 展开时不得吸附到 shell 右缘）', () => {
  it('已就绪对话：锚点 = 对话右缘（相对 overlay 左缘）', () => {
    expect(panelDockAnchor(1920, 1920, 1540)).toBe(1540)
  })

  it('对话右缘超出 shell：钳制到 overlay 宽度', () => {
    expect(panelDockAnchor(0, 1920, 2500)).toBe(1920)
  })

  it('对话右缘为负：钳制到 0', () => {
    expect(panelDockAnchor(0, 1920, -40)).toBe(0)
  })

  it('无已就绪对话（hero/settling）：保留上一次锚点，不再回退到 shell 右缘', () => {
    // 回归用例：详情列打开后对话宽度收窄到 1540，若此时没有
    // [data-phase=active] 节点，旧实现会把锚点回退成全宽 1920，
    // docked 面板会盖在 details 列上。
    expect(panelDockAnchor(1540, 1920, null)).toBe(1540)
  })

  it('无已就绪对话且上一次锚点超出新 shell：钳制到宽度', () => {
    expect(panelDockAnchor(1920, 1200, null)).toBe(1200)
  })

  it('无已就绪对话且上一次锚点为负：钳制到 0', () => {
    expect(panelDockAnchor(-50, 1200, null)).toBe(0)
  })

  it('overlay 宽度非正：按 1px 处理并钳制', () => {
    expect(panelDockAnchor(10, 0, 5)).toBe(1)
    expect(panelDockAnchor(10, -3, null)).toBe(1)
  })
})

describe('resolvePanelGeometry — docked 分支与 details 展开后的锚点联动', () => {
  it('details 打开（对话右缘 1540）时 docked 面板贴合对话右缘，而非 shell 右缘', () => {
    // 1920 宽 shell，右侧 380px 为 details 列；对话右缘 1540。
    const bounds = { width: 1920, height: 900, anchorRight: 1540 }
    const geometry = resolvePanelGeometry({ ...DEFAULT_PANEL_LAYOUT, mode: 'docked' }, bounds)
    // x = anchorRight - PANEL_DOCK_RIGHT - width = 1540 - 18 - 388
    expect(geometry.x).toBe(1540 - PANEL_DOCK_RIGHT - DEFAULT_PANEL_LAYOUT.width)
    // 面板右缘必须落在 details 列左边（< 1540），绝不能盖住 details。
    expect(geometry.x + geometry.width).toBeLessThanOrEqual(1540)
  })

  it('锚点 = 全宽（旧回退行为）时面板会盖住 details 列——回归保护', () => {
    const bounds = { width: 1920, height: 900, anchorRight: 1920 }
    const geometry = resolvePanelGeometry({ ...DEFAULT_PANEL_LAYOUT, mode: 'docked' }, bounds)
    expect(geometry.x).toBe(1920 - PANEL_DOCK_RIGHT - DEFAULT_PANEL_LAYOUT.width)
    // 右缘 1902 > 对话右缘 1540：面板压到 details 列上——这正是被修复的异常。
    expect(geometry.x + geometry.width).toBeGreaterThan(1540)
  })
})
