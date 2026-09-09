import { describe, expect, it } from 'vitest'
import { copyTaskDetail, taskDetailClipboardText } from './task-detail-copy.ts'

const t = ((key: string, values?: Record<string, unknown>) => `${key}:${JSON.stringify(values ?? {})}`) as never
const task = {
  id: 't1', subject: 'Long detail', status: 'completed', state: 'completed', assignee: 'captain', dependencies: [], depth: 0,
  signals: { outputBytes: 3, selfReport: 'fixture self report' },
  retro: { attempt: 1, actualMs: 1, overran: false, cause: 'on_time', summary: 'fixture', recommendation: 'fixture recommendation', createdAt: 1 },
} as never

describe('task detail clipboard', () => {
  it('keeps task detail fields in deterministic plain text', () => {
    const text = taskDetailClipboardText(task, t)
    expect(text).toContain('Long detail')
    expect(text).toContain('fixture self report')
    expect(text).toContain('fixture recommendation')
  })

  it('reports clipboard rejection without relying on mounted React state', async () => {
    await expect(copyTaskDetail('text', { writeText: async () => { throw new Error('denied') } })).resolves.toBe('failed')
    await expect(copyTaskDetail('text', undefined)).resolves.toBe('failed')
  })

  it('reports successful copies', async () => {
    let copied = ''
    await expect(copyTaskDetail('text', { writeText: async value => { copied = value } })).resolves.toBe('copied')
    expect(copied).toBe('text')
  })
})
