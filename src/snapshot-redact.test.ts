/**
 * R-17/H-1: /state response redaction tests — the anonymous projection strips
 * session identifiers and every field the panel never renders, while the
 * authenticated projection keeps the ids the panel needs for navigation.
 * @module dsh-agent-team-web/snapshot-redact.test
 */

import { describe, expect, it } from 'vitest'
import { redactSnapshotForHttp, type TeamActivitySnapshot } from './snapshot.ts'

function snapshot(overrides: Partial<TeamActivitySnapshot> = {}): TeamActivitySnapshot {
  return {
    workspace: 'w',
    teamId: 'framework-audit',
    name: '测试团队',
    description: 'demo',
    captainSessionId: 'session-captain',
    members: [
      {
        id: 'session-member-1',
        name: '技术员',
        role: 'engineer',
        status: 'idle',
        activity: 'idle',
        progress: 0,
        done: 0,
        total: 1,
        currentTask: '',
        currentTaskElapsedMs: 0,
        currentTaskElapsedApprox: false,
        unread: 0,
      },
    ],
    tasks: [
      {
        id: 't1',
        subject: '安全审查',
        status: 'in_progress',
        state: 'running',
        assignee: '技术员',
        dependencies: [],
        depth: 0,
        estimateLevel: 'M',
        estimatedMs: 30 * 60_000,
        claimedAt: 1000,
        startedAt: 2000,
        signals: { turns: 2, outputBytes: 42 },
        retro: {
          attempt: 1,
          actualMs: 10_000,
          overran: false,
          cause: 'on_time',
          summary: '按预期完成',
          recommendation: '',
          createdAt: 3000,
        },
      },
    ],
    messageCount: 3,
    captainInbox: [
      { from: '技术员', content: '机密消息全文' },
      { from: '质检员', content: '另一条机密消息' },
    ],
    intelligence: {
      health: { score: 90, statusLabel: 'ok', overview: '良好', alerts: [], recommendedActions: [] },
      priorities: [],
      memberLoads: [],
      messageRisks: [
        { from: '技术员', content: '机密消息全文', riskLevel: 'high', reasons: ['测试'] },
      ],
      milestones: { latestTitle: null, completedTaskCount: 0, runningTaskCount: 0 },
      commandPlan: {
        version: 1,
        total: 1,
        highPriorityCount: 1,
        mediumPriorityCount: 0,
        lowPriorityCount: 0,
        commands: [{ id: 'c1', kind: 'member:restart', label: '重启 技术员', targetId: '技术员', targetLabel: '机密消息全文', priority: 'high', rationale: 'x' }],
      },
    },
    bestPractices: [{
      id: 'bp-1', sourceTeamId: 'other', sourceTaskId: 't1', sourceTaskSubject: '别的团队任务', role: 'engineer',
      cause: 'underestimated', practice: '跨团队经验', verdict: 'pending', createdAt: 1, updatedAt: 1,
    }],
    calibration: {
      completedWithTiming: 1,
      byRoleLevel: [{ role: 'engineer', level: 'M', taskCount: 1, avgActualMs: 10_000, overrunRatio: 1.2 }],
    },
    ...overrides,
  }
}

describe('redactSnapshotForHttp — anonymous projection', () => {
  const redacted = redactSnapshotForHttp(snapshot(), false)

  it('blanks captainSessionId and member subagent ids', () => {
    expect(redacted.captainSessionId).toBe('')
    expect(redacted.members[0]?.id).toBe('')
  })

  it('drops inbox full text but keeps messageCount', () => {
    expect(redacted.captainInbox).toEqual([])
    expect(redacted.messageCount).toBe(3)
  })

  it('drops best-practices library and calibration table', () => {
    expect(redacted.bestPractices).toBeUndefined()
    expect(redacted.calibration).toBeUndefined()
  })

  it('strips message-risk content and the command plan', () => {
    expect(redacted.intelligence?.messageRisks[0]?.content).toBe('')
    expect(redacted.intelligence?.messageRisks[0]?.riskLevel).toBe('high')
    expect(redacted.intelligence?.commandPlan.commands).toEqual([])
    expect(redacted.intelligence?.commandPlan.total).toBe(0)
  })

  it('keeps display data the panel renders', () => {
    expect(redacted.teamId).toBe('framework-audit')
    expect(redacted.name).toBe('测试团队')
    expect(redacted.members[0]?.name).toBe('技术员')
    expect(redacted.members[0]?.role).toBe('engineer')
    expect(redacted.intelligence?.health.score).toBe(90)
    expect(redacted.intelligence?.milestones).toBeDefined()
  })

  it('panel completeness whitelist: tasks and their display fields survive redaction', () => {
    // 质检员验收预期 ①:裁剪敏感字段后,面板数据完整性白名单仍须成立——
    // teamId/name/members/tasks 等渲染所需数据一律保留,不能剪秃。
    expect(redacted.tasks).toHaveLength(1)
    const task = redacted.tasks[0]
    expect(task?.id).toBe('t1')
    expect(task?.subject).toBe('安全审查')
    expect(task?.status).toBe('in_progress')
    expect(task?.state).toBe('running')
    expect(task?.assignee).toBe('技术员')
    expect(task?.dependencies).toEqual([])
    expect(task?.depth).toBe(0)
    expect(task?.estimateLevel).toBe('M')
    expect(task?.estimatedMs).toBe(30 * 60_000)
    expect(task?.claimedAt).toBe(1000)
    expect(task?.startedAt).toBe(2000)
    expect(task?.signals).toEqual({ turns: 2, outputBytes: 42 })
    expect(task?.retro?.summary).toBe('按预期完成')
  })

  it('panel completeness whitelist: workspace, description and member fields survive', () => {
    expect(redacted.workspace).toBe('w')
    expect(redacted.description).toBe('demo')
    const member = redacted.members[0]
    expect(member?.name).toBe('技术员')
    expect(member?.role).toBe('engineer')
    expect(member?.status).toBe('idle')
    expect(member?.activity).toBe('idle')
    expect(member?.progress).toBe(0)
    expect(member?.total).toBe(1)
    expect(member?.currentTask).toBe('')
    expect(member?.unread).toBe(0)
  })
})

describe('redactSnapshotForHttp — authenticated projection', () => {
  const full = redactSnapshotForHttp(snapshot(), true)

  it('keeps captainSessionId and member ids (panel navigation/discovery)', () => {
    expect(full.captainSessionId).toBe('session-captain')
    expect(full.members[0]?.id).toBe('session-member-1')
  })

  it('still drops the fields the panel never renders', () => {
    expect(full.captainInbox).toEqual([])
    expect(full.bestPractices).toBeUndefined()
    expect(full.calibration).toBeUndefined()
    expect(full.intelligence?.messageRisks[0]?.content).toBe('')
    expect(full.intelligence?.commandPlan.commands).toEqual([])
  })

  it('preserves messageCount for the panel stat', () => {
    expect(full.messageCount).toBe(3)
  })
})
