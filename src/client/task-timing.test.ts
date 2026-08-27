import { describe, expect, it } from 'vitest'
import type { AgentTeamsTranslate } from './locales.ts'
import {
  memberTimingState,
  taskElapsedMs,
  taskSignalsText,
  taskTimingState,
  taskTimingText,
} from './task-timing.ts'
import type { ActivityMember, ActivityTask } from './activity-monitor.ts'

const t: AgentTeamsTranslate = (key, params = {}) => {
  const templates: Record<string, string> = {
    'timing.estimated': '预估 {value}',
    'timing.actual': '实际 {value}',
    'timing.elapsed': '已用 {value}',
    'timing.overrun': '超时 {value}',
    'timing.memberElapsed': '已耗时 {value}',
    'timing.signals': '产出信号：回合 {turns} 次 · 工具 {toolCalls} · 输出 {bytes} 字符',
    'timing.selfReport': '成员自报：{note}',
  }
  const template = templates[key]
  if (template === undefined) return key
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''))
}

function task(overrides: Partial<ActivityTask> = {}): ActivityTask {
  return {
    id: 't1',
    subject: '任务t1',
    status: 'in_progress',
    state: 'running',
    assignee: '技术员一号',
    dependencies: [],
    depth: 0,
    ...overrides,
  }
}

describe('taskTimingState — 等级优先口径', () => {
  it('S 等级预算 15m:超出即 warn,超 1.5 倍即 over', () => {
    const base = task({ estimateLevel: 'S', claimedAt: 0 })
    expect(taskTimingState(base, 15 * 60_000)).toBe('ok')
    expect(taskTimingState(base, 15 * 60_000 + 1)).toBe('warn')
    expect(taskTimingState(base, 15 * 60_000 * 1.5 + 1)).toBe('over')
  })

  it('L 等级无上限时回落内部毫秒', () => {
    const base = task({ estimateLevel: 'L', estimatedMs: 60_000, claimedAt: 0 })
    expect(taskTimingState(base, 61_000)).toBe('warn')
    expect(taskTimingState(base, 90_001)).toBe('over')
  })

  it('无预估恒为 ok;已完成取实际耗时', () => {
    expect(taskTimingState(task(), 999_999)).toBe('ok')
    const done = task({ status: 'completed', state: 'completed', estimateLevel: 'S', actualMs: 10 * 60_000 })
    expect(taskTimingState(done, 999_999)).toBe('ok')
    const overran = task({ status: 'completed', state: 'completed', estimateLevel: 'S', actualMs: 30 * 60_000 })
    expect(taskTimingState(overran, 999_999)).toBe('over')
  })
})

describe('taskElapsedMs / memberTimingState', () => {
  it('进行中取 now - claimedAt;成员行按当前任务判定', () => {
    expect(taskElapsedMs(task({ claimedAt: 10_000 }), 70_000)).toBe(60_000)
    const member: ActivityMember = {
      id: 'm1', name: '技术员一号', role: 'engineer', status: 'working',
      activity: 'working', progress: 0, done: 0, total: 1,
      currentTask: 't1', currentTaskElapsedMs: 60_000, unread: 0,
    }
    expect(memberTimingState(member, [task({ estimateLevel: 'S', claimedAt: 0 })], 20 * 60_000)).toBe('warn')
  })
})

describe('taskTimingText / taskSignalsText — 面板文本', () => {
  it('等级预估文本 + 已用', () => {
    const text = taskTimingText(task({ estimateLevel: 'S', claimedAt: 0 }), t, 12 * 60_000)
    expect(text).toBe('预估 S(≤15m) · 已用 12m')
  })

  it('完成态:预估 vs 实际 + 超时偏差', () => {
    const done = task({
      status: 'completed', state: 'completed',
      estimateLevel: 'S', estimatedMs: 10 * 60_000, actualMs: 20 * 60_000,
    })
    expect(taskTimingText(done, t)).toBe('预估 S(≤15m) · 实际 20m · 超时 10m')
  })

  it('产出信号行:回合/工具/输出/自报', () => {
    const signals = taskSignalsText(task({ signals: { turns: 3, toolCalls: 5, outputBytes: 240, selfReport: '深挖了 1400 行 CSS' } }), t)
    expect(signals).toContain('回合 3 次')
    expect(signals).toContain('工具 5')
    expect(signals).toContain('240 字符')
    expect(signals).toContain('深挖了 1400 行 CSS')
  })
})
