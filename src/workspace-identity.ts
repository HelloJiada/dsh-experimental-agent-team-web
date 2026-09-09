/** Canonical workspace identity helpers shared by host snapshot and close. */
import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'

export async function canonicalWorkspaceId(stateRoot: string): Promise<string> {
  const canonical = await realpath(stateRoot)
  return `ws_${createHash('sha256').update(canonical).digest('base64url')}`
}

export function workspaceIdForCanonicalPath(canonicalPath: string): string {
  return `ws_${createHash('sha256').update(canonicalPath).digest('base64url')}`
}
