/**
 * CloudWatch Scalability Phase 2D: deterministic keyset pagination over an already-
 * evaluated CloudWatchServiceHealth[] -- the complete, uncapped fleet computeMetrics()
 * now returns (see cloudwatch.service.ts). This module does no AWS calls and no DB
 * queries, and it never re-sorts: the array's order (type bucket, then resource_name ASC
 * NULLS LAST, then id ASC) is already established by getResourceInventory()'s ORDER BY
 * and preserved end-to-end through evaluation (Promise.all() preserves input order; see
 * cloudwatch.service.ts's own ordering comment). This only slices that array into a
 * bounded page and encodes/decodes the resume-from cursor.
 *
 * Deliberately applied in the route layer, AFTER getMetrics()'s 45s cache read/write --
 * pagination parameters are not part of the cache key (org + range only), so paginating
 * through a large fleet never triggers a redundant AWS evaluation; every page within a
 * cache window is sliced from the same cached complete-fleet result.
 */
import { CloudWatchServiceHealth } from './cloudwatch.service'

export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 100

export interface CloudWatchPaginationMeta {
  shown: number
  total: number
  hasMore: boolean
  cursor: string | null
}

export interface CloudWatchPage {
  services: CloudWatchServiceHealth[]
  pagination: CloudWatchPaginationMeta
}

export interface CursorPayload {
  type: CloudWatchServiceHealth['resourceType']
  name: string | null
  id: string
}

// Fixed type-bucket order, matching computeMetrics()'s own services[] concatenation
// order (EC2, ALB, RDS, Lambda, DynamoDB, ECS, EKS, EBS, CloudFront) -- see
// cloudwatch.service.ts's ordering comment on that concatenation, which this must stay
// consistent with. EBS/CloudFront (Service Health Coverage Expansion) are appended after
// the original seven rather than interleaved, so pagination cursors issued before this
// change remain valid.
const TYPE_ORDER: Record<CloudWatchServiceHealth['resourceType'], number> = {
  ec2: 0,
  'load-balancer': 1,
  rds: 2,
  lambda: 3,
  dynamodb: 4,
  ecs: 5,
  eks: 6,
  ebs: 7,
  cloudfront: 8,
}

/**
 * Clamps a client-requested page size to [1, MAX_PAGE_SIZE], defaulting to
 * DEFAULT_PAGE_SIZE for anything missing, non-numeric, non-finite, or <= 0. Never trusts
 * an arbitrary client-requested size -- this is what guarantees the response can never
 * render hundreds/thousands of resources at once, regardless of what a caller asks for.
 */
export function clampPageSize(requested: unknown): number {
  const n = typeof requested === 'string' ? parseInt(requested, 10) : typeof requested === 'number' ? requested : NaN
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_SIZE
  return Math.min(Math.trunc(n), MAX_PAGE_SIZE)
}

/**
 * Thrown for a cursor that is present but malformed (not valid base64+JSON, or missing/
 * wrong-shaped fields) -- the route layer maps this to a clean 400, never a 500. A
 * missing cursor (undefined/null/empty string) is NOT an error -- decodeCursor() returns
 * null for that case, meaning "start from the first page."
 */
export class InvalidCursorError extends Error {}

export function decodeCursor(raw: string | undefined | null): CursorPayload | null {
  if (raw === undefined || raw === null || raw === '') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
  } catch {
    throw new InvalidCursorError('Cursor is not valid base64-encoded JSON')
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).type !== 'string' ||
    !((parsed as Record<string, unknown>).type as string in TYPE_ORDER) ||
    typeof (parsed as Record<string, unknown>).id !== 'string' ||
    !((parsed as Record<string, unknown>).id as string) ||
    ((parsed as Record<string, unknown>).name !== null && typeof (parsed as Record<string, unknown>).name !== 'string')
  ) {
    throw new InvalidCursorError('Cursor is missing required fields or has the wrong shape')
  }

  const p = parsed as { type: CloudWatchServiceHealth['resourceType']; name: string | null; id: string }
  return { type: p.type, name: p.name, id: p.id }
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

// NULLS LAST, matching getResourceInventory()'s ORDER BY resource_name ASC NULLS LAST.
function compareKeys(a: CursorPayload, b: CursorPayload): number {
  if (TYPE_ORDER[a.type] !== TYPE_ORDER[b.type]) return TYPE_ORDER[a.type] - TYPE_ORDER[b.type]
  if (a.name === null && b.name !== null) return 1
  if (a.name !== null && b.name === null) return -1
  if (a.name !== b.name) return (a.name as string) < (b.name as string) ? -1 : 1
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return 0
}

function keyOf(service: CloudWatchServiceHealth): CursorPayload {
  return { type: service.resourceType, name: service.resourceSortName, id: service.resourceDbId }
}

/**
 * Slices the complete, already-ordered fleet into one page starting just after `cursor`
 * (or from the beginning when `cursor` is null). A cursor referencing a row that no
 * longer exists in `services` (renamed/removed between requests -- a stale cursor across
 * a cache refresh) still resumes correctly: the first row whose key sorts after the
 * cursor's key is used, exactly as if the missing row were still present. This never
 * throws for a well-formed-but-stale cursor -- only decodeCursor() throws, for a
 * malformed one.
 */
export function paginateServices(services: CloudWatchServiceHealth[], cursor: CursorPayload | null, pageSize: number): CloudWatchPage {
  let startIndex = 0
  if (cursor) {
    const idx = services.findIndex((s) => compareKeys(keyOf(s), cursor) > 0)
    startIndex = idx === -1 ? services.length : idx
  }

  const page = services.slice(startIndex, startIndex + pageSize)
  const hasMore = startIndex + pageSize < services.length
  const lastRow = page[page.length - 1]

  return {
    services: page,
    pagination: {
      shown: page.length,
      total: services.length,
      hasMore,
      cursor: hasMore && lastRow ? encodeCursor(keyOf(lastRow)) : null,
    },
  }
}
