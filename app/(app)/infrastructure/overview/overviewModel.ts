/**
 * What the Infrastructure Overview (NEXT_PUBLIC_INFRA_OVERVIEW_V2) shows, from
 * six existing DB-backed responses (coverage, services stats, the
 * needs-attention list, account findings, the cost summary, cost-recommendation
 * stats). Pure: no React, no fetch, no Date.now(); `now` is passed in. Every
 * string the page prints is built here, so each wording rule is tested without
 * rendering (infra-overview-plan.md §5–§7, §17–§19).
 *
 * Rules:
 * - A value that did not load is "—" or a reason, never 0.
 * - Findings on resources and account-level findings are two separately
 *   labelled numbers, never added together (riskScoring.ts:22-28).
 * - Open account finding = derived_status active or acknowledged; the table and
 *   status line show critical and high only.
 * - Spend is billed Cost Explorer month to date only; an inventory estimate is
 *   never shown as spend or split by service.
 * - A cost recommendation's HIGH is a dollar band (≥ $100/mo est.) and a status
 *   row's priority comes from the coarse mapped status: neither is printed as a
 *   finding severity. Status rows use the Services page's wording (STATUS_LABEL).
 * - The attention order uses the list's monthly_cost (a list-price estimate)
 *   for ordering only; it is never printed.
 * - Region counts, times and scope claims come from the Services modules
 *   (regionCoverage.ts, coverage.ts, notChecked.ts), which are imported, not copied.
 */
import type { AWSService, AWSServicesPage, AWSServicesStats, ServicesCoverage } from '@/lib/services/aws-services.service'
import type { AccountSecurityFinding, ComplianceSeverity } from '@/lib/services/account-security-findings.service'
import type { CostSummary, RecommendationStats } from '@/lib/types'
import type { SeverityLevel } from '@/lib/utils/severity-colors'
import { describeCeilings } from '@/lib/savings-basis'
import { formatUsd } from '../../costs/cost-display'
import { describeServicesSpend, SPEND_UNAVAILABLE_TEXT } from '../../services/SummaryTiles'
import { SEVERITY_LABEL, STATUS_LABEL, typeLabel } from '../../services/AttentionTable'
import { footerText, hasRegionCoverage, latestAttempt, regionCounts, type Rich } from '../../services/regionCoverage'
import { inventoryGap, scopeIsCompleted, warningNotes } from '../../services/coverage'
import { NOT_CHECKED_COPY, unknownTagsText } from '../../services/notChecked'

export type Loadable<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T }

export interface OverviewInputs {
  coverage: Loadable<ServicesCoverage>
  stats: Loadable<AWSServicesStats>
  attention: Loadable<AWSServicesPage>
  accountFindings: Loadable<AccountSecurityFinding[]>
  costSummary: Loadable<CostSummary>
  savings: Loadable<RecommendationStats>
  /** Discovery warning codes from a Sync run in this tab. */
  inTabWarnings: readonly string[]
  /** The Services V2 and M6 flags are both on, so /services#region-coverage exists. */
  regionsLinkAvailable: boolean
}

// ── Copy ──

export const OVERVIEW_COPY = {
  title: 'Infrastructure Overview',
  subtitle: 'What needs attention, what it costs, and what we checked in your AWS account.',
  noScanYet: 'No scan has finished yet',
  noAccountTitle: 'No AWS account connected',
  noAccountStatus: 'No AWS account connected.',
  connectAws: 'Connect AWS →',
  nothingChecked: 'Nothing has been checked yet.',
  coverageError: "Coverage couldn't be loaded, so we can't show what was checked.",
  findingsError: "Findings couldn't be loaded.",
  noCriticalHigh: 'No critical or high-severity findings from the last scan.',
  iam: 'IAM roles and policies: not checked. IAM users are checked for MFA and old access keys.',
  iamNotChecked: 'IAM roles and policies',
  alarms: 'CloudWatch alarms (EC2/RDS): Unavailable on this page',
  alarmsLink: 'See alert coverage →',
  alarmsHref: '/observability/alert-history',
  savingsSource: "Estimated from AWS list prices by DevControl's cost checks, not from your bill.",
  savingsNone: 'No cost recommendations right now',
  savingsError: "Savings couldn't be loaded",
  reviewRecommendations: 'Review recommendations →',
  reviewRecommendationsHref: '/cost-optimization',
  costRowLabel: 'Cost · ≥ $100/mo est.',
  attentionTitle: 'What needs attention',
  attentionDescription: 'Critical and high findings, cost recommendations of $100/mo or more (est.), stopped or failed resources.',
  attentionEmpty: 'Nothing needs review from the last scan.',
  attentionEmptyAccountError: "No resources need review. Account-level findings (security groups, IAM users) couldn't be loaded.",
  attentionEmptyResourceError: "No account-level findings need review. The resources that need attention couldn't be loaded.",
  resourcesError: "The resources that need attention couldn't be loaded.",
  attentionError: "The list of items that need attention couldn't be loaded",
  accountFindingsError: "Account-level findings (security groups, IAM users) couldn't be loaded.",
  firstHundred: 'Showing the highest-severity items of the first 100.',
  beforeYouChange: "DevControl only reads your account and won't change anything. Check what depends on this resource before you change it in AWS.",
  costByServiceTitle: 'Cost by AWS service',
  costByServiceNote: "Per-resource cost isn't shown: AWS doesn't report it without extra billing setup. Estimates are marked 'est.'",
  costByServiceUnavailable: "Cost by service isn't available: ",
  costExplorerNotYet: 'Cost Explorer data not available yet',
  ownershipTitle: 'Ownership gaps',
  assignOwners: 'Assign owners in Services & Ownership →',
  openServices: 'Open Services & Ownership',
  regionsHref: '/services#region-coverage',
} as const

const SEVERITIES: ComplianceSeverity[] = ['critical', 'high', 'medium', 'low']
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

// ── Findings ──

export type SeverityCounts = Record<ComplianceSeverity, number>

/** Open = active or acknowledged; dismissed and accepted risk are not open (Q8 / Q-R1). */
export function isOpenAccountFinding(f: AccountSecurityFinding): boolean {
  return f.derived_status === 'active' || f.derived_status === 'acknowledged'
}

/** Resource findings by severity (/stats findings_by_severity); null when unknown. */
export function resourceFindingCounts(stats: Loadable<AWSServicesStats>): SeverityCounts | null {
  if (stats.status !== 'ready' || !stats.data.findings_by_severity) return null
  const f = stats.data.findings_by_severity
  return { critical: f.critical ?? 0, high: f.high ?? 0, medium: f.medium ?? 0, low: f.low ?? 0 }
}

/** Open account findings by severity; null when unknown. */
export function accountFindingCounts(findings: Loadable<AccountSecurityFinding[]>): SeverityCounts | null {
  if (findings.status !== 'ready') return null
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const f of findings.data) if (isOpenAccountFinding(f) && f.severity in counts) counts[f.severity] += 1
  return counts
}

const sumCounts = (c: SeverityCounts) => c.critical + c.high + c.medium + c.low

// ── Attention ──

/** A SeverityBadge: a finding's own severity, or the grey 'info' variant with a label for cost and status rows. */
export interface DisplaySeverity { kind: 'badge'; severity: SeverityLevel; label: string }

export interface AttentionRow {
  key: string
  source: 'resource' | 'account'
  /** What put the row on the list: a finding (on a resource or account-level), a cost recommendation, or the resource's status. */
  cause: 'finding' | 'cost' | 'status'
  severity: DisplaySeverity
  issue: string
  resource: string
  resourceKind: string
  region: string
  found: string
  foundAt: string | null
  nextStep: { text: string } | { link: string; href: string } | null
}

/** The severity cell, from data only (§6.3, §17.1, C1). */
export function displaySeverity(row: AWSService): DisplaySeverity {
  const grey = (label: string): DisplaySeverity => ({ kind: 'badge', severity: 'info', label })
  switch (row.attention_cause) {
    case 'finding':
      return row.priority_severity ? { kind: 'badge', severity: row.priority_severity, label: SEVERITY_LABEL[row.priority_severity] } : grey('—')
    case 'cost_recommendation':
      return grey(OVERVIEW_COPY.costRowLabel)
    case 'status':
      return grey(STATUS_LABEL[row.status] ?? '—')
    default:
      return grey('—')
  }
}

function accountSeverity(f: AccountSecurityFinding): DisplaySeverity {
  return { kind: 'badge', severity: f.severity, label: SEVERITY_LABEL[f.severity] }
}

function regionLabel(region: string | null | undefined): string {
  if (!region) return '—'
  return region === 'global' ? 'Global' : region
}

const ACCOUNT_KIND: Record<string, string> = { networking: 'Security group', iam: 'IAM user' }
const NAME_COLLATOR = new Intl.Collator('en')

interface Ranked { rank: number; cost: number | null; name: string; id: string; row: AttentionRow }

/**
 * Severity (critical, high, medium, low), then the resource's monthly_cost
 * (hidden; larger first; no cost and account rows after costed rows), then
 * name, then id (Q13). The cost is read here and nowhere else.
 */
export function rankAttention(resources: AWSService[], accountFindings: AccountSecurityFinding[], foundAt: string | null): AttentionRow[] {
  const ranked: Ranked[] = []
  for (const r of resources) {
    const cause = r.attention_cause
    ranked.push({
      rank: SEVERITY_RANK[r.priority_severity ?? ''] ?? 4,
      cost: typeof r.monthly_cost === 'number' && Number.isFinite(r.monthly_cost) ? r.monthly_cost : null,
      name: r.name ?? '',
      id: `r:${r.id}`,
      row: {
        key: `resource-${r.id}`,
        source: 'resource',
        cause: cause === 'finding' ? 'finding' : cause === 'cost_recommendation' ? 'cost' : 'status',
        severity: displaySeverity(r),
        issue: r.reason ?? '—',
        resource: r.name ?? '—',
        resourceKind: typeLabel(r.type),
        region: regionLabel(r.aws_region),
        found: r.reason ?? '—',
        foundAt,
        nextStep: cause === 'cost_recommendation' ? { link: 'Review recommendations →', href: '/cost-optimization' }
          : cause === 'finding' ? { link: 'Review on the Security page →', href: '/security' }
          : null,
      },
    })
  }
  for (const f of accountFindings) {
    if (!isOpenAccountFinding(f) || (f.severity !== 'critical' && f.severity !== 'high')) continue
    const kind = ACCOUNT_KIND[f.category] ?? 'Account'
    ranked.push({
      rank: SEVERITY_RANK[f.severity],
      cost: null,
      name: f.resource_identifier ?? '',
      id: `a:${f.id}`,
      row: {
        key: `account-${f.id}`,
        source: 'account',
        cause: 'finding',
        severity: accountSeverity(f),
        issue: f.title,
        resource: f.resource_identifier,
        resourceKind: kind,
        region: f.region ?? 'Global (IAM)',
        found: `${f.title} (${kind === 'Account' ? 'account-level' : kind.toLowerCase()})`,
        foundAt: f.last_seen_at ?? null,
        nextStep: f.recommendation ? { text: f.recommendation } : null,
      },
    })
  }
  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank
    if (a.cost !== null || b.cost !== null) {
      if (a.cost === null) return 1
      if (b.cost === null) return -1
      if (a.cost !== b.cost) return b.cost - a.cost
    }
    return NAME_COLLATOR.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  })
  return ranked.map((r) => r.row)
}

export const ATTENTION_SHOWN = 10

export type AttentionView =
  | { status: 'loading' }
  | { status: 'error' }
  | {
    status: 'ready'
    rows: AttentionRow[]
    /**
     * "N resources · M account-level findings": the list's own total and the open
     * critical/high account findings, each said on its own and never added; a
     * source that failed says so instead of a number.
     */
    counts: string
    resourceError: boolean
    accountError: boolean
    viewAll: number | null
    securityLink: boolean
    firstHundred: boolean
    /** Only with no rows: what is known, per source (never "nothing" while a source is unknown). */
    empty: { text: string; scope: string | null } | null
  }

// ── View ──

export interface Line { key: string; parts: Rich; link?: { text: string; href: string }; tone?: 'warn' }

export interface StatusLineView {
  headline: string
  reason: string | null
  notChecked: string | null
  notes: Rich[]
}

export interface Tile {
  key: 'spend' | 'findings' | 'savings' | 'ownership'
  label: string
  value: string
  captions: Rich[]
  link?: { text: string; href: string }
}

export interface FindingsTile {
  key: 'findings'
  label: string
  sources: { key: 'resources' | 'account'; label: string; value: string; breakdown: string | null; note: string | null }[]
  captions: Rich[]
}

export interface CostByServiceView {
  status: 'loading' | 'unavailable' | 'ready'
  sub: string | null
  /** share: the server's sharePercent as sent (a raw ratio, unrounded); the component rounds it for display. */
  rows: { service: string; amount: string; share: number | null }[]
  unavailable: string | null
}

export interface OverviewView {
  mode: 'loading' | 'coverage-error' | 'no-account' | 'connected'
  header: { lastScan: Rich | null; scanRunning: boolean; showSync: boolean }
  account: { items: { term: string; value: string }[]; regionsLink: boolean; listNote: Rich | null } | null
  status: StatusLineView
  tiles: { spend: Tile; findings: FindingsTile; savings: Tile; ownership: Tile } | null
  attention: AttentionView | null
  checked: Line[]
  costByService: CostByServiceView | null
  ownership: { lines: string[]; note: string | null } | null
  footer: { total: number | null } | null
}

function lastCompletedIso(c: ServicesCoverage): string | null {
  return c.last_completed_scan?.completed_at ?? c.last_successful_scan_at ?? null
}

/** Account strip: no Account ID (D1) and no "of M listed" (D2) in this phase. */
function accountStrip(c: ServicesCoverage, regionsLinkAvailable: boolean): NonNullable<OverviewView['account']> {
  const home = c.account.home_region ?? c.scope.home_region?.region ?? null
  const homeText = home ?? '—'
  const regionCoverage = hasRegionCoverage(c)
  const counts = regionCoverage ? regionCounts(c) : null
  const enabled = counts?.enabled ?? null
  const scanned = !!lastCompletedIso(c)
  let checked: string
  if (!regionCoverage) checked = homeText
  else if (enabled !== null) checked = `${counts!.checked} of ${enabled}${counts!.withGaps > 0 ? ` · ${counts!.withGaps} with gaps` : ''}`
  else checked = `${homeText}${scanned ? ' checked' : ': not scanned yet'} · region list not read yet`
  const { stale, listed_at: listedAt } = c.scope.enabled_regions
  return {
    items: [
      { term: 'AWS account', value: 'Connected' },
      { term: 'Home region', value: homeText },
      { term: 'Enabled regions', value: enabled !== null ? String(enabled) : 'Not read yet' },
      { term: 'Regions checked', value: checked },
    ],
    regionsLink: regionsLinkAvailable,
    listNote: enabled !== null && stale === true && listedAt ? ['Region list last read ', { iso: listedAt }] : null,
  }
}

/** "Not checked yet: …", built from parts (§6.2, §17.1). */
function notCheckedText(c: ServicesCoverage): string {
  const counts = hasRegionCoverage(c) ? regionCounts(c) : null
  const parts: string[] = []
  if (counts && counts.enabled !== null) {
    const n = Math.max(0, counts.enabled - counts.checked)
    if (n > 0) parts.push(`${n} ${plural(n, 'region', 'regions')}`)
  } else {
    parts.push('other regions (region list not read yet)')
  }
  parts.push(OVERVIEW_COPY.iamNotChecked)
  return `Not checked yet: ${parts.join(' · ')}`
}

function sourceFragment(counts: SeverityCounts | null, severity: 'critical' | 'high', label: string, errorLabel: string): string {
  return counts ? `${counts[severity]} ${label}` : errorLabel
}

/** The headline and reason (§6.2 as amended by §18.2: per source, never one total). */
/** 'findings': critical/high findings; 'items': stopped, failed or cost items; 'other': anything else (no "Top:" line). */
type HeadlineKind = 'findings' | 'items' | 'other'

function statusHeadline(
  r: SeverityCounts | null, a: SeverityCounts | null, stats: Loadable<AWSServicesStats>, coverage: ServicesCoverage | null,
): { text: string; kind: HeadlineKind } {
  const text = statusHeadlineText(r, a, stats, coverage)
  const kind: HeadlineKind = /^(Critical|High)-severity findings need review/.test(text) ? 'findings'
    : /^\d+ resources? needs? review/.test(text) ? 'items'
    : 'other'
  return { text, kind }
}

function statusHeadlineText(
  r: SeverityCounts | null, a: SeverityCounts | null, stats: Loadable<AWSServicesStats>, coverage: ServicesCoverage | null,
): string {
  const res = (s: 'critical' | 'high') => sourceFragment(r, s, 'on resources', "resource findings couldn't be loaded")
  const acc = (s: 'critical' | 'high') => sourceFragment(a, s, 'account-level', "account-level findings couldn't be loaded")
  if (!r && !a) return OVERVIEW_COPY.findingsError
  const critical = (r?.critical ?? 0) > 0 || (a?.critical ?? 0) > 0
  const high = (r?.high ?? 0) > 0 || (a?.high ?? 0) > 0
  if (critical) {
    return `Critical-severity findings need review: ${res('critical')}, ${acc('critical')}${high ? ` · High: ${res('high')}, ${acc('high')}` : ''}`
  }
  if (high) return `High-severity findings need review: ${res('high')}, ${acc('high')}`
  if (!r) return `Resource findings couldn't be loaded; no critical or high-severity account-level findings.`
  if (!a) return `Account-level findings couldn't be loaded; no critical or high-severity findings on resources.`
  if (stats.status === 'ready') {
    const reasons = stats.data.attention_reasons
    const n = stats.data.needs_attention ?? 0
    if (n > 0 && reasons) {
      const parts: string[] = []
      if (reasons.stopped_or_degraded > 0) parts.push(`${reasons.stopped_or_degraded} stopped or degraded`)
      if (reasons.failed > 0) parts.push(`${reasons.failed} failed or terminated`)
      if (reasons.with_cost_recommendation > 0) parts.push(`${reasons.with_cost_recommendation} with a cost recommendation of $100/mo or more (est.)`)
      return `${n} ${plural(n, 'resource needs', 'resources need')} review${parts.length > 0 ? `: ${parts.join(' · ')}` : ''}`
    }
  }
  if (!coverage) return OVERVIEW_COPY.coverageError
  return lastCompletedIso(coverage) ? OVERVIEW_COPY.noCriticalHigh : `${OVERVIEW_COPY.noScanYet}.`
}

function statusNotes(c: ServicesCoverage): Rich[] {
  const notes: Rich[] = []
  const attempt = latestAttempt(c)
  const done = lastCompletedIso(c)
  if (attempt === 'unfinished') {
    notes.push(done
      ? ["The most recent scan attempt didn't finish; results are from the scan that finished ", { iso: done }, '.']
      : ["The most recent scan attempt didn't finish."])
  }
  if (attempt === 'running' && c.scan_in_progress) notes.push(['Scan in progress since ', { iso: c.scan_in_progress.since }, '.'])
  const home = (c.region_status ?? []).find((r) => r.home)
  if (home?.stale && home.last_scan_finished_at) {
    notes.push(['Results may be out of date: ', `${home.region} was last scanned `, { iso: home.last_scan_finished_at }, '.'])
  }
  return notes
}

function breakdown(c: SeverityCounts): string {
  return SEVERITIES.map((s) => `${SEVERITY_LABEL[s]} ${c[s]}`).join(' · ')
}

function findingsTile(i: OverviewInputs, coverage: ServicesCoverage | null): FindingsTile {
  const r = resourceFindingCounts(i.stats)
  const a = accountFindingCounts(i.accountFindings)
  const value = (loading: boolean, c: SeverityCounts | null) => (loading ? '…' : c ? String(sumCounts(c)) : '—')
  const rLoading = i.stats.status === 'loading'
  const aLoading = i.accountFindings.status === 'loading'
  const notOpen = i.accountFindings.status === 'ready' ? i.accountFindings.data.filter((f) => f.status === 'active' && !isOpenAccountFinding(f)).length : 0
  const done = coverage ? lastCompletedIso(coverage) : null
  return {
    key: 'findings',
    label: 'Open findings',
    sources: [
      { key: 'resources', label: 'On resources', value: value(rLoading, r), breakdown: r ? breakdown(r) : null, note: !rLoading && !r ? "Couldn't be loaded" : null },
      {
        key: 'account', label: 'Account-level (security groups, IAM users)', value: value(aLoading, a), breakdown: a ? breakdown(a) : null,
        note: !aLoading && !a ? "Couldn't be loaded" : notOpen > 0 ? `${notOpen} dismissed or accepted not counted` : null,
      },
    ],
    captions: done ? [['From the scan that finished ', { iso: done }]] : [],
  }
}

function spendTile(i: OverviewInputs): Tile {
  const summary = i.costSummary.status === 'ready' ? i.costSummary.data : undefined
  const spend = describeServicesSpend({ loading: i.costSummary.status === 'loading', error: i.costSummary.status === 'error', summary })
  if (spend.kind === 'loading') return { key: 'spend', label: 'Spend this month', value: '…', captions: [] }
  if (spend.kind === 'unavailable') {
    const reason = summary?.spend?.reason
    return { key: 'spend', label: 'Spend this month', value: SPEND_UNAVAILABLE_TEXT, captions: reason ? [[reason]] : [] }
  }
  const asOf = summary?.spend.asOf
  return {
    key: 'spend', label: 'Spend this month', value: spend.value,
    captions: [[spend.notes.join(' · ')], ...(asOf ? [['Cost Explorer, as of ', { iso: asOf }] as Rich] : [])],
  }
}

/** The savings tile. Its "Review recommendations →" link is in every state (N1 / RU-3). */
function savingsTile(i: OverviewInputs): Tile {
  const link = { text: OVERVIEW_COPY.reviewRecommendations, href: OVERVIEW_COPY.reviewRecommendationsHref }
  const base = { key: 'savings' as const, label: 'Possible savings', link }
  if (i.savings.status === 'loading') return { ...base, value: '…', captions: [] }
  if (i.savings.status === 'error') return { ...base, value: '—', captions: [[OVERVIEW_COPY.savingsError]] }
  const s = i.savings.data
  const total = Number.isFinite(s.totalPotentialSavings) ? s.totalPotentialSavings : 0
  const captions: Rich[] = [[OVERVIEW_COPY.savingsSource]]
  for (const line of describeCeilings(s.potentialSavingsCeilingByResourceType ?? {}, formatUsd)) captions.push([line])
  if ((s.activeRecommendations ?? 0) === 0) captions.push([OVERVIEW_COPY.savingsNone])
  return { ...base, value: `${formatUsd(total)}/mo est.`, captions }
}

function ownershipTile(i: OverviewInputs, coverage: ServicesCoverage | null): Tile {
  const link = { text: 'Review ownership →', href: '/services' }
  if (i.stats.status === 'loading') return { key: 'ownership', label: 'Owned resources', value: '…', captions: [], link }
  const stats = i.stats.status === 'ready' ? i.stats.data : null
  if (!stats || !stats.ownership || typeof stats.total !== 'number') {
    return { key: 'ownership', label: 'Owned resources', value: '—', captions: [["Couldn't be loaded"]], link }
  }
  if (stats.total === 0) {
    const gap = inventoryGap(coverage ?? undefined, 0)
    return { key: 'ownership', label: 'Owned resources', value: 'No resources yet', captions: gap === 'not-scanned' ? [['Not scanned yet']] : [], link }
  }
  const { owned, unowned, unknown } = stats.ownership
  return {
    key: 'ownership', label: 'Owned resources', value: `${owned} of ${stats.total}`,
    captions: [[`${unowned} unowned${unknown > 0 ? ` · ${unknown} tags unreadable` : ''}`]],
    link,
  }
}

function attentionView(i: OverviewInputs, coverage: ServicesCoverage | null): AttentionView {
  const res = i.attention
  const acc = i.accountFindings
  if (res.status === 'loading' || acc.status === 'loading') return { status: 'loading' }
  if (res.status === 'error' && acc.status === 'error') return { status: 'error' }
  const page = res.status === 'ready' ? res.data : null
  const accounts = acc.status === 'ready' ? acc.data : []
  const foundAt = coverage ? lastCompletedIso(coverage) : null
  const rows = rankAttention(page?.services ?? [], accounts, foundAt)
  const accountTotal = acc.status === 'ready'
    ? accounts.filter((f) => isOpenAccountFinding(f) && (f.severity === 'critical' || f.severity === 'high')).length
    : null
  const resourceText = page ? `${page.pagination.total} ${plural(page.pagination.total, 'resource', 'resources')}` : "resources couldn't be loaded"
  const accountText = accountTotal !== null ? `${accountTotal} account-level ${plural(accountTotal, 'finding', 'findings')}` : "account-level findings couldn't be loaded"
  let empty: { text: string; scope: string | null } | null = null
  if (rows.length === 0) {
    if (!page) empty = { text: OVERVIEW_COPY.attentionEmptyResourceError, scope: null }
    else if (accountTotal === null) empty = { text: OVERVIEW_COPY.attentionEmptyAccountError, scope: null }
    else {
      const home = coverage ? coverage.account.home_region ?? coverage.scope.home_region?.region ?? '—' : null
      const counts = coverage && hasRegionCoverage(coverage) ? regionCounts(coverage) : null
      const scope = home === null ? null : counts && counts.enabled !== null ? `Checked: ${home} (${counts.checked} of ${counts.enabled} enabled regions).` : `Checked: ${home}.`
      empty = { text: OVERVIEW_COPY.attentionEmpty, scope }
    }
  }
  const total = page?.pagination.total ?? 0
  return {
    status: 'ready',
    rows: rows.slice(0, ATTENTION_SHOWN),
    counts: `${resourceText} · ${accountText}`,
    resourceError: !page,
    accountError: acc.status === 'error',
    viewAll: total > ATTENTION_SHOWN ? total : null,
    securityLink: (accountTotal ?? 0) > 0,
    firstHundred: !!page && page.pagination.total > page.services.length,
    empty,
  }
}

/** The home region's gap sentence for "What we checked", from its written status. */
function homeGap(c: ServicesCoverage): string | null {
  const home = (c.region_status ?? []).find((r) => r.home)
  switch (home?.status) {
    case 'partial': return 'some listings were cut off'
    case 'denied': return "some resource types couldn't be checked because of permissions"
    case 'timed_out': return "some resource types couldn't be checked because AWS didn't respond in time"
    case 'failed': return "some resource types couldn't be checked because the scan ran into an error"
    default: return null
  }
}

function checkedLines(c: ServicesCoverage, i: OverviewInputs): Line[] {
  const lines: Line[] = []
  const home = c.account.home_region ?? c.scope.home_region?.region ?? '—'
  const done = lastCompletedIso(c)
  const types = c.last_completed_scan?.resource_types ?? (scopeIsCompleted(c) ? c.resource_types ?? [] : [])
  const typeNames = types.map((t) => typeLabel(t)).join(', ')
  if (done) {
    const gap = hasRegionCoverage(c) ? homeGap(c) : null
    lines.push({ key: 'inventory', parts: [`Resource inventory${typeNames ? ` (${typeNames})` : ''} · ${home}: ${gap ? `Checked with gaps: ${gap}` : 'Checked'}`], tone: gap ? 'warn' : undefined })
  } else {
    lines.push({ key: 'inventory', parts: [`Resource inventory · ${home}: Not checked yet (no scan has finished)`] })
  }
  const counts = hasRegionCoverage(c) ? regionCounts(c) : null
  const regionsLink = i.regionsLinkAvailable ? { text: 'View regions not checked →', href: OVERVIEW_COPY.regionsHref } : undefined
  if (counts && counts.enabled !== null) {
    const n = Math.max(0, counts.enabled - counts.checked)
    if (n > 0) lines.push({ key: 'other-regions', parts: [`Other enabled regions: Not checked (${n})`], link: regionsLink })
  } else {
    lines.push({ key: 'other-regions', parts: ['Other regions: region list not read yet'], link: regionsLink })
  }
  const global = footerText(c)
  if (global) lines.push({ key: 'global', parts: [global] })
  if (done) lines.push({ key: 'security-groups', parts: [`Security groups (${home}): checked during each scan`] })
  lines.push({ key: 'iam', parts: [OVERVIEW_COPY.iam] })
  lines.push({ key: 'alarms', parts: [OVERVIEW_COPY.alarms], link: { text: OVERVIEW_COPY.alarmsLink, href: OVERVIEW_COPY.alarmsHref } })
  lines.push({ key: 'other-types', parts: [NOT_CHECKED_COPY.otherTypes] })
  for (const note of warningNotes(c.last_scan?.warnings ?? [], i.inTabWarnings)) {
    lines.push({ key: `warning-${note.key}`, parts: [note.body], tone: 'warn' })
  }
  return lines
}

export function costByService(cost: Loadable<CostSummary>): CostByServiceView {
  if (cost.status === 'loading') return { status: 'loading', sub: null, rows: [], unavailable: null }
  const summary = cost.status === 'ready' ? cost.data : undefined
  const spend = describeServicesSpend({ loading: false, error: cost.status === 'error', summary })
  const top = summary?.spend?.data?.topServices
  if (spend.kind !== 'billed' || !Array.isArray(top)) {
    const reason = summary?.spend?.reason || OVERVIEW_COPY.costExplorerNotYet
    return { status: 'unavailable', sub: null, rows: [], unavailable: `${OVERVIEW_COPY.costByServiceUnavailable}${reason}` }
  }
  const data = summary!.spend.data!
  const rows = top.map((s) => ({ service: s.service, amount: formatUsd(s.amount), share: typeof s.sharePercent === 'number' && Number.isFinite(s.sharePercent) ? s.sharePercent : null }))
  const cents = (n: number) => Math.round(n * 100)
  const rest = (cents(data.amount) - top.reduce((sum, s) => sum + cents(s.amount), 0)) / 100
  if (Math.abs(rest) >= 0.01) rows.push({ service: rest < 0 ? 'All other services and credits' : 'All other services', amount: formatUsd(rest), share: null })
  const through = spend.notes.find((n) => n.startsWith('billed through'))
  return { status: 'ready', sub: `This month, billed${through ? ` · ${through}` : ''}`, rows, unavailable: null }
}

export function describeOverview(i: OverviewInputs, now: number): OverviewView {
  void now
  const empty = { checked: [], costByService: null, ownership: null, footer: null }
  if (i.coverage.status === 'ready' && !i.coverage.data.account.connected) {
    return {
      mode: 'no-account',
      header: { lastScan: null, scanRunning: false, showSync: false },
      account: null,
      status: { headline: OVERVIEW_COPY.noAccountStatus, reason: null, notChecked: null, notes: [] },
      tiles: null,
      attention: null,
      ...empty,
      checked: [{ key: 'nothing', parts: [OVERVIEW_COPY.nothingChecked] }],
    }
  }
  const coverage = i.coverage.status === 'ready' ? i.coverage.data : null
  const mode: OverviewView['mode'] = coverage ? 'connected' : i.coverage.status === 'error' ? 'coverage-error' : 'loading'
  const r = resourceFindingCounts(i.stats)
  const a = accountFindingCounts(i.accountFindings)
  const attention = attentionView(i, coverage)

  let status: StatusLineView
  if (mode === 'loading') {
    status = { headline: 'Loading…', reason: null, notChecked: null, notes: [] }
  } else if (i.stats.status === 'loading' || i.accountFindings.status === 'loading') {
    status = { headline: 'Loading findings…', reason: null, notChecked: coverage ? notCheckedText(coverage) : null, notes: coverage ? statusNotes(coverage) : [] }
  } else {
    const { text: headline, kind } = statusHeadline(r, a, i.stats, coverage)
    // "Top:" names the first row of the kind the headline is about: a finding under a
    // findings headline, a stopped/failed or cost item under an items headline.
    const rows = attention.status === 'ready' ? attention.rows : []
    const top = kind === 'findings' ? rows.find((row) => row.cause === 'finding')
      : kind === 'items' ? rows.find((row) => row.cause !== 'finding')
      : undefined
    status = {
      headline,
      reason: top ? `Top: ${top.issue}` : null,
      notChecked: coverage ? notCheckedText(coverage) : null,
      notes: coverage ? statusNotes(coverage) : headline === OVERVIEW_COPY.coverageError ? [] : [[OVERVIEW_COPY.coverageError]],
    }
  }

  const lastScan: Rich | null = coverage ? (lastCompletedIso(coverage) ? ['Last scan: ', { iso: lastCompletedIso(coverage)! }] : [OVERVIEW_COPY.noScanYet]) : null
  const ownershipStats = i.stats.status === 'ready' ? i.stats.data : null
  return {
    mode,
    header: { lastScan, scanRunning: !!coverage && latestAttempt(coverage) === 'running', showSync: true },
    account: coverage ? accountStrip(coverage, i.regionsLinkAvailable) : null,
    status,
    tiles: { spend: spendTile(i), findings: findingsTile(i, coverage), savings: savingsTile(i), ownership: ownershipTile(i, coverage) },
    attention,
    checked: coverage ? checkedLines(coverage, i) : [],
    costByService: costByService(i.costSummary),
    ownership: i.stats.status === 'loading' ? { lines: ['Loading…'], note: null }
      : ownershipStats?.ownership ? {
        lines: [`No owner or team tag: ${ownershipStats.ownership.unowned}`, `Tags couldn't be read: ${ownershipStats.ownership.unknown}`],
        note: ownershipStats.ownership.unknown > 0 ? unknownTagsText(ownershipStats.ownership.unknown, ownershipStats.unknown_by_type) : null,
      }
      : { lines: ["Ownership couldn't be loaded"], note: null },
    footer: { total: ownershipStats && typeof ownershipStats.total === 'number' ? ownershipStats.total : null },
  }
}
