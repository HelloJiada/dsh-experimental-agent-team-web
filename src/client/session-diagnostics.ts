/** Safe, public-message-only diagnostics for historical session navigation. */
export type TeamHistoryDiagnosticState = 'healthy' | 'legacy-session-events' | 'unavailable'

export interface TeamHistoryDiagnostic {
  readonly state: TeamHistoryDiagnosticState
  readonly code: string
  readonly sessionRef: string
  readonly detail?: string
}

const LEGACY_CUES = /unknown event|unsupported event|legacy|migration|format/i
const ABSOLUTE_PATH = /(?:file:\/\/)?\/[^\s'"`<>]+|[A-Za-z]:[\\/][^\s'"`<>]+|\\\\[^\s'"`<>]+/g
const TOKEN_RUN = /[A-Za-z0-9_-]{32,}/g

export function redactDiagnosticText(value: string): string {
  return value
    .replace(ABSOLUTE_PATH, '[path]')
    .replace(TOKEN_RUN, '[token]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

function sessionReference(sessionId: string): string {
  const value = sessionId.trim()
  return value === '' ? 'unknown' : `${value.slice(0, 8)}…`
}

export function healthyDiagnostic(): TeamHistoryDiagnostic {
  return { state: 'healthy', code: 'healthy', sessionRef: '' }
}

export function classifySessionFailure(error: unknown, options: { sessionId: string }): TeamHistoryDiagnostic {
  const detail = error instanceof Error ? error.message : String(error)
  const state: TeamHistoryDiagnosticState = LEGACY_CUES.test(detail) ? 'legacy-session-events' : 'unavailable'
  return {
    state,
    code: state === 'legacy-session-events' ? 'legacy-session-events' : 'session-unavailable',
    sessionRef: sessionReference(options.sessionId),
    detail: redactDiagnosticText(detail),
  }
}

export function relevantDiagnostic(
  teams: readonly { readonly members: readonly { readonly id: string }[] }[],
  diagnostics: ReadonlyMap<string, TeamHistoryDiagnostic>,
  _currentSessionId: string,
): TeamHistoryDiagnostic | undefined {
  for (const team of teams) {
    for (const member of team.members) {
      const diagnostic = diagnostics.get(member.id)
      if (diagnostic !== undefined) return diagnostic
    }
  }
  return undefined
}

export function memberNavigationDisabled(diagnostics: ReadonlyMap<string, TeamHistoryDiagnostic>, memberId: string): boolean {
  return memberId !== '' && diagnostics.has(memberId)
}

export function diagnosticBannerText(
  diagnostic: TeamHistoryDiagnostic,
  t: (key: 'history.diagnostic.legacy' | 'history.diagnostic.unavailable') => string,
): string {
  return t(diagnostic.state === 'legacy-session-events' ? 'history.diagnostic.legacy' : 'history.diagnostic.unavailable')
}

export function diagnosticClipboardText(diagnostic: TeamHistoryDiagnostic): string {
  return [diagnostic.code, diagnostic.state, diagnostic.sessionRef, diagnostic.detail ?? ''].join(' · ')
}

/**
 * Panel reaction to one navigation attempt. The floater may only hide when the
 * navigation actually opened; a failure keeps the panel (and its retry entry
 * point) visible so a transient error can never deadlock navigation.
 */
export function navigationPanelEffect(opened: boolean): { hidePanel: boolean; keepRetry: boolean } {
  return opened ? { hidePanel: true, keepRetry: false } : { hidePanel: false, keepRetry: true }
}
