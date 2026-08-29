/**
 * Provider 授权中心持久化层测试:provider-grants.json 读写 + 授权判定。
 *
 * 覆盖设计文档第 2/3 节:grant 落盘原子写 + 锁、deepseek-official 隐式恒
 * 授权(永不落盘)、未授权 provider 判定、坏文件/缺文件容错。
 * @module dsh-agent-team-web/provider-grants.test
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  providerGranted,
  readProviderGrants,
  setProviderGrant,
} from './state.ts'

const GRANTS_FILE = 'provider-grants.json'

let stateRoot: string

beforeEach(async () => {
  stateRoot = await mkdtemp(join(tmpdir(), 'agent-team-grants-'))
})

afterEach(async () => {
  await rm(stateRoot, { recursive: true, force: true })
})

describe('readProviderGrants — 授权文件读取', () => {
  it('文件不存在(默认态)→ 空集合,不抛错', async () => {
    expect(await readProviderGrants(stateRoot)).toEqual(new Set())
  })

  it('合法文件 → 集合;重复/乱序条目去重归一', async () => {
    await writeFile(join(stateRoot, GRANTS_FILE), '["kimi-coding", "cc-switch", "kimi-coding"]\n', 'utf8')
    expect(await readProviderGrants(stateRoot)).toEqual(new Set(['kimi-coding', 'cc-switch']))
  })

  it('空串条目 / 非字符串数组 → 抛错(坏文件不被静默吞掉)', async () => {
    await writeFile(join(stateRoot, GRANTS_FILE), '["kimi-coding", ""]', 'utf8')
    await expect(readProviderGrants(stateRoot)).rejects.toThrow(/invalid AgentTeams provider grant index/)
    await writeFile(join(stateRoot, GRANTS_FILE), '{"kimi-coding": true}', 'utf8')
    await expect(readProviderGrants(stateRoot)).rejects.toThrow(/invalid AgentTeams provider grant index/)
  })

  it('非法 JSON → 抛错(区别于 ENOENT 容错)', async () => {
    await writeFile(join(stateRoot, GRANTS_FILE), 'not-json{', 'utf8')
    await expect(readProviderGrants(stateRoot)).rejects.toThrow()
  })
})

describe('providerGranted — 授权判定', () => {
  it('deepseek-official 恒授权(内置,不看文件)', async () => {
    expect(await providerGranted(stateRoot, 'deepseek-official')).toBe(true)
  })

  it('其余 provider 默认未授权;写入 grants 后授权', async () => {
    expect(await providerGranted(stateRoot, 'kimi-coding')).toBe(false)
    await setProviderGrant(stateRoot, 'kimi-coding', true)
    expect(await providerGranted(stateRoot, 'kimi-coding')).toBe(true)
  })
})

describe('setProviderGrant — 原子落盘', () => {
  it('授权写入:文件为排序后的字符串数组', async () => {
    await setProviderGrant(stateRoot, 'kimi-coding', true)
    await setProviderGrant(stateRoot, 'cc-switch', true)
    const raw = await readFile(join(stateRoot, GRANTS_FILE), 'utf8')
    expect(JSON.parse(raw)).toEqual(['cc-switch', 'kimi-coding'])
  })

  it('撤销从文件移除;重复授权幂等', async () => {
    await setProviderGrant(stateRoot, 'kimi-coding', true)
    await setProviderGrant(stateRoot, 'kimi-coding', true)
    await setProviderGrant(stateRoot, 'kimi-coding', false)
    expect(await readProviderGrants(stateRoot)).toEqual(new Set())
  })

  it('deepseek-official 授权/撤销均为 no-op,永不落盘', async () => {
    await setProviderGrant(stateRoot, 'deepseek-official', true)
    await setProviderGrant(stateRoot, 'deepseek-official', false)
    await expect(readFile(join(stateRoot, GRANTS_FILE), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await providerGranted(stateRoot, 'deepseek-official')).toBe(true)
  })

  it('空 provider 拒绝', async () => {
    await expect(setProviderGrant(stateRoot, '  ', true)).rejects.toThrow(/provider must not be empty/)
  })

  it('写入前自动建 stateRoot(目录缺失时)', async () => {
    const fresh = join(stateRoot, 'nested', 'missing')
    await setProviderGrant(fresh, 'xiaomi', true)
    expect(await readProviderGrants(fresh)).toEqual(new Set(['xiaomi']))
  })
})
