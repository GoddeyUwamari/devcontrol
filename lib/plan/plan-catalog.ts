/**
 * The one plan catalog. Every place that lists plans or plan features reads
 * it: the pricing cards and comparison table, the pricing FAQ figures, the
 * in-app upgrade page, the homepage pricing teaser, the /enterprise plan
 * cards, the team-limit upgrade modal and the mid-market plan card. Nothing
 * else may hard-code a plan feature, so the surfaces can't drift.
 *
 * Rules (review-logs/pricing/catalog-step1.md, "CAT-1 Step" and "CAT-1 build"):
 * - Fixing a claim never removes a capability: a feature that isn't ready
 *   stays listed with status 'coming_soon' (lib/plan/__tests__/
 *   plan-catalog.capabilities-kept.test.ts pins every id).
 * - Built features sit at their server gate; plan limits come from
 *   plan-limits.json, which the backend parity test compares with the server.
 * - No entitlement, gate or price changes here: this file describes them.
 *
 * Pure data and pure functions; no React.
 */
import limits from './plan-limits.json'
import { PLAN_NAME, type Tier } from './plan-names'
import type { PlanEntitlement } from './entitlements'

export type { Tier }
export const TIERS: readonly Tier[] = ['free', 'starter', 'pro', 'enterprise']

export type FeatureStatus = 'verified' | 'partial' | 'coming_soon' | 'claim'
export type FeatureBadge = 'Coming soon' | 'Beta'
export const COMING_SOON_BADGE: FeatureBadge = 'Coming soon'
export const BETA_BADGE: FeatureBadge = 'Beta'

/** Comparison-table groups, in table order (Pricing Mock). */
export const GROUPS = [
  { id: 'limits', label: 'Limits' },
  { id: 'connection', label: 'Connection' },
  { id: 'money', label: 'Find the money' },
  { id: 'risk', label: 'Find the risk' },
  { id: 'watches', label: 'It watches for you' },
  { id: 'ai', label: 'AI and reports' },
  { id: 'team', label: 'Team, integrations and admin' },
  { id: 'support', label: 'Support' },
] as const
export type GroupId = (typeof GROUPS)[number]['id']

export interface CatalogFeature {
  /** Stable id; the capabilities-kept test pins the full list. */
  id: string
  /** The one customer string, used on every surface (badge shown separately). */
  label: string
  /** Lowest plan that includes it. */
  tier: Tier
  status: FeatureStatus
  /** Required for 'coming_soon' ("Coming soon"); "Beta" only for efficiency and remediation. */
  badge?: FeatureBadge
  group: GroupId
  /** The comparison table's "Key" chip (the rows that had it before CAT-1). */
  key?: boolean
  /** Shows the small "AI" chip. */
  ai?: boolean
  /** false = a plan-card line that the comparison table shows as a value row instead. */
  table?: boolean
  /** Ties the line to PLAN_ENTITLEMENTS (the parity test checks the tier). */
  entitlement?: PlanEntitlement
  /** Where the claim is proven (never rendered). */
  evidence: string
}

const CS = { status: 'coming_soon', badge: COMING_SOON_BADGE } as const

export const FEATURES: readonly CatalogFeature[] = [
  // ── Visibility ────────────────────────────────────────────────────────────
  { id: 'limits-free', tier: 'free', group: 'limits', status: 'partial', table: false,
    label: 'Monitor up to 20 AWS resources · 4 core types (EC2, EBS, RDS, S3)',
    evidence: 'TIER_LIMITS.free.maxResources 20; TIER_RESOURCE_TYPES.free; limit stops the inventory view once over (awsResources.routes.ts)' },
  { id: 'read-only-connection', tier: 'free', group: 'connection', status: 'verified',
    label: 'Read-only connection: AWS SecurityAudit + ViewOnlyAccess, plus a small read-only DevControl policy',
    evidence: 'connect-aws; lib/aws/customer-role-inline-policy.json' },
  { id: 'cost-overview', tier: 'free', group: 'money', status: 'verified',
    label: 'Cost overview from AWS Cost Explorer, updated daily',
    evidence: 'aws-cost.service.ts (Cost Explorer, 4 h cache); /costs' },
  { id: 'cost-trend', tier: 'free', group: 'money', status: 'verified',
    label: '12 months of cost trend',
    evidence: 'costs/page.tsx DATE_RANGES up to 1Y; aws-cost.service.ts trendPeriodUtc; no plan check on /api/platform/costs/trend' },
  { id: 'savings-summary', tier: 'free', group: 'money', status: 'verified',
    label: 'Savings summary: how many savings we found and their estimated total',
    evidence: 'dashboard SavingsOpportunities + /api/cost-recommendations stats (every plan)' },
  { id: 'top-risk', tier: 'free', group: 'risk', status: 'verified',
    label: 'Top Risk: your most important security finding, first',
    evidence: 'dashboard Top Risk (false-positives PR 1)' },
  { id: 'security-findings', tier: 'free', group: 'risk', status: 'verified',
    label: 'Security findings, with accept-risk and a recorded reason',
    evidence: 'account-security-findings.routes.ts (no plan gate); /security' },
  { id: 'security-checks', tier: 'free', group: 'risk', status: 'verified',
    label: 'IAM & MFA, security group and EC2 encryption checks',
    evidence: 'complianceScanner.ts' },
  { id: 'operational-health', tier: 'free', group: 'watches', status: 'verified',
    label: 'Operational health: CloudWatch alarms and "last seen" per resource',
    evidence: 'Operational Health (NEXT_PUBLIC_OBSERVABILITY_V2 on in production, founder 2026-11-11)' },
  { id: 'alert-history', tier: 'free', group: 'watches', ...CS,
    label: 'Alert history',
    evidence: 'alert_history has no org-scoped writer (observability/alerts/page.tsx)' },
  { id: 'weekly-ai-summary', tier: 'free', group: 'ai', status: 'verified',
    label: 'Weekly summary email',
    evidence: 'weekly-ai-summary.job.ts (every plan); no model-written text (WE-D1, founder 2026-11-11)' },
  { id: 'weekly-ai-recommendations', tier: 'free', group: 'ai', ...CS, ai: true,
    label: 'AI recommendations in the weekly email',
    evidence: 'not built: the weekly email has no model-written text; a re-enable needs its own step 1 (WE-D1, WE-D9)' },
  { id: 'audit-trail', tier: 'free', group: 'team', status: 'verified',
    label: 'Activity audit trail',
    evidence: '/audit-logs' },
  { id: 'status-page', tier: 'free', group: 'support', status: 'verified',
    label: 'DevControl status page',
    evidence: 'app/(app)/status/page.tsx' },
  { id: 'support-free', tier: 'free', group: 'support', status: 'claim', table: false,
    label: 'Community support (Slack)',
    evidence: 'service (C1-D11)' },

  // ── Cost Control ──────────────────────────────────────────────────────────
  { id: 'limits-starter', tier: 'starter', group: 'limits', status: 'partial', table: false,
    label: 'Monitor up to 60 AWS resources · 16 resource types',
    evidence: 'TIER_LIMITS.starter.maxResources 60; TIER_RESOURCE_TYPES.starter' },
  { id: 'savings-list', tier: 'starter', group: 'money', status: 'verified', key: true,
    label: 'Full savings list with estimated monthly savings',
    evidence: '/cost-optimization; cost-recommendations.routes.ts' },
  { id: 'idle-orphaned', tier: 'starter', group: 'money', status: 'verified',
    label: 'Idle & orphaned resources: low-activity EC2, unattached EBS volumes, unused Elastic IPs',
    evidence: 'awsResources.routes.ts orphaned (Starter); ec2_idle (low-activity, #304), ebs_unattached, ec2_unused_elastic_ip' },
  { id: 'savings-source', tier: 'starter', group: 'money', status: 'verified',
    label: 'Every saving shows its source: estimated, upper bound or default price',
    evidence: 'lib/savings-basis.ts (estimate, ceiling, default_unlisted_type)' },
  { id: 'review-findings', tier: 'starter', group: 'money', status: 'verified',
    label: 'Review, dismiss and reopen findings; still-detected ones stay visible',
    evidence: 'cost-recommendations.routes.ts dismiss/reopen; cost-finding-freshness.ts' },
  { id: 'notifications', tier: 'starter', group: 'watches', ...CS,
    label: 'Email & Slack notifications',
    evidence: 'alert-config holds config in a process Map; only the test send delivers' },
  { id: 'ai-cost-insights', tier: 'starter', group: 'ai', ...CS, ai: true,
    label: 'AI cost insights',
    evidence: 'not built (Pricing Mock)' },
  { id: 'inventory-export', tier: 'starter', group: 'team', status: 'verified',
    label: 'Resource inventory export (CSV/PDF)', entitlement: 'resourceInventoryExport',
    evidence: 'PLAN_ENTITLEMENTS.resourceInventoryExport; awsResources.routes.ts export' },
  { id: 'team-management', tier: 'starter', group: 'team', status: 'verified',
    label: 'Team management',
    evidence: 'organizations.routes.ts members; TIER_LIMITS.starter.maxUsers 5' },
  { id: 'billing-invoices', tier: 'starter', group: 'team', status: 'verified',
    label: 'Billing & invoices',
    evidence: '/settings/billing; Stripe invoices' },
  { id: 'members-starter', tier: 'starter', group: 'team', status: 'verified', table: false,
    label: 'Up to 5 team members',
    evidence: 'TIER_LIMITS.starter.maxUsers 5' },
  { id: 'support-starter', tier: 'starter', group: 'support', status: 'claim', table: false,
    label: 'Email support',
    evidence: 'service' },

  // ── Optimization Engine ───────────────────────────────────────────────────
  { id: 'limits-pro', tier: 'pro', group: 'limits', status: 'partial', table: false,
    label: 'Monitor up to 500 AWS resources',
    evidence: 'TIER_LIMITS.pro.maxResources 500' },
  { id: 'savings-checks', tier: 'pro', group: 'money', status: 'verified',
    label: '9 automated savings checks across EC2, EBS, S3, Lambda and DynamoDB',
    evidence: 'optimization-rules.ts: 9 implemented rules' },
  { id: 'rds-checks', tier: 'pro', group: 'money', ...CS,
    label: 'RDS savings checks',
    evidence: 'optimization-rules.ts: every RDS rule planned' },
  { id: 'reserved-instances', tier: 'pro', group: 'money', status: 'verified',
    label: 'Reserved Instance opportunities (EC2)',
    evidence: 'ec2_reserved_instances implemented' },
  { id: 'rightsizing', tier: 'pro', group: 'money', ...CS,
    label: 'Rightsizing recommendations',
    evidence: 'optimization-rules.ts: rightsizing planned' },
  { id: 'ai-chat', tier: 'pro', group: 'ai', status: 'verified', ai: true,
    label: 'AI chat assistant',
    evidence: 'ai-chat.routes.ts requirePro' },
  { id: 'nl-search', tier: 'pro', group: 'ai', status: 'verified', ai: true,
    label: 'Natural-language search',
    evidence: 'nl-query.routes.ts requirePro' },
  { id: 'ai-reports', tier: 'pro', group: 'ai', status: 'verified', ai: true,
    label: 'On-demand AI reports: cost, security, infrastructure health and executive summary',
    evidence: 'ai-reports.routes.ts requirePro; ai-reports.controller.ts reportType enum' },
  { id: 'anomaly-detection', tier: 'pro', group: 'watches', ...CS, ai: true,
    label: 'Anomaly detection: cost, CPU, invocation and error-rate spikes',
    evidence: 'anomaly-detection.service.ts returns []; ANOMALY_DETECTION_ACTIVE = false' },
  { id: 'forecast', tier: 'pro', group: 'money', status: 'verified',
    label: 'Forecast future AWS spend',
    evidence: 'forecast.routes.ts requirePro' },
  { id: 'risk-score', tier: 'pro', group: 'risk', status: 'verified',
    label: 'Risk score & trend', entitlement: 'riskScore',
    evidence: 'PLAN_ENTITLEMENTS.riskScore; risk-score.routes.ts' },
  { id: 'pci-cis', tier: 'pro', group: 'risk', status: 'verified', key: true,
    label: 'PCI DSS, CIS & NIST 800-53 Compliance Readiness (requires AWS Security Hub)', entitlement: 'securityHubCis',
    evidence: 'PLAN_ENTITLEMENTS.securityHubCis/securityHubPci/securityHubNist (all pro); security-hub.routes.ts /frameworks/nist (founder M-1 a)' },
  { id: 'advanced-alert-config', tier: 'pro', group: 'watches', ...CS,
    label: 'Advanced alert configuration',
    evidence: 'config screen + test send only' },
  { id: 'webhooks-jira', tier: 'pro', group: 'team', ...CS,
    label: 'Webhooks (up to 5) and Jira',
    evidence: '/api/webhooks answers 501 (WEBHOOKS_AVAILABLE = false); CreateTicketDialog has no importer' },
  { id: 'api-keys', tier: 'pro', group: 'team', ...CS,
    label: 'Developer API keys',
    evidence: '/api/keys answers 501 (API_KEYS_AVAILABLE = false)' },
  { id: 'efficiency', tier: 'pro', group: 'money', status: 'partial', badge: BETA_BADGE,
    label: 'Resource efficiency (estimated)',
    evidence: 'costs/efficiency (cost-tier heuristic)' },
  { id: 'dora', tier: 'pro', group: 'watches', status: 'verified',
    label: 'DORA metrics', entitlement: 'doraMetrics',
    evidence: 'PLAN_ENTITLEMENTS.doraMetrics; needs GitHub deployments' },
  { id: 'team-attribution', tier: 'starter', group: 'money', ...CS,
    label: 'Team cost attribution',
    evidence: 'costs/by-team shows demo data only; its live gate admits Cost Control (costs/by-team/page.tsx) (founder M-2)' },
  { id: 'advanced-security-overview', tier: 'pro', group: 'risk', ...CS,
    label: 'Advanced security overview',
    evidence: 'not defined yet (C1-D4)' },
  { id: 'pagerduty', tier: 'pro', group: 'team', ...CS,
    label: 'PagerDuty integration',
    evidence: 'no code (C1-D13)' },
  { id: 'members-pro', tier: 'pro', group: 'team', status: 'verified', table: false,
    label: 'Up to 10 team members',
    evidence: 'TIER_LIMITS.pro.maxUsers 10' },
  { id: 'support-pro', tier: 'pro', group: 'support', status: 'claim', table: false,
    label: 'Priority email support',
    evidence: 'service' },

  // ── Revenue Protection ────────────────────────────────────────────────────
  { id: 'limits-enterprise', tier: 'enterprise', group: 'limits', status: 'verified', table: false,
    label: 'Unlimited AWS resources',
    evidence: 'TIER_LIMITS.enterprise.maxResources -1' },
  { id: 'soc2-evidence', tier: 'enterprise', group: 'risk', status: 'verified',
    label: 'SOC 2 readiness evidence: technical checks plus your own evidence (not a certification)',
    evidence: 'soc2-customer-evidence.routes.ts requireEnterprise; /compliance/frameworks/soc2' },
  { id: 'custom-frameworks', tier: 'enterprise', group: 'risk', status: 'verified', key: true,
    label: 'Custom compliance frameworks', entitlement: 'complianceFrameworks',
    evidence: 'PLAN_ENTITLEMENTS.complianceFrameworks' },
  { id: 'sso', tier: 'enterprise', group: 'team', status: 'verified', key: true,
    label: 'SAML single sign-on',
    evidence: 'saml.routes.ts requireEnterprise' },
  { id: 'remediation', tier: 'enterprise', group: 'money', status: 'partial', badge: BETA_BADGE, key: true,
    label: 'Remediation workflows with approval',
    evidence: 'remediation.routes.ts requireEnterprise; execution needs ENABLE_AUTOMATED_REMEDIATION' },
  { id: 'optimization-rules', tier: 'enterprise', group: 'money', status: 'verified',
    label: 'Optimization rules you tune (Lambda low-usage threshold)',
    evidence: 'optimization-rules.ts lambda_low_usage/max_invocations; cost-recommendations.routes.ts requireEnterprise' },
  { id: 'custom-anomaly-rules', tier: 'enterprise', group: 'watches', ...CS,
    label: 'Custom anomaly rules',
    evidence: 'custom-anomaly-rules.routes.ts stores rules; nothing evaluates them' },
  { id: 'slo', tier: 'enterprise', group: 'watches', status: 'verified',
    label: 'SLO dashboard & management',
    evidence: 'slo.routes.ts requireEnterprise' },
  { id: 'scheduled-reports', tier: 'enterprise', group: 'ai', status: 'verified',
    label: 'Scheduled reports: cost, security and compliance status (PDF/CSV, by email; Slack coming soon)',
    evidence: 'scheduled-reports.controller.ts report_type + format enums; Slack delivery disabled in CreateScheduleModal' },
  { id: 'dora-benchmarks', tier: 'enterprise', group: 'watches', status: 'verified',
    label: 'Custom DORA benchmarks', entitlement: 'doraCustomBenchmarks',
    evidence: 'PLAN_ENTITLEMENTS.doraCustomBenchmarks' },
  { id: 'multi-account', tier: 'enterprise', group: 'connection', ...CS,
    label: 'Multi-account visibility',
    evidence: 'one AWS account per organization (aws_accounts_org_id_key)' },
  { id: 'scheduled-ai-reports', tier: 'enterprise', group: 'ai', ...CS, ai: true,
    label: 'Scheduled AI reports, including a monthly executive summary to leadership',
    evidence: 'not built' },
  { id: 'custom-optimization-policies', tier: 'enterprise', group: 'money', ...CS,
    label: 'Custom optimization policies',
    evidence: 'not defined yet (C1-D4)' },
  { id: 'custom-integrations', tier: 'enterprise', group: 'team', status: 'claim',
    label: 'Custom integrations',
    evidence: 'service' },
  { id: 'members-enterprise', tier: 'enterprise', group: 'team', status: 'verified', table: false,
    label: 'Unlimited team members',
    evidence: 'TIER_LIMITS.enterprise.maxUsers -1' },
  { id: 'support-enterprise', tier: 'enterprise', group: 'support', status: 'claim', table: false,
    label: 'Named support contact · talk to us about an SLA',
    evidence: 'service (C1-D11; Pricing Mock)' },
]

/** Ids that left the catalog on purpose (Pricing Mock, 2026-11-05). Nothing else may leave. */
export const RETIRED: readonly { id: string; reason: string }[] = [
  { id: 'security-command-center', reason: 'Pricing Mock: retired from public pages (never defined, no route)' },
  { id: 'implementation-rules', reason: 'Pricing Mock: retired from public pages (never defined)' },
]

const byId = new Map(FEATURES.map((f) => [f.id, f]))
export function feature(id: string): CatalogFeature {
  const found = byId.get(id)
  if (!found) throw new Error(`Unknown catalog feature: ${id}`)
  return found
}

// ── Plans ────────────────────────────────────────────────────────────────────

export interface PlanDef {
  tier: Tier
  name: string
  tagline: string
  /** null = "Custom". */
  monthly: number | null
  /** Yearly charge for the annual price, when the plan has one. */
  annualTotal?: number
  popular?: boolean
  /** Shown under the price. */
  priceNote?: string
  /** Plan-card lines, in Pricing Mock order. */
  card: readonly string[]
}

const prices = limits.prices

export const PLANS: readonly PlanDef[] = [
  {
    tier: 'free', name: PLAN_NAME.free, monthly: 0,
    tagline: 'See where your AWS money is going — in minutes.',
    priceNote: 'Free forever',
    card: ['limits-free', 'read-only-connection', 'cost-overview', 'cost-trend', 'savings-summary', 'top-risk',
      'security-findings', 'security-checks', 'operational-health', 'alert-history', 'weekly-ai-summary',
      'weekly-ai-recommendations', 'audit-trail', 'status-page', 'support-free'],
  },
  {
    tier: 'starter', name: PLAN_NAME.starter, monthly: prices.starter.monthly, annualTotal: prices.starter.annual,
    tagline: 'Identify and eliminate the most common sources of AWS waste.',
    card: ['limits-starter', 'savings-list', 'idle-orphaned', 'savings-source', 'review-findings', 'notifications',
      'ai-cost-insights', 'team-attribution', 'inventory-export', 'members-starter', 'support-starter'],
  },
  {
    tier: 'pro', name: PLAN_NAME.pro, monthly: prices.pro.monthly, annualTotal: prices.pro.annual, popular: true,
    tagline: 'Turn your AWS into a predictable, optimized system.',
    card: ['limits-pro', 'savings-checks', 'rds-checks', 'reserved-instances', 'rightsizing', 'ai-chat', 'nl-search',
      'ai-reports', 'anomaly-detection', 'forecast', 'risk-score', 'pci-cis', 'advanced-alert-config', 'webhooks-jira',
      'api-keys', 'efficiency', 'dora', 'members-pro', 'support-pro'],
  },
  {
    tier: 'enterprise', name: PLAN_NAME.enterprise, monthly: null,
    tagline: 'Protect revenue at scale and eliminate high-impact risk.',
    priceNote: 'Annual contract',
    card: ['limits-enterprise', 'soc2-evidence', 'custom-frameworks', 'sso', 'remediation', 'optimization-rules',
      'custom-anomaly-rules', 'slo', 'scheduled-reports', 'dora-benchmarks', 'members-enterprise', 'multi-account',
      'scheduled-ai-reports', 'support-enterprise'],
  },
]

export function plan(tier: Tier): PlanDef {
  const found = PLANS.find((p) => p.tier === tier)
  if (!found) throw new Error(`Unknown plan: ${tier}`)
  return found
}

/** A plan card's feature lines, in order. */
export function cardFeatures(tier: Tier): CatalogFeature[] {
  return plan(tier).card.map(feature)
}

/** "Everything in {previous plan}, plus:" — null for the first plan. */
export function includesPrevious(tier: Tier): string | null {
  const index = TIERS.indexOf(tier)
  return index > 0 ? PLAN_NAME[TIERS[index - 1]] : null
}

/** Prices shown on every surface; computed, never typed. */
export function annual(tier: Tier): { perMonth: number; total: number; savingPerYear: number; monthsFree: number } | null {
  const p = plan(tier)
  if (p.monthly === null || !p.annualTotal) return null
  const yearAtMonthly = p.monthly * 12
  return {
    perMonth: Math.round(p.annualTotal / 12),
    total: p.annualTotal,
    savingPerYear: yearAtMonthly - p.annualTotal,
    monthsFree: Math.round((yearAtMonthly - p.annualTotal) / p.monthly),
  }
}

export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`
}

/** The annual toggle's chip, computed from the prices of the self-serve plans ("2 months free"). */
export function annualToggleLabel(): string {
  const months = new Set(PLANS.map((p) => annual(p.tier)?.monthsFree).filter((m): m is number => m !== undefined))
  if (months.size !== 1) throw new Error('Annual plans disagree on months free')
  const [m] = Array.from(months)
  return `${m} months free`
}

/** The card line under an annual price: "$490 billed yearly · save $98/year". */
export function annualBillingLine(tier: Tier): string | null {
  const a = annual(tier)
  return a ? `${formatUsd(a.total)} billed yearly · save ${formatUsd(a.savingPerYear)}/year` : null
}

/** The price a card shows: "$49", "$41" (annual, per month), "$0", or "Custom". */
export function priceLabel(tier: Tier, billing: 'monthly' | 'annual'): string {
  const p = plan(tier)
  if (p.monthly === null) return 'Custom'
  const a = billing === 'annual' ? annual(tier) : null
  return formatUsd(a ? a.perMonth : p.monthly)
}

// ── Comparison table ─────────────────────────────────────────────────────────

/** Rows whose cells are values rather than ✓ (Pricing Mock "Limits" and "Support"). */
export interface ValueRow {
  id: string
  label: string
  group: GroupId
  values: Readonly<Record<Tier, string>>
  tooltip?: string
}

const countOrUnlimited = (n: number | null) => (n === null ? 'Unlimited' : String(n))

export const VALUE_ROWS: readonly ValueRow[] = [
  { id: 'row-resources', group: 'limits', label: 'AWS resources monitored (up to)',
    tooltip: 'How many AWS resources DevControl monitors on each plan',
    values: {
      free: countOrUnlimited(limits.resources.free), starter: countOrUnlimited(limits.resources.starter),
      pro: countOrUnlimited(limits.resources.pro), enterprise: countOrUnlimited(limits.resources.enterprise),
    } },
  { id: 'row-resource-types', group: 'limits', label: 'Resource types',
    values: { free: '4 core types (EC2, EBS, RDS, S3)', starter: String(limits.resourceTypes.starter),
      pro: String(limits.resourceTypes.pro), enterprise: String(limits.resourceTypes.enterprise) } },
  { id: 'row-team-members', group: 'limits', label: 'Team members',
    values: {
      free: countOrUnlimited(limits.teamMembers.free), starter: countOrUnlimited(limits.teamMembers.starter),
      pro: countOrUnlimited(limits.teamMembers.pro), enterprise: countOrUnlimited(limits.teamMembers.enterprise),
    } },
  { id: 'row-aws-accounts', group: 'limits', label: 'AWS accounts per organization',
    values: { free: '1', starter: '1', pro: '1', enterprise: '1' } },
  { id: 'row-support', group: 'support', label: 'Support',
    values: { free: 'Community support (Slack)', starter: 'Email', pro: 'Priority email', enterprise: 'Named contact' } },
  { id: 'row-sla', group: 'support', label: 'SLA',
    values: { free: '—', starter: '—', pro: '—', enterprise: 'Talk to us' } },
]

export type TableRow =
  | { kind: 'value'; row: ValueRow }
  | { kind: 'feature'; feature: CatalogFeature }

/** Every comparison-table row, grouped in table order. */
export function comparisonGroups(): { id: GroupId; label: string; rows: TableRow[] }[] {
  return GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    rows: [
      ...VALUE_ROWS.filter((r) => r.group === g.id).map((row) => ({ kind: 'value' as const, row })),
      ...FEATURES.filter((f) => f.group === g.id && f.table !== false).map((f) => ({ kind: 'feature' as const, feature: f })),
    ],
  })).filter((g) => g.rows.length > 0)
}

/** Whether a plan includes a feature (it is on that plan or a lower one). */
export function includes(tier: Tier, f: CatalogFeature): boolean {
  return TIERS.indexOf(tier) >= TIERS.indexOf(f.tier)
}

// ── Curated subsets (verbatim catalog labels) ────────────────────────────────

/** Homepage pricing teaser: one catalog line for each line the teaser had (approved L-table). */
export const TEASER: Readonly<Record<Tier, readonly string[]>> = {
  free: ['limits-free', 'cost-overview', 'cost-trend'],
  starter: ['limits-starter', 'ai-cost-insights', 'savings-list', 'notifications', 'members-starter'],
  pro: ['limits-pro', 'ai-chat', 'nl-search', 'ai-reports', 'forecast', 'dora', 'members-pro', 'support-pro'],
  enterprise: ['limits-enterprise', 'custom-integrations', 'slo', 'sso', 'support-enterprise'],
}

/** /enterprise plan cards. */
export const ENTERPRISE_PAGE: Readonly<Record<Tier, readonly string[]>> = {
  free: ['limits-free', 'support-free'],
  starter: ['limits-starter', 'savings-list', 'support-starter'],
  pro: ['ai-reports', 'forecast', 'pci-cis', 'support-pro'],
  enterprise: ['sso', 'soc2-evidence', 'multi-account', 'support-enterprise'],
}

/** Team-limit upgrade modal: seats first. */
export const UPGRADE_MODAL: Readonly<Record<Tier, readonly string[]>> = {
  free: ['limits-free'],
  starter: ['limits-starter', 'members-starter', 'support-starter'],
  pro: ['limits-pro', 'members-pro', 'ai-reports', 'pci-cis'],
  enterprise: ['limits-enterprise', 'members-enterprise', 'sso', 'support-enterprise'],
}

/** Mid-market page: the Optimization Engine card. */
export const MID_MARKET: readonly string[] = [
  'ai-chat', 'forecast', 'team-management', 'team-attribution', 'pci-cis', 'dora', 'audit-trail',
  'notifications', 'pagerduty', 'support-pro',
]

export function lines(ids: readonly string[]): CatalogFeature[] {
  return ids.map(feature)
}

// ── Founding-member offer ───────────────────────────────────────────────────

/**
 * The founding-member banner on the pricing page. Hidden until prices and the
 * Stripe billing rules for it are final (C1-D9). The code stays; turning it on
 * is this one flag.
 */
export const FOUNDING_OFFER_VISIBLE = false
/** Founding spots (open placeholder; today's copy says 50). */
export const FOUNDING_SPOTS = 50
