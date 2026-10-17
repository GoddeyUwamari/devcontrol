/**
 * Response headers set for every route through next.config.ts: Referrer-Policy
 * strict-origin (no path or query in any Referer, same-origin included),
 * nosniff and X-Frame-Options DENY, and no X-Powered-By. vercel.json must not
 * set headers of its own, which would apply on top of these.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import nextConfig from '../../next.config'

describe('security response headers', () => {
  it('every path gets Referrer-Policy strict-origin, nosniff and X-Frame-Options DENY', async () => {
    const rules = await nextConfig.headers!()
    expect(rules).toEqual([
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'strict-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ])
  })

  it('X-Powered-By is off', () => {
    expect(nextConfig.poweredByHeader).toBe(false)
  })

  it('vercel.json sets no headers, routes or rewrites that could override them', () => {
    const vercel = JSON.parse(readFileSync(join(__dirname, '..', '..', 'vercel.json'), 'utf8'))
    for (const key of ['headers', 'routes', 'rewrites', 'redirects', 'cleanUrls', 'trailingSlash']) {
      expect(vercel, key).not.toHaveProperty(key)
    }
    expect(JSON.stringify(vercel).toLowerCase()).not.toMatch(/referrer|x-frame-options|x-content-type-options/)
  })
})
