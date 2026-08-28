/**
 * R-34:事件上报静默丢弃修复测试——未识别事件至少 warn 一次,且累计计数
 * 可观测。真实 harness 的 KNOWN_SESSION_EVENT_TYPES 不含 agent-team-web/*
 * (out-of-repo 事件),所以这些事件必走"跳过"分支;修复前仅 debug 一次,
 * 修复后 warn 一次并带上累计总数。
 *
 * skippedEventTypes / skippedEventCount 是模块级累计态,跨用例泄漏会导致
 * 断言依赖执行顺序;beforeEach 重置(见 events.ts resetSkippedEventTracking)。
 * @module dsh-agent-team-web/events.test
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { beforeEach, describe, expect, it } from 'vitest'
import { appendTeamEvent, resetSkippedEventTracking } from './events.ts'

interface WarnCapture {
  warns: string[]
}

function fakeCtx(capture: WarnCapture): Context {
  return {
    logger: {
      warn: (message: string) => { capture.warns.push(message) },
      debug: () => undefined,
    },
  } as unknown as Context
}

function fakeSession(): Session {
  const appends: unknown[] = []
  const session = {
    append: (type: string, data: unknown) => { appends.push({ type, data }) },
  } as unknown as Session
  Object.defineProperty(session, '__appends', { value: appends })
  return session
}

describe('appendTeamEvent — R-34 未识别事件可观测', () => {
  beforeEach(() => {
    resetSkippedEventTracking()
  })

  it('harness 未识别 agent-team-web 事件时至少 warn 一次(不再静默 debug)', () => {
    const capture: WarnCapture = { warns: [] }
    const ctx = fakeCtx(capture)
    const session = fakeSession()
    appendTeamEvent(ctx, session, 'agent-team-web/team-created', {
      teamId: 'team-1',
      captainSessionId: 'session-captain',
      name: '测试团队',
    })
    expect(capture.warns.length).toBeGreaterThanOrEqual(1)
    expect(capture.warns[0]).toContain('agent-team-web/team-created')
    expect(capture.warns[0]).toContain('omitted')
    expect(capture.warns[0]).toContain('skipped in total')
  })

  it('同类型事件只 warn 一次(去重防刷屏),累计计数随不同类型递增', () => {
    const capture: WarnCapture = { warns: [] }
    const ctx = fakeCtx(capture)
    const session = fakeSession()
    appendTeamEvent(ctx, session, 'agent-team-web/team-created', {
      teamId: 'team-1',
      captainSessionId: 'session-captain',
      name: '测试团队',
    })
    appendTeamEvent(ctx, session, 'agent-team-web/team-created', {
      teamId: 'team-1',
      captainSessionId: 'session-captain',
      name: '测试团队',
    })
    appendTeamEvent(ctx, session, 'agent-team-web/task-created', {
      teamId: 'team-1',
      taskId: 't1',
      subject: '任务',
      dependencies: [],
    })
    // 两种不同事件类型只 warn 两次:team-created 去重,再加 task-created。
    expect(capture.warns.length).toBe(2)
    // 累计计数=3(所有被跳过的事件,包括去重后不再打日志的)。
    expect(capture.warns[1]).toContain('3 events skipped in total')
  })
})
