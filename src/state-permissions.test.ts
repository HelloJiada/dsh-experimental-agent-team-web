/**
 * R-19/M-1: state-file permission tests — team.json / inbox mailboxes /
 * retired-members.json must be owner-only (0600) inside owner-only dirs
 * (0700), so other local users cannot read session ids, message text, or
 * task outputs on multi-user machines.
 * @module dsh-agent-team-web/state-permissions.test
 */

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTeamDir, recordRetiredMemberIds, sanitizeKey } from './state.ts'
import type { TeamState } from './types.ts'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agent-team-perm-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function team(overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: '权限测试团队',
    id: 'perm-team',
    description: 'demo',
    captainSessionId: 'session-captain',
    createdAt: 1000,
    members: [
      { id: 'session-member-1', name: '技术员', role: 'engineer', provider: 'p', model: 'm', joinedAt: 1000, status: 'idle' },
    ],
    tasks: [],
    taskSeq: 0,
    ...overrides,
  }
}

function modeOf(mode: number): number {
  return mode & 0o777
}

describe('R-19 state file/dir permissions', () => {
  it('createTeamDir: 团队目录 0700、inbox 0700、team.json 0600', async () => {
    await createTeamDir(tempRoot, team())
    const teamDir = join(tempRoot, 'perm-team')
    expect(modeOf((await stat(teamDir)).mode)).toBe(0o700)
    expect(modeOf((await stat(join(teamDir, 'inbox'))).mode)).toBe(0o700)
    expect(modeOf((await stat(join(teamDir, 'team.json'))).mode)).toBe(0o600)
  })

  it('recordRetiredMemberIds: retired-members.json 0600、stateRoot 0700', async () => {
    await recordRetiredMemberIds(tempRoot, ['session-member-1'])
    expect(modeOf((await stat(join(tempRoot, 'retired-members.json'))).mode)).toBe(0o600)
    expect(modeOf((await stat(tempRoot)).mode)).toBe(0o700)
  })

  it('appendMailbox 落盘消息 0600(经 atomicWriteText)', async () => {
    const { appendMailbox } = await import('./state.ts')
    await createTeamDir(tempRoot, team())
    await appendMailbox(tempRoot, 'perm-team', 'captain', {
      id: 'm1',
      from: '技术员',
      to: 'captain',
      content: '机密消息',
      ts: 1000,
    })
    const file = join(tempRoot, 'perm-team', 'inbox', 'captain.jsonl')
    const content = await readFile(file, 'utf8')
    expect(content).toContain('机密消息')
    expect(modeOf((await stat(file)).mode)).toBe(0o600)
  })

  it('覆盖已存在文件后权限仍为 0600(原子替换保留 temp mode)', async () => {
    const teamFile = join(tempRoot, 'perm-team', 'team.json')
    await createTeamDir(tempRoot, team())
    // 模拟旧权限(0644)的文件被再次原子写覆盖。
    await writeFile(teamFile, 'stale', { mode: 0o644 })
    await createTeamDir(tempRoot, team())
    expect(modeOf((await stat(teamFile)).mode)).toBe(0o600)
  })
})

describe('R-21/L-3 sanitizeKey — Windows 保留名', () => {
  it('保留设备名追加摘要后缀,避免 Windows 设备语义', () => {
    expect(sanitizeKey('con')).toMatch(/^con-[0-9a-f]{8}$/)
    expect(sanitizeKey('CON')).toBe(sanitizeKey('con'))
    // 带扩展名的保留名:判定基于折叠前名(nul.json),后缀接在折叠后 key 上。
    expect(sanitizeKey('nul.json')).toMatch(/^nul-json-[0-9a-f]{8}$/)
    expect(sanitizeKey('aux')).toMatch(/^aux-[0-9a-f]{8}$/)
    expect(sanitizeKey('com1')).toMatch(/^com1-[0-9a-f]{8}$/)
    expect(sanitizeKey('lpt1')).toMatch(/^lpt1-[0-9a-f]{8}$/)
  })

  it('普通名称不受影响', () => {
    expect(sanitizeKey('技术员')).toBe('技术员')
    expect(sanitizeKey('framework-audit')).toBe('framework-audit')
    expect(sanitizeKey('team')).toBe('team')
  })
})
