'use client'

import Link from 'next/link'
import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink, ListChecks, Server } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { checkResultLabel, resourceTypeLabel } from '@/components/monitoring/ServiceHealthTable'
import { useInViewOnce, useResourceChecks, type ResourceChecksState } from '@/lib/hooks/useResourceChecks'
import { checkCountsFrom, mapServiceRow, type CloudWatchMetricsData, type HealthSummary, type PaginationMeta, type ServiceHealth } from '@/lib/resource-checks'
import { EvidenceBadge, NEUTRAL_COLOR, toneFillClass } from './evidence-badge'
import { EvidenceInfo, EvidenceSection } from './evidence-info'

export const RESOURCE_CHECKS_TITLE = 'Resource checks'
export const RESOURCE_CHECKS_SCOPE = 'AWS status checks and configured CloudWatch thresholds for resources that report telemetry.'
export const RESOURCE_CHECKS_NOT_CHECKED = 'Latency, error rates, application health, and resources not reporting telemetry.'
export const MAX_RESOURCE_ROWS = 6
const MONITORING_HREF = '/admin/monitoring'

export interface ResourceCheckRow {
  key: string
  resourceType: string
  typeLabel: string
  shortId: string
  label: string
  /** Status of the row as the backend reported it -- only used to color its chip. */
  status: ServiceHealth['status']
}

/** What the section shows, derived only from the canonical response. */
export type ResourceChecksView =
  | { kind: 'line'; line: 'Loading…' | 'Could not be retrieved' | 'Not connected' | 'No check results yet' }
  | {
    kind: 'results'
    /** N: resources whose check passed. */
    passing: number
    /** M: resources reporting telemetry -- the same denominator as /admin/monitoring (checkCountsFrom().reporting). */
    reporting: number
    withIssues: number
    /** K: resources reporting telemetry whose check produced no result. */
    undetermined: number
    /** 'danger' when any result is critical or down, else 'warning'; null when all pass. */
    issueTone: 'warning' | 'danger' | null
    caption: string | null
    rows: ResourceCheckRow[]
    moreCount: number
    capturedAt: Date | null
  }

/**
 * "i-0c3e…c59": the resource's ID, middle-truncated when long. An ARN is shown
 * by the resource's name when it has one, else by its last segment.
 */
export function shortResourceId(id: string, name?: string): string {
  const tail = !id.startsWith('arn:') ? id
    : name && !name.startsWith('arn:') ? name
    : id.split(/[:/]/).filter(Boolean).pop() ?? id
  return tail.length > 16 ? `${tail.slice(0, 6)}…${tail.slice(-3)}` : tail
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/**
 * One segment per resourceType present among the checked rows, in response
 * order, in each type's own check wording (checkResultLabel): "EC2: status
 * checks passing · ALB (2): 1 within thresholds, 1 threshold exceeded".
 * Undetermined rows are left out (they are counted separately).
 */
export function resourceChecksCaption(rows: ResourceCheckRow[]): string | null {
  const byType = new Map<string, { typeLabel: string; labels: Map<string, number>; count: number }>()
  for (const row of rows) {
    if (row.status === 'unknown') continue
    const entry = byType.get(row.resourceType) ?? { typeLabel: row.typeLabel, labels: new Map<string, number>(), count: 0 }
    entry.labels.set(row.label, (entry.labels.get(row.label) ?? 0) + 1)
    entry.count += 1
    byType.set(row.resourceType, entry)
  }
  if (byType.size === 0) return null
  return [...byType.values()].map(({ typeLabel, labels, count }) => {
    const name = count > 1 ? `${typeLabel} (${count})` : typeLabel
    const results = labels.size === 1
      ? lowerFirst([...labels.keys()][0])
      : [...labels.entries()].map(([label, n]) => `${n} ${lowerFirst(label)}`).join(', ')
    return `${name}: ${results}`
  }).join(' · ')
}

export function resourceChecksView(state: ResourceChecksState): ResourceChecksView {
  if (state.status === 'idle' || state.status === 'loading') return { kind: 'line', line: 'Loading…' }
  if (state.status === 'failed') return { kind: 'line', line: 'Could not be retrieved' }
  if (state.status === 'not_connected') return { kind: 'line', line: 'Not connected' }

  const data: CloudWatchMetricsData = state.data
  const summary: HealthSummary | undefined = data?.healthSummary
  if (!summary) return { kind: 'line', line: 'Could not be retrieved' }

  // The same counts /admin/monitoring shows: M includes undetermined resources, which
  // are never counted as passing and are shown separately.
  const counts = checkCountsFrom(summary)
  if (counts.noIssues + counts.withIssues === 0) return { kind: 'line', line: 'No check results yet' }

  // Rows are the checked resources on the response's page: checkResultLabel gives no
  // label to a resource with no telemetry, so never-checked ones are left out.
  const rows: ResourceCheckRow[] = []
  const services: unknown[] = Array.isArray(data.services) ? data.services : []
  services.forEach((raw, i) => {
    const row = mapServiceRow(raw)
    const label = checkResultLabel(row)
    if (!label || !row.resourceType) return
    rows.push({ key: `${row.resourceType}:${row.resourceId ?? row.name}:${i}`, resourceType: row.resourceType, typeLabel: resourceTypeLabel(row.resourceType), shortId: shortResourceId(row.resourceId ?? row.name, row.name), label, status: row.status })
  })

  const pagination: PaginationMeta | undefined = data.pagination
  // The per-type caption needs every checked resource; with more pages to come it would
  // describe only part of them, so it is left out.
  const complete = !pagination?.hasMore
  const caption = complete ? resourceChecksCaption(rows) : null

  const shown = rows.slice(0, MAX_RESOURCE_ROWS)
  const capturedAt = data.capturedAt ? new Date(data.capturedAt) : null

  return {
    kind: 'results',
    passing: counts.noIssues,
    reporting: counts.reporting,
    withIssues: counts.withIssues,
    undetermined: counts.undetermined,
    issueTone: counts.withIssues === 0 ? null : summary.critical + summary.down > 0 ? 'danger' : 'warning',
    caption,
    rows: shown,
    moreCount: Math.max(0, summary.monitored - shown.length),
    capturedAt: capturedAt && !isNaN(capturedAt.getTime()) ? capturedAt : null,
  }
}

/** "checked 4 min ago", from the time the backend finished the checks. */
export function checkedAgo(capturedAt: Date, now: number = Date.now()): string {
  const minutes = Math.floor((now - capturedAt.getTime()) / 60000)
  if (minutes < 1) return 'checked just now'
  if (minutes < 60) return `checked ${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return `checked ${hours} h ago`
}

const TONE_COLOR = { success: 'var(--text-success)', warning: 'var(--text-warning)', danger: 'var(--text-danger)' }

function rowChipColor(row: ResourceCheckRow): string {
  if (row.status === 'healthy') return TONE_COLOR.success
  if (row.status === 'degraded') return TONE_COLOR.warning
  if (row.status === 'critical' || row.status === 'down') return TONE_COLOR.danger
  return NEUTRAL_COLOR
}

function SectionInfo() {
  return (
    <>
      <EvidenceSection heading="What resource checks are">
        <p className="m-0">The latest check result for each discovered AWS resource that reports telemetry: {lowerFirst(RESOURCE_CHECKS_SCOPE)}</p>
      </EvidenceSection>
      <EvidenceSection heading="How results are counted">
        <p className="m-0">“N of M”: N resources have no issues detected; M is every resource reporting telemetry, the same count as the monitoring page. A resource whose check produced no result is included in M, shown as undetermined, and never counted as passing.</p>
      </EvidenceSection>
      <EvidenceSection heading="Separate from the posture score">
        <p className="m-0">Resource check results are not included in the Infrastructure Posture score.</p>
      </EvidenceSection>
      <EvidenceSection heading="Not checked">
        <p className="m-0">{RESOURCE_CHECKS_NOT_CHECKED}</p>
      </EvidenceSection>
    </>
  )
}

function SummaryCard({ view }: { view: ResourceChecksView }) {
  const noIssues = view.kind === 'results' && view.withIssues === 0
  // N = M > 0: every resource reporting telemetry passed its check.
  const allPass = noIssues && view.kind === 'results' && view.undetermined === 0
  const issueColor = view.kind === 'results' && view.issueTone ? TONE_COLOR[view.issueTone] : NEUTRAL_COLOR
  const hasIssues = view.kind === 'results' && view.withIssues > 0
  const StatusIcon = allPass ? CheckCircle2 : hasIssues ? AlertTriangle : CircleDashed
  const iconColor = allPass ? TONE_COLOR.success : hasIssues ? issueColor : NEUTRAL_COLOR

  return (
    <div className="min-w-0 self-start rounded-xl border border-border bg-[var(--surface-2)] p-5 flex items-start gap-4" data-testid="resource-checks-summary">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-[var(--surface-1)] border border-border">
        <StatusIcon size={20} aria-hidden="true" style={{ color: iconColor }} data-testid={`resource-checks-icon-${allPass ? 'pass' : hasIssues ? 'issue' : 'neutral'}`} />
      </div>
      <div className="min-w-0 flex-1 self-center">
        {view.kind === 'line' ? (
          <p className="text-sm text-[var(--text-secondary)] m-0" data-testid="resource-checks-state">{view.line}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xl font-bold leading-none text-foreground mr-1" data-testid="resource-checks-value">
                {view.passing} <span className="text-base font-semibold text-[var(--text-secondary)]">of</span> {view.reporting}
              </span>
              {noIssues
                ? <EvidenceBadge label="No issues detected" color={TONE_COLOR.success} testId="resource-checks-chip" />
                : <EvidenceBadge label={`${view.withIssues} with issues detected`} color={TONE_COLOR.danger} testId="resource-checks-chip" />}
              {view.undetermined > 0 && <EvidenceBadge label={`${view.undetermined} undetermined`} color={NEUTRAL_COLOR} testId="resource-checks-undetermined" />}
            </div>
            <div className="mt-4">
              <Progress
                value={(view.passing / view.reporting) * 100}
                className="h-2 bg-[color:var(--border)]"
                indicatorClassName={toneFillClass(noIssues ? TONE_COLOR.success : issueColor)}
                aria-label="Resources with no issues detected"
                aria-valuetext={`${view.passing} of ${view.reporting} with no issues detected`}
              />
            </div>
            {view.caption && (
              <p className="text-xs text-[var(--text-secondary)] leading-snug m-0 mt-3" data-testid="resource-checks-caption">{view.caption}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function DetailsPanel({ view }: { view: ResourceChecksView }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-[var(--surface-2)] p-5 flex flex-col gap-4" data-testid="resource-checks-details">
      <div>
        <p className="text-sm font-semibold text-foreground m-0">What this checks</p>
        <p className="text-xs text-[var(--text-secondary)] leading-snug m-0 mt-1">{RESOURCE_CHECKS_SCOPE}</p>
      </div>
      {view.kind === 'results' && (
        <div>
          <p className="text-sm font-semibold text-foreground m-0 mb-1">Resources</p>
          <ul className="list-none m-0 p-0" data-testid="resource-checks-rows">
            {view.rows.map((row) => (
              <li key={row.key} className="flex items-center gap-3 py-2 border-b border-border last:border-b-0" data-testid="resource-checks-row">
                <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[var(--surface-1)] border border-border">
                  <Server size={14} aria-hidden="true" className="text-[var(--text-secondary)]" />
                </span>
                <span className="min-w-0 flex-1 flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <span className="text-sm text-foreground max-w-full truncate">{row.typeLabel} · {row.shortId}</span>
                  <EvidenceBadge label={row.label} color={rowChipColor(row)} testId="resource-checks-row-result" />
                </span>
              </li>
            ))}
          </ul>
          {view.moreCount > 0 && (
            <Link href={MONITORING_HREF} className="inline-block text-xs font-semibold no-underline mt-2" style={{ color: 'var(--text-accent)' }} data-testid="resource-checks-more">
              +{view.moreCount} more
            </Link>
          )}
        </div>
      )}
      <div>
        <p className="text-sm font-semibold text-foreground m-0">Not checked</p>
        <p className="text-xs text-[var(--text-secondary)] leading-snug m-0 mt-1">{RESOURCE_CHECKS_NOT_CHECKED}</p>
      </div>
      {view.kind === 'results' ? (
        <>
          <p className="text-xs text-[var(--text-secondary)] m-0" data-testid="resource-checks-source">
            Amazon CloudWatch{view.capturedAt ? ` · ${checkedAgo(view.capturedAt)}` : ''}
          </p>
          <Link href={MONITORING_HREF} className="inline-flex items-center gap-1.5 text-xs font-semibold no-underline mt-auto" style={{ color: 'var(--text-accent)' }}>
            <ExternalLink size={13} aria-hidden="true" /> Open resource checks →
          </Link>
        </>
      ) : (
        <p className="text-xs text-[var(--text-secondary)] m-0" data-testid="resource-checks-details-state">{view.line}</p>
      )}
    </div>
  )
}

/**
 * Resource checks section: the canonical /api/cloudwatch/metrics results,
 * fetched once the section scrolls into view (watched only after the sections
 * above have loaded, so their loading skeletons cannot pull it into view). Not part of Infrastructure
 * Posture. Never shown in demo mode (no check results are invented).
 */
export function ResourceChecksSection({ isDemoActive, organizationId, aboveLoaded = true }: {
  isDemoActive: boolean
  organizationId: string | null | undefined
  /** False while sections above are still loading and can still move this one. */
  aboveLoaded?: boolean
}) {
  const [ref, inView] = useInViewOnce<HTMLDivElement>(aboveLoaded)
  const state = useResourceChecks(inView && !isDemoActive, organizationId)
  if (isDemoActive) return null
  const view = resourceChecksView(state)

  return (
    <div ref={ref} className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 mb-6" data-testid="resource-checks-section">
      <div className="relative flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-5">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-[var(--bg-accent)]">
            <ListChecks size={16} aria-hidden="true" style={{ color: 'var(--text-accent)' }} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-foreground m-0">{RESOURCE_CHECKS_TITLE}</h3>
              <EvidenceInfo about={RESOURCE_CHECKS_TITLE} heading="How these checks work" tooltip="How these checks work" align="start">
                <SectionInfo />
              </EvidenceInfo>
            </div>
            <p className="text-xs text-[var(--text-secondary)] m-0 mt-0.5">Not included in the posture score</p>
          </div>
        </div>
        <Link href={MONITORING_HREF} className="text-xs font-semibold no-underline whitespace-nowrap py-2" style={{ color: 'var(--text-accent)' }}>
          View all checks →
        </Link>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SummaryCard view={view} />
        <DetailsPanel view={view} />
      </div>
    </div>
  )
}
