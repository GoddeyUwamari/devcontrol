/**
 * demo-generator builds its data when the module loads, and demo-mode.service
 * (imported by app pages) loads it. Nothing it runs at load may depend on a
 * runtime facility that can be missing: crypto.randomUUID, for one, exists only
 * in secure contexts in browsers. The ids are fixed, so loading it with
 * crypto.randomUUID removed must still work, and give the same ids each time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const loadWithoutRandomUUID = async () => {
  vi.resetModules()
  const real = globalThis.crypto
  vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real), subtle: real.subtle })
  expect(globalThis.crypto.randomUUID).toBeUndefined()
  return import('@/lib/demo-data/demo-generator')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('demo-generator at module load', () => {
  it('loads with crypto.randomUUID unavailable', async () => {
    const { DEMO_AWS_RESOURCES } = await loadWithoutRandomUUID()

    expect(DEMO_AWS_RESOURCES.length).toBeGreaterThan(0)
  })

  it('gives every resource a fixed, unique id, the same on every load', async () => {
    const first = (await loadWithoutRandomUUID()).DEMO_AWS_RESOURCES.map((r) => r.id)
    const second = (await loadWithoutRandomUUID()).DEMO_AWS_RESOURCES.map((r) => r.id)

    expect(new Set(first).size).toBe(first.length)
    expect(second).toEqual(first)
    for (const id of first) expect(id).toMatch(/^demo-/)
  })
})
