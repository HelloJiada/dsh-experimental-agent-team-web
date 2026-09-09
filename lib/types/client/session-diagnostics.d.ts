/** Safe, public-message-only diagnostics for historical session navigation. */
export type TeamHistoryDiagnosticState = 'healthy' | 'legacy-session-events' | 'unavailable';
export interface TeamHistoryDiagnostic {
    readonly state: TeamHistoryDiagnosticState;
    readonly code: string;
    readonly sessionRef: string;
    readonly detail?: string;
}
export declare function redactDiagnosticText(value: string): string;
export declare function healthyDiagnostic(): TeamHistoryDiagnostic;
export declare function classifySessionFailure(error: unknown, options: {
    sessionId: string;
}): TeamHistoryDiagnostic;
export declare function relevantDiagnostic(teams: readonly {
    readonly members: readonly {
        readonly id: string;
    }[];
}[], diagnostics: ReadonlyMap<string, TeamHistoryDiagnostic>, _currentSessionId: string): TeamHistoryDiagnostic | undefined;
export declare function memberNavigationDisabled(diagnostics: ReadonlyMap<string, TeamHistoryDiagnostic>, memberId: string): boolean;
export declare function diagnosticBannerText(diagnostic: TeamHistoryDiagnostic, t: (key: 'history.diagnostic.legacy' | 'history.diagnostic.unavailable') => string): string;
export declare function diagnosticClipboardText(diagnostic: TeamHistoryDiagnostic): string;
/**
 * Panel reaction to one navigation attempt. The floater may only hide when the
 * navigation actually opened; a failure keeps the panel (and its retry entry
 * point) visible so a transient error can never deadlock navigation.
 */
export declare function navigationPanelEffect(opened: boolean): {
    hidePanel: boolean;
    keepRetry: boolean;
};
//# sourceMappingURL=session-diagnostics.d.ts.map