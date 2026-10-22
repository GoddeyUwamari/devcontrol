/**
 * "What we didn't check" (Phase 1, PR S1-D): what this page does not cover,
 * so nothing on it looks more complete than it is. Built only from GET
 * /api/services/coverage and /stats; each line only when it applies. Pure, so
 * every condition is tested without rendering.
 */
import type { AWSServicesStats, ServicesCoverage } from '@/lib/services/aws-services.service'
import { TYPE_DISPLAY } from './resourceTypes'
import { isScanAbandoned, scopeIsCompleted, warningNotes } from './coverage'
import { latestAttempt } from './regionCoverage'

export interface NotCheckedLine { key: string; text: string }

export const NOT_CHECKED_COPY = {
  otherRegions: 'Other enabled regions are not scanned yet.',
  otherRegionsExceptS3: 'Other enabled regions are not scanned yet, except for S3 buckets, which are listed in every region.',
  iam: 'IAM is not inventoried.',
  cloudfrontTags: "CloudFront tags aren't read yet, so every distribution's owner shows as Unknown.",
  lastScanFailed: 'The last scan did not finish cleanly; some counts may be from an earlier scan.',
  neverScanned: 'No scan has run yet, so nothing on this page has been checked.',
  otherTypes: 'Other AWS resource types are not inventoried.',
}

function typeName(type: string): string {
  return TYPE_DISPLAY[type] ?? type
}

/** "A", "A and B", "A, B and C". */
function listOf(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** The tags-unreadable line, with the per-type counts when /stats has them. */
export function unknownTagsText(count: number, byType: Record<string, number> | undefined): string {
  const head = count === 1
    ? "1 resource: tags couldn't be read, so its owner is unknown, not missing. It is not counted as Unowned."
    : `${count} resources: tags couldn't be read, so their owner is unknown, not missing. They are not counted as Unowned.`
  const types = Object.entries(byType ?? {}).filter(([, n]) => n > 0).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
  return types.length > 0 ? `${head} By type: ${types.map(([t, n]) => `${typeName(t)} ${n}`).join(', ')}.` : head
}

/**
 * `leaseRule` (multi-region M6, only with the M5c keys): whether the last scan
 * finished comes from last_scan and scan_in_progress, as in the region
 * coverage, instead of the one-hour rule for running jobs.
 */
export function notCheckedLines(coverage: ServicesCoverage, stats: AWSServicesStats | undefined, now: number, inTabWarnings: readonly string[] = [], leaseRule = false): NotCheckedLine[] {
  const lines: NotCheckedLine[] = []
  const connected = coverage.account.connected && !!coverage.scope.home_region
  const last = coverage.last_scan
  const completed = scopeIsCompleted(coverage)

  // Only with a connected account: without one, nothing is being scanned.
  // S3 is claimed only from a completed scan that listed it (as in the strip).
  if (connected) {
    lines.push({ key: 'regions', text: completed && coverage.scope.s3.in_last_scan ? NOT_CHECKED_COPY.otherRegionsExceptS3 : NOT_CHECKED_COPY.otherRegions })
  }
  // Whenever the page shows any inventory: a connected account, or stored resources.
  if (connected || (stats?.total ?? 0) > 0) lines.push({ key: 'iam', text: NOT_CHECKED_COPY.iam })
  if (coverage.scope.cloudfront.count > 0) lines.push({ key: 'cloudfront-tags', text: NOT_CHECKED_COPY.cloudfrontTags })

  const unknown = stats?.ownership?.unknown ?? 0
  if (unknown > 0) lines.push({ key: 'tags-unknown', text: unknownTagsText(unknown, stats?.unknown_by_type) })

  for (const note of warningNotes(last?.warnings ?? [], inTabWarnings)) lines.push({ key: `warning-${note.key}`, text: note.body })

  const unfinished = leaseRule ? latestAttempt(coverage) === 'unfinished' : last?.status === 'failed' || isScanAbandoned(last, now)
  if (connected && unfinished) {
    lines.push({ key: 'last-scan-failed', text: NOT_CHECKED_COPY.lastScanFailed })
  } else if (connected && !last && !coverage.last_successful_scan_at) {
    lines.push({ key: 'never-scanned', text: NOT_CHECKED_COPY.neverScanned })
  }

  // The inventoried types come from the last completed scan only: the API
  // gives the newest job's types, so they are listed only when it completed.
  const types = completed ? (coverage.resource_types ?? []) : []
  if (types.length > 0) {
    lines.push({ key: 'types', text: `We inventory these types: ${listOf(types.map(typeName))}. ${NOT_CHECKED_COPY.otherTypes}` })
  }
  return lines
}
