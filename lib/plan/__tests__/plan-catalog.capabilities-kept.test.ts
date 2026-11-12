/**
 * Fixing a claim never removes a capability (CAT-1 binding rule).
 *
 * LEGACY is a frozen copy of every plan-feature line on every pricing surface
 * before CAT-1 (origin/main a23f254f): the pricing cards (M), the comparison
 * table (T), the in-app upgrade page (U), the homepage teaser (L), the
 * /enterprise plan cards (E), the mid-market plan card (G) and the team-limit
 * upgrade modal (A). Each maps to the catalog line(s) that carry it now. Only
 * the two items the Pricing Mock retired may leave (RETIRED), plus the drops
 * the founder approved by name (DROPPED). Everything else, built or not, must
 * still be in the catalog and on a rendered surface.
 */
import { describe, it, expect } from 'vitest'
import { FEATURES, RETIRED, VALUE_ROWS, PLANS, feature } from '../plan-catalog'
import { pricingFaqs } from '@/components/billing/pricing-faq'

type Target = string | readonly string[]
const R = (id: string) => `RETIRED:${id}`
const D = (decision: string) => `DROPPED:${decision}`
/** A capability the FAQ itself keeps saying (not a plan line): the FAQ must still contain this text. */
const FAQ = (text: string) => `FAQ:${text}`

const LEGACY: Record<string, ReadonlyArray<readonly [string, Target]>> = {
  M: [
    ['AWS Account Connection', 'read-only-connection'],
    ['AWS Resource Discovery & Inventory', 'limits-free'],
    ['Cost Overview (real-time spend tracking)', 'cost-overview'],
    ['Security Overview', 'security-findings'],
    ['IAM & MFA Visibility', 'security-checks'],
    ['Security Group Risk Detection', 'security-checks'],
    ['EC2 Encryption Visibility', 'security-checks'],
    ['System Health Status', 'status-page'],
    ['Activity Audit Trail', 'audit-trail'],
    ['Up to 20 AWS resources', 'limits-free'],
    ['Expanded Resource Discovery', 'limits-starter'],
    ['Orphaned Resource Detection', 'idle-orphaned'],
    ['Cost Optimization Opportunities', 'savings-list'],
    ['Cost Data Export', 'inventory-export'],
    ['Security Findings', 'security-findings'],
    ['Active Alerts', 'operational-health'],
    ['Alert History', 'alert-history'],
    ['Email Notifications', 'notifications'],
    ['Team Management', 'team-management'],
    ['Billing & Invoices', 'billing-invoices'],
    ['Slack Notifications', 'notifications'],
    ['Up to 60 resources', 'limits-starter'],
    ['3 team members', 'members-starter'],
    ['30-day cost history', 'cost-trend'],
    ['✨ AI Chat Assistant', 'ai-chat'],
    ['✨ Natural-Language Queries', 'nl-search'],
    ['Cost Optimization — EC2, EBS, RDS, S3, Lambda, DynamoDB', ['savings-checks', 'rds-checks']],
    ['Reserved Instance & Rightsizing Opportunities', ['reserved-instances', 'rightsizing']],
    ['Resource Efficiency Analysis', 'efficiency'],
    ['Team Cost Attribution', 'team-attribution'],
    ['Predictive Budget Forecasting', 'forecast'],
    ['✨ AI-Generated Reports', 'ai-reports'],
    ['✨ Scheduled AI Reports', 'scheduled-ai-reports'],
    ['DORA Metrics', 'dora'],
    ['Advanced Security Overview', 'advanced-security-overview'],
    ['Risk Score', 'risk-score'],
    ['PCI DSS, CIS Compliance Readiness (Security Hub-backed)', 'pci-cis'],
    ['Advanced Alert Configuration', 'advanced-alert-config'],
    ['Webhook Integrations', 'webhooks-jira'],
    ['Up to 500 resources', 'limits-pro'],
    ['10 team members', 'members-pro'],
    ['90-day history', 'cost-trend'],
    ['Priority Support', 'support-pro'],
    ['Unlimited Resources', 'limits-enterprise'],
    ['Multi-Account Visibility', 'multi-account'],
    ['Enterprise Optimization Rules', 'optimization-rules'],
    ['Custom Optimization Policies', 'custom-optimization-policies'],
    ['Enterprise Security Command Center', R('security-command-center')],
    ['Advanced Compliance Management', ['custom-frameworks', 'soc2-evidence']],
    ['Full PDF Compliance Reports', 'scheduled-reports'],
    ['Custom Anomaly Rules', 'custom-anomaly-rules'],
    ['SLO Dashboard & Management', 'slo'],
    ['Approval-Based Remediation Workflows', 'remediation'],
    ['SAML/SSO', 'sso'],
    ['Scheduled Reports', 'scheduled-reports'],
    ['Custom Integrations', 'custom-integrations'],
    ['Dedicated CSM', 'support-enterprise'],
    ['SLA', ['support-enterprise', 'row-sla']],
    ['Implementation Rules', R('implementation-rules')],
  ],
  T: [
    ['AWS Account Connection', 'read-only-connection'],
    ['AWS Resource Discovery & Inventory', 'row-resource-types'],
    ['Expanded Resource Discovery', 'row-resource-types'],
    ['Multi-Account Visibility', 'multi-account'],
    ['AWS Resources', 'row-resources'],
    ['Team Members', 'row-team-members'],
    ['Cost History', 'cost-trend'],
    ['Cost Overview (real-time spend tracking)', 'cost-overview'],
    ['Orphaned Resource Detection', 'idle-orphaned'],
    ['Cost Optimization Opportunities', 'savings-list'],
    ['Cost Data Export', 'inventory-export'],
    ['Cost Optimization — EC2, EBS, RDS, S3, Lambda, DynamoDB', ['savings-checks', 'rds-checks']],
    ['Reserved Instance & Rightsizing Opportunities', ['reserved-instances', 'rightsizing']],
    ['Resource Efficiency Analysis', 'efficiency'],
    ['Team Cost Attribution', 'team-attribution'],
    ['Predictive Budget Forecasting', 'forecast'],
    ['Enterprise Optimization Rules', 'optimization-rules'],
    ['Custom Optimization Policies', 'custom-optimization-policies'],
    ['Security Overview', 'security-findings'],
    ['IAM & MFA Visibility', 'security-checks'],
    ['Security Group Risk Detection', 'security-checks'],
    ['EC2 Encryption Visibility', 'security-checks'],
    ['Security Findings', 'security-findings'],
    ['Advanced Security Overview', 'advanced-security-overview'],
    ['Risk Score', 'risk-score'],
    ['PCI DSS, CIS Compliance Readiness', 'pci-cis'],
    ['Enterprise Security Command Center', R('security-command-center')],
    ['Advanced Compliance Management', ['custom-frameworks', 'soc2-evidence']],
    ['Full PDF Compliance Reports', 'scheduled-reports'],
    ['Custom Anomaly Rules', 'custom-anomaly-rules'],
    ['AI Chat Assistant', 'ai-chat'],
    ['Natural-Language Queries', 'nl-search'],
    ['AI-Generated Reports', 'ai-reports'],
    ['Scheduled AI Reports', 'scheduled-ai-reports'],
    ['Active Alerts', 'operational-health'],
    ['Alert History', 'alert-history'],
    ['Advanced Alert Configuration', 'advanced-alert-config'],
    ['DORA Metrics', 'dora'],
    ['SLO Dashboard & Management', 'slo'],
    ['Approval-Based Remediation Workflows', 'remediation'],
    ['Team Management', 'team-management'],
    ['SAML/SSO', 'sso'],
    ['Email Notifications', 'notifications'],
    ['Slack Notifications', 'notifications'],
    ['Webhook Integrations', 'webhooks-jira'],
    ['Custom Integrations', 'custom-integrations'],
    ['Activity Audit Trail', 'audit-trail'],
    ['Billing & Invoices', 'billing-invoices'],
    ['Scheduled Reports', 'scheduled-reports'],
    ['System Health Status', 'status-page'],
    ['Priority Support', 'row-support'],
    ['Dedicated CSM', 'row-support'],
    ['SLA', 'row-sla'],
    ['Implementation Rules', R('implementation-rules')],
  ],
  U: [
    ['Up to 60 AWS resources', 'limits-starter'],
    ['15 resource types', 'limits-starter'],
    ['Idle & orphaned resource detection', 'idle-orphaned'],
    ['Cost attribution by team', 'team-attribution'],
    ['Actionable savings recommendations', 'savings-list'],
    ['Infrastructure monitoring', 'operational-health'],
    ['Active alerts & alert history', ['operational-health', 'alert-history']],
    ['Export reports (CSV/PDF)', 'inventory-export'],
    ['Up to 5 team members', 'members-starter'],
    ['Email support', 'support-starter'],
    ['✨ AI Chat Assistant (unlimited queries)', 'ai-chat'],
    ['✨ Anomaly Detection (4 detection types)', 'anomaly-detection'],
    ['✨ Natural Language Search', 'nl-search'],
    ['✨ AI Cost Optimization (8 types)', 'savings-checks'],
    ['✨ On-Demand AI Reports', 'ai-reports'],
    ['✨ Smart AI Recommendations', 'ai-cost-insights'],
    ['Up to 500 AWS resources', 'limits-pro'],
    ['Risk score & trends', 'risk-score'],
    ['SLO Dashboard', 'slo'],
    ['DORA metrics & engineering performance', 'dora'],
    ['Slack & Jira integrations', ['notifications', 'webhooks-jira']],
    ['Webhook integrations (5 endpoints)', 'webhooks-jira'],
    ['Up to 10 team members', 'members-pro'],
    ['Priority support', 'support-pro'],
    ['✨ Scheduled AI Reports (weekly/monthly)', 'scheduled-ai-reports'],
    ['✨ Weekly AI Email Summaries', ['weekly-ai-summary', 'weekly-ai-recommendations']],
    ['✨ Custom Anomaly Detection Rules', 'custom-anomaly-rules'],
    ['✨ Executive AI Reports (auto-delivered monthly to leadership)', 'scheduled-ai-reports'],
    ['Unlimited AWS resources', 'limits-enterprise'],
    ['Custom compliance frameworks', 'custom-frameworks'],
    ['SOC 2 readiness support (in development — technical evidence, not certification)', 'soc2-evidence'],
    ['Auto-remediation workflows', 'remediation'],
    ['Advanced SLO management', 'slo'],
    ['Multi-account monitoring', 'multi-account'],
    ['SSO/SAML authentication', 'sso'],
    ['Dedicated account manager', 'support-enterprise'],
    ['24/7 priority support', 'support-pro'],
  ],
  L: [
    ['20 AWS resources', 'limits-free'],
    ['Basic cost dashboard', 'cost-overview'],
    ['7-day data history', 'cost-trend'],
    ['Email alerts', 'notifications'],
    ['60 AWS resources', 'limits-starter'],
    ['AI cost insights', 'ai-cost-insights'],
    ['30-day history', 'cost-trend'],
    ['Slack alerts', 'notifications'],
    ['3 team members', 'members-starter'],
    ['500 AWS resources', 'limits-pro'],
    ['All 8 AI features', ['ai-chat', 'nl-search', 'ai-reports']],
    ['90-day history', 'cost-trend'],
    ['DORA metrics', 'dora'],
    ['Up to 10 members', 'members-pro'],
    ['Priority support', 'support-pro'],
    ['Unlimited resources', 'limits-enterprise'],
    ['Custom integrations', 'custom-integrations'],
    ['Unlimited history', 'cost-trend'],
    ['SSO / SAML', 'sso'],
    ['Dedicated CSM', 'support-enterprise'],
    ['SLA guarantee', 'support-enterprise'],
  ],
  E: [
    ['1 AWS account', 'row-aws-accounts'],
    ['5 AI reports/month', D('C1-D14: Visibility has no AI reports; AI reports stay listed on Optimization Engine (ai-reports)')],
    ['Community support', 'support-free'],
    ['Unlimited AWS accounts', 'multi-account'],
    ['SOC 2 readiness tools', 'soc2-evidence'],
    ['Unlimited AI reports', 'ai-reports'],
    ['Priority support', 'support-pro'],
    ['SSO, priority support, tailored security, and custom contracts', ['sso', 'support-enterprise']],
  ],
  G: [
    ['Up to 500 AWS resources', 'limits-pro'],
    ['Unlimited team members', 'members-pro'],
    ['Multi-team RBAC', 'team-management'],
    ['Cost attribution & budgets', ['team-attribution', D('G5: "budgets" (the mock replaced budget wording with "Forecast future AWS spend")')]],
    ['SOC 2 readiness / PCI-DSS scanning', ['pci-cis', 'soc2-evidence']],
    ['SAML SSO integration', 'sso'],
    ['DORA metrics dashboard', 'dora'],
    ['Auto-remediation workflows', 'remediation'],
    ['Audit logs & reporting', ['audit-trail', 'scheduled-reports']],
    ['Slack & PagerDuty integration', ['notifications', 'pagerduty']],
    ['Priority support (4hr SLA)', 'support-pro'],
  ],
  A: [
    ['Up to 100 AWS resources', 'limits-pro'],
    ['Advanced analytics & reports', 'ai-reports'],
    ['Cost optimization insights', 'savings-list'],
    ['Compliance scanning (CIS, PCI-DSS, NIST 800-53) + SOC 2 readiness', ['pci-cis', 'soc2-evidence']], // NIST named in pci-cis (M-1)
    ['Unlimited AWS resources', 'limits-enterprise'],
    ['Priority support & SLA', 'support-enterprise'],
    ['SSO & advanced security', 'sso'],
    ['Dedicated account manager', 'support-enterprise'],
    ['Up to 20 AWS resources', 'limits-starter'],
    ['Cost analytics & alerts', ['savings-list', 'notifications']],
    ['Email support', 'support-starter'],
  ],
  // The pricing FAQ's capability mentions before CAT-1 (catalog-step1 §4.1: export, API, limit emails, support tiers).
  F: [
    ['export all your data anytime in CSV or JSON format', 'inventory-export'],
    ['Starter plans and above include export functionality', 'inventory-export'],
    ['You can also access your data via API on Enterprise plans', 'api-keys'],
    ["We'll send you email notifications as you approach your limit", FAQ('Email warnings as you approach the limit are coming soon.')],
    ['Free tier gets community support', 'support-free'],
    ['Starter includes email support (24hr response)', 'support-starter'],
    ['Pro gets priority support (4hr response) plus Slack integration', ['support-pro', 'notifications']],
    ['Enterprise includes a dedicated account manager and 24/7 priority support', 'support-enterprise'],
  ],
}

/** Every catalog id at the CAT-1 build. The list may only grow. */
const PINNED_IDS = [
  'limits-free', 'read-only-connection', 'cost-overview', 'cost-trend', 'savings-summary', 'top-risk', 'security-findings',
  'security-checks', 'operational-health', 'alert-history', 'weekly-ai-summary', 'audit-trail', 'status-page', 'support-free',
  'limits-starter', 'savings-list', 'idle-orphaned', 'savings-source', 'review-findings', 'notifications', 'ai-cost-insights',
  'inventory-export', 'team-management', 'billing-invoices', 'members-starter', 'support-starter',
  'limits-pro', 'savings-checks', 'rds-checks', 'reserved-instances', 'rightsizing', 'ai-chat', 'nl-search', 'ai-reports',
  'anomaly-detection', 'forecast', 'risk-score', 'pci-cis', 'advanced-alert-config', 'webhooks-jira', 'api-keys', 'efficiency',
  'dora', 'team-attribution', 'advanced-security-overview', 'pagerduty', 'members-pro', 'support-pro',
  'limits-enterprise', 'soc2-evidence', 'custom-frameworks', 'sso', 'remediation', 'optimization-rules', 'custom-anomaly-rules',
  'slo', 'scheduled-reports', 'dora-benchmarks', 'multi-account', 'scheduled-ai-reports', 'custom-optimization-policies',
  'custom-integrations', 'members-enterprise', 'support-enterprise',
  // Added after CAT-1: WE-D1 (founder 2026-11-11) split the weekly email's AI part into its own Coming soon row.
  'weekly-ai-recommendations',
]

const featureIds = new Set(FEATURES.map((f) => f.id))
const valueRowIds = new Set(VALUE_ROWS.map((r) => r.id))
const onACard = new Set(PLANS.flatMap((p) => p.card))
const retiredIds = new Set(RETIRED.map((r) => r.id))

const targets = (t: Target) => (typeof t === 'string' ? [t] : [...t])
const faqText = [false, true].flatMap((on) => pricingFaqs({ on, days: 14, plansOr: 'Cost Control or Optimization Engine' }))
  .map((q) => `${q.question} ${q.answer}`).join('\n')
const allTargets = Object.values(LEGACY).flatMap((lines) => lines.flatMap(([, t]) => targets(t)))

describe('no listed capability disappears', () => {
  it.each(Object.entries(LEGACY).flatMap(([surface, lines]) => lines.map(([old, t]) => [surface, old, t] as const)))(
    '%s "%s" is still listed',
    (_surface, _old, target) => {
      for (const id of targets(target)) {
        if (id.startsWith('DROPPED:')) continue
        if (id.startsWith('FAQ:')) {
          expect(faqText, 'the FAQ dropped a capability it listed').toContain(id.slice('FAQ:'.length))
          continue
        }
        if (id.startsWith('RETIRED:')) {
          expect(retiredIds.has(id.slice('RETIRED:'.length)), `${id} is not a recorded retirement`).toBe(true)
          continue
        }
        expect(featureIds.has(id) || valueRowIds.has(id), `${id}: a capability must stay listed as Coming soon`).toBe(true)
        if (featureIds.has(id)) {
          const f = FEATURES.find((x) => x.id === id)!
          // Rendered somewhere: the comparison table shows every table row; the rest are plan-card lines.
          expect(f.table !== false || onACard.has(id), `${id} is in the catalog but on no surface`).toBe(true)
        }
      }
    },
  )

  it('every catalog id pinned at the CAT-1 build is still there (the list may only grow)', () => {
    for (const id of PINNED_IDS) {
      expect(featureIds.has(id), `${id} was removed: a capability must stay listed as Coming soon`).toBe(true)
    }
  })

  it('a capability named inside an old line is named in its new line (NIST 800-53, founder M-1)', () => {
    expect(feature('pci-cis').label).toContain('NIST 800-53')
    expect(feature('pci-cis').label).toContain('PCI DSS')
    expect(feature('pci-cis').label).toContain('CIS')
  })

  it('only the two Pricing Mock retirements have left', () => {
    expect([...retiredIds].sort()).toEqual(['implementation-rules', 'security-command-center'])
    expect(allTargets.filter((t) => t.startsWith('RETIRED:')).map((t) => t.slice(8)).sort()).toEqual(
      ['implementation-rules', 'implementation-rules', 'security-command-center', 'security-command-center'],
    )
  })

  it('the only other drops are the two the founder approved by name', () => {
    expect(allTargets.filter((t) => t.startsWith('DROPPED:')).length).toBe(2)
  })
})
