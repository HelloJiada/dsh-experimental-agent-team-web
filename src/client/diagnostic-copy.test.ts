import { describe, expect, it } from 'vitest'
import { copyDiagnosticText } from './diagnostic-copy.ts'

describe('diagnostic copy', () => {
  it('reports copied, failed, and missing clipboard', async () => {
    let value = ''
    await expect(copyDiagnosticText('x', { writeText: async text => { value = text } })).resolves.toBe('copied')
    expect(value).toBe('x')
    await expect(copyDiagnosticText('x', { writeText: async () => { throw new Error('denied') } })).resolves.toBe('failed')
    await expect(copyDiagnosticText('x', undefined)).resolves.toBe('failed')
  })
})
