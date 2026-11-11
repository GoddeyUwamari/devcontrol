/**
 * CAT-1 banned-claim scan: the claims CAT-1 removed stay removed.
 *
 * (1) Source: plan surfaces get the full list (SLA promises, internal plan
 *     names, retired items, "Save 20%", invented limits…); every page that
 *     had a trial button or trial line gets the trial list (no "no credit
 *     card", no trial wording outside components/billing/trial-line.tsx).
 * (2) Rendered: the plan surfaces, with the trial OFF (no trial wording at
 *     all) and ON (trial wording only from the trial line, never "no credit
 *     card").
 * Exact phrases only. CAT-2 still owns the rest of the marketing claims on the
 * solution pages, so those pages get only the trial list here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/gtag', () => ({ trackLeadQualified: vi.fn() }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useIsBillingAdmin: () => true, useCurrentRole: () => 'owner' }))
vi.mock('@/lib/services/stripe.service', () => ({
  getSubscription: vi.fn(async () => ({ success: true, data: { tier: 'free', actions: { selfServe: 'checkout' }, trial: { eligible: false } } })),
  createCheckoutSession: vi.fn(),
  changePlan: vi.fn(),
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-1' }, user: { id: 'u1' } }) }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ tier: 'free', isEnterprise: false, isPro: false }) }))
vi.mock('@/lib/services/subscriptions.service', () => ({ subscriptionsService: { getAll: vi.fn(async () => []) } }))
vi.mock('@/lib/services/organizations.service', () => ({ organizationsService: { getMembers: vi.fn(async () => []), inviteMember: vi.fn() } }))
vi.mock('@/lib/services/invoices.service', () => ({ invoicesService: { getAll: vi.fn(async () => []) } }))

import PricingPage from '@/app/(marketing)/pricing/page'
import UpgradePage from '@/app/(app)/settings/billing/upgrade/page'
import EnterprisePage from '@/app/(app)/enterprise/page'
import MidMarketPage from '@/app/(marketing)/solutions/mid-market/page'
import { PricingPreview } from '@/components/landing/PricingPreview'
import { CTASection } from '@/components/landing/CTASection'
import { Footer } from '@/components/footer'
import { UpgradeModal } from '@/components/billing/upgrade-modal'
import { resetBillingOfferForTests } from '@/lib/billing/offer'

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const ROOT = join(__dirname, '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/** Plan surfaces and the files whose plan names CAT-1 fixed: the full list. */
const PLAN_FILES = [
  'app/(marketing)/pricing/page.tsx',
  'components/billing/feature-comparison-table.tsx',
  'components/billing/pricing-faq.tsx',
  'app/(app)/settings/billing/upgrade/page.tsx',
  'components/landing/PricingPreview.tsx',
  'app/(app)/enterprise/page.tsx',
  'components/billing/upgrade-modal.tsx',
  'components/billing/feature-line.tsx',
  'components/billing/trial-line.tsx',
  'lib/plan/plan-catalog.ts',
  'lib/plan/plan-names.ts',
  'app/(app)/forecast/page.tsx',
  'app/(app)/costs/page.tsx',
  'app/(app)/costs/by-team/page.tsx',
  'app/(app)/costs/efficiency/page.tsx',
  'app/(app)/ai-reports/page.tsx',
  'app/(app)/anomalies/page.tsx',
  'app/(app)/anomalies/rules/page.tsx',
  'app/(app)/settings/sso/page.tsx',
  'app/(app)/cost-optimization/controls/page.tsx',
  'app/(app)/monitoring/slos/page.tsx',
  'app/(app)/remediation/page.tsx',
  'app/(app)/settings/scheduled-reports/page.tsx',
  'app/(app)/security/overview/securityModel.ts',
  'app/(app)/infrastructure/page.tsx',
  'app/(app)/infrastructure/overview/PlanBanners.tsx',
  'app/(app)/admin/monitoring/operational-health/operationalHealthCopy.ts',
  'app/(app)/billing/success/page.tsx',
  'app/(app)/billing/cancel/page.tsx',
  'components/billing/cancel-subscription-dialog.tsx',
  'components/billing/subscription-status.tsx',
  'components/dashboard/dashboard-unconnected-preview.tsx',
  'backend/src/middleware/subscription.middleware.ts',
  'backend/src/services/saml.service.ts',
]

/** Every page or component that had a trial button or trial line: the trial list. */
const TRIAL_FILES = [
  ...PLAN_FILES,
  'components/footer.tsx',
  'components/landing/CTASection.tsx',
  'app/(marketing)/aws-resources/page.tsx',
  'app/(marketing)/case-studies/page.tsx',
  'app/(marketing)/community/page.tsx',
  'app/(marketing)/contact/page.tsx',
  'app/(marketing)/dora-metrics/page.tsx',
  'app/(marketing)/platform/costs/page.tsx',
  'app/(marketing)/platform/infrastructure/page.tsx',
  'app/(marketing)/platform/service-health/page.tsx',
  'app/(marketing)/solutions/cost-optimization/page.tsx',
  'app/(marketing)/solutions/devops/page.tsx',
  'app/(marketing)/solutions/finops/page.tsx',
  'app/(marketing)/solutions/mid-market/page.tsx',
  'app/(marketing)/solutions/platform-engineering/page.tsx',
  'app/(marketing)/solutions/platform-engineers/page.tsx',
  'app/(marketing)/solutions/scaleups/page.tsx',
  'app/(marketing)/solutions/security/page.tsx',
  'app/(marketing)/solutions/startups/page.tsx',
  'app/(marketing)/tour/page.tsx',
]

/** The one file allowed to hold trial wording. */
const TRIAL_SOURCE = 'components/billing/trial-line.tsx'

const TRIAL_BANNED: (string | RegExp)[] = [
  /no credit card/i,
  /no card required/i,
  'Start Free Trial',
  'Start Free 14-Day Trial',
  /free for 14 days/i,
  /14-day free trial/i,
  /money-back/i,
]

const PLAN_BANNED: (string | RegExp)[] = [
  'Save 20%',
  /SLA guarantee/i,
  /\b4\s?hr\b/i,
  /\b24\s?hr\b/i,
  '24/7',
  'Security Command Center',
  'Implementation Rules',
  'Growth Plan',
  /Everything in (Free|Starter|Pro),/,
  /\b(Starter|Pro|Enterprise|Growth) (Plan|plan|tier)\b/,
  /\bFree (Plan|tier)\b/,
  /Upgrade to (Starter|Pro|Enterprise)\b/,
  /Enterprise Feature/,
  'sales@devcontrol.app',
  /real-time spend/i,
  'Real-time only',
  /Real-time anomaly/i,
  'All 8 AI',
  '(8 types)',
  '(4 detection types)',
  /unlimited queries/i,
  'Unlimited AI reports',
  'Unlimited AWS accounts',
  'First leak found in 15 min',
  'first insights in 15 minutes',
  '2-minute setup',
  '5 AI reports/month',
  'Up to 100 AWS resources',
  'SLA guarantees',
  'API access, and custom integrations',
  /50% off/,
  /NET-30/,
  /happy to extend/i,
  /locked in forever/i, // allowed only inside the hidden founding banner (see ALLOWED)
]

/** Exact allowed occurrences, each with its reason. */
const ALLOWED: Record<string, (string | RegExp)[]> = {
  // The founding banner stays in code, hidden behind FOUNDING_OFFER_VISIBLE (C1-D9).
  'app/(marketing)/pricing/page.tsx': [/locked in forever/i],
  // The customer's own tenant tiers (Tenants feature), not DevControl plans.
  'app/(app)/tenants/page.tsx': [],
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function hits(text: string, banned: (string | RegExp)[], allowed: (string | RegExp)[] = []): string[] {
  return banned
    .filter((b) => !allowed.some((a) => String(a) === String(b)))
    .filter((b) => (typeof b === 'string' ? text.includes(b) : b.test(text)))
    .map(String)
}

describe('source scan', () => {
  it.each(TRIAL_FILES.filter((f) => f !== TRIAL_SOURCE))('%s has no trial wording or "no credit card"', (file) => {
    expect(hits(stripComments(read(file)), TRIAL_BANNED, ALLOWED[file])).toEqual([])
  })

  it.each(PLAN_FILES)('%s has none of the removed plan claims', (file) => {
    expect(hits(stripComments(read(file)), PLAN_BANNED, ALLOWED[file])).toEqual([])
  })

  it('the trial line itself never says "no credit card"', () => {
    expect(hits(stripComments(read(TRIAL_SOURCE)), [/no credit card/i, /no card required/i])).toEqual([])
  })
})

function withQuery(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** [name, element, text that shows the surface has finished loading] */
const SURFACES: [string, () => ReactNode, string][] = [
  ['pricing page', () => <PricingPage />, 'Compare Plans'],
  ['homepage teaser', () => <PricingPreview />, 'See full pricing comparison'],
  ['homepage CTA', () => <CTASection />, 'Cancel anytime'],
  ['footer', () => <Footer />, 'Book a Demo'],
  ['mid-market page', () => <MidMarketPage />, 'Optimization Engine'],
  ['in-app upgrade page', () => <UpgradePage />, 'Everything in Cost Control, plus:'],
  ['/enterprise', () => withQuery(<EnterprisePage />), 'Revenue Protection'],
  ['upgrade modal (Revenue Protection)', () => <UpgradeModal open onOpenChange={() => {}} currentTier="pro" requiredTier="enterprise" currentLimit={10} nextLimit={-1} />, 'What you get on Revenue Protection:'],
]

function serveOffer(on: boolean) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify(on ? { trial: { enabled: true, days: 14, plans: ['starter', 'pro'], cardRequired: true } } : { trial: { enabled: false } }), {
      headers: { 'Content-Type': 'application/json' },
    }))
}

async function renderedText(make: () => ReactNode, on: boolean, ready: string): Promise<string> {
  const { container, baseElement, unmount } = render(<>{make()}</>)
  await waitFor(() => expect(baseElement.textContent).toContain(ready))
  await waitFor(() => {
    for (const el of container.querySelectorAll('[data-trial]')) expect(el.getAttribute('data-trial')).toBe(on ? 'on' : 'off')
  })
  const text = baseElement.textContent ?? ''
  unmount()
  return text
}

describe('rendered scan', () => {
  beforeEach(() => resetBillingOfferForTests())
  afterEach(() => vi.restoreAllMocks())

  it.each(SURFACES)('%s, trial OFF: no removed claim and no trial wording at all', async (_name, make, ready) => {
    serveOffer(false)
    const text = await renderedText(make, false, ready)
    expect(hits(text, [...PLAN_BANNED.filter((b) => String(b) !== String(/locked in forever/i)), ...TRIAL_BANNED, /free trial/i, /Start \d+-day trial/])).toEqual([])
  })

  it.each(SURFACES)('%s, trial ON: still no removed claim and never "no credit card"', async (_name, make, ready) => {
    serveOffer(true)
    const text = await renderedText(make, true, ready)
    expect(hits(text, [...PLAN_BANNED.filter((b) => String(b) !== String(/locked in forever/i)), /no credit card/i, /no card required/i, /money-back/i, 'Start Free Trial'])).toEqual([])
  })

  it('pricing page with the trial ON shows the trial line and the trial button', async () => {
    serveOffer(true)
    const text = await renderedText(() => <PricingPage />, true, 'Compare Plans')
    expect(text).toContain('14-day free trial on Cost Control and Optimization Engine (card required)')
    expect(text).toContain('Start 14-day trial')
    expect(text).toContain('What happens after my free trial?')
  })
})
