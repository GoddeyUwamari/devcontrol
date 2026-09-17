/**
 * Coverage for the SOC 2 Readiness product-truthfulness correction (PR1 of
 * the approved SOC 2 Readiness blueprint).
 *
 * DevControl is building SOC 2 Readiness — technical evidence and readiness
 * gaps for a customer's SOC 2 program — never a certification, an
 * independent audit, or a compliance determination DevControl itself makes.
 * Prior to this fix, numerous customer-facing surfaces (billing, the in-app
 * Enterprise page, marketing/solutions pages, dashboard upsell copy, and
 * several dormant components) claimed or implied SOC 2/HIPAA/GDPR
 * certification, an "audit in progress," a BAA available on request, or
 * automated audit-report generation — none of which exist.
 *
 * This test scans the exact source files touched by that fix (customer-facing
 * only) for the prohibited phrases and confirms the approved "readiness"
 * language replaced them. It deliberately does NOT scan the whole repo:
 * legitimate internal comments (e.g. compliance-engine.service.ts, the
 * retired /compliance page's own historical docblock), tests, and the
 * Privacy Policy legal copy (flagged separately for legal review, not
 * modified here) are out of scope and would produce false failures.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..', '..')

const CORRECTED_FILES = [
  'app/(app)/settings/billing/upgrade/page.tsx',
  'app/(app)/settings/alerts/page.tsx',
  'app/(app)/connect-aws/page.tsx',
  'app/(app)/enterprise/page.tsx',
  'app/(app)/security/page.tsx',
  'app/(app)/dashboard/page.tsx',
  'app/(marketing)/solutions/startups/data/startupFAQs.ts',
  'app/(marketing)/solutions/startups/page.tsx',
  'app/(marketing)/solutions/security/data/securityFeatures.ts',
  'app/(marketing)/solutions/security/data/securityMetrics.ts',
  'app/(marketing)/solutions/security/page.tsx',
  'app/(marketing)/solutions/enterprise/page.tsx',
  'app/(marketing)/solutions/enterprise/data/enterpriseValueCards.ts',
  'app/(marketing)/solutions/scaleups/page.tsx',
  'app/(marketing)/solutions/mid-market/page.tsx',
  'app/(marketing)/solutions/mid-market/data/midMarketValueCards.ts',
  'app/(marketing)/solutions/mid-market/data/midMarketQuickWins.ts',
  'app/(marketing)/docs/getting-started/page.tsx',
  'app/(marketing)/tour/page.tsx',
  'components/ui/security-badge.tsx',
  'components/landing/MarketingContent.tsx',
  'components/landing/PricingPreview.tsx',
  'components/dashboard/risk-score-trend-chart.tsx',
  'components/dashboard/security-posture.tsx',
  'components/dashboard/PlatformPreview.tsx',
  'components/dashboard/ValuePropCards.tsx',
  'components/dashboard/FAQ.tsx',
  'components/dashboard/TrustIndicators.tsx',
  'components/infrastructure/InfrastructureValueProps.tsx',
  'components/infrastructure/InfrastructureSecurityBadges.tsx',
  'components/billing/trust-badges.tsx',
  'components/billing/pricing-faq.tsx',
  'components/billing/upgrade-modal.tsx',
  'lib/demo/sales-demo-data.ts',
]

/** Strip block/line comments so historical/explanatory comments never trip a prohibited-phrase assertion. */
function readCode(relPath: string): string {
  const full = fs.readFileSync(path.join(ROOT, relPath), 'utf-8')
  return full.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const PROHIBITED_PATTERNS: Array<[RegExp, string]> = [
  [/SOC\s*2\s*(Type\s*II\s*)?certif(y|ied|ication)/i, 'SOC 2 certification claim'],
  [/SOC\s*2\s*audit(?!or)/i, 'SOC 2 audit claim'],
  [/SOC\s*2\s+compliant/i, 'SOC 2 compliant claim'],
  [/SOC\s*2\s+compliance\s+score/i, 'SOC 2 compliance score claim'],
  [/\bSOC\s*2\s+PASS\b|\bSOC\s*2\s+FAIL\b/i, 'SOC 2 PASS/FAIL claim'],
  [/audit\s+in\s+progress/i, '"audit in progress" claim'],
  [/audit\s+underway/i, '"audit underway" claim'],
  [/audit[- ]ready/i, '"audit-ready" claim'],
  [/compliance\s+audit\s+report/i, 'compliance audit report claim'],
  [/DevControl\s+certifies/i, 'DevControl-certifies claim'],
  [/DevControl\s+audits/i, 'DevControl-audits claim'],
  [/BAA\s+on\s+request/i, 'unsupported BAA-availability claim'],
  [/HIPAA\s+compliant/i, 'HIPAA compliant claim'],
  [/GDPR\s+compliant/i, 'GDPR compliant claim'],
  [/DPA\s+available/i, 'unsupported DPA-availability claim'],
]

describe('SOC 2 Readiness messaging — corrected customer-facing surfaces', () => {
  it.each(CORRECTED_FILES)('%s contains none of the prohibited SOC 2/HIPAA/GDPR/BAA claims', (relPath) => {
    const code = readCode(relPath)
    for (const [pattern, label] of PROHIBITED_PATTERNS) {
      expect(code, `${relPath} still contains a ${label}`).not.toMatch(pattern)
    }
  })

  it('the billing upgrade page no longer sells "SOC 2 & HIPAA named-control audit reports"', () => {
    const code = readCode('app/(app)/settings/billing/upgrade/page.tsx')
    expect(code).not.toMatch(/named-control audit reports/i)
    expect(code).toMatch(/SOC 2 readiness support/i)
  })

  it('the Enterprise page no longer claims a HIPAA BAA or GDPR compliance, and reframes SOC 2 as readiness planning', () => {
    const code = readCode('app/(app)/enterprise/page.tsx')
    expect(code).not.toMatch(/name:\s*'HIPAA'/)
    expect(code).not.toMatch(/name:\s*'GDPR'/)
    expect(code).toMatch(/SOC 2 Readiness/)
    expect(code).toMatch(/Readiness planning underway/i)
  })

  it('the connect-aws security panel describes SOC 2 readiness planning, not an audit underway', () => {
    const code = readCode('app/(app)/connect-aws/page.tsx')
    expect(code).toMatch(/SOC 2 readiness planning underway/i)
  })

  it('dashboard demo compliance chips reference only Security Hub-backed frameworks (CIS, PCI-DSS, NIST 800-53), never SOC2 or GDPR', () => {
    const code = readCode('app/(app)/dashboard/page.tsx')
    const chipArrayMatches = code.match(/\['CIS AWS', 'PCI-DSS', 'NIST 800-53'\]/g) ?? []
    expect(chipArrayMatches.length).toBe(2)
    expect(code).not.toMatch(/'SOC2', 'CIS AWS', 'GDPR'/)
  })

  it('the security page no longer falsely enumerates "CIS, NIST, SOC 2, PCI-DSS" as passing for any org with enabled custom frameworks', () => {
    const code = readCode('app/(app)/security/page.tsx')
    expect(code).not.toMatch(/'CIS, NIST, SOC 2, PCI-DSS'/)
    expect(code).toMatch(/'All frameworks passing'/)
  })

  it('marketing solutions pages describe SOC 2 as readiness/planning, never a completed audit or certification', () => {
    for (const relPath of [
      'app/(marketing)/solutions/startups/page.tsx',
      'app/(marketing)/solutions/security/page.tsx',
      'app/(marketing)/solutions/enterprise/page.tsx',
      'app/(marketing)/solutions/scaleups/page.tsx',
      'app/(marketing)/solutions/mid-market/page.tsx',
    ]) {
      const code = readCode(relPath)
      expect(code, `${relPath} should mention SOC 2 readiness`).toMatch(/SOC 2 readiness|SOC 2 Readiness/)
    }
  })

  it('the startups FAQ no longer claims DevControl reports are used as auditor evidence or that DevControl performs SOC 2 audits', () => {
    const code = readCode('app/(marketing)/solutions/startups/data/startupFAQs.ts')
    expect(code).not.toMatch(/map directly to SOC 2 controls/i)
    expect(code).not.toMatch(/evidence during their audits/i)
    expect(code).toMatch(/independent CPA\/auditor still performs your actual SOC 2 examination/i)
  })
})

describe('/compliance/frameworks SOC 2 card — protected invariant', () => {
  it('the real (non-demo) SOC 2 standard card remains attributed "not_implemented", unchanged by this PR', () => {
    const code = readCode('app/(app)/compliance/frameworks/page.tsx')
    expect(code).toMatch(/key:\s*'soc2'[^}]*attribution:\s*'not_implemented'/)
  })
})
