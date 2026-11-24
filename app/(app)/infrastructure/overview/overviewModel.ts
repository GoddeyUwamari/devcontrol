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
 *   (servicesTruth.ts, coverage.ts, notChecked.ts), which are imported, not copied.
 *   PR 3d-1: the scan state, the coverage line, the regions not checked and the
 *   home region's result come from servicesTruth.ts (the Services page's own
 *   rules and words); nothing here counts region rows itself.
 */
import type { AWSService, AWSServicesPage, AWSServicesStats, ServicesCoverage } from '@/lib/services/aws-services.service'
import type { AccountSecurityFinding, ComplianceSeverity } from '@/lib/services/account-security-findings.service'
import type { CostSummary, RecommendationStats } from '@/lib/types'
import type { SeverityLevel } from '@/lib/utils/severity-colors'
import { describeCeilings, describeCeilingsWithoutEstimate, NO_DOLLAR_ESTIMATE } from '@/lib/savings-basis'
import { formatUsd, NO_BILLED_DAYS_YET, spendDaysLabel } from '../../costs/cost-display'
import { describeServicesSpend, SPEND_UNAVAILABLE_TEXT } from '../../services/SummaryTiles'
import { SEVERITY_LABEL, STATUS_LABEL, typeLabel } from '../../services/AttentionTable'
import { footerText, type Rich } from '../../services/regionCoverage'
import { inventoryGap, scopeIsCompleted, shownWarnings, warningNotes } from '../../services/coverage'
import { lastCompletedScanIso as lastCompletedIso } from '@/lib/scan-time'
import { FAILURE_LABEL, REDESIGN_COPY, latestScanNotChecked } from '../../services/redesignModel'
import {
  ATTENTION_DEFINITION, NEEDS_ATTENTION_HREF, REGION_COVERAGE_HREF, REGION_COVERAGE_LINK, coverageLine, homeRegionCheck, homeRegionOf,
  homeRegionWarnings, multiRegionOf, regionGaps, scanIsRunning, scanState, scanStateParts,
} from '../../services/servicesTruth'

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

/** The not-connected "—" row's four labels (PR2), kept as they were (redesign R9: not connected unchanged). */
export const TILE_LABELS = { spend: 'Spend this month', findings: 'Open findings', savings: 'Possible savings', ownership: 'Owned resources' } as const

/** The connected page's three cards (redesign, founder mock Nov 24). */
export const CARD_LABELS = { spend: 'AWS spend, this month', findings: 'Open findings', savings: 'Possible savings' } as const

/**
 * Scan warning codes this page words itself (redesign R1, founder Nov 24): region_incomplete and
 * scan_budget are said by the region notice and the inventory chip (from each region's own row), so
 * they get no line of their own; scan_deadline takes Services' approved sentence. Any other code
 * the shared notes don't know keeps the generic line.
 */
const REGION_WARNINGS = ['region_incomplete', 'scan_budget']
const SCAN_DEADLINE = 'scan_deadline'

export const OVERVIEW_COPY = {
  title: 'Infrastructure Overview',
  subtitle: 'What needs attention, what it costs, and what we checked in your AWS account.',
  accountConnected: 'AWS account connected',
  noAccountStatus: 'No AWS account connected.',
  nothingChecked: 'Nothing has been checked yet.',
  coverageError: "Coverage couldn't be loaded, so we can't show what was checked.",
  coverageLoadError: "Coverage couldn't be loaded",
  regionsDenied: "AWS refused DevControl's read role there. Resources found earlier stay listed until a complete scan.",
  noScanFinished: 'No scan has finished yet',
  iamName: 'IAM',
  iamDetail: 'Users checked for MFA and old access keys; roles and policies not checked',
  alarmsName: 'CloudWatch alarms (EC2/RDS)',
  alarmsDetail: 'Unavailable on this page',
  alarmsLink: 'See alert coverage →',
  alarmsHref: '/observability/alert-history',
  savingsSource: "Estimated from AWS list prices by DevControl's cost checks, not from your bill.",
  savingsNone: 'No cost recommendations right now',
  savingsError: "Savings couldn't be loaded",
  reviewRecommendations: 'Review recommendations →',
  reviewRecommendationsHref: '/cost-optimization',
  costLink: 'Cost by service ↓',
  costHref: '#infra-cost-heading',
  securityFindings: 'Security findings →',
  securityHref: '/security',
  resourceFindingsError: "Findings on resources couldn't be loaded",
  accountLineError: "Account-level findings couldn't be loaded",
  costRowLabel: 'Cost · ≥ $100/mo est.',
  attentionTitle: 'What needs attention',
  // PR 3d-2 (D4): the one sentence Services' What needs attention shows too.
  attentionDescription: ATTENTION_DEFINITION,
  // PR 3d-2 (D5): the account-level rows stay; this says why the counts differ.
  attentionAccountNote: 'This list also includes account-level findings (IAM, security groups). The Services count covers resources only.',
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
  ownershipTitle: 'Ownership',
  // The Services page's label (in-app polish): "unowned" is never used on this page.
  noOwnerTag: 'No owner tag',
  tagsUnreadable: "Tags couldn't be read",
  ownershipError: "Ownership couldn't be loaded",
  // PR 3d-2 (D1): Services shows owner assignment as Coming soon, so the link promises only what is there.
  seeOwnership: 'See ownership in Services & Ownership →',
  // PR 3d-2 (D7): one label for every link to the Region coverage card (Security's).
  regionsHref: REGION_COVERAGE_HREF,
  regionsLink: REGION_COVERAGE_LINK,
  // PR 3d-2 (D7): Services opens with Needs attention selected.
  viewAllHref: NEEDS_ATTENTION_HREF,
  // PR 3d-2 (D2): the discovery scan is "scan", as on Services.
  scanNow: 'Scan now',
  scanning: 'Scanning…',
  scanFinished: 'Scan finished',
  scanFinishedToast: (discovered: number, updated: number) => `Scan finished — ${discovered.toLocaleString('en-US')} new · ${updated.toLocaleString('en-US')} updated`,
  scanFailedToast: 'Scan failed — check your AWS connection',
} as const

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
  /** A security group's sg- ID when the row shows its name instead (redesign R7): shown in the Review expansion only. */
  resourceId?: string | null
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

const SG_ID = /^sg-[0-9a-z]+$/i
const SG_IN_ARN = /:security-group\/(sg-[0-9a-z]+)$/i

/**
 * How a security-group finding's resource reads: "<group name> (sg-…)", or the
 * sg- ID alone when the name is not known. The ID is the stored identifier's
 * (its ARN or bare sg- ID), else the evidence's; the name is the evidence's
 * security_group_name, used only when the evidence is about that same group.
 * With no sg- ID at all the stored identifier is shown as it is. Display only:
 * resource_identifier, sorting and links are unchanged.
 */
export function securityGroupLabel(f: Pick<AccountSecurityFinding, 'resource_identifier' | 'evidence'>): string {
  const { name, id, identifier } = securityGroupParts(f)
  if (!id) return identifier
  return name ? `${name} (${id})` : id
}

/**
 * The parts securityGroupLabel joins: the group's name (null when unknown or the same as its ID), its
 * sg- ID (null when none is found) and the stored identifier. The redesigned table shows the name once
 * and keeps the ID for the Review expansion (redesign R7); without a name the ID is the row's label.
 */
export function securityGroupParts(f: Pick<AccountSecurityFinding, 'resource_identifier' | 'evidence'>): { name: string | null; id: string | null; identifier: string } {
  const evidence = f.evidence && 'security_group_id' in f.evidence ? f.evidence : null
  const evidenceId = typeof evidence?.security_group_id === 'string' && SG_ID.test(evidence.security_group_id) ? evidence.security_group_id : null
  const identifier = f.resource_identifier ?? ''
  const id = identifier.match(SG_IN_ARN)?.[1] ?? (SG_ID.test(identifier) ? identifier : null) ?? evidenceId
  if (!id) return { name: null, id: null, identifier }
  const name = evidenceId === id && typeof evidence?.security_group_name === 'string' ? evidence.security_group_name.trim() : ''
  return { name: name && name !== id ? name : null, id, identifier }
}

/** The kind under a security group's name: the finding is about the account, not a resource in the inventory. */
export const SECURITY_GROUP_KIND = 'Security group · account-level'
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
    const sg = f.category === 'networking' ? securityGroupParts(f) : null
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
        resource: sg ? (sg.name ?? sg.id ?? sg.identifier) : f.resource_identifier,
        resourceKind: sg ? SECURITY_GROUP_KIND : kind,
        region: f.region ?? 'Global (IAM)',
        found: `${f.title} (${kind === 'Account' ? 'account-level' : kind.toLowerCase()})`,
        foundAt: f.last_seen_at ?? null,
        resourceId: sg?.name && sg.id ? sg.id : null,
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
    resourceError: boolean
    accountError: boolean
    viewAll: number | null
    securityLink: boolean
    firstHundred: boolean
    /** Only with no rows: what is known, per source (never "nothing" while a source is unknown). */
    empty: { text: string; scope: string | null } | null
    /**
     * After the heading (founder ruling, Nov 24 round 2): "x high-severity on resources, y account-level"
     * ("critical and high-severity" when either source has a critical one); a clause whose count is 0 is
     * left out; each source on its own, never added (ruling 2, Q-R1). null when both have none or either
     * didn't load (its failure is said below the heading).
     */
    severityLine: string | null
  }

// ── View ──

export interface Line { key: string; parts: Rich; link?: { text: string; href: string }; tone?: 'warn' }

/**
 * The header's one status line: "AWS account connected · Home region {r} · {n of m} regions checked ·
 * {scan line}". `regions` is Services' coverage line's first segment ("16 of 17 regions checked",
 * "Scanning: 3 of 17 regions checked so far", …), `strong` its "n of m" when it has one. `notes`: the
 * existing scan notes (didn't finish, in progress, out of date) and "Region list last read", muted, below.
 */
export interface HeaderStatus {
  home: string
  regions: { strong: string | null; text: string }
  lastScan: Rich
  notes: Rich[]
}

/** The one amber notice: only when the scan couldn't check a region (redesign item 2). */
export interface RegionNotice { lead: string; body: string | null; link: boolean }

export interface Tile {
  key: 'spend' | 'savings'
  label: string
  value: string
  /** 'success': the value is shown green (the savings tile, only for an estimate above $0). */
  tone?: 'success'
  /** Every sentence the tile has (the model's record; the card shows `line` and puts `info` behind ⓘ). */
  captions: Rich[]
  /** The one line under the number. */
  line: Rich | null
  /** The ⓘ text, one sentence per entry; none when empty. */
  info: string[]
  link: { text: string; href: string }
}

/**
 * Open findings (ruling 2, keep rule Q-R1): the big number is findings on resources only, with its High
 * (and Critical, when any) count; account-level findings are a separate line, never added to it.
 */
export interface FindingsTile {
  key: 'findings'
  label: string
  value: string
  chips: { severity: 'critical' | 'high'; label: string }[]
  /** "+ 4 account-level findings (1 High)", or the reason it is missing. */
  accountLine: string | null
  /** Shown instead of a number's meaning when /stats didn't load. */
  resourceNote: string | null
  info: string[]
  link: { text: string; href: string }
}

export type ChipTone = 'warn' | 'ok' | 'muted'

export interface CheckedRow {
  key: string
  name: string
  detail: Rich | null
  /** Regions the scan didn't count as checked, other than the notice's (ruling 6). */
  extra: string | null
  chip: { text: string; tone: ChipTone }
  link?: { text: string; href: string }
}

export interface CheckedView {
  /** "From the scan that finished {t}." */
  from: Rich | null
  rows: CheckedRow[]
  warnings: { key: string; text: string }[]
  /** Coverage failed: this sentence instead of rows. */
  error: string | null
}

export type OwnershipView =
  | { status: 'loading' }
  | { status: 'error'; text: string }
  | { status: 'empty'; text: string; note: string | null }
  | { status: 'ready'; noOwnerTag: number; unknown: number; sentence: string; total: number }

export interface CostByServiceView {
  status: 'loading' | 'unavailable' | 'ready'
  sub: string | null
  /** The Cost Explorer time the spend card used to show (redesign R5). */
  asOf: string | null
  /** share: the server's sharePercent as sent (a raw ratio, unrounded); the component rounds it for display. */
  rows: { service: string; amount: string; share: number | null }[]
  unavailable: string | null
}

export interface OverviewView {
  mode: 'loading' | 'coverage-error' | 'no-account' | 'connected'
  header: { status: HeaderStatus | null; scanRunning: boolean; showSync: boolean }
  notice: RegionNotice | null
  tiles: { spend: Tile; findings: FindingsTile; savings: Tile } | null
  attention: AttentionView | null
  checked: CheckedView
  costByService: CostByServiceView | null
  ownership: OwnershipView | null
}

const num = (n: number) => n.toLocaleString('en-US')

/** Services' coverage line's first segment, with its "n of m" picked out for bold. */
function regionsPart(c: ServicesCoverage): HeaderStatus['regions'] {
  const text = coverageLine(c).split(' · ')[0]
  return { strong: text.match(/\d[\d,]* of \d[\d,]*/)?.[0] ?? null, text }
}

function headerStatus(c: ServicesCoverage, now: number): HeaderStatus {
  const notes = statusNotes(c, now)
  // The stored region list's age, as the account strip said it (only when the list is stale).
  const { known, count, stale, listed_at: listedAt } = c.scope.enabled_regions
  if (known && typeof count === 'number' && stale === true && listedAt) notes.push(['Region list last read ', { iso: listedAt }])
  return { home: homeRegionOf(c) ?? '—', regions: regionsPart(c), lastScan: scanStateParts(c, now), notes }
}

function statusNotes(c: ServicesCoverage, now: number): Rich[] {
  const notes: Rich[] = []
  // PR 3d-1 (D3): which note shows follows the shared scan state; the notes' words are unchanged.
  const state = scanState(c, now).state
  const done = lastCompletedIso(c)
  if (state === 'failed') {
    notes.push(done
      ? ["The most recent scan attempt didn't finish; results are from the scan that finished ", { iso: done }, '.']
      : ["The most recent scan attempt didn't finish."])
  }
  if (state === 'running' && c.scan_in_progress) notes.push(['Scan in progress since ', { iso: c.scan_in_progress.since }, '.'])
  const home = (c.region_status ?? []).find((r) => r.home)
  if (home?.stale && home.last_scan_finished_at) {
    notes.push(['Results may be out of date: ', `${home.region} was last scanned `, { iso: home.last_scan_finished_at }, '.'])
  }
  return notes
}

/**
 * The amber notice: Services' "who couldn't be checked" (regionGaps: the scan's regions not checked, or
 * the home region flag off), never a recount. The access-denied sentence only when every such region of
 * the latest scan was refused (FailureCode access_denied); otherwise the generic count alone, with the
 * per-region reasons one click away on Region coverage.
 */
function regionNotice(c: ServicesCoverage, now: number, regionsLinkAvailable: boolean): RegionNotice | null {
  const gap = (regionGaps(c, now) ?? []).find((g) => g.key === 'not-checked-by-scan' || g.key === 'home-couldnt')
  if (!gap) return null
  const mr = multiRegionOf(c)
  const denied = mr
    ? (() => { const failed = latestScanNotChecked(mr); return failed.length > 0 && failed.every((f) => f.code === 'access_denied') })()
    : homeRegionCheck(c)?.label === FAILURE_LABEL.access_denied
  return { lead: `${gap.long}.`, body: denied ? OVERVIEW_COPY.regionsDenied : null, link: regionsLinkAvailable }
}

const severityChips = (c: SeverityCounts) => [
  ...(c.critical > 0 ? [{ severity: 'critical' as const, label: `${c.critical} Critical` }] : []),
  { severity: 'high' as const, label: `${c.high} High` },
]

function findingsTile(i: OverviewInputs): FindingsTile {
  const r = resourceFindingCounts(i.stats)
  const a = accountFindingCounts(i.accountFindings)
  const rLoading = i.stats.status === 'loading'
  const aLoading = i.accountFindings.status === 'loading'
  const notOpen = i.accountFindings.status === 'ready' ? i.accountFindings.data.filter((f) => f.status === 'active' && !isOpenAccountFinding(f)).length : 0
  const accountSeverities = (c: SeverityCounts) => (c.critical > 0 ? `${c.critical} Critical, ${c.high} High` : `${c.high} High`)
  const accountLine = aLoading ? null
    : a ? `+ ${sumCounts(a)} account-level ${plural(sumCounts(a), 'finding', 'findings')} (${accountSeverities(a)})`
    : OVERVIEW_COPY.accountLineError
  return {
    key: 'findings',
    label: CARD_LABELS.findings,
    value: rLoading ? '…' : r ? String(sumCounts(r)) : '—',
    chips: r ? severityChips(r) : [],
    accountLine,
    resourceNote: !rLoading && !r ? OVERVIEW_COPY.resourceFindingsError : null,
    info: notOpen > 0 ? [`${notOpen} dismissed or accepted account-level ${plural(notOpen, 'finding is', 'findings are')} not counted.`] : [],
    link: { text: OVERVIEW_COPY.securityFindings, href: OVERVIEW_COPY.securityHref },
  }
}

const capitalize = (s: string) => (s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : s)

function spendTile(i: OverviewInputs): Tile {
  const base = { key: 'spend' as const, label: CARD_LABELS.spend, info: [], link: { text: OVERVIEW_COPY.costLink, href: OVERVIEW_COPY.costHref } }
  const summary = i.costSummary.status === 'ready' ? i.costSummary.data : undefined
  const spend = describeServicesSpend({ loading: i.costSummary.status === 'loading', error: i.costSummary.status === 'error', summary })
  if (spend.kind === 'loading') return { ...base, value: '…', captions: [], line: null }
  if (spend.kind === 'unavailable') {
    const reason = summary?.spend?.reason
    return { ...base, value: SPEND_UNAVAILABLE_TEXT, captions: reason ? [[reason]] : [], line: reason ? [reason] : null }
  }
  const asOf = summary?.spend.asOf
  const asOfCaption: Rich[] = asOf ? [['Cost Explorer, as of ', { iso: asOf }]] : []
  // Nothing reported yet this month is "no data yet", not a measured $0.00.
  const first = spend.kind === 'no_billed_days'
    ? ['whole account', 'billed, from Cost Explorer', NO_BILLED_DAYS_YET].join(' · ')
    : spend.notes.join(' · ')
  // The card shows the first caption; the Cost Explorer time is on Cost by AWS service (redesign R5).
  // Founder mock (Nov 24 round 3): "billed" is said once on the card: "… · billed, from Cost Explorer · through Nov 14".
  const line = capitalize(first.replace(' · billed through ', ' · through '))
  return { ...base, value: spend.kind === 'no_billed_days' ? '—' : spend.value, captions: [[first], ...asOfCaption], line: [line] }
}

const opportunities = (n: number) => `${n} open ${plural(n, 'opportunity', 'opportunities')}`
const textOf = (parts: Rich) => parts.map((p) => (typeof p === 'string' ? p : '')).join('')

/** The savings tile. Its "Review recommendations →" link is in every state (N1 / RU-3). */
function savingsTile(i: OverviewInputs): Tile {
  const link = { text: OVERVIEW_COPY.reviewRecommendations, href: OVERVIEW_COPY.reviewRecommendationsHref }
  const base = { key: 'savings' as const, label: CARD_LABELS.savings, link }
  if (i.savings.status === 'loading') return { ...base, value: '…', captions: [], line: null, info: [] }
  if (i.savings.status === 'error') return { ...base, value: '—', captions: [[OVERVIEW_COPY.savingsError]], line: [OVERVIEW_COPY.savingsError], info: [] }
  const s = i.savings.data
  const total = Number.isFinite(s.totalPotentialSavings) ? s.totalPotentialSavings : 0
  const ceilings = s.potentialSavingsCeilingByResourceType ?? {}
  const active = s.activeRecommendations ?? 0
  if (active === 0) {
    // No open findings: the value and sentences unchanged; the last one is the line, the rest behind ⓘ.
    const captions: Rich[] = [[OVERVIEW_COPY.savingsSource]]
    for (const line of describeCeilings(ceilings, formatUsd)) captions.push([line])
    captions.push([OVERVIEW_COPY.savingsNone])
    return { ...base, value: `${formatUsd(total)}/mo est.`, captions, line: [OVERVIEW_COPY.savingsNone], info: captions.slice(0, -1).map(textOf) }
  }
  const open = describeOpenSavings(total, active, ceilings, s.estimatedFindings, s.unestimatedFindings)
  if (open.value === NO_DOLLAR_ESTIMATE) {
    // "—" with the reason (founder mock): the first caption says the same as the line, so ⓘ holds the rest.
    return { ...base, ...open, value: '—', line: [`No dollar estimate yet · ${opportunities(active)}`], info: open.captions.slice(1).map(textOf) }
  }
  return { ...base, ...open, line: [`DevControl estimate · ${opportunities(active)}`], info: open.captions.map(textOf) }
}

const findings = (n: number) => `${n} open finding${n === 1 ? '' : 's'}`

/**
 * The savings tile with open findings, in the Dashboard header's sentences
 * (lib/savings-basis.ts estimatedSavingsHeadline; the weekly email no longer
 * uses them since the executive brief redesign, 53a791e1). Green only for an estimate above
 * $0; a total of $0 is never shown as a measured "$0". The counts are the
 * stats API's own (estimated_findings / unestimated_findings): without them
 * the sentence leaves the count out, and nothing is computed here.
 */
export function describeOpenSavings(
  total: number,
  active: number,
  ceilings: Record<string, number>,
  estimatedFindings: number | null | undefined,
  unestimatedFindings: number | null | undefined,
): { value: string; tone?: 'success'; captions: Rich[] } {
  const captions: Rich[] = []
  if (total > 0) {
    const amount = `${formatUsd(total)}/month`
    const across = typeof estimatedFindings === 'number' && estimatedFindings > 0 ? ` across ${findings(estimatedFindings)}` : ''
    captions.push([`Estimated savings: ${amount}${across}. This is a DevControl estimate, not realized savings.`])
    // The Dashboard header's order (executive-roi-card.tsx): the estimate, its upper bounds, then the findings with no figure.
    for (const line of describeCeilings(ceilings, formatUsd, 'month')) captions.push([`${line}.`])
    if (typeof unestimatedFindings === 'number' && unestimatedFindings > 0) {
      captions.push([unestimatedFindings === 1
        ? '1 more open finding has no dollar estimate yet.'
        : `${unestimatedFindings} more open findings have no dollar estimate yet.`])
    }
    captions.push([OVERVIEW_COPY.savingsSource])
    return { value: amount, tone: 'success', captions }
  }
  captions.push([`${findings(active)}; none has a dollar estimate yet.`])
  for (const line of describeCeilingsWithoutEstimate(ceilings, formatUsd, 'month')) captions.push([`${line}.`])
  captions.push([OVERVIEW_COPY.savingsSource])
  return { value: NO_DOLLAR_ESTIMATE, captions }
}

/** "x high-severity on resources, y account-level"; a 0 clause left out; never one total (ruling 2). */
function severityLine(r: SeverityCounts | null, a: SeverityCounts | null): string | null {
  if (!r || !a) return null
  const critical = r.critical + a.critical > 0
  const of = (c: SeverityCounts) => (critical ? c.critical + c.high : c.high)
  const label = critical ? 'critical and high-severity' : 'high-severity'
  const clauses = [
    ...(of(r) > 0 ? [{ n: of(r), where: 'on resources' }] : []),
    ...(of(a) > 0 ? [{ n: of(a), where: 'account-level' }] : []),
  ]
  if (clauses.length === 0) return null
  return clauses.map((c, i) => (i === 0 ? `${num(c.n)} ${label} ${c.where}` : `${num(c.n)} ${c.where}`)).join(', ')
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
  let empty: { text: string; scope: string | null } | null = null
  if (rows.length === 0) {
    if (!page) empty = { text: OVERVIEW_COPY.attentionEmptyResourceError, scope: null }
    else if (accountTotal === null) empty = { text: OVERVIEW_COPY.attentionEmptyAccountError, scope: null }
    else {
      // PR 3d-1 (D6): the Services page's coverage line, ending in a full stop.
      const line = coverage ? coverageLine(coverage) : null
      const scope = line === null ? null : line.endsWith('.') ? line : `${line}.`
      empty = { text: OVERVIEW_COPY.attentionEmpty, scope }
    }
  }
  const total = page?.pagination.total ?? 0
  return {
    status: 'ready',
    rows: rows.slice(0, ATTENTION_SHOWN),
    resourceError: !page,
    accountError: acc.status === 'error',
    viewAll: total > ATTENTION_SHOWN ? total : null,
    securityLink: (accountTotal ?? 0) > 0,
    firstHundred: !!page && page.pagination.total > page.services.length,
    empty,
    severityLine: severityLine(resourceFindingCounts(i.stats), accountFindingCounts(i.accountFindings)),
  }
}

/** "S3 and CloudFront are checked in every region on each scan: {found}." → its name and "Every scan: {found}". */
function scopeRow(c: ServicesCoverage): CheckedRow | null {
  const text = footerText(c)
  if (!text) return null
  const at = text.indexOf(' on each scan: ')
  const head = text.slice(0, text.indexOf(' is'))
  const name = text.startsWith('S3 and CloudFront') ? 'S3 and CloudFront' : head
  const found = at >= 0 ? text.slice(at + ' on each scan: '.length).replace(/\.$/, '') : text
  return { key: 'global', name, detail: [`Every scan: ${found}`], extra: null, chip: { text: 'Checked', tone: 'ok' } }
}

function checkedView(c: ServicesCoverage, i: OverviewInputs, now: number): CheckedView {
  const rows: CheckedRow[] = []
  const home = homeRegionOf(c) ?? '—'
  const done = lastCompletedIso(c)
  const types = c.last_completed_scan?.resource_types ?? (scopeIsCompleted(c) ? c.resource_types ?? [] : [])
  const typeNames = types.map((t) => typeLabel(t)).join(', ')
  const mr = multiRegionOf(c)
  // Ruling 6: the regions the scan didn't count as checked, other than the notice's, in Services' words.
  const gaps = regionGaps(c, now)
  const extra = gaps === null
    ? 'Other regions: region list not read yet'
    : gaps.filter((g) => g.key !== 'not-checked-by-scan' && g.key !== 'home-couldnt').map((g) => g.short).join(' · ') || null
  if (done) {
    const regions = regionsPart(c).strong
    let tone: ChipTone
    if (mr) {
      // Flag-on prep I5: the inventory spans every region the scan checks; the gap rule is unchanged.
      tone = mr.coverage_status === 'latest_scan_failed' || mr.coverage_status === 'completed_with_regions_not_checked' ? 'warn'
        : mr.coverage_status === 'in_progress' ? 'muted' : 'ok'
    } else {
      // PR 3d-1 (D6, R3): the home region's last result in the Services card's words.
      const check = homeRegionCheck(c)
      tone = check && check.kind !== 'checked' ? 'warn' : 'ok'
    }
    rows.push({
      key: 'inventory', name: 'Resource inventory', detail: typeNames ? [typeNames] : null, extra,
      chip: { text: regions ? `${regions} ${regions.endsWith(' 1') ? 'region' : 'regions'}` : coverageLine(c), tone },
    })
  } else {
    rows.push({ key: 'inventory', name: 'Resource inventory', detail: [`${OVERVIEW_COPY.noScanFinished}.`], extra, chip: { text: 'Not checked yet', tone: 'muted' } })
  }
  const scope = scopeRow(c)
  if (scope) rows.push(scope)
  // Flag-on prep (N5, founder Nov 19): switched on, security groups are read in each region the scan covers.
  if (done) {
    rows.push({ key: 'security-groups', name: 'Security groups', detail: [mr ? 'In each region the scan covers' : `${home}, during each scan`], extra: null, chip: { text: 'Checked', tone: 'ok' } })
  }
  rows.push({ key: 'iam', name: OVERVIEW_COPY.iamName, detail: [OVERVIEW_COPY.iamDetail], extra: null, chip: { text: 'Partly checked', tone: 'muted' } })
  rows.push({
    key: 'alarms', name: OVERVIEW_COPY.alarmsName, detail: [OVERVIEW_COPY.alarmsDetail], extra: null,
    chip: { text: 'Not shown here', tone: 'muted' }, link: { text: OVERVIEW_COPY.alarmsLink, href: OVERVIEW_COPY.alarmsHref },
  })
  rows.push({ key: 'other-types', name: 'Other AWS resource types', detail: ['Not inventoried'], extra: null, chip: { text: 'Not checked', tone: 'muted' } })

  // Nov 21 founder ruling: only the warnings that describe the home region name it (servicesTruth homeRegionWarnings).
  // Ruling R1: the region codes are said by the notice and the inventory chip; scan_deadline in Services' words.
  const persisted = homeRegionWarnings(c, c.last_scan?.warnings ?? [])
  const inTab = homeRegionWarnings(c, i.inTabWarnings)
  const own = (codes: string[]) => codes.filter((code) => !REGION_WARNINGS.includes(code) && code !== SCAN_DEADLINE)
  const warnings = warningNotes(own(persisted), own(inTab), home === '—' ? null : home).map((n) => ({ key: `warning-${n.key}`, text: n.body }))
  if (shownWarnings([...persisted, ...inTab]).includes(SCAN_DEADLINE)) warnings.push({ key: 'warning-scan-deadline', text: REDESIGN_COPY.scanDeadline })
  return { from: done ? ['From the scan that finished ', { iso: done }, '.'] : null, rows, warnings, error: null }
}

export function costByService(cost: Loadable<CostSummary>): CostByServiceView {
  if (cost.status === 'loading') return { status: 'loading', sub: null, asOf: null, rows: [], unavailable: null }
  const summary = cost.status === 'ready' ? cost.data : undefined
  const spend = describeServicesSpend({ loading: false, error: cost.status === 'error', summary })
  const top = summary?.spend?.data?.topServices
  const asOf = (spend.kind === 'billed' || spend.kind === 'no_billed_days') && summary?.spend.asOf ? summary.spend.asOf : null
  if (spend.kind === 'no_billed_days') {
    // An empty table would read as "nothing billed"; say what it is instead.
    const days = spendDaysLabel(summary?.spend)
    return { status: 'unavailable', sub: null, asOf, rows: [], unavailable: `No billed days yet this month${days ? ` (${days}, UTC)` : ''}. Services appear here once AWS Cost Explorer reports them.` }
  }
  if (spend.kind !== 'billed' || !Array.isArray(top)) {
    const reason = summary?.spend?.reason || OVERVIEW_COPY.costExplorerNotYet
    return { status: 'unavailable', sub: null, asOf: null, rows: [], unavailable: `${OVERVIEW_COPY.costByServiceUnavailable}${reason}` }
  }
  const data = summary!.spend.data!
  const amount = data.amount ?? 0
  const rows = top.map((s) => ({ service: s.service, amount: formatUsd(s.amount), share: typeof s.sharePercent === 'number' && Number.isFinite(s.sharePercent) ? s.sharePercent : null }))
  const cents = (n: number) => Math.round(n * 100)
  const rest = (cents(amount) - top.reduce((sum, s) => sum + cents(s.amount), 0)) / 100
  if (Math.abs(rest) >= 0.01) rows.push({ service: rest < 0 ? 'All other services and credits' : 'All other services', amount: formatUsd(rest), share: null })
  const through = spend.notes.find((n) => n.startsWith('billed through'))
  return { status: 'ready', sub: `This month, billed${through ? ` · ${through}` : ''}`, asOf, rows, unavailable: null }
}

/** "VPC 5, SNS 1": /stats unknown_by_type, largest first (as the Services sentence orders it). */
function byType(counts: Record<string, number> | undefined): string {
  return Object.entries(counts ?? {}).filter(([, n]) => n > 0).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .map(([t, n]) => `${typeLabel(t)} ${num(n)}`).join(', ')
}

function ownershipView(i: OverviewInputs, coverage: ServicesCoverage | null): OwnershipView {
  if (i.stats.status === 'loading') return { status: 'loading' }
  const stats = i.stats.status === 'ready' ? i.stats.data : null
  if (!stats || !stats.ownership || typeof stats.total !== 'number') return { status: 'error', text: OVERVIEW_COPY.ownershipError }
  if (stats.total === 0) {
    const gap = inventoryGap(coverage ?? undefined, 0)
    return { status: 'empty', text: 'No resources yet', note: gap === 'not-scanned' ? 'Not scanned yet' : null }
  }
  const { owned, unowned, unknown } = stats.ownership
  const t = stats.total
  let sentence = `${num(owned)} of ${num(t)} ${plural(t, 'resource has', 'resources have')} an owner.`
  if (unknown > 0) {
    const types = byType(stats.unknown_by_type)
    sentence += ` Tags couldn't be read on ${num(unknown)}${types ? ` (${types})` : ''}, so ${plural(unknown, 'its', 'their')} owner is unknown, not missing; ${plural(unknown, "it isn't", "they aren't")} counted as "${OVERVIEW_COPY.noOwnerTag}".`
  }
  return { status: 'ready', noOwnerTag: unowned, unknown, sentence, total: t }
}

export function describeOverview(i: OverviewInputs, now: number): OverviewView {
  if (i.coverage.status === 'ready' && !i.coverage.data.account.connected) {
    return {
      mode: 'no-account',
      header: { status: null, scanRunning: false, showSync: false },
      notice: null,
      tiles: null,
      attention: null,
      checked: { from: null, rows: [], warnings: [], error: OVERVIEW_COPY.nothingChecked },
      costByService: null,
      ownership: null,
    }
  }
  const coverage = i.coverage.status === 'ready' ? i.coverage.data : null
  const mode: OverviewView['mode'] = coverage ? 'connected' : i.coverage.status === 'error' ? 'coverage-error' : 'loading'
  return {
    mode,
    header: { status: coverage ? headerStatus(coverage, now) : null, scanRunning: !!coverage && scanIsRunning(coverage), showSync: true },
    notice: coverage ? regionNotice(coverage, now, i.regionsLinkAvailable) : null,
    tiles: { spend: spendTile(i), findings: findingsTile(i), savings: savingsTile(i) },
    attention: attentionView(i, coverage),
    checked: coverage ? checkedView(coverage, i, now)
      : { from: null, rows: [], warnings: [], error: mode === 'coverage-error' ? OVERVIEW_COPY.coverageError : null },
    costByService: costByService(i.costSummary),
    ownership: ownershipView(i, coverage),
  }
}
