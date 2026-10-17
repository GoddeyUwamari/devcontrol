/**
 * AUDIT-TRUTH-PR3: the public marketing surface claims only what DevControl
 * does today.
 *
 * Our buyer checks our numbers against their AWS bill, Cost Explorer and
 * Trusted Advisor. One invented outcome, stat or capability costs the deal.
 * This test scans the source of every page a visitor can reach from the
 * marketing nav or footer, plus the homepage and the components it renders,
 * for claims that were removed because nothing in the product backs them.
 *
 * The page list is derived from the nav and footer themselves, so a new
 * nav/footer link is scanned automatically. Comments are stripped first, so
 * an explanatory comment that names a removed claim never trips it.
 *
 * Out of scope: the legal pages (legal copy, reviewed separately, as in
 * soc2-readiness-messaging.test.ts), the auth pages, and the retired pages
 * that next.config.ts redirects (retired-marketing-pages.test.ts proves
 * nothing links to them).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..', '..')
const MARKETING = 'app/(marketing)'

/** The homepage and every component it renders (MarketingContent and its children). */
const HOMEPAGE_FILES = [
  `${MARKETING}/page.tsx`,
  'components/landing/MarketingContent.tsx',
  'components/landing/HeroSection.tsx',
  'components/landing/FeaturePanels.tsx',
  'components/landing/AIFeaturesSection.tsx',
  'components/landing/PersonaSection.tsx',
  'components/landing/FounderSection.tsx',
  'components/landing/PricingPreview.tsx',
  'components/landing/CTASection.tsx',
]

/** Rendered on every marketing page. */
const CHROME_FILES = ['components/layout/MarketingNav.tsx', 'components/footer.tsx']

/** The site-wide meta description: on every page, and the snippet search results show. */
const SITE_FILES = ['app/layout.tsx']

/** Rendered by /pricing. */
const PRICING_COMPONENTS = ['components/billing/pricing-faq.tsx', 'components/billing/feature-comparison-table.tsx']

/** Linked from the nav/footer but deliberately not scanned here (see the docblock). */
const NOT_SCANNED_ROUTES = new Set(['/', '/login', '/register', '/legal/privacy', '/legal/terms', '/legal/cookies'])

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf-8')
}

/** Strip block/line comments so explanatory comments never trip a banned-claim assertion. */
function readCode(relPath: string): string {
  return read(relPath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/** Internal routes linked from the marketing nav and footer. */
function navAndFooterRoutes(): string[] {
  const routes = new Set<string>()
  for (const file of CHROME_FILES) {
    for (const [, href] of read(file).matchAll(/href(?:=|:\s*)["'{`]+(\/[^"'`#?\s}]*)/g)) {
      routes.add(href.replace(/\/$/, '') || '/')
    }
  }
  return [...routes].sort()
}

function pageFileFor(route: string): string {
  return `${MARKETING}${route}/page.tsx`
}

const reachableRoutes = navAndFooterRoutes().filter((r) => !NOT_SCANNED_ROUTES.has(r))
const SCANNED_FILES = [
  ...new Set([...SITE_FILES, ...HOMEPAGE_FILES, ...CHROME_FILES, ...PRICING_COMPONENTS, ...reachableRoutes.map(pageFileFor)]),
]

const BANNED: Array<[RegExp, string]> = [
  // Detectors DevControl does not have (backend optimization-rules.ts: planned, or absent).
  [/idle\s+RDS/i, 'idle-RDS detection (rds_idle is planned)'],
  [/snapshot/i, 'snapshot-waste detection (no detector)'],
  [/rightsiz|right-siz/i, 'rightsizing (not implemented; remediation disabled)'],
  [/anomal(y|ies)/i, 'anomaly detection (no detector runs)'],
  [/auto[- ]?remediat/i, 'auto-remediation (approval-gated and kill-switched)'],
  [/drift\s+detect/i, 'infrastructure drift detection'],
  // Fabricated outcomes, social proof and stats.
  [/client\s+outcome/i, 'customer outcome (no customer stories exist)'],
  [/replace with real customer/i, 'placeholder testimonial'],
  [/trusted\s+by/i, '"trusted by" social proof'],
  [/fortune\s*500/i, 'Fortune 500 claim'],
  [/\$\s?800\b|\$\s?8,000|\$\s?8K/i, 'the "$800-$8,000+ waste" range'],
  [/\d+(\.\d+)?%\s*(forecast\s+)?accura/i, 'forecast-accuracy percentage'],
  [/save\s+up\s+to|up\s+to\s+\d+%\s+(on|off)\s+(your\s+)?AWS/i, '"save up to N%" on AWS'],
  [/cut\s+(your\s+)?AWS\s+(costs?|bills?)\s+(by\s+)?\d/i, '"cut AWS costs by N%"'],
  [/\b\d+(\.\d+)?\s?[x×]\s+(faster|longer|more|higher)/i, '"Nx faster" stat'],
  [/\d+%\s+(higher|lower|faster|less|more|of\s+(similar\s+)?companies)/i, 'unsourced comparative percentage'],
  [/outperform/i, 'benchmark ranking'],
  [/top\s+\d+%|elite\s+tier/i, 'percentile ranking'],
  // Business terms removed pending the founder.
  [/\bSLAs?\b/, 'SLA claim'],
  [/99\.9+%/, 'uptime percentage'],
  [/money[- ]back/i, 'money-back guarantee'],
  [/first\s+50\s+customers|founding\s+member/i, 'founding-member price lock'],
  // Capabilities stated more broadly than the code supports.
  [/one[- ]click|1[- ]click/i, '"one-click"'],
  [/cloudformation/i, 'CloudFormation onboarding (onboarding is a manual IAM role)'],
  [/datadog|pagerduty|terraform|kubernetes/i, 'integration with no code behind it'],
  [/\b(GCP|Google\s+Cloud|Azure)\b/, 'other-cloud support'],
  [/real[- ]time/i, '"real-time" (scans run every 6 hours)'],
  [/TLS\s*1\.3/i, 'TLS 1.3 claim'],
  [/AES-256(?!-GCM)/, 'blanket AES-256 claim (only stored secrets use AES-256-GCM)'],
  [/never\s+store\s+(your\s+)?(AWS\s+)?credentials|no\s+credential\s+storage/i, '"never store credentials" (an endpoint stores encrypted keys)'],
  [/@devcontrol\/(cli|sdk)|pip\s+install\s+devcontrol|deploy-action/i, 'CLI / SDK / GitHub Action that does not exist'],
  [/graphql/i, 'GraphQL API (none exists)'],
  [/(under|in|within)\s+\d+\s+(seconds|mins?|minutes|hours)\b/i, 'timed speed claim (use "Takes a few minutes")'],
]

describe('marketing banned claims: scope', () => {
  it('derives the reachable pages from the nav and footer, and every one has a page file', () => {
    expect(reachableRoutes).toEqual(
      expect.arrayContaining(['/tour', '/pricing', '/docs', '/docs/api', '/case-studies', '/changelog', '/contact']),
    )
    for (const route of reachableRoutes) {
      expect(fs.existsSync(path.join(ROOT, pageFileFor(route))), `${route} is linked but has no page`).toBe(true)
    }
  })
})

describe('marketing banned claims', () => {
  it.each(SCANNED_FILES)('%s makes none of the removed claims', (relPath) => {
    const code = readCode(relPath)
    const found = BANNED.filter(([pattern]) => pattern.test(code)).map(
      ([pattern, label]) => `${label}: "${code.match(pattern)?.[0]}"`,
    )
    expect(found, `${relPath} still makes removed claims`).toEqual([])
  })
})

describe('Starter price', () => {
  it('reads one constant everywhere it is shown', () => {
    for (const relPath of [
      'components/landing/PricingPreview.tsx',
      `${MARKETING}/pricing/page.tsx`,
      'app/(app)/settings/billing/upgrade/page.tsx',
      `${MARKETING}/solutions/startups/data/startupFAQs.ts`,
    ]) {
      const code = readCode(relPath)
      expect(code, `${relPath} should read the Starter price constant`).toMatch(/STARTER_MONTHLY_PRICE_(USD|LABEL)/)
      expect(code, `${relPath} hardcodes a Starter price`).not.toMatch(/\$(49|79)\b|price:\s*(49|79)\b/)
    }
  })
})
