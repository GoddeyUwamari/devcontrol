/**
 * OrphanedResourceDetectorService, against a stand-in connection: what it
 * asks the inventory for and what it reports. No database and no AWS.
 *
 *   - An S3 bucket is "empty" only when its object count is recorded as 0;
 *     an unrecorded count is unknown and is not reported.
 *   - An empty bucket is reported with no saving: it stores nothing.
 *   - Stopped EC2 instances are not reported at all: no stop time is
 *     recorded, and a stopped instance accrues no compute charge.
 *
 * The SQL predicates themselves are also exercised against live Postgres in
 * awsResourceDiscovery.tenant-context.test.ts.
 */
import { OrphanedResourceDetectorService } from '../orphanedResourceDetector';

const ORG = '00000000-0000-4000-8000-000000000001';

interface FakeRow {
  id: string;
  resource_type: string;
  status: string;
  estimated_monthly_cost: number | null;
  metadata: Record<string, unknown>;
  first_discovered_at: Date;
}

/**
 * A connection tagged for `tag` whose inventory query answers with the rows
 * that match the statement's resource type, and records every statement.
 */
function fakeConnection(tag: string | null, inventory: FakeRow[]) {
  const statements: string[] = [];
  const query = jest.fn(async (sql: string) => {
    statements.push(sql);
    if (sql.includes("current_setting('app.current_organization_id'")) {
      return { rows: [{ organization_id: tag }] };
    }
    const type = /resource_type = '([a-z0-9-]+)'/.exec(sql)?.[1];
    return { rows: inventory.filter((r) => r.resource_type === type) };
  });
  return { connection: { query } as any, statements };
}

function row(overrides: Partial<FakeRow>): FakeRow {
  return {
    id: 'res-1',
    resource_type: 's3',
    status: 'active',
    estimated_monthly_cost: 5,
    metadata: {},
    first_discovered_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('OrphanedResourceDetectorService.detectOrphaned', () => {
  it('refuses a connection that is not tagged for the organization', async () => {
    const { connection } = fakeConnection(null, [row({})]);
    await expect(new OrphanedResourceDetectorService(connection).detectOrphaned(ORG)).rejects.toThrow(/^TENANT_CONTEXT_MISSING/);
  });

  it('reports a recorded-empty bucket with no saving, whatever its inventory estimate', async () => {
    const { connection } = fakeConnection(ORG, [row({ id: 'bucket', estimated_monthly_cost: 5, metadata: { object_count: 0 } })]);
    const orphaned = await new OrphanedResourceDetectorService(connection).detectOrphaned(ORG);
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]).toMatchObject({ orphaned_type: 'empty_s3_bucket', potential_savings: 0 });
    expect(orphaned[0].resource.id).toBe('bucket');
  });

  it('asks only for buckets whose object count is recorded as 0 -- an unrecorded count is not empty', async () => {
    const { connection, statements } = fakeConnection(ORG, []);
    await new OrphanedResourceDetectorService(connection).detectOrphaned(ORG);
    const inventory = statements.filter((sql) => sql.includes('FROM aws_resources'));
    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toContain("resource_type = 's3'");
    expect(inventory[0]).toContain("metadata->>'object_count' = '0'");
    expect(inventory[0]).not.toMatch(/object_count'\s+IS\s+NULL/i);
    expect(inventory[0]).toContain("status != 'terminated'");
  });

  it('never reports a stopped EC2 instance, and never asks for one', async () => {
    const { connection, statements } = fakeConnection(ORG, [
      row({ id: 'stopped', resource_type: 'ec2', status: 'stopped', estimated_monthly_cost: 120 }),
    ]);
    const orphaned = await new OrphanedResourceDetectorService(connection).detectOrphaned(ORG);
    expect(orphaned).toEqual([]);
    expect(statements.some((sql) => sql.includes("resource_type = 'ec2'"))).toBe(false);
  });

  it('claims no saving in total for any result', async () => {
    const { connection } = fakeConnection(ORG, [
      row({ id: 'a', metadata: { object_count: 0 }, estimated_monthly_cost: 5 }),
      row({ id: 'b', metadata: { object_count: 0 }, estimated_monthly_cost: 50 }),
    ]);
    const service = new OrphanedResourceDetectorService(connection);
    const orphaned = await service.detectOrphaned(ORG);
    expect(await service.calculateTotalSavings(orphaned)).toBe(0);
  });
});
