/**
 * CloudWatch Scalability Phase 2D: pure unit coverage for cloudwatch-pagination.util.ts
 * -- deterministic keyset pagination over an already-evaluated, already-ordered
 * CloudWatchServiceHealth[]. No AWS calls, no DB, no CloudWatchService involved: this
 * file proves the slicing/cursor mechanics in isolation, against hand-built fixtures
 * whose order is deliberately NOT re-sorted by the module under test (it trusts the
 * caller's order, matching cloudwatch.service.ts's own getResourceInventory() ORDER BY +
 * Promise.all()-preserves-order guarantee -- see that file's comments).
 */
import {
  clampPageSize,
  decodeCursor,
  paginateServices,
  InvalidCursorError,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  CursorPayload,
} from '../cloudwatch-pagination.util';
import { CloudWatchServiceHealth } from '../cloudwatch.service';

function fx(
  type: CloudWatchServiceHealth['resourceType'],
  name: string | null,
  id: string,
  overrides: Partial<CloudWatchServiceHealth> = {}
): CloudWatchServiceHealth {
  return {
    resourceId: id,
    resourceDbId: id,
    resourceSortName: name,
    name: name ?? id,
    description: '',
    resourceType: type,
    status: 'healthy',
    uptime: null,
    responseTimeMs: null,
    errorRate: null,
    critical: false,
    monitored: true,
    ...overrides,
  };
}

function encode(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

describe('clampPageSize', () => {
  it('defaults when missing', () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('defaults for non-numeric input', () => {
    expect(clampPageSize('not-a-number')).toBe(DEFAULT_PAGE_SIZE);
  });

  it('defaults for zero or negative values', () => {
    expect(clampPageSize('0')).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(-5)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('accepts a valid in-range size (string query-param form)', () => {
    expect(clampPageSize('10')).toBe(10);
  });

  it('clamps an oversized client-requested pageSize to MAX_PAGE_SIZE -- never trusts an arbitrary client size', () => {
    expect(clampPageSize('100000')).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(9999)).toBe(MAX_PAGE_SIZE);
  });

  it('truncates a fractional size', () => {
    expect(clampPageSize('12.9')).toBe(12);
  });
});

describe('decodeCursor', () => {
  it('returns null for an absent cursor (undefined/null/empty string) -- not an error, means "first page"', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('round-trips a well-formed cursor', () => {
    const payload: CursorPayload = { type: 'ec2', name: 'web-1', id: 'row-1' };
    expect(decodeCursor(encode(payload))).toEqual(payload);
  });

  it('round-trips a cursor with a null name', () => {
    const payload: CursorPayload = { type: 'lambda', name: null, id: 'row-2' };
    expect(decodeCursor(encode(payload))).toEqual(payload);
  });

  it('throws InvalidCursorError (not a generic Error) for non-base64/non-JSON garbage', () => {
    expect(() => decodeCursor('not-valid-base64-json!!!')).toThrow(InvalidCursorError);
  });

  it('throws InvalidCursorError for valid JSON missing required fields', () => {
    const bad = Buffer.from(JSON.stringify({ type: 'ec2' }), 'utf8').toString('base64');
    expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
  });

  it('throws InvalidCursorError for an unrecognized resource type', () => {
    const bad = Buffer.from(JSON.stringify({ type: 'not-a-real-type', name: 'x', id: '1' }), 'utf8').toString('base64');
    expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
  });

  it('throws InvalidCursorError for an empty id', () => {
    const bad = Buffer.from(JSON.stringify({ type: 'ec2', name: 'x', id: '' }), 'utf8').toString('base64');
    expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
  });

  it('throws InvalidCursorError when name is present but not a string or null', () => {
    const bad = Buffer.from(JSON.stringify({ type: 'ec2', name: 42, id: '1' }), 'utf8').toString('base64');
    expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
  });
});

describe('paginateServices', () => {
  it('empty fleet: shown/total 0, hasMore false, cursor null', () => {
    const result = paginateServices([], null, 25);
    expect(result.services).toEqual([]);
    expect(result.pagination).toEqual({ shown: 0, total: 0, hasMore: false, cursor: null });
  });

  it('fleet smaller than page size: single page, hasMore false, cursor null', () => {
    const fleet = [fx('ec2', 'a', '1'), fx('ec2', 'b', '2')];
    const result = paginateServices(fleet, null, 25);
    expect(result.services).toHaveLength(2);
    expect(result.pagination).toEqual({ shown: 2, total: 2, hasMore: false, cursor: null });
  });

  it('fleet exactly equal to page size: single page, hasMore false', () => {
    const fleet = [fx('ec2', 'a', '1'), fx('ec2', 'b', '2'), fx('ec2', 'c', '3')];
    const result = paginateServices(fleet, null, 3);
    expect(result.services).toHaveLength(3);
    expect(result.pagination.hasMore).toBe(false);
    expect(result.pagination.cursor).toBeNull();
  });

  it('fleet larger than page size: first page has hasMore true and a non-null cursor', () => {
    const fleet = [fx('ec2', 'a', '1'), fx('ec2', 'b', '2'), fx('ec2', 'c', '3')];
    const result = paginateServices(fleet, null, 2);
    expect(result.services.map((s) => s.resourceDbId)).toEqual(['1', '2']);
    expect(result.pagination).toEqual({ shown: 2, total: 3, hasMore: true, cursor: expect.any(String) });
  });

  it('first page -> subsequent page -> final page walks the whole fleet with no gaps or duplicates', () => {
    const fleet = [fx('ec2', 'a', '1'), fx('ec2', 'b', '2'), fx('ec2', 'c', '3'), fx('ec2', 'd', '4'), fx('ec2', 'e', '5')];
    const seen: string[] = [];

    let cursor: CursorPayload | null = null;
    let hasMore = true;
    let guard = 0;
    while (hasMore && guard < 10) {
      guard++;
      const page = paginateServices(fleet, cursor, 2);
      seen.push(...page.services.map((s) => s.resourceDbId));
      hasMore = page.pagination.hasMore;
      cursor = page.pagination.cursor ? decodeCursor(page.pagination.cursor) : null;
    }

    expect(seen).toEqual(['1', '2', '3', '4', '5']);
  });

  it('exact page boundary: a fleet of exactly 2x page size produces exactly two pages, second has hasMore false', () => {
    const fleet = [fx('ec2', 'a', '1'), fx('ec2', 'b', '2'), fx('ec2', 'c', '3'), fx('ec2', 'd', '4')];
    const first = paginateServices(fleet, null, 2);
    expect(first.pagination.hasMore).toBe(true);
    const second = paginateServices(fleet, decodeCursor(first.pagination.cursor!), 2);
    expect(second.services.map((s) => s.resourceDbId)).toEqual(['3', '4']);
    expect(second.pagination.hasMore).toBe(false);
    expect(second.pagination.cursor).toBeNull();
  });

  it('maximum page size: a page request at MAX_PAGE_SIZE returns up to that many rows in one page', () => {
    const fleet = Array.from({ length: MAX_PAGE_SIZE + 10 }, (_, i) => fx('ec2', `r${i}`, `id-${i}`));
    const result = paginateServices(fleet, null, MAX_PAGE_SIZE);
    expect(result.services).toHaveLength(MAX_PAGE_SIZE);
    expect(result.pagination.hasMore).toBe(true);
  });

  it('deterministic ordering: type bucket order is honored regardless of input interleaving', () => {
    // Input already reflects computeMetrics()'s fixed EC2/ALB/RDS/Lambda/DynamoDB/ECS/EKS
    // concatenation order -- this fixture keeps that order deliberately, since the module
    // under test does not re-sort.
    const fleet = [
      fx('ec2', 'a', '1'),
      fx('load-balancer', 'alb-a', '2'),
      fx('rds', 'db-a', '3'),
      fx('lambda', 'fn-a', '4'),
      fx('dynamodb', 'tbl-a', '5'),
      fx('ecs', 'svc-a', '6'),
      fx('eks', 'cluster-a', '7'),
    ];
    const result = paginateServices(fleet, null, 100);
    expect(result.services.map((s) => s.resourceType)).toEqual(['ec2', 'load-balancer', 'rds', 'lambda', 'dynamodb', 'ecs', 'eks']);
  });

  it('Service Health Coverage Expansion: ebs and cloudfront sort after the original seven types, never interleaved with them', () => {
    // Input already reflects computeMetrics()'s fixed concatenation order -- ebs/cloudfront
    // are appended after eks, exactly as the pagination fixture above appends nothing past
    // eks for the original seven. This proves TYPE_ORDER was extended, not just widened to
    // compile.
    const fleet = [
      fx('ec2', 'a', '1'),
      fx('eks', 'cluster-a', '7'),
      fx('ebs', 'vol-a', '8'),
      fx('cloudfront', 'dist-a', '9'),
    ];
    const result = paginateServices(fleet, null, 100);
    expect(result.services.map((s) => s.resourceType)).toEqual(['ec2', 'eks', 'ebs', 'cloudfront']);
  });

  it('Aurora Service Health: aurora sorts after cloudfront, at the end of the type order', () => {
    const fleet = [
      fx('cloudfront', 'dist-a', '9'),
      fx('aurora', 'cluster-a', '10'),
    ];
    const result = paginateServices(fleet, null, 100);
    expect(result.services.map((s) => s.resourceType)).toEqual(['cloudfront', 'aurora']);
  });

  it('Service Health Coverage Expansion: a cursor resumes correctly across the ebs/cloudfront type boundary', () => {
    const fleet = [fx('eks', 'cluster-a', '7'), fx('ebs', 'vol-a', '8'), fx('ebs', 'vol-b', '9'), fx('cloudfront', 'dist-a', '10')];
    const firstPage = paginateServices(fleet, null, 2);
    expect(firstPage.services.map((s) => s.resourceType)).toEqual(['eks', 'ebs']);
    expect(firstPage.pagination.cursor).not.toBeNull();

    const cursor = decodeCursor(firstPage.pagination.cursor);
    const secondPage = paginateServices(fleet, cursor, 2);
    expect(secondPage.services.map((s) => s.resourceType)).toEqual(['ebs', 'cloudfront']);
  });

  it('resuming after a cursor whose row has a duplicate resource_name finds the correct next row via the id tiebreaker', () => {
    // Two EC2 rows share the same resource_name -- exactly the case the id ASC tiebreaker
    // exists for (resource_name has no uniqueness constraint in aws_resources).
    const fleet = [fx('ec2', 'shared-name', 'aaa'), fx('ec2', 'shared-name', 'bbb'), fx('ec2', 'zzz-last', 'ccc')];
    const first = paginateServices(fleet, null, 1);
    expect(first.services[0].resourceDbId).toBe('aaa');
    const second = paginateServices(fleet, decodeCursor(first.pagination.cursor!), 1);
    expect(second.services[0].resourceDbId).toBe('bbb');
    const third = paginateServices(fleet, decodeCursor(second.pagination.cursor!), 1);
    expect(third.services[0].resourceDbId).toBe('ccc');
  });

  it('null resource_name sorts last within its type (NULLS LAST), matching the DB ORDER BY', () => {
    // The module under test trusts the caller's order rather than re-sorting (see its
    // own doc comment) -- this fixture is deliberately pre-sorted NULLS LAST, matching
    // what getResourceInventory()'s real ORDER BY would produce.
    const ordered = [fx('ec2', 'aaa', '1'), fx('ec2', 'bbb', '3'), fx('ec2', null, '2')];
    const page1 = paginateServices(ordered, null, 2);
    expect(page1.services.map((s) => s.resourceDbId)).toEqual(['1', '3']);
    const page2 = paginateServices(ordered, decodeCursor(page1.pagination.cursor!), 2);
    expect(page2.services.map((s) => s.resourceDbId)).toEqual(['2']);
    expect(page2.pagination.hasMore).toBe(false);
  });

  it('a stale cursor (referencing a row no longer present) still resumes gracefully at the first row that sorts after it, rather than throwing', () => {
    const fleet = [fx('ec2', 'aaa', '1'), fx('ec2', 'ccc', '3'), fx('ec2', 'ddd', '4')];
    // Cursor references 'bbb'/id '2', which no longer exists in the fleet (e.g. removed
    // between requests).
    const staleCursor: CursorPayload = { type: 'ec2', name: 'bbb', id: '2' };
    const result = paginateServices(fleet, staleCursor, 10);
    expect(result.services.map((s) => s.resourceDbId)).toEqual(['3', '4']);
  });

  it('a cursor pointing past the end of the fleet returns an empty page with hasMore false', () => {
    const fleet = [fx('ec2', 'aaa', '1')];
    const cursor: CursorPayload = { type: 'eks', name: 'zzz', id: '999' };
    const result = paginateServices(fleet, cursor, 10);
    expect(result.services).toEqual([]);
    expect(result.pagination).toEqual({ shown: 0, total: 1, hasMore: false, cursor: null });
  });
});
