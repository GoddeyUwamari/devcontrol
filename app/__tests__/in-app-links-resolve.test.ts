/**
 * Every internal link literal in the app (signed-in pages, auth pages,
 * components, lib) resolves to a page, a next.config.ts redirect, or a file in
 * public/. mailto:, tel:, http(s) and #anchors are not checked.
 *
 * Found by this scan (CAT-3): /support, /privacy, /terms, /billing,
 * /docs/pricing and /admin/alerts, all fixed. KNOWN_DEAD holds the dead links
 * owned by other work, each with its owner; it may only shrink.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const SCANNED = ['app/(app)', 'app/(auth)', 'components', 'lib']

/** file:line → link, with the owner that fixes it. */
const KNOWN_DEAD: Record<string, { link: string; owner: string }> = {
  'app/(app)/admin/monitoring/page.tsx:457': { link: '/settings/monitoring', owner: 'legacy /admin/monitoring, flag off (C3-D12)' },
  'app/(app)/admin/monitoring/page.tsx:544': { link: '/settings/monitoring', owner: 'legacy /admin/monitoring, flag off (C3-D12)' },
  'app/(app)/admin/monitoring/page.tsx:557': { link: '/settings/monitoring', owner: 'legacy /admin/monitoring, flag off (C3-D12)' },
  'app/(app)/admin/monitoring/page.tsx:739': { link: '/settings/monitoring', owner: 'legacy /admin/monitoring, flag off (C3-D12)' },
  'components/dashboard/risk-score-trend-chart.tsx:91': { link: '/settings/integrations', owner: 'unrendered file, CAT-2 / CAT-D10' },
  'components/deployments/DeploymentIntegrations.tsx:116': { link: '/settings/integrations', owner: 'unrendered file, CAT-2 / CAT-D10' },
  'components/deployments/DeploymentIntegrations.tsx:132': { link: '/settings/integrations', owner: 'unrendered file, CAT-2 / CAT-D10' },
  'components/deployments/DeploymentSetupChecklist.tsx:46': { link: '/settings/integrations', owner: 'unrendered file, CAT-2 / CAT-D10' },
  'app/(app)/deployments/page.tsx:542': { link: '/deployments/__DYN__/logs', owner: 'found in the CAT-3 build; awaiting founder decision' },
  'app/(app)/deployments/page.tsx:543': { link: '/deployments/__DYN__/rollback', owner: 'found in the CAT-3 build; awaiting founder decision' },
  'app/(app)/deployments/page.tsx:580': { link: '/deployments/__DYN__/logs', owner: 'found in the CAT-3 build; awaiting founder decision' },
  'app/(app)/deployments/page.tsx:581': { link: '/deployments/__DYN__/rollback', owner: 'found in the CAT-3 build; awaiting founder decision' },
  'lib/hooks/useBreadcrumbs.ts:69': { link: '/observability', owner: 'breadcrumb; found in the CAT-3 build; awaiting founder decision' },
  'lib/hooks/useBreadcrumbs.ts:70': { link: '/devops', owner: 'breadcrumb; found in the CAT-3 build; awaiting founder decision' },
  'lib/hooks/useBreadcrumbs.ts:71': { link: '/devops', owner: 'breadcrumb; found in the CAT-3 build; awaiting founder decision' },
  'lib/hooks/useBreadcrumbs.ts:73': { link: '/devops', owner: 'breadcrumb; found in the CAT-3 build; awaiting founder decision' },
  'lib/hooks/useBreadcrumbs.ts:74': { link: '/devops', owner: 'breadcrumb; found in the CAT-3 build; awaiting founder decision' },
  'lib/hooks/useBreadcrumbs.ts:75': { link: '/devops', owner: 'breadcrumb; found in the CAT-3 build; awaiting founder decision' },
}

function walk(dir: string, keep: (f: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      walk(full, keep, out)
    } else if (keep(full)) out.push(full)
  }
  return out
}

const isGroup = (s: string) => s.startsWith('(') && s.endsWith(')')
const ROUTES: string[][] = walk(join(ROOT, 'app'), (f) => /[\\/](page|route)\.tsx?$/.test(f))
  .map((f) => relative(join(ROOT, 'app'), f).split(sep).slice(0, -1).filter((s) => !isGroup(s)))
const REDIRECTS = new Set([...readFileSync(join(ROOT, 'next.config.ts'), 'utf-8').matchAll(/source:\s*'([^']+)'/g)].map((m) => m[1]))
const PUBLIC = existsSync(join(ROOT, 'public'))
  ? new Set(walk(join(ROOT, 'public'), () => true).map((f) => '/' + relative(join(ROOT, 'public'), f).split(sep).join('/')))
  : new Set<string>()

const LINK_PATTERNS = [
  /href="([^"]+)"/g, /href='([^']+)'/g, /href=\{'([^']+)'\}/g, /href=\{`([^`]+)`\}/g,
  /href:\s*'([^']+)'/g, /href:\s*`([^`]+)`/g,
  /router\.(?:push|replace)\(\s*'([^']+)'/g, /router\.(?:push|replace)\(\s*`([^`]+)`/g,
  /location\.href\s*=\s*'([^']+)'/g,
]

/** A template's `${…}` right after a slash is a path segment; any other `${…}` starts the query. */
export function normalize(link: string): string {
  const withSegments = link.replace(/(?<=\/)\$\{[^}]*\}/g, '__DYN__')
  const cut = withSegments.indexOf('${')
  return (cut >= 0 ? withSegments.slice(0, cut) : withSegments).split('?')[0].split('#')[0]
}

export function resolves(link: string): boolean {
  const path = normalize(link)
  if (path === '' || path === '/') return true
  if (REDIRECTS.has(path.replace(/\/$/, '')) || PUBLIC.has(path)) return true
  const segs = path.replace(/^\/|\/$/g, '').split('/')
  const match = (a: string, b: string) => a === b || b.startsWith('[') || a === '__DYN__'
  return ROUTES.some((r) => {
    const last = r[r.length - 1]
    if (last?.startsWith('[...') || last?.startsWith('[[...')) {
      const head = r.slice(0, -1)
      return segs.length >= head.length && head.every((b, i) => match(segs[i], b))
    }
    return r.length === segs.length && r.every((b, i) => match(segs[i], b))
  })
}

function internalLinks(): Array<{ at: string; link: string }> {
  const out: Array<{ at: string; link: string }> = []
  for (const dir of SCANNED) {
    for (const file of walk(join(ROOT, dir), (f) => /\.tsx?$/.test(f))) {
      readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
        for (const pattern of LINK_PATTERNS) {
          for (const m of line.matchAll(pattern)) {
            if (m[1].startsWith('/')) out.push({ at: `${relative(ROOT, file).split(sep).join('/')}:${i + 1}`, link: m[1] })
          }
        }
      })
    }
  }
  return out
}

describe('in-app links resolve', () => {
  const links = internalLinks()

  it('the scan finds links (sanity)', () => {
    expect(links.length).toBeGreaterThan(100)
    expect(links.some((l) => l.link === '/settings/billing')).toBe(true)
  })

  it('every internal link resolves, apart from the known dead links owned elsewhere', () => {
    const dead = links.filter((l) => !resolves(l.link)).map((l) => `${l.at} ${normalize(l.link)}`)
    const expected = Object.entries(KNOWN_DEAD).map(([at, { link }]) => `${at} ${link}`)
    expect(dead.filter((d) => !expected.includes(d))).toEqual([])
  })

  it('the known-dead list only shrinks: each entry is still there and still dead', () => {
    for (const [at, { link, owner }] of Object.entries(KNOWN_DEAD)) {
      expect(owner).not.toBe('')
      expect(links.some((l) => l.at === at && normalize(l.link) === link), `${at} is fixed or moved: remove it from KNOWN_DEAD`).toBe(true)
      expect(resolves(link)).toBe(false)
    }
  })

  it('the resolver itself: pages, groups, dynamic segments, redirects and queries', () => {
    expect(resolves('/legal/privacy')).toBe(true)
    expect(resolves('/legal/terms')).toBe(true)
    expect(resolves('/settings/billing')).toBe(true)
    expect(resolves('/pricing')).toBe(true)
    expect(resolves('/deployments/${id}')).toBe(true)
    expect(resolves('/observability/alerts${q ? `?${q}` : \'\'}')).toBe(true)
    expect(resolves('/demo')).toBe(true) // a next.config.ts redirect
    for (const dead of ['/support', '/privacy', '/terms', '/billing', '/docs/pricing', '/admin/alerts']) expect(resolves(dead), dead).toBe(false)
  })
})

describe('the CAT-3 dead links are fixed', () => {
  const src = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

  it('sign-in footer: /legal/privacy, /legal/terms and the support mailbox', () => {
    const layout = src('app/(auth)/layout.tsx')
    expect(layout).toContain('href="/legal/privacy"')
    expect(layout).toContain('href="/legal/terms"')
    expect(layout).toContain('href="mailto:support@getdevcontrol.com"')
  })

  it('billing success and cancel: the support mailbox and /pricing', () => {
    expect(src('app/(app)/billing/success/page.tsx')).toContain('href="mailto:support@getdevcontrol.com"')
    const cancel = src('app/(app)/billing/cancel/page.tsx')
    expect(cancel).toContain('href="mailto:support@getdevcontrol.com"')
    expect(cancel).toContain('href="/pricing"')
    expect(cancel).toContain('Email support')
    expect(cancel).toContain('View plans and FAQ')
  })

  it('no CAT-3 file links to a dead target any more', () => {
    const files = ['app/(auth)/layout.tsx', 'app/(app)/billing/success/page.tsx', 'app/(app)/billing/cancel/page.tsx', 'app/(app)/enterprise/page.tsx', 'app/(app)/observability/alerts/page.tsx']
    for (const f of files) {
      expect(src(f), f).not.toMatch(/["'`](\/support|\/privacy|\/terms|\/billing|\/docs\/pricing|\/admin\/alerts)["'`$?]/)
    }
  })
})
