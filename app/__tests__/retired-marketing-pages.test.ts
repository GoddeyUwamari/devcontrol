/**
 * AUDIT-TRUTH-PR3 retired the marketing pages built on fabricated customer
 * outcomes, stats and capabilities (solutions/*, platform/*, /aws-resources,
 * /dora-metrics) and the blog (posts by invented authors, every post link a
 * 404). The page files stay for an honest rewrite, so this test pins three things:
 *
 *  1. each retired route redirects (non-permanently) to /tour, or to / for
 *     the blog, and no earlier rule shadows it;
 *  2. nothing in the app links to a retired route, so it is reachable only by
 *     typing its URL, and then it redirects;
 *  3. no marketing link sends a logged-out visitor into an authenticated app
 *     page, except /docs, which tells signed-in customers where things live
 *     (Settings → API keys).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import nextConfig from '../../next.config'

const ROOT = path.resolve(__dirname, '..', '..')
const MARKETING = path.join(ROOT, 'app', '(marketing)')

/** Retired route → where it must redirect. */
const RETIRED: Array<[string, string]> = [
  ['/solutions/startups', '/tour'],
  ['/solutions/mid-market', '/tour'],
  ['/solutions/scaleups', '/tour'],
  ['/solutions/enterprise', '/tour'],
  ['/solutions/devops', '/tour'],
  ['/solutions/finops', '/tour'],
  ['/solutions/platform-engineers', '/tour'],
  ['/solutions/platform-engineering', '/tour'],
  ['/solutions/cost-optimization', '/tour'],
  ['/solutions/security', '/tour'],
  ['/platform/costs', '/tour'],
  ['/platform/infrastructure', '/tour'],
  ['/platform/service-health', '/tour'],
  ['/aws-resources', '/tour'],
  ['/dora-metrics', '/tour'],
  ['/blog', '/'],
  ['/blog/ai-cost-recommendations', '/'],
]

/** Page directories kept on disk for the rewrite (relative to app/(marketing)). */
const RETIRED_DIRS = ['solutions', 'platform', 'aws-resources', 'dora-metrics', 'blog']

/** Does an href point at a retired route? (/app/dora-metrics is the authed DORA page, not retired.) */
function isRetired(href: string): boolean {
  return (
    /^\/(solutions|platform\/(costs|infrastructure|service-health)|aws-resources|dora-metrics|blog)(\/|$)/.test(href)
  )
}

function matches(source: string, pathname: string): boolean {
  if (source.endsWith('/:path*')) {
    const prefix = source.slice(0, -'/:path*'.length)
    return pathname === prefix || pathname.startsWith(`${prefix}/`)
  }
  return source === pathname
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue
      walk(full, out)
    } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** Every internal href literal in a file: href="/x", href: '/x', href={'/x' + id}. */
function hrefs(file: string): string[] {
  const code = fs.readFileSync(file, 'utf-8')
  return [...code.matchAll(/href(?:=|:\s*)["'{`(\s]*["'`](\/[^"'`#?\s}]*)/g)].map(([, h]) => h)
}

const rel = (file: string) => path.relative(ROOT, file)
const insideRetired = (file: string) =>
  RETIRED_DIRS.some((d) => file.startsWith(path.join(MARKETING, d) + path.sep))

describe('retired marketing pages', () => {
  it.each(RETIRED)('%s redirects non-permanently to %s', async (route, destination) => {
    const redirects = await nextConfig.redirects!()
    const first = redirects.find((r) => matches(r.source, route))
    expect(first, `${route} has no redirect`).toBeDefined()
    expect(first).toMatchObject({ destination, permanent: false })
  })

  it('keeps /platform/integrations on its own /docs/api rule (listed before the platform wildcard)', async () => {
    const redirects = await nextConfig.redirects!()
    expect(redirects.find((r) => matches(r.source, '/platform/integrations'))?.destination).toBe('/docs/api')
  })

  it('no old /features/* redirect lands on a retired page (no redirect chains)', async () => {
    const redirects = await nextConfig.redirects!()
    for (const r of redirects) expect(isRetired(r.destination), `${r.source} → ${r.destination}`).toBe(false)
  })

  it.each(RETIRED_DIRS)('app/(marketing)/%s stays on disk for the rewrite', (dir) => {
    expect(fs.existsSync(path.join(MARKETING, dir))).toBe(true)
  })

  it('nothing outside the retired pages links to a retired route', () => {
    const files = ['app', 'components', 'lib'].flatMap((d) => walk(path.join(ROOT, d))).filter((f) => !insideRetired(f))
    const offenders = files.flatMap((f) => hrefs(f).filter(isRetired).map((h) => `${rel(f)} → ${h}`))
    expect(offenders).toEqual([])
  })
})

describe('marketing links', () => {
  /** Top-level authenticated routes: every directory under app/(app). */
  const AUTHED = fs
    .readdirSync(path.join(ROOT, 'app', '(app)'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `/${e.name}`)

  /** /docs explains where things live in the app for signed-in customers. */
  const DOCS_DIR = path.join(MARKETING, 'docs') + path.sep

  it('knows the authenticated routes', () => {
    expect(AUTHED).toEqual(expect.arrayContaining(['/dashboard', '/cost-optimization', '/settings']))
  })

  it('no marketing page or component links a visitor into an authenticated app page', () => {
    const files = [
      ...walk(MARKETING).filter((f) => !insideRetired(f) && !f.startsWith(DOCS_DIR)),
      ...walk(path.join(ROOT, 'components', 'landing')),
      path.join(ROOT, 'components', 'layout', 'MarketingNav.tsx'),
      path.join(ROOT, 'components', 'footer.tsx'),
    ]
    const offenders = files.flatMap((f) =>
      hrefs(f)
        .filter((h) => AUTHED.some((a) => h === a || h.startsWith(`${a}/`)))
        .map((h) => `${rel(f)} → ${h}`),
    )
    expect(offenders).toEqual([])
  })

  it('every "View Demo" / demo CTA goes to /tour', () => {
    const files = [...walk(MARKETING), ...walk(path.join(ROOT, 'components', 'landing')), path.join(ROOT, 'components', 'layout', 'MarketingNav.tsx')]
    for (const f of files) {
      const code = fs.readFileSync(f, 'utf-8')
      for (const [, href] of code.matchAll(/href=["'{`]+([^"'`}]+)["'`}]+[^<]*>\s*(?:View|Watch)\s+(?:a\s+)?Demo/gi)) {
        expect(href, `${rel(f)}: demo CTA`).toBe('/tour')
      }
    }
  })
})
