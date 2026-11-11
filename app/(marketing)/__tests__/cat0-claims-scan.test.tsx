/**
 * Catalog CAT-0: the marketing site carried invented customer testimonials,
 * invented case stories, a "$8,000/mo recent client outcome" card and
 * "$800–$8,000+" savings ranges. None had a customer or a measurement behind
 * them (the case-studies page itself says "We're early"). They were removed,
 * not relabelled: an invented quote reads as evidence even when marked
 * illustrative. Where a block stayed, it now names checks DevControl really
 * runs ("What a first scan looks for").
 *
 * This test fails if any removed string returns, in two ways:
 *  1. Source: the exact strings, in every file CAT-0 touched.
 *  2. Rendered: the text of each affected page, rendered at 1440 and 390 px
 *     (the pages choose their layout from window.innerWidth).
 *
 * Exact strings only, so unrelated content (prices, other figures that are
 * still under review in CAT-2) never trips it. CAT-0 does not make the
 * marketing site claim-clean: the remaining unsourced statistics and other
 * claims are tracked for CAT-2 in review-logs/pricing/catalog-step1.md.
 */
process.env.TZ = 'UTC'

import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/lib/contexts/auth-context'
import { rejectEveryApiRequest } from '@/lib/__tests__/support/console-sentinels'
import MarketingLayout from '../layout'
import HomePage from '../page'
import ScaleupsPage from '../solutions/scaleups/page'
import MidMarketPage from '../solutions/mid-market/page'
import ServiceHealthPage from '../platform/service-health/page'
import PlatformEngineersPage from '../solutions/platform-engineers/page'
import DoraMetricsPage from '../dora-metrics/page'
import DevOpsPage from '../solutions/devops/page'
import StartupsPage from '../solutions/startups/page'
import InfrastructureManagementPage from '../platform/infrastructure/page'
import FinOpsPage from '../solutions/finops/page'
import EnterprisePage from '../solutions/enterprise/page'
import CostOptimizationPage from '../platform/costs/page'
import TourPage from '../tour/page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/analytics/site-analytics', () => ({ SiteAnalytics: () => null }))

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

/** Every string CAT-0 removed. Each must never appear again. */
const REMOVED: readonly string[] = [
  // Homepage hero card and savings ranges
  'Recent client outcome',
  '$8,000/mo',
  '$8,000+',
  '$8,000',
  'in unnecessary AWS spend identified in under 60 seconds',
  '$800–$8,000+',
  '$800–$8K+',
  'Potential savings:',
  'Teams typically uncover',
  'Teams identify $800',
  // Homepage persona testimonials
  'Jordan Ellis',
  'Sam Rivera',
  'Alex Kim',
  'Taylor Morgan',
  'Dana Okafor',
  'Chris Nakamura',
  'VP Engineering, SaaS Co.',
  'Director of Finance, Tech Startup',
  'without bugging my engineers or digging through AWS myself',
  'Now the numbers just show up every Monday',
  'The anomaly alerts caught a misconfigured Lambda',
  'connects infrastructure health to shipping velocity',
  'cloud cost reconciliation process from two days to thirty minutes',
  'what did my service cost last week?',
  'replace with real customer before launch',
  // Scale-ups (Axiom Labs)
  'Axiom Labs',
  'Marcus Chen',
  'Scale-up Result',
  'We had 3 AWS accounts, 4 teams, and no idea what anything cost',
  '$8,200/month in idle resources',
  'Saved $8,200/month',
  // Mid-market
  'David K.',
  'Customer Result',
  'VP Engineering · B2B SaaS · 65',
  'We were flying blind across 3 AWS accounts and 4 teams',
  '$31,000/month in waste',
  'Saved $31K/month',
  'Monthly savings found',
  'Read more customer stories',
  // Service health
  'Alex T.',
  'DevOps Team Result',
  'Lead DevOps Engineer · Series B SaaS',
  'Our on-call engineers were spending 4 hours per incident',
  'MTTR dropped by 60% in the first month',
  'A DevOps team reduced their MTTR by 60%',
  // Platform engineers
  'Tom N.',
  'Platform Engineering Result',
  'Staff Platform Engineer · Series B SaaS',
  'We replaced our internal Backstage implementation',
  '3 months of platform work back',
  'A platform team of 4 engineers replaced 3 internal tools',
  // DORA and DevOps
  'Sophia P.',
  'VP Engineering · Enterprise SaaS',
  'half a day to compile for board reviews',
  'Our CTO uses it directly in QBRs',
  // One-line case stories
  'A seed-stage startup cut their AWS bill by $1,800/month',
  'A Series B fintech discovered $18,200/month',
  'A FinOps team reduced their AWS bill by 38%',
  'A global SaaS company managing 120+ AWS services identified $1.2M',
  'A fintech team cut their AWS bill by $3,100',
  // Startups timeline
  'Real Startup Result',
  'From Seed to Enterprise-Ready in 6 Weeks',
  'How a seed-stage fintech used DevControl',
  'Discovered $1,800/month in idle resources immediately',
  'right-sized 3 RDS databases',
  '24% bill reduction',
  'All resolved in 4 days',
  'First enterprise logo',
  'answer security questionnaire in 20 minutes',
]

const HEADING = 'What a first scan looks for'
const CHECK_LIST = 'Low-activity EC2 instances · Unattached EBS volumes · Open security groups'
const CHECK_SENTENCE =
  'What a first scan looks for: low-activity EC2 instances, unattached EBS volumes and open security groups.'

const ROOT = join(__dirname, '..', '..', '..')

/** Every file CAT-0 touched. */
const TOUCHED = [
  'components/landing/HeroSection.tsx',
  'components/landing/PersonaSection.tsx',
  'components/landing/PricingPreview.tsx',
  'app/(marketing)/solutions/scaleups/page.tsx',
  'app/(marketing)/solutions/mid-market/page.tsx',
  'app/(marketing)/platform/service-health/page.tsx',
  'app/(marketing)/solutions/platform-engineers/page.tsx',
  'app/(marketing)/dora-metrics/page.tsx',
  'app/(marketing)/solutions/devops/page.tsx',
  'app/(marketing)/solutions/startups/page.tsx',
  'app/(marketing)/platform/infrastructure/page.tsx',
  'app/(marketing)/solutions/finops/page.tsx',
  'app/(marketing)/solutions/enterprise/page.tsx',
  'app/(marketing)/platform/costs/page.tsx',
  'app/(marketing)/tour/page.tsx',
]

function withAuth(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  )
}

interface Page {
  name: string
  path: string
  element: () => ReactNode
  /** Replacement text that must render on this page. */
  mustShow: readonly string[]
}

const PAGES: Page[] = [
  { name: 'home', path: '/', element: () => withAuth(<MarketingLayout><HomePage /></MarketingLayout>), mustShow: [HEADING, '4 cost checks', CHECK_LIST] },
  { name: 'solutions/scaleups', path: '/solutions/scaleups', element: () => <ScaleupsPage />, mustShow: [CHECK_SENTENCE, CHECK_LIST] },
  { name: 'solutions/mid-market', path: '/solutions/mid-market', element: () => <MidMarketPage />, mustShow: [HEADING, CHECK_LIST] },
  { name: 'platform/service-health', path: '/platform/service-health', element: () => <ServiceHealthPage />, mustShow: [] },
  { name: 'solutions/platform-engineers', path: '/solutions/platform-engineers', element: () => <PlatformEngineersPage />, mustShow: [] },
  { name: 'dora-metrics', path: '/dora-metrics', element: () => <DoraMetricsPage />, mustShow: [] },
  { name: 'solutions/devops', path: '/solutions/devops', element: () => <DevOpsPage />, mustShow: ['Low-activity EC2 instances found', 'estimated per finding'] },
  { name: 'solutions/startups', path: '/solutions/startups', element: () => <StartupsPage />, mustShow: [CHECK_SENTENCE, 'Four checks on your first scan', 'Unused Elastic IPs', 'Open security groups'] },
  { name: 'platform/infrastructure', path: '/platform/infrastructure', element: () => <InfrastructureManagementPage />, mustShow: [CHECK_SENTENCE] },
  { name: 'solutions/finops', path: '/solutions/finops', element: () => <FinOpsPage />, mustShow: [CHECK_SENTENCE] },
  { name: 'solutions/enterprise', path: '/solutions/enterprise', element: () => <EnterprisePage />, mustShow: [CHECK_SENTENCE] },
  { name: 'platform/costs', path: '/platform/costs', element: () => <CostOptimizationPage />, mustShow: [CHECK_SENTENCE] },
  { name: 'tour', path: '/tour', element: () => <TourPage />, mustShow: [] },
]

const WIDTHS = [1440, 390] as const

let restoreApi: () => void

beforeEach(() => {
  restoreApi = rejectEveryApiRequest()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ count: 7 }), { headers: { 'Content-Type': 'application/json' } })
  )
})

afterEach(() => {
  cleanup()
  restoreApi()
  vi.restoreAllMocks()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

async function settle() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

const normalise = (s: string) => s.replace(/\s+/g, ' ')

describe('CAT-0: removed testimonials, case stories and savings ranges stay removed', () => {
  describe('source of every touched file', () => {
    for (const file of TOUCHED) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      it(`${file} contains none of the removed strings`, () => {
        const found = REMOVED.filter((phrase) => source.includes(phrase))
        expect(found).toEqual([])
      })
    }

    it('no touched file renders a typographic open quote any more', () => {
      const withQuotes = TOUCHED.filter((file) => {
        const source = readFileSync(join(ROOT, file), 'utf8')
        return source.includes('\\u201C') || source.includes('&ldquo;') || source.includes('“')
      })
      expect(withQuotes).toEqual([])
    })
  })

  describe('rendered pages', () => {
    for (const page of PAGES) {
      for (const width of WIDTHS) {
        it(`${page.name} at ${width} px shows none of the removed strings`, async () => {
          Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
          window.history.replaceState(null, '', page.path)
          const { container } = render(page.element())
          await settle()

          const text = normalise(container.textContent ?? '')
          expect(text.length).toBeGreaterThan(200)
          expect(text).not.toMatch(/something went wrong/i)
          expect(REMOVED.filter((phrase) => text.includes(phrase))).toEqual([])
          for (const phrase of page.mustShow) expect(text).toContain(phrase)
        })
      }
    }
  })
})
