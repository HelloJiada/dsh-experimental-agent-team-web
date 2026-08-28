import { describe, expect, it } from 'vitest'
import {
  buildTaskRetro,
  currentTaskElapsedApprox,
  currentTaskElapsedMs,
  resolveTaskTiming,
  retroCalibrationHint,
  retroPendingCalibration,
  summarizeTeamRetro,
  taskElapsedMs,
  taskTimingState,
} from '../src/retro.ts'
import type { TeamMember, TeamTask } from '../src/types.ts'

function task(id: string, overrides: Partial<TeamTask> = {}): TeamTask {
  return {
    id,
    subject: `任务${id}`,
    status: 'completed',
    dependencies: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

const member = (name: string, role: string): TeamMember => ({
  id: `session-${name}`,
  name,
  role,
  joinedAt: 1000,
  status: 'idle',
})

describe('taskTimingState — 超时档位(等级/毫秒预算口径)', () => {
  it('无预估恒为 ok', () => {
    expect(taskTimingState(undefined, undefined, 5000)).toBe('ok')
    expect(taskTimingState('L', undefined, 999_999_999)).toBe('ok')
  })

  it('实际 <= 预算为 ok(毫秒口径)', () => {
    expect(taskTimingState(undefined, 60_000, 60_000)).toBe('ok')
    expect(taskTimingState(undefined, 60_000, 30_000)).toBe('ok')
  })

  it('等级口径:S 预算 15m / M 预算 45m', () => {
    expect(taskTimingState('S', undefined, 15 * 60_000)).toBe('ok')
    expect(taskTimingState('S', undefined, 15 * 60_000 + 1)).toBe('warn')
    expect(taskTimingState('M', undefined, 45 * 60_000)).toBe('ok')
    expect(taskTimingState('M', undefined, 45 * 60_000 + 1)).toBe('warn')
  })

  it('实际 > 预算(<=1.5x)为 warn(超预算)', () => {
    expect(taskTimingState(undefined, 60_000, 61_000)).toBe('warn')
    expect(taskTimingState(undefined, 60_000, 90_000)).toBe('warn')
  })

  it('实际 > 预算 1.5 倍为 over(严重超时)', () => {
    expect(taskTimingState(undefined, 60_000, 90_001)).toBe('over')
    expect(taskTimingState(undefined, 60_000, 180_000)).toBe('over')
    expect(taskTimingState('S', undefined, 15 * 60_000 * 1.5 + 1)).toBe('over')
  })
})

describe('taskElapsedMs / currentTaskElapsedMs — 耗时取值', () => {
  it('已完成取实际耗时,进行中取 now - claimedAt', () => {
    expect(taskElapsedMs({ actualMs: 5000 }, 999_999)).toBe(5000)
    expect(taskElapsedMs({ claimedAt: 1000 }, 61_000)).toBe(60_000)
    expect(taskElapsedMs({}, 61_000)).toBe(0)
  })

  it('缺 claimedAt 的旧任务回退 updatedAt 近似', () => {
    expect(taskElapsedMs({ updatedAt: 1000 }, 61_000)).toBe(60_000)
    expect(taskElapsedMs({ updatedAt: 0 }, 61_000)).toBe(61_000)
  })

  it('currentTaskElapsedMs 只统计成员 in_progress 任务', () => {
    const tasks = [
      task('t1', { status: 'completed', assignee: 'alice', claimedAt: 0, completedAt: 50_000, actualMs: 50_000 }),
      task('t2', { status: 'in_progress', assignee: 'alice', claimedAt: 10_000 }),
      task('t3', { status: 'in_progress', assignee: 'bob', claimedAt: 20_000 }),
    ]
    expect(currentTaskElapsedMs('alice', tasks, 70_000)).toBe(60_000)
    expect(currentTaskElapsedMs('bob', tasks, 70_000)).toBe(50_000)
    expect(currentTaskElapsedMs('nobody', tasks, 70_000)).toBe(0)
  })

  it('currentTaskElapsedApprox:缺 claimedAt 的 in_progress 为近似,否则精确', () => {
    const legacy = [task('t1', { status: 'in_progress', assignee: 'alice', updatedAt: 10_000 })]
    const fresh = [task('t2', { status: 'in_progress', assignee: 'alice', claimedAt: 10_000 })]
    // task() 默认带 updatedAt:无 claimedAt 也无显式 updatedAt 时仍是近似(有默认 updatedAt)。
    const noTimestamps = [task('t3', { status: 'in_progress', assignee: 'alice', claimedAt: undefined, updatedAt: undefined })]
    expect(currentTaskElapsedApprox('alice', legacy)).toBe(true)
    expect(currentTaskElapsedApprox('alice', fresh)).toBe(false)
    expect(currentTaskElapsedApprox('alice', noTimestamps)).toBe(false)
    expect(currentTaskElapsedApprox('nobody', legacy)).toBe(false)
  })
})

describe('resolveTaskTiming — 结算耗时', () => {
  it('由 claimed→completed 计算 actualMs 与 overrunMs', () => {
    const timing = resolveTaskTiming(
      { estimatedMs: 60_000, claimedAt: 10_000, completedAt: 100_000 },
      999_999,
    )
    expect(timing.completedAt).toBe(100_000)
    expect(timing.actualMs).toBe(90_000)
    expect(timing.overrunMs).toBe(30_000)
  })

  it('completedAt 缺省时用 now 兜底', () => {
    const timing = resolveTaskTiming({ claimedAt: 10_000 }, 70_000)
    expect(timing.completedAt).toBe(70_000)
    expect(timing.actualMs).toBe(60_000)
    expect(timing.overrunMs).toBeUndefined()
  })

  it('无 claimedAt 的旧任务不产生损坏数据', () => {
    const timing = resolveTaskTiming({}, 70_000)
    expect(timing.completedAt).toBe(70_000)
    expect(timing.actualMs).toBeUndefined()
    expect(timing.overrunMs).toBeUndefined()
  })
})

describe('buildTaskRetro — 自动复盘生成', () => {
  it('超时任务自动归因 underestimated 并给出校准建议', () => {
    const retro = buildTaskRetro(
      { estimatedMs: 3_600_000, claimedAt: 10_000, completedAt: 5_770_000 },
      undefined,
      5_770_000,
    )
    expect(retro.overran).toBe(true)
    expect(retro.cause).toBe('underestimated')
    expect(retro.actualMs).toBe(5_760_000)
    expect(retro.overrunMs).toBe(2_160_000)
    expect(retro.summary).toContain('超时完成')
    expect(retro.summary).toContain('实际 1h 36m')
    expect(retro.summary).toContain('预估 1h 00m')
    expect(retro.recommendation).toContain('1.3~1.5 倍')
  })

  it('按预期完成归因 on_time,摘要含"按预期"', () => {
    const retro = buildTaskRetro(
      { estimatedMs: 60_000, claimedAt: 10_000, completedAt: 40_000 },
      undefined,
      40_000,
    )
    expect(retro.overran).toBe(false)
    expect(retro.cause).toBe('on_time')
    expect(retro.estimateLevel).toBeUndefined()
    expect(retro.summary).toContain('按预期完成')
    expect(retro.summary).toContain('提前')
  })

  it('等级口径:含预估等级/等级偏差/边界标注', () => {
    const retro = buildTaskRetro(
      {
        attempt: 2,
        estimateLevel: 'S',
        estimatedMs: 10 * 60_000,
        claimedAt: 10_000,
        completedAt: 40 * 60_000 + 10_000,
        status: 'completed',
        retroNote: '先读测试再动手,省一半时间',
        includesGateWait: true,
        hasHelper: true,
      },
      undefined,
      40 * 60_000 + 10_000,
    )
    expect(retro.attempt).toBe(2)
    expect(retro.estimateLevel).toBe('S')
    expect(retro.levelDeviation).toBe(1) // 实际 40m → M,预估 S → +1
    expect(retro.overran).toBe(true)     // 40m > S 预算 15m
    expect(retro.retroNote).toBe('先读测试再动手,省一半时间')
    expect(retro.includesGateWait).toBe(true)
    expect(retro.hasHelper).toBe(true)
    expect(retro.summary).toContain('含等待')
    expect(retro.summary).toContain('有 helper 介入')
    expect(retro.recommendation).toContain('1.3~1.5 倍')
  })

  it('cancelled 记耗时不推经验:cause=other、建议为空', () => {
    const retro = buildTaskRetro(
      { estimateLevel: 'M', claimedAt: 10_000, completedAt: 100_000, status: 'cancelled' },
      undefined,
      100_000,
    )
    expect(retro.cause).toBe('other')
    expect(retro.recommendation).toBe('')
    expect(retro.overran).toBe(false) // 90s 未超 M 预算,但仍归 other
  })

  it('显式原因优先于数字推导', () => {
    const retro = buildTaskRetro(
      { estimatedMs: 60_000, claimedAt: 10_000, completedAt: 200_000 },
      'dependency-blocked',
      200_000,
    )
    expect(retro.overran).toBe(true)
    expect(retro.cause).toBe('dependency-blocked')
    expect(retro.recommendation).toContain('依赖')
  })

  it('无预估任务也能生成复盘', () => {
    const retro = buildTaskRetro({ claimedAt: 10_000, completedAt: 40_000 }, undefined, 40_000)
    expect(retro.overran).toBe(false)
    expect(retro.estimatedMs).toBeUndefined()
    expect(retro.summary).toContain('未设预估')
  })
})

describe('summarizeTeamRetro / retroCalibrationHint — 团队校准统计', () => {
  it('按角色×等级统计平均实际耗时与超时率', () => {
    const tasks = [
      task('t1', { assignee: '技术员一号', claimedAt: 0, completedAt: 60_000, actualMs: 60_000, estimatedMs: 60_000 }),
      task('t2', { assignee: '技术员一号', claimedAt: 0, completedAt: 180_000, actualMs: 180_000, estimatedMs: 60_000 }),
      task('t3', { assignee: '研究员', claimedAt: 0, completedAt: 30_000, actualMs: 30_000, estimatedMs: 30_000 }),
      task('t4', { status: 'in_progress', assignee: '技术员一号' }),
    ]
    const summary = summarizeTeamRetro(tasks, [member('技术员一号', 'engineer'), member('研究员', 'researcher')])
    expect(summary.completedWithTiming).toBe(3)
    expect(summary.overranCount).toBe(1)
    expect(summary.avgActualMs).toBe(90_000)
    expect(summary.overallOverrunRatio).toBeCloseTo(1 / 3)
    const engineer = summary.byRole.find(entry => entry.role === 'engineer')
    expect(engineer?.taskCount).toBe(2)
    expect(engineer?.avgActualMs).toBe(120_000)
    expect(engineer?.overrunRatio).toBeCloseTo(0.5)
    // 等级口径:engineer × ms(无等级任务按 ms 分组)。
    const engineerLevel = summary.byRoleLevel.find(entry => entry.role === 'engineer')
    expect(engineerLevel?.taskCount).toBe(2)
    expect(engineerLevel?.avgActualMs).toBe(120_000)
    const hint = retroCalibrationHint(summary)
    expect(hint).toContain('3 个任务')
    expect(hint).toContain('上调一档')
  })

  it('冷启动:样本不足 2 个不输出校准结论', () => {
    const tasks = [
      task('t1', { assignee: '技术员一号', claimedAt: 0, completedAt: 60_000, actualMs: 60_000, estimatedMs: 60_000 }),
    ]
    const summary = summarizeTeamRetro(tasks, [member('技术员一号', 'engineer')])
    expect(summary.completedWithTiming).toBe(1)
    expect(retroCalibrationHint(summary)).toContain('样本不足')
  })

  it('无结算任务时给出引导性提示', () => {
    const summary = summarizeTeamRetro([task('t1')])
    expect(summary.completedWithTiming).toBe(0)
    expect(summary.byRole).toHaveLength(0)
    expect(retroCalibrationHint(summary)).toContain('样本不足')
  })
})

describe('retroPendingCalibration — 复盘质量闭环「待校准」判定', () => {
  const doneRetro = buildTaskRetro(
    { estimatedMs: 60_000, claimedAt: 10_000, completedAt: 100_000 },
    undefined,
    100_000,
  )

  it('high 已完成 + 无 retro_note + 无 captainVerdict → 待校准', () => {
    const t = task('t1', { status: 'completed', riskLevel: 'high', retro: doneRetro })
    expect(retroPendingCalibration(t)).toBe(true)
  })

  it('critical 同样判定待校准', () => {
    const t = task('t1', { status: 'completed', riskLevel: 'critical', retro: doneRetro })
    expect(retroPendingCalibration(t)).toBe(true)
  })

  it('failed 同样判定待校准(cancelled 除外)', () => {
    const t = task('t1', { status: 'failed', riskLevel: 'high', retro: doneRetro })
    expect(retroPendingCalibration(t)).toBe(true)
  })

  it('有成员经验(retro_note)不待校准', () => {
    const withNote = buildTaskRetro(
      { estimatedMs: 60_000, claimedAt: 10_000, completedAt: 100_000, retroNote: '先读测试再动手' },
      undefined,
      100_000,
    )
    const t = task('t1', { status: 'completed', riskLevel: 'high', retro: withNote })
    expect(retroPendingCalibration(t)).toBe(false)
  })

  it('有队长校准(captainVerdict)不待校准', () => {
    const calibrated = { ...doneRetro, captainVerdict: 'useful' as const }
    const t = task('t1', { status: 'completed', riskLevel: 'high', retro: calibrated })
    expect(retroPendingCalibration(t)).toBe(false)
  })

  it('低/中风险不待校准', () => {
    expect(retroPendingCalibration(task('t1', { status: 'completed', riskLevel: 'low', retro: doneRetro }))).toBe(false)
    expect(retroPendingCalibration(task('t1', { status: 'completed', riskLevel: 'medium', retro: doneRetro }))).toBe(false)
  })

  it('cancelled 不推经验,不标待校准', () => {
    const cancelledRetro = buildTaskRetro(
      { status: 'cancelled', estimatedMs: 60_000, claimedAt: 10_000, completedAt: 100_000 },
      undefined,
      100_000,
    )
    const t = task('t1', { status: 'cancelled', riskLevel: 'high', retro: cancelledRetro })
    expect(retroPendingCalibration(t)).toBe(false)
  })

  it('无 retro 或未设风险级恒为 false', () => {
    expect(retroPendingCalibration(task('t1', { status: 'completed' }))).toBe(false)
    expect(retroPendingCalibration(task('t1', { status: 'completed', retro: doneRetro }))).toBe(false)
  })
})
