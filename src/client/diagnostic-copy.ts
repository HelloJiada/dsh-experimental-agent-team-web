export type DiagnosticCopyResult = 'copied' | 'failed'

export async function copyDiagnosticText(
  text: string,
  clipboard: Pick<Clipboard, 'writeText'> | undefined = typeof navigator === 'undefined' ? undefined : navigator.clipboard,
): Promise<DiagnosticCopyResult> {
  if (clipboard === undefined) return 'failed'
  try {
    await clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}
