/**
 * R-18/H-2: member state-dir isolation at the tool dispatch boundary.
 *
 * `toolFilter` can only deny tools by *name*, not by *path* — so a member's
 * read/edit/write/bash tools are not restricted by the subagent filter alone.
 * This module installs a `tools/execute` wrapper that inspects the target
 * path of file-touching tools invoked **by a member agent** and denies any
 * call that resolves inside the team state directory (`<workspace>/<stateDir>`).
 *
 * The guard is defense-in-depth over the persona instruction: it cannot parse
 * free-form `bash` command strings reliably, so bash is checked heuristically
 * for stateRoot references; structured tools (read/write/edit/glob/grep) get
 * an exact resolved-path deny. A member that needs team state is directed to
 * `agent_teams_status`, which is the sanctioned read path.
 * @module dsh-agent-team-web/member-state-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDispatchExecution, ToolExecutionResult, ToolFailure } from '@deepseek-ai/dsh-tools'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/** File-touching tools whose target paths the guard inspects. */
const GUARDED_TOOLS: ReadonlySet<string> = new Set(['read', 'write', 'edit', 'glob', 'grep'])

/**
 * Whether a resolved candidate path is inside the state root. Both sides are
 * resolved absolute paths; a prefix match is refused (a state dir sibling
 * like `.agent-team-web-2` must not match `.agent-team-web`).
 */
export function isUnderStateRoot(candidate: string, stateRoot: string): boolean {
  if (candidate === stateRoot) return true
  if (!candidate.startsWith(stateRoot)) return false
  const rest = candidate.slice(stateRoot.length)
  return rest.startsWith(sep) || rest.startsWith('/') || rest.startsWith('\\')
}

/** The state root for one member workspace. */
export function stateRootOf(workspace: string, stateDir: string): string {
  return resolve(workspace, stateDir)
}

/** Resolve a possibly-relative tool argument against the member workspace. */
function resolveAgainstWorkspace(workspace: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  return isAbsolute(value) ? value : resolve(workspace, value)
}

/**
 * One dispatch-time denial decision for a member-invoked tool.
 * @param toolName - the invoked tool name.
 * @param args - the parsed tool arguments (already deep-frozen by the registry).
 * @param workspace - the calling member's workspace root.
 * @param stateDir - the configured state directory name.
 * @returns a denial message when the call targets the state directory, else undefined.
 */
export function memberStateDenial(
  toolName: string,
  args: Record<string, unknown>,
  workspace: string,
  stateDir: string,
): string | undefined {
  const stateRoot = stateRootOf(workspace, stateDir)
  // Structured tools: exact path deny.
  if (GUARDED_TOOLS.has(toolName)) {
    const candidate = toolName === 'glob' || toolName === 'grep'
      ? resolveAgainstWorkspace(workspace, args['path'])
      : resolveAgainstWorkspace(workspace, args['file_path'])
    if (candidate !== undefined && isUnderStateRoot(candidate, stateRoot)) {
      return `AgentTeams: "${toolName}" is denied for the team state directory (${stateRoot}) — read team state via agent_teams_status instead`
    }
    return undefined
  }
  // Free-form bash: heuristic reference scan. A command string that names the
  // state root (absolute, or a stateDir-relative path segment) is refused;
  // obfuscated indirection cannot be caught here and remains a documented
  // limitation of the shared-workspace model.
  if (toolName === 'bash') {
    const command = typeof args['command'] === 'string' ? args['command'] : ''
    const workdir = resolveAgainstWorkspace(workspace, args['workdir'])
    if (command === '' && workdir === undefined) return undefined
    const stateRootText = stateRoot
    const stateDirName = stateDir.split(sep).filter(Boolean).join(sep)
    // The stateDir basename as a standalone word (path segment, quoted, or
    // followed by a separator/space/end) is refused even without an explicit
    // separator — e.g. `cd .agent-team-web && ls` or `rm -rf .agent-team-web`.
    const stateDirToken = stateDirName === '' ? null : new RegExp(`(^|[\\s"'${escapeRegExp(sep)}/])${escapeRegExp(stateDirName)}([\\s"'${escapeRegExp(sep)}/]|$)`)
    const referencesStateRoot = command.includes(stateRootText)
      || (stateDirToken !== null && stateDirToken.test(command))
    const workdirInside = workdir !== undefined && isUnderStateRoot(workdir, stateRoot)
    if (referencesStateRoot || workdirInside) {
      return `AgentTeams: "bash" referencing the team state directory (${stateRoot}) is denied — read team state via agent_teams_status instead`
    }
  }
  return undefined
}

/** Escape regex special characters in a literal string fragment. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Member agent session ids the guard denies state access for. */
const memberAgentIds = new Set<string>()

/** Register one member agent id (called on spawn and on cold resume). */
export function registerMemberAgent(id: string): void {
  if (id !== '') memberAgentIds.add(id)
}

/** Unregister a member agent id (called on remove/delete). */
export function unregisterMemberAgent(id: string): void {
  memberAgentIds.delete(id)
}

/** Whether a session id is a live team member the guard protects. */
export function isMemberAgent(id: string): boolean {
  return memberAgentIds.has(id)
}

/** Build the denial result shape the registry expects. */
function denialResult(message: string): ToolExecutionResult {
  const failure: ToolFailure = { message }
  return {
    isError: true,
    error: failure,
    content: [{ type: 'text', text: message }],
  } as ToolExecutionResult
}

/**
 * Install the dispatch-time state-dir guard for member agents.
 * @param ctx - the plugin context (injects `tools`).
 * @param stateDir - the configured state directory name.
 * @returns a disposer removing the wrapper.
 */
export function installMemberStateGuard(ctx: Context, stateDir: string): () => void {
  const handler = async (
    exec: ToolDispatchExecution,
    next: () => Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult> => {
    const agent = exec.agent
    if (agent === undefined || !memberAgentIds.has(agent.id)) return next()
    const workspace = agent.session.header.cwd ?? process.cwd()
    const denial = memberStateDenial(exec.name, exec.arguments as Record<string, unknown>, workspace, stateDir)
    if (denial === undefined) return next()
    return denialResult(denial)
  }
  const disposer = ctx.on('tools/execute', handler)
  // Test harnesses stub ctx.on with a no-op returning undefined; the real
  // cordis registry returns a disposer. Guard both shapes.
  return () => { if (typeof disposer === 'function') disposer() }
}
