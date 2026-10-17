/**
 * /dependencies was removed: its only real data was a hand-entered graph, and
 * the rest of the page (trends, latency, cost, "AI Analysis") was fabricated.
 * Old links land on /services instead of a 404, and the page stays gone.
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import nextConfig from '../../next.config'

describe('removed /dependencies page', () => {
  it('/dependencies redirects to /services (not permanent)', async () => {
    const redirects = await nextConfig.redirects!()
    expect(redirects.filter((r) => r.source === '/dependencies')).toEqual([
      { source: '/dependencies', destination: '/services', permanent: false },
    ])
  })

  it('app/(app)/dependencies has no page', () => {
    expect(existsSync(join(__dirname, '..', '(app)', 'dependencies'))).toBe(false)
  })
})
