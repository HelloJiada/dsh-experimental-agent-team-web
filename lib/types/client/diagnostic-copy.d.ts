export type DiagnosticCopyResult = 'copied' | 'failed';
export declare function copyDiagnosticText(text: string, clipboard?: Pick<Clipboard, 'writeText'> | undefined): Promise<DiagnosticCopyResult>;
//# sourceMappingURL=diagnostic-copy.d.ts.map