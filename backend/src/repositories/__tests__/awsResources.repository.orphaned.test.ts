/**
 * GET /api/aws-resources/orphaned (AWSResourcesRepository.getOrphaned) lists
 * orphaned resources by the same rule as OrphanedResourceDetectorService: S3
 * buckets recorded as holding zero objects. It no longer lists stopped EC2
 * instances, which the detector dropped (no stop time is recorded, and a
 * stopped instance accrues no compute charge). Against a stand-in pool: the
 * statement is what is checked. No database and no AWS.
 */
import { AWSResourcesRepository } from '../awsResources.repository';

const ORG = '00000000-0000-4000-8000-000000000001';

function fakePool() {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    statements.push({ sql, params });
    return { rows: [] };
  });
  return { pool: { query } as any, statements };
}

describe('AWSResourcesRepository.getOrphaned', () => {
  it('asks only for buckets recorded as empty, for this organization, excluding terminated ones', async () => {
    const { pool, statements } = fakePool();
    await new AWSResourcesRepository(pool).getOrphaned(ORG);
    expect(statements).toHaveLength(1);
    const { sql, params } = statements[0];
    expect(params).toEqual([ORG]);
    expect(sql).toContain('organization_id = $1');
    expect(sql).toContain("status != 'terminated'");
    expect(sql).toContain("resource_type = 's3'");
    expect(sql).toContain("metadata->>'object_count' = '0'");
    expect(sql).not.toMatch(/object_count'\s+IS\s+NULL/i);
  });

  it('never lists stopped EC2 instances', async () => {
    const { pool, statements } = fakePool();
    await new AWSResourcesRepository(pool).getOrphaned(ORG);
    expect(statements[0].sql).not.toContain("'ec2'");
    expect(statements[0].sql).not.toMatch(/status\s*=\s*'stopped'/);
  });
});
