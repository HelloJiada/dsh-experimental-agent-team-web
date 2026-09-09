import { describe, expect, it } from 'vitest'
import {
  clearHistoryDiagnostic,
  getHistoryDiagnosticsSnapshot,
  recordHistoryDiagnostic,
  subscribeHistoryDiagnostics,
} from './activity-monitor.ts'
import { healthyDiagnostic } from './session-diagnostics.ts'

describe('history diagnostics store', () => {
  it('records, notifies, keys by child, and clears', () => {
    const diagnostic = { ...healthyDiagnostic(), state: 'unavailable' as const, code: 'session-unavailable', sessionRef: 'child-1' }
    let notifications = 0
    const unsubscribe = subscribeHistoryDiagnostics(() => { notifications += 1 })
    recordHistoryDiagnostic('child-1', diagnostic)
    expect(getHistoryDiagnosticsSnapshot().get('child-1')).toBe(diagnostic)
    expect(getHistoryDiagnosticsSnapshot().has('captain')).toBe(false)
    clearHistoryDiagnostic('child-1')
    expect(getHistoryDiagnosticsSnapshot().has('child-1')).toBe(false)
    expect(notifications).toBe(2)
    unsubscribe()
  })
})
