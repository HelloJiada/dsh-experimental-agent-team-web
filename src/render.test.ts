/**
 * render.ts 纯函数测试:R-33 序列化收敛 + R-36 updatedAt 回退。
 *
 * serializeSignals/serializeRetro 抽自 update_task 输出与 status 输出,
 * 此处直测 snake_case 形状与 undefined 展开语义;renderStatus 的
 * updated_at 回退验证旧团队 in_progress 任务显示近似耗时。
 * @module dsh-agent-team-web/render.test
 */

import { describe, expect, it } from 'vitest'
import { renderStatus, serializeRetro, serializeSignals } from './render.ts'

describe('serializeSignals / serializeRetro — R-33 公共序列化', () => {
  it('undefined 输入返回空对象(可直接展开)', () => {
    expect(serializeSignals(undefined)).toEqual({})
    expect(serializeRetro(undefined)).toEqual({})
  })

  it('signals 映射为 snake_case,缺省键不输出', () => {
    expect(serializeSignals({
      turns: 3,
      outputBytes: 240,
      selfReport: '深挖了 1400 行 CSS',
    })).toEqual({
      signals: {
        turns: 3,
        output_bytes: 240,
        self_report: '深挖了 1400 行 CSS',
      },
    })
    expect(serializeSignals({ outputBytes: 0 })).toEqual({
      signals: { output_bytes: 0 },
    })
  })

  it('retro 映射为 snake_case,可选键不输出', () => {
    const retro = {
      attempt: 2,
      actualMs: 12_000,
      estimateLevel: 'S' as const,
      estimatedMs: 10_000,
      overrunMs: 2_000,
      levelDeviation: 1,
      overran: true,
      cause: 'underestimated' as const,
      summary: '超预算完成',
      retroNote: '先读测试',
      recommendation: '下次按 1.3 倍预估',
      includesGateWait: true,
      hasHelper: true,
      createdAt: 1000,
    }
    expect(serializeRetro(retro)).toEqual({
      retro: {
        attempt: 2,
        actual_ms: 12_000,
        estimate_level: 'S',
        estimated_ms: 10_000,
        overrun_ms: 2_000,
        level_deviation: 1,
        overran: true,
        cause: 'underestimated',
        summary: '超预算完成',
        retro_note: '先读测试',
        recommendation: '下次按 1.3 倍预估',
        includes_gate_wait: true,
        has_helper: true,
        created_at: 1000,
      },
    })
  })
})

describe('renderStatus — R-36 updatedAt 回退', () => {
  const base = {
    team_name: '测试团队',
    viewer: 'captain',
    members: [],
    captain_inbox: [],
    member_inboxes: {},
    mailbox_warnings: [],
    mailbox_warning_count: 0,
  }

  it('旧团队 in_progress 任务(无 claimed_at)以 updated_at 回退显示近似 used', () => {
    const text = renderStatus({
      ...base,
      tasks: [{
        id: 't1',
        subject: '旧任务',
        status: 'in_progress',
        assignee: '技术员',
        dependencies: [],
        attempt: 1,
        attempt_id: '',
        reassigning: false,
        updated_at: Date.now() - 60_000,
      }],
    })
    // 旧行为:无 claimed_at → 不显示 used;R-36 后回退 updatedAt 显示近似耗时。
    expect(text).toContain('used ')
    expect(text).not.toContain('used 0m')
  })

  it('无任何时间戳的 in_progress 任务仍不显示 used(与旧行为一致)', () => {
    const text = renderStatus({
      ...base,
      tasks: [{
        id: 't1',
        subject: '无时间戳',
        status: 'in_progress',
        assignee: '技术员',
        dependencies: [],
        attempt: 1,
        attempt_id: '',
        reassigning: false,
      }],
    })
    expect(text).not.toContain('used ')
  })
})
