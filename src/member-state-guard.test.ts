/**
 * R-18/H-2: member state-dir guard tests — pure denial decisions plus the
 * tools/execute wrapper behavior.
 * @module dsh-agent-team-web/member-state-guard.test
 */

import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  installMemberStateGuard,
  isUnderStateRoot,
  memberStateDenial,
  registerMemberAgent,
  stateRootOf,
  unregisterMemberAgent,
} from './member-state-guard.ts'

const WORKSPACE = '/ws/team-a'
const STATE_DIR = '.agent-team-web'
const STATE_ROOT = stateRootOf(WORKSPACE, STATE_DIR)

describe('isUnderStateRoot — boundary-safe prefix check', () => {
  it('matches the root itself and descendants', () => {
    expect(isUnderStateRoot(STATE_ROOT, STATE_ROOT)).toBe(true)
    expect(isUnderStateRoot(join(STATE_ROOT, 'team.json'), STATE_ROOT)).toBe(true)
    expect(isUnderStateRoot(join(STATE_ROOT, 'inbox', 'captain.jsonl'), STATE_ROOT)).toBe(true)
  })

  it('refuses sibling prefixes', () => {
    expect(isUnderStateRoot(`${STATE_ROOT}-2/team.json`, STATE_ROOT)).toBe(false)
    expect(isUnderStateRoot(join(WORKSPACE, '.agent-team-web-2', 'team.json'), STATE_ROOT)).toBe(false)
    expect(isUnderStateRoot('/ws/team-b/.agent-team-web/team.json', STATE_ROOT)).toBe(false)
  })

  it('refuses unrelated paths', () => {
    expect(isUnderStateRoot(join(WORKSPACE, 'src', 'index.ts'), STATE_ROOT)).toBe(false)
  })
})

describe('memberStateDenial — structured tools', () => {
  it('denies read/write/edit on a state-dir file path (absolute)', () => {
    const args = { file_path: join(STATE_ROOT, 'framework-audit', 'team.json') }
    for (const tool of ['read', 'write', 'edit']) {
      expect(memberStateDenial(tool, args, WORKSPACE, STATE_DIR)).toMatch(/denied for the team state directory/)
    }
  })

  it('denies read/write/edit on a state-dir path given relative to the workspace', () => {
    const args = { file_path: '.agent-team-web/framework-audit/team.json' }
    expect(memberStateDenial('read', args, WORKSPACE, STATE_DIR)).toMatch(/denied/)
    expect(memberStateDenial('write', args, WORKSPACE, STATE_DIR)).toMatch(/denied/)
    expect(memberStateDenial('edit', args, WORKSPACE, STATE_DIR)).toMatch(/denied/)
  })

  it('allows read/write/edit on ordinary workspace files', () => {
    for (const tool of ['read', 'write', 'edit']) {
      expect(memberStateDenial(tool, { file_path: join(WORKSPACE, 'src', 'index.ts') }, WORKSPACE, STATE_DIR)).toBeUndefined()
    }
  })

  it('denies glob/grep with an explicit state-dir path', () => {
    expect(memberStateDenial('glob', { path: STATE_ROOT, pattern: '**/*.json' }, WORKSPACE, STATE_DIR)).toMatch(/denied/)
    expect(memberStateDenial('grep', { path: join(STATE_ROOT, 'framework-audit'), pattern: 'x' }, WORKSPACE, STATE_DIR)).toMatch(/denied/)
  })

  it('allows glob/grep over the workspace root', () => {
    expect(memberStateDenial('glob', { pattern: '**/*.ts' }, WORKSPACE, STATE_DIR)).toBeUndefined()
    expect(memberStateDenial('grep', { path: WORKSPACE, pattern: 'x' }, WORKSPACE, STATE_DIR)).toBeUndefined()
  })

  it('ignores unguarded tools', () => {
    expect(memberStateDenial('agent_teams_status', {}, WORKSPACE, STATE_DIR)).toBeUndefined()
    expect(memberStateDenial('bash', { command: 'ls -la' }, WORKSPACE, STATE_DIR)).toBeUndefined()
  })

  it('质检员验收预期 ②: agent_teams_* 协作工具永不被误伤 (claim→update→completed→review)', () => {
    // 成员正常协作全链路不得被 state-dir 守卫拦截:
    // claim/update/review_task/send_message 与文件路径无关,一律放行。
    expect(memberStateDenial('agent_teams_claim_task', { task_id: 't1' }, WORKSPACE, STATE_DIR)).toBeUndefined()
    expect(memberStateDenial('agent_teams_update_task', {
      task_id: 't1',
      status: 'in_progress',
      attempt_id: 'att-1',
    }, WORKSPACE, STATE_DIR)).toBeUndefined()
    expect(memberStateDenial('agent_teams_update_task', {
      task_id: 't1',
      status: 'completed',
      attempt_id: 'att-1',
      output: '完成',
    }, WORKSPACE, STATE_DIR)).toBeUndefined()
    expect(memberStateDenial('agent_teams_review_task', {
      task_id: 't1',
      verdict: 'pass',
    }, WORKSPACE, STATE_DIR)).toBeUndefined()
    expect(memberStateDenial('agent_teams_send_message', {
      to: 'captain',
      content: '报告',
    }, WORKSPACE, STATE_DIR)).toBeUndefined()
    expect(memberStateDenial('agent_teams_status', {}, WORKSPACE, STATE_DIR)).toBeUndefined()
  })
})

describe('memberStateDenial — free-form bash heuristic', () => {
  it('denies a command that names the absolute state root', () => {
    expect(memberStateDenial('bash', { command: `cat ${STATE_ROOT}/team.json` }, WORKSPACE, STATE_DIR)).toMatch(/denied/)
  })

  it('denies a command that references the stateDir-relative path', () => {
    expect(memberStateDenial('bash', { command: 'cat .agent-team-web/framework-audit/team.json' }, WORKSPACE, STATE_DIR)).toMatch(/denied/)
    expect(memberStateDenial('bash', { command: 'cd .agent-team-web && ls' }, WORKSPACE, STATE_DIR)).toMatch(/denied/)
  })

  it('denies a bash workdir inside the state root', () => {
    expect(memberStateDenial('bash', { command: 'ls', workdir: STATE_ROOT }, WORKSPACE, STATE_DIR)).toMatch(/denied/)
  })

  it('allows ordinary commands', () => {
    expect(memberStateDenial('bash', { command: 'pnpm test' }, WORKSPACE, STATE_DIR)).toBeUndefined()
    expect(memberStateDenial('bash', { command: 'cat src/index.ts' }, WORKSPACE, STATE_DIR)).toBeUndefined()
  })
})

describe('installMemberStateGuard — dispatch wrapper', () => {
  it('denies a member read of the state dir and passes everything else', async () => {
    const memberId = 'session-member-1'
    registerMemberAgent(memberId)
    try {
      const handler = vi.fn()
      const ctx = {
        on: (name: string, listener: unknown) => {
          if (name === 'tools/execute') handler(listener)
          return () => undefined
        },
      } as never
      installMemberStateGuard(ctx, STATE_DIR)

      const exec = (tool: string, args: Record<string, unknown>, agentId: string) => ({
        name: tool,
        arguments: args,
        agent: { id: agentId, session: { header: { cwd: WORKSPACE } } },
      })
      const next = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' as const }] }))

      // Member read of the state dir → denial result, next() not called.
      const denied = await handler.mock.calls[0]?.[0](
        exec('read', { file_path: join(STATE_ROOT, 'team.json') }, memberId),
        next,
      )
      expect(denied.isError).toBe(true)
      expect(denied.error.message).toMatch(/denied for the team state directory/)
      expect(next).not.toHaveBeenCalled()

      // Member read of an ordinary file → next() called.
      const allowed = await handler.mock.calls[0]?.[0](
        exec('read', { file_path: join(WORKSPACE, 'src', 'index.ts') }, memberId),
        next,
      )
      expect(allowed.content[0]?.text).toBe('ok')

      // Non-member agent → next() called even for state-dir reads.
      next.mockClear()
      const stranger = await handler.mock.calls[0]?.[0](
        exec('read', { file_path: join(STATE_ROOT, 'team.json') }, 'session-captain'),
        next,
      )
      expect(stranger.content[0]?.text).toBe('ok')
    } finally {
      unregisterMemberAgent(memberId)
    }
  })

  it('does not guard agents after unregisterMemberAgent', async () => {
    const memberId = 'session-member-2'
    registerMemberAgent(memberId)
    unregisterMemberAgent(memberId)
    const handler = vi.fn()
    const ctx = {
      on: (name: string, listener: unknown) => {
        if (name === 'tools/execute') handler(listener)
        return () => undefined
      },
    } as never
    installMemberStateGuard(ctx, STATE_DIR)
    const next = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' as const }] }))
    const result = await handler.mock.calls[0]?.[0](
      { name: 'read', arguments: { file_path: join(STATE_ROOT, 'team.json') }, agent: { id: memberId, session: { header: { cwd: WORKSPACE } } } },
      next,
    )
    expect(result.content[0]?.text).toBe('ok')
  })
})
