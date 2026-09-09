import { describe, expect, it } from 'vitest'
import {
  classifySessionFailure,
  diagnosticBannerText,
  diagnosticClipboardText,
  healthyDiagnostic,
  memberNavigationDisabled,
  navigationPanelEffect,
  redactDiagnosticText,
  relevantDiagnostic,
} from './session-diagnostics.ts'

describe('session diagnostics', () => {
  it('classifies public legacy cues and redacts session reference', () => {
    const diagnostic = classifySessionFailure(new Error('unsupported event in migration format'), { sessionId: 'session-123456' })
    expect(diagnostic.state).toBe('legacy-session-events')
    expect(diagnostic.code).toBe('legacy-session-events')
    expect(diagnostic.sessionRef).toBe('session-…')
  })

  it('classifies other failures as unavailable', () => {
    expect(classifySessionFailure(new Error('network unavailable'), { sessionId: '' })).toEqual({
      state: 'unavailable', code: 'session-unavailable', sessionRef: 'unknown', detail: 'network unavailable',
    })
  })

  it('redacts absolute paths and token-like runs and caps detail', () => {
    const token = 'a'.repeat(40)
    const result = redactDiagnosticText(`/home/alice/a /Volumes/drive/b file:///etc/config C:\\Users\\alice\\secret ${token} ${'x'.repeat(300)}`)
    expect(result).not.toContain('/home/')
    expect(result).not.toContain('/Volumes/')
    expect(result).not.toContain('file:///etc/')
    expect(result).not.toContain('C:\\Users\\')
    expect(result).not.toContain(token)
    expect(result.length).toBeLessThanOrEqual(240)
  })

  it('redacts embedded full session ids and exposes a healthy factory', () => {
    const sessionId = 'session-615e9e1a-b78c-44e5-8f26-56378b751656'
    const diagnostic = classifySessionFailure(new Error(`failed ${sessionId}`), { sessionId })
    expect(diagnostic.detail).not.toContain(sessionId)
    expect(healthyDiagnostic()).toEqual({ state: 'healthy', code: 'healthy', sessionRef: '' })
  })

  it('selects relevant diagnostics and maps disabled navigation/banner text', () => {
    const diagnostic = classifySessionFailure(new Error('unknown event'), { sessionId: 'member-1' })
    const map = new Map([['member-1', diagnostic]])
    expect(relevantDiagnostic([{ members: [{ id: 'member-1' }] }], map, 'captain')).toBe(diagnostic)
    expect(relevantDiagnostic([{ members: [{ id: 'other' }] }], map, 'captain')).toBeUndefined()
    expect(memberNavigationDisabled(map, 'member-1')).toBe(true)
    expect(memberNavigationDisabled(map, 'other')).toBe(false)
    expect(diagnosticBannerText(diagnostic, key => key === 'history.diagnostic.legacy' ? 'legacy text' : 'unavailable text')).toBe('legacy text')
    const unavailable = classifySessionFailure(new Error('network'), { sessionId: 'member-2' })
    expect(diagnosticBannerText(unavailable, key => key === 'history.diagnostic.legacy' ? 'legacy text' : 'unavailable text')).toBe('unavailable text')
  })

  it('clipboard text contains no path or token', () => {
    const diagnostic = classifySessionFailure(new Error('/home/user/private ' + 'b'.repeat(40)), { sessionId: 'child-1' })
    const text = diagnosticClipboardText(diagnostic)
    expect(text).not.toContain('/home/user')
    expect(text).not.toContain('b'.repeat(40))
  })

  it('keeps the panel and retry open on failure, hides only on success', () => {
    expect(navigationPanelEffect(false)).toEqual({ hidePanel: false, keepRetry: true })
    expect(navigationPanelEffect(true)).toEqual({ hidePanel: true, keepRetry: false })
  })

  it('a diagnostic never filters durable team/task/archive data', () => {
    const teams = [{ members: [{ id: 'member-1' }], tasks: [{ id: 't1' }], archived: true }]
    const diagnostic = classifySessionFailure(new Error('unknown event'), { sessionId: 'member-1' })
    const before = JSON.stringify(teams)
    expect(relevantDiagnostic(teams, new Map([['member-1', diagnostic]]), 'captain')).toBe(diagnostic)
    expect(JSON.stringify(teams)).toBe(before)
  })

  it('formats stable copy text', () => {
    const diagnostic = classifySessionFailure('unknown event', { sessionId: 'abcdefgh-123' })
    expect(diagnosticClipboardText(diagnostic)).toBe('legacy-session-events · legacy-session-events · abcdefgh… · unknown event')
  })
})
