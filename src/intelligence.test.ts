import { describe, expect, it } from 'vitest'
import { analyzeTeamSnapshot, type TeamIntelligence } from '../src/intelligence.ts'
import type { TeamActivitySnapshot } from '../src/snapshot.ts'

function snapshot(overrides: Partial<TeamActivitySnapshot> = {}): TeamActivitySnapshot {
  return {
    workspace: '/workspace',
    teamId: 'team-1',
    name: '测试团队',
    captainSessionId: 'session-captain',
    members: [],
    tasks: [],
    messageCount: 0,
    captainInbox: [],
    ...overrides,
  }
}

const member = (name: string, overrides: Record<string, unknown> = {}) => ({
  id: `session-${name}`,
  name,
  role: 'engineer',
  status: 'working' as const,
  activity: 'working' as const,
  progress: 50,
  done: 1,
  total: 2,
  currentTask: '',
  currentTaskElapsedMs: 0,
  currentTaskElapsedApprox: false,
  unread: 0,
  ...overrides,
})

const task = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  subject: `任务${id}`,
  status: 'pending' as const,
  state: 'open' as const,
  assignee: '',
  dependencies: [] as string[],
  depth: 0,
  ...overrides,
})

describe('analyzeTeamSnapshot — 融合智能分析层', () => {
  it('健康团队:100 分 · 运行平稳 · 无优先干预 · 无命令建议', () => {
    const intelligence = analyzeTeamSnapshot(snapshot({
      members: [member('alice')],
      tasks: [task('t1', { status: 'completed', state: 'completed' })],
    }))
    expect(intelligence.health.score).toBe(100)
    expect(intelligence.health.statusLabel).toBe('运行平稳')
    expect(intelligence.priorities).toHaveLength(0)
    expect(intelligence.commandPlan.total).toBe(0)
    expect(intelligence.milestones.latestTitle).toBe('任务t1')
  })

  it('阻塞任务:P1 优先干预 + unblock 命令 + 健康扣分', () => {
    const intelligence = analyzeTeamSnapshot(snapshot({
      members: [member('alice')],
      tasks: [
        task('t1', { status: 'in_progress', state: 'running', assignee: 'alice' }),
        task('t2', { status: 'pending', state: 'blocked', dependencies: ['t1'], depth: 1 }),
      ],
    }))
    expect(intelligence.priorities[0]?.taskId).toBe('t2')
    expect(intelligence.priorities[0]?.readiness).toBe('blocked')
    expect(intelligence.priorities[0]?.interventionPriority).toBe(1)
    expect(intelligence.commandPlan.commands.some(c => c.kind === 'task:unblock' && c.targetId === 't2')).toBe(true)
    expect(intelligence.health.score).toBeLessThan(100)
  })

  it('无 owner 的 in_progress 任务:stalled + claim 命令', () => {
    const intelligence = analyzeTeamSnapshot(snapshot({
      members: [member('alice')],
      tasks: [task('t1', { status: 'in_progress', state: 'running', assignee: '' })],
    }))
    expect(intelligence.priorities[0]?.readiness).toBe('stalled')
    expect(intelligence.commandPlan.commands.some(c => c.kind === 'task:claim')).toBe(true)
  })

  it('owner 不存在的任务:orphaned + reassign 命令', () => {
    const intelligence = analyzeTeamSnapshot(snapshot({
      members: [member('alice')],
      tasks: [task('t1', { status: 'in_progress', state: 'running', assignee: 'ghost' })],
    }))
    expect(intelligence.priorities[0]?.readiness).toBe('orphaned')
    expect(intelligence.commandPlan.commands.some(c => c.kind === 'task:reassign')).toBe(true)
  })

  it('成员负载:active/pending/stalled 分段计数与档位', () => {
    const intelligence = analyzeTeamSnapshot(snapshot({
      members: [
        member('busy', { status: 'working' }),
        member('idle', { status: 'idle', activity: 'idle' }),
      ],
      tasks: [
        task('t1', { status: 'in_progress', state: 'running', assignee: 'busy' }),
        task('t2', { status: 'in_progress', state: 'running', assignee: 'busy' }),
        task('t3', { status: 'pending', state: 'open', assignee: 'busy' }),
      ],
    }))
    const busy = intelligence.memberLoads.find(load => load.memberName === 'busy')
    expect(busy?.activeTaskCount).toBe(2)
    expect(busy?.pendingOwnedTaskCount).toBe(1)
    expect(busy?.level).toBe('stretched')
    expect(intelligence.memberLoads[0]?.memberName).toBe('busy')
  })

  it('移除成员的高风险消息:redeliver/broadcast 命令', () => {
    const intelligence = analyzeTeamSnapshot(snapshot({
      members: [member('alice'), member('gone', { status: 'removed' })],
      captainInbox: [{ from: 'gone', content: '请立即处理阻塞' }],
      messageCount: 1,
    }))
    const risk = intelligence.messageRisks.find(r => r.from === 'gone')
    expect(risk?.riskLevel).toBe('high')
    expect(intelligence.commandPlan.commands.some(c => c.kind === 'message:broadcast')).toBe(true)
    expect(intelligence.health.score).toBeLessThan(100)
  })

  it('里程碑:最新任务标题 + 完成/进行计数', () => {
    const intelligence = analyzeTeamSnapshot(snapshot({
      members: [member('alice')],
      tasks: [
        task('t1', { status: 'completed', state: 'completed' }),
        task('t2', { status: 'in_progress', state: 'running', assignee: 'alice' }),
      ],
    }))
    expect(intelligence.milestones.latestTitle).toBe('任务t2')
    expect(intelligence.milestones.completedTaskCount).toBe(1)
    expect(intelligence.milestones.runningTaskCount).toBe(1)
  })

  it('输出可 JSON 序列化(供宿主消费层)', () => {
    const intelligence: TeamIntelligence = analyzeTeamSnapshot(snapshot({
      members: [member('alice')],
      tasks: [task('t1', { status: 'pending', state: 'open' })],
    }))
    const roundTrip = JSON.parse(JSON.stringify(intelligence)) as TeamIntelligence
    expect(roundTrip.health.score).toBe(intelligence.health.score)
    expect(roundTrip.commandPlan.version).toBe(1)
  })

  it('进行中任务超过预估 1.5 倍:超时提示 + 健康告警', () => {
    const now = Date.now()
    const intelligence = analyzeTeamSnapshot(snapshot({
      members: [member('alice')],
      tasks: [
        task('t1', {
          status: 'in_progress',
          state: 'running',
          assignee: 'alice',
          estimatedMs: 60_000,
          claimedAt: now - 180_000,
        }),
      ],
    }))
    const insight = intelligence.priorities[0]
    expect(insight?.taskId).toBe('t1')
    expect(insight?.severity).toBe('high')
    expect(insight?.reasons.join(' ')).toContain('超时')
    expect(intelligence.health.alerts.join(' ')).toContain('超时')
    expect(intelligence.health.score).toBeLessThan(100)
  })

  it('进行中任务超出预估但未达 1.5 倍:超预算提示,严重度不升到 high', () => {
    const now = Date.now()
    const intelligence = analyzeTeamSnapshot(snapshot({
      members: [member('alice')],
      tasks: [
        task('t1', {
          status: 'in_progress',
          state: 'running',
          assignee: 'alice',
          estimatedMs: 60_000,
          claimedAt: now - 70_000,
        }),
      ],
    }))
    expect(intelligence.priorities[0]?.reasons.join(' ')).toContain('超出预估')
    expect(intelligence.priorities[0]?.reasons.join(' ')).not.toContain('1.5 倍')
  })

  it('已完成超时任务:复盘洞察进入健康告警', () => {
    const intelligence = analyzeTeamSnapshot(snapshot({
      members: [member('alice')],
      tasks: [
        task('t1', {
          status: 'completed',
          state: 'completed',
          assignee: 'alice',
          estimatedMs: 60_000,
          actualMs: 180_000,
          retro: {
            actualMs: 180_000,
            estimatedMs: 60_000,
            overran: true,
            cause: 'underestimated',
            summary: '任务超时完成:实际 3h 00m,预估 1h 00m。',
            recommendation: '下次按 1.3~1.5 倍预估。',
            createdAt: 1,
          },
        }),
      ],
    }))
    expect(intelligence.health.alerts.join(' ')).toContain('已完成任务超时')
    expect(intelligence.health.overview).toContain('超时完成')
  })

  it('无预估的旧数据不受超时逻辑影响', () => {
    const intelligence = analyzeTeamSnapshot(snapshot({
      members: [member('alice')],
      tasks: [
        task('t1', { status: 'in_progress', state: 'running', assignee: 'alice', claimedAt: Date.now() - 999_999_999 }),
      ],
    }))
    expect(intelligence.health.alerts.some(alert => alert.includes('超时'))).toBe(false)
  })
})
