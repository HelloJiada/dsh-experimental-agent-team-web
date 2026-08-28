import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PANEL_LAYOUT,
  PANEL_DOCK_RIGHT,
  PANEL_FLOAT_MARGIN,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  compactPanelForBounds,
  dockPanelLayout,
  floatPanelLayout,
  movePanelLayout,
  panelDockAnchor,
  panelMaximumHeight,
  panelUsesAutoHeight,
  parsePanelLayout,
  resizePanelLayout,
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

describe('R-17: parsePanelLayout / compactPanelForBounds / panelUsesAutoHeight / panelMaximumHeight', () => {
  it('parsePanelLayout:null/非法 JSON/坏形状 → 默认布局', () => {
    expect(parsePanelLayout(null)).toEqual(DEFAULT_PANEL_LAYOUT)
    expect(parsePanelLayout('not-json')).toEqual(DEFAULT_PANEL_LAYOUT)
    expect(parsePanelLayout('42')).toEqual(DEFAULT_PANEL_LAYOUT)
    expect(parsePanelLayout(JSON.stringify({ mode: 'weird', x: 1, y: 2, width: 3, height: 4 }))).toEqual(DEFAULT_PANEL_LAYOUT)
    expect(parsePanelLayout(JSON.stringify({ mode: 'floating', x: 'a', y: 2, width: 3, height: 4 }))).toEqual(DEFAULT_PANEL_LAYOUT)
  })

  it('parsePanelLayout:合法 floating+manual → 保留;其余 heightMode 归 auto', () => {
    const manual = parsePanelLayout(JSON.stringify({ mode: 'floating', x: 10, y: 20, width: 388, height: 640, heightMode: 'manual' }))
    expect(manual).toMatchObject({ mode: 'floating', x: 10, y: 20, width: 388, height: 640, heightMode: 'manual' })
    // docked 或未写 heightMode 的旧值 → auto(升级去除旧空白)。
    expect(parsePanelLayout(JSON.stringify({ mode: 'docked', x: 0, y: 64, width: 388, height: 640, heightMode: 'manual' })).heightMode).toBe('auto')
    expect(parsePanelLayout(JSON.stringify({ mode: 'floating', x: 0, y: 64, width: 388, height: 640 })).heightMode).toBe('auto')
  })

  it('compactPanelForBounds:窄于等于断点即紧凑', () => {
    expect(compactPanelForBounds({ width: 960, height: 800, anchorRight: 0 })).toBe(true)
    expect(compactPanelForBounds({ width: 959, height: 800, anchorRight: 0 })).toBe(true)
    expect(compactPanelForBounds({ width: 961, height: 800, anchorRight: 0 })).toBe(false)
  })

  it('panelUsesAutoHeight:紧凑/docked/auto 模式恒 true;floating+manual 才 false', () => {
    const bounds = { width: 1200, height: 800, anchorRight: 1000 }
    expect(panelUsesAutoHeight({ ...DEFAULT_PANEL_LAYOUT, mode: 'floating', heightMode: 'manual' }, bounds)).toBe(false)
    expect(panelUsesAutoHeight({ ...DEFAULT_PANEL_LAYOUT, mode: 'floating', heightMode: 'auto' }, bounds)).toBe(true)
    expect(panelUsesAutoHeight({ ...DEFAULT_PANEL_LAYOUT, mode: 'docked', heightMode: 'manual' }, bounds)).toBe(true)
    expect(panelUsesAutoHeight({ ...DEFAULT_PANEL_LAYOUT, mode: 'floating', heightMode: 'manual' }, { width: 800, height: 600, anchorRight: 700 })).toBe(true)
  })

  it('panelMaximumHeight:floating/紧凑用 float margin,docked 用 dock bottom', () => {
    const bounds = { width: 1200, height: 900, anchorRight: 1000 }
    const floating = panelMaximumHeight({ ...DEFAULT_PANEL_LAYOUT, mode: 'floating', y: 100 }, bounds)
    expect(floating).toBe(900 - 100 - PANEL_FLOAT_MARGIN)
    const docked = panelMaximumHeight({ ...DEFAULT_PANEL_LAYOUT, mode: 'docked', y: 100 }, bounds)
    expect(docked).toBe(900 - 100 - 48)
  })
})

describe('R-17: floatPanelLayout / dockPanelLayout / movePanelLayout / resizePanelLayout', () => {
  const bounds = { width: 1200, height: 900, anchorRight: 1000 }

  it('floatPanelLayout:按当前矩形转 floating,不再跳变', () => {
    const docked = resolvePanelGeometry({ ...DEFAULT_PANEL_LAYOUT, mode: 'docked' }, bounds)
    const floated = floatPanelLayout(docked, bounds)
    expect(floated.mode).toBe('floating')
    // 转换后坐标仍在壳内(钳制生效)。
    expect(floated.x).toBeGreaterThanOrEqual(PANEL_FLOAT_MARGIN)
    expect(floated.y).toBeGreaterThanOrEqual(PANEL_FLOAT_MARGIN)
  })

  it('dockPanelLayout:回到 dock,高度模式复位 auto', () => {
    const docked = dockPanelLayout(
      { ...DEFAULT_PANEL_LAYOUT, mode: 'floating', heightMode: 'manual', x: 500, y: 300 },
      bounds,
    )
    expect(docked.mode).toBe('docked')
    expect(docked.heightMode).toBe('auto')
  })

  it('movePanelLayout:平移 floating 并钳回壳内', () => {
    const moved = movePanelLayout(
      { ...DEFAULT_PANEL_LAYOUT, mode: 'floating', x: 400, y: 200 },
      100,
      50,
      bounds,
    )
    expect(moved.x).toBe(500)
    expect(moved.y).toBe(248) // 900 - 640 - 12(浮动边距)上限
    // 拖出界外会被钳回。
    const clamped = movePanelLayout(
      { ...DEFAULT_PANEL_LAYOUT, mode: 'floating', x: 400, y: 200 },
      5000,
      5000,
      bounds,
    )
    expect(clamped.x).toBeLessThanOrEqual(bounds.width - PANEL_FLOAT_MARGIN)
    expect(clamped.y).toBeLessThanOrEqual(bounds.height - PANEL_FLOAT_MARGIN)
  })

  it('resizePanelLayout:docked 左缘拉伸改宽度;非 left 边 docked 保持原样', () => {
    const dockedStart = { ...DEFAULT_PANEL_LAYOUT, mode: 'docked' as const, width: 388 }
    const resized = resizePanelLayout(dockedStart, 'left', 50, 0, bounds)
    expect(resized.width).toBe(338)
    const bottom = resizePanelLayout(dockedStart, 'bottom', 0, 100, bounds)
    expect(bottom.width).toBe(388)
  })

  it('resizePanelLayout:floating 各边——left 改宽不动右缘/bottom 改高置 manual/corner 双向', () => {
    const start = { ...DEFAULT_PANEL_LAYOUT, mode: 'floating' as const, x: 400, y: 200, width: 388, height: 640, heightMode: 'auto' as const }
    const left = resizePanelLayout(start, 'left', 40, 0, bounds)
    expect(left.width).toBe(348)
    expect(left.x + left.width).toBe(400 + 388) // 右缘不动
    const bottom = resizePanelLayout(start, 'bottom', 0, 40, bounds)
    expect(bottom.height).toBe(680)
    expect(bottom.heightMode).toBe('manual')
    const corner = resizePanelLayout(start, 'corner', 20, 30, bounds)
    expect(corner.width).toBe(408)
    expect(corner.height).toBe(670)
    expect(corner.heightMode).toBe('manual')
  })

  it('resizePanelLayout:floating 缩到最小尺寸被钳制', () => {
    const start = { ...DEFAULT_PANEL_LAYOUT, mode: 'floating' as const, x: 400, y: 200, width: 388, height: 640, heightMode: 'auto' as const }
    const tiny = resizePanelLayout(start, 'corner', -500, -500, bounds)
    expect(tiny.width).toBeGreaterThanOrEqual(PANEL_MIN_WIDTH - 1)
    expect(tiny.height).toBeGreaterThanOrEqual(PANEL_MIN_HEIGHT - 1)
  })
})
