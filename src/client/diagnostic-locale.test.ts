import { describe, expect, it } from 'vitest'
import { en, zh } from './locales.ts'

describe('diagnostic locale pairing', () => {
  it('has all diagnostic keys in zh and en', () => {
    const keys = [
      'history.diagnostic.legacy', 'history.diagnostic.unavailable',
      'history.diagnostic.copy', 'history.diagnostic.copyOk',
      'history.diagnostic.copyFail', 'history.diagnostic.disabledReason',
    ] as const
    for (const key of keys) {
      expect(zh[key]).toBeTruthy()
      expect(en[key]).toBeTruthy()
    }
  })
})
