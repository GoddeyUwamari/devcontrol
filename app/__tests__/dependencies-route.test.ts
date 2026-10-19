/**
 * /dependencies is an app page again (restored as real-data-only; see
 * app/(app)/dependencies/page.tsx). Its #209 redirect to /services is gone;
 * /services/dependencies, a different removed page, still redirects.
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import nextConfig from '../../next.config'

describe('/dependencies route', () => {
  it('is not redirected', async () => {
    const redirects = await nextConfig.redirects!()
    expect(redirects.filter((r) => r.source === '/dependencies' || r.source.startsWith('/dependencies/'))).toEqual([])
  })

  it('app/(app)/dependencies has a page', () => {
    expect(existsSync(join(__dirname, '..', '(app)', 'dependencies', 'page.tsx'))).toBe(true)
  })

  it('/services/dependencies still redirects to /services', async () => {
    const redirects = await nextConfig.redirects!()
    expect(redirects.filter((r) => r.source === '/services/dependencies')).toEqual([
      { source: '/services/dependencies', destination: '/services', permanent: false },
    ])
  })
})
