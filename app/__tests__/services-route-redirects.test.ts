/**
 * /services/health and /services/dependencies were removed (static copy with
 * no data behind it). Old links land on /services instead of a 404, and the
 * pages themselves stay gone.
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import nextConfig from '../../next.config'

describe('removed /services sub-pages', () => {
  it.each(['/services/health', '/services/dependencies'])('%s redirects to /services', async (source) => {
    const redirects = await nextConfig.redirects!()
    expect(redirects.filter((r) => r.source === source)).toEqual([
      { source, destination: '/services', permanent: false },
    ])
  })

  it.each(['health', 'dependencies'])('services/%s has no page', (dir) => {
    expect(existsSync(join(__dirname, '..', '(app)', 'services', dir))).toBe(false)
  })
})
