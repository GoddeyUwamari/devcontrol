import { describe, it, expect } from 'vitest'

// Throwaway: proves the frontend test step blocks lint-and-build. Never merged.
describe('CI gate canary', () => {
  it('fails on purpose', () => {
    expect(1).toBe(2)
  })
})
