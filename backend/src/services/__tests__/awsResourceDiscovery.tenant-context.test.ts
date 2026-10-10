/**
 * Tenant context for discovery's orphan detection (H1) and for discovery
 * started fire-and-forget from inside an authenticated request (H2).
 *
 * aws_resources is RLS-protected, and an untagged or differently-tagged read
 * doesn't fail -- it returns zero rows, which orphan detection would read as
 * "nothing is orphaned" and then clear every is_orphaned flag for the org.
 * So everything here runs as a throwaway NOSUPERUSER NOBYPASSRLS role (see
 * config/__tests__/database.tenant-tag-reset.test.ts for the technique):
 * running as the `postgres` superuser would make RLS a no-op and hide both
 * bugs.
 *
 * AWS is never contacted: AWSClientFactory is mocked with non-SDK stand-ins
 * so each AWS-touching discovery phase fails fast inside its own try/catch
 * (same strategy as awsResourceDiscovery.first-insight-funnel.test.ts),
 * leaving the DB-only phases -- compliance scan over already-synced rows and
 * orphan detection -- to run for real.
 */
import { Pool, PoolClient } from 'pg';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { OrphanedResourceDetectorService } from '../orphanedResourceDetector';
import { AWSClientFactory } from '../aws-client-factory.service';
import costOptimizationService from '../cost-optimization.service';
import { securityAuditService } from '../securityAudit.service';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { AccountSecurityFindingsRepository } from '../../repositories/account-security-findings.repository';
import { installTenantTagReset, requestContext, pool as appPool } from '../../config/database';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const ROLE = `discovery_tenant_test_${suffix}`;
const admin = new Pool(dbConfig());
const rolePools: Pool[] = [];
const createdOrgIds: string[] = [];

function rolePool(max: number): Pool {
  const p = installTenantTagReset(new Pool({ ...dbConfig(), max, options: `-c role=${ROLE}` }));
  rolePools.push(p);
  return p;
}

async function insertOrg(label: string): Promise<string> {
  const s = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await admin.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Discovery Tenant ${s}`, `discovery-tenant-${s}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

/** An S3 bucket recorded as holding zero objects -- exactly what findEmptyS3Buckets flags. */
async function insertEmptyBucket(orgId: string): Promise<string> {
  const { rows } = await admin.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status,
        estimated_monthly_cost, is_orphaned, orphaned_monthly_savings, metadata)
     VALUES ($1, $2, $3, $3, 's3', 'us-east-1', 'active', 10, false, 0, '{"object_count": 0}')
     RETURNING id`,
    [orgId, `arn:aws:s3:::discovery-tenant-${orgId}`, `discovery-tenant-${orgId}`]
  );
  return rows[0].id as string;
}

async function orphanState(resourceId: string) {
  const { rows } = await admin.query(
    `SELECT is_orphaned, orphaned_monthly_savings::float AS savings FROM aws_resources WHERE id = $1`,
    [resourceId]
  );
  return rows[0] as { is_orphaned: boolean; savings: number };
}

async function latestJobError(orgId: string): Promise<string | null> {
  const { rows } = await admin.query(
    `SELECT error_message FROM resource_discovery_jobs WHERE organization_id = $1 ORDER BY started_at DESC LIMIT 1`,
    [orgId]
  );
  return rows[0]?.error_message ?? null;
}

function mockCollaborators(onCreateClients?: () => Promise<void> | void) {
  jest.spyOn(AWSClientFactory, 'createClients').mockImplementation(async () => {
    await onCreateClients?.();
    return {
      enabled: true,
      region: 'us-east-1',
      accountId: '000000000000',
      costExplorer: {}, ec2: {}, rds: {}, s3: {}, cloudWatch: {}, lambda: {}, ecs: {}, elb: {}, eks: {},
      dynamodb: {}, cloudFront: {}, apiGateway: {}, elastiCache: {}, sqs: {}, sns: {}, iam: {},
      resourceExplorer: {}, backup: {},
    } as any;
  });
  jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({ observations: [], riRecommendations: [] });
  jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations').mockResolvedValue({ insertedCount: 0 });
  jest.spyOn(CostRecommendationsRepository.prototype, 'deleteActiveByIssue').mockResolvedValue(0);
  jest.spyOn(CostRecommendationsRepository.prototype, 'createBulk').mockResolvedValue(0);
  jest.spyOn(AccountSecurityFindingsRepository.prototype, 'reconcileScan').mockResolvedValue({ active: 0, resolved: 0 } as any);
  jest.spyOn(securityAuditService, 'record').mockResolvedValue(undefined);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
}

beforeAll(async () => {
  await admin.query(`CREATE ROLE ${ROLE} NOSUPERUSER NOBYPASSRLS`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
  await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`);
});

afterAll(async () => {
  await Promise.all(rolePools.map((p) => p.end()));
  if (createdOrgIds.length > 0) {
    await admin.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await admin.query(`DROP OWNED BY ${ROLE}`);
  await admin.query(`DROP ROLE ${ROLE}`);
  await admin.end();
  await appPool.end();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('H1 -- OrphanedResourceDetectorService requires an org-tagged connection', () => {
  it('refuses an untagged connection instead of returning a silent zero-row result', async () => {
    const orgId = await insertOrg('h1-untagged');
    await insertEmptyBucket(orgId);
    const p = rolePool(1);

    await expect(new OrphanedResourceDetectorService(p).detectOrphaned(orgId)).rejects.toThrow(
      `TENANT_CONTEXT_MISSING: database connection is not tagged for organization ${orgId}`
    );
  });

  it('refuses a connection tagged for a different org, without echoing that org\'s id', async () => {
    const orgId = await insertOrg('h1-target');
    const otherOrgId = await insertOrg('h1-other');
    await insertEmptyBucket(orgId);
    const c = await rolePool(1).connect();
    try {
      await c.query("SELECT set_config('app.current_organization_id', $1, false)", [otherOrgId]);
      const error = await new OrphanedResourceDetectorService(c).detectOrphaned(orgId).catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/^TENANT_CONTEXT_MISSING/);
      expect((error as Error).message).not.toContain(otherOrgId);
    } finally {
      c.release();
    }
  });

  it('finds the org\'s orphaned resources under RLS on a correctly tagged connection', async () => {
    const orgId = await insertOrg('h1-tagged');
    const resourceId = await insertEmptyBucket(orgId);
    const c = await rolePool(1).connect();
    try {
      await c.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
      const orphaned = await new OrphanedResourceDetectorService(c).detectOrphaned(orgId);
      expect(orphaned.map((o) => o.resource.id)).toEqual([resourceId]);
      expect(orphaned[0].orphaned_type).toBe('empty_s3_bucket');
      expect(orphaned[0].potential_savings).toBe(0);
    } finally {
      c.release();
    }
  });

  it('does not report a bucket whose object count was never recorded, or a long-stopped EC2 instance', async () => {
    const orgId = await insertOrg('h1-unknown');
    await admin.query(
      `INSERT INTO aws_resources
         (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, estimated_monthly_cost)
       VALUES ($1, $2, 'unknown-count', 'unknown-count', 's3', 'us-east-1', 'active', 5),
              ($1, $3, 'i-stopped', 'i-stopped', 'ec2', 'us-east-1', 'stopped', 120)`,
      [orgId, `arn:aws:s3:::unknown-count-${orgId}`, `arn:aws:ec2:us-east-1:*:instance/i-stopped-${orgId}`]
    );
    // Even with no update for far longer than the former 30-day window.
    await admin.query(`UPDATE aws_resources SET updated_at = NOW() - INTERVAL '90 days' WHERE organization_id = $1`, [orgId]);
    const c = await rolePool(1).connect();
    try {
      await c.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
      expect(await new OrphanedResourceDetectorService(c).detectOrphaned(orgId)).toEqual([]);
    } finally {
      c.release();
    }
  });
});

describe('H1 -- scheduled (cron-style) discovery persists real orphan flags under RLS', () => {
  it('runs orphan detection on discovery\'s own org-tagged client, with no ambient request context', async () => {
    const orgId = await insertOrg('h1-cron');
    const resourceId = await insertEmptyBucket(orgId);
    mockCollaborators();
    expect(requestContext.getStore()).toBeUndefined();

    // Exactly how ResourceDiscoveryJob calls it: a pool, no request, no tag.
    await new AWSResourceDiscoveryService(rolePool(3)).discoverAllResources(orgId);

    expect(await orphanState(resourceId)).toEqual({ is_orphaned: true, savings: 0 });
    expect(await latestJobError(orgId)).not.toMatch(/Orphaned detection/);
  });
});

describe('H2 -- discovery started from inside a request never uses the request\'s client', () => {
  it('rebinds the ambient context to its own tagged client; the released request client is never queried', async () => {
    const orgId = await insertOrg('h2');
    const resourceId = await insertEmptyBucket(orgId);
    const p = rolePool(3);

    // Stand-in for runWithOrgClient: an org-tagged request client bound as
    // the ambient requestContext for the request's lifetime.
    const requestClient = await p.connect();
    await requestClient.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
    const requestClientQuery = jest.spyOn(requestClient, 'query');

    let ambientDuringDiscovery: PoolClient | undefined;
    let ambientTag: string | null = null;
    let discovery!: Promise<unknown>;
    let releaseRequest!: () => void;
    const requestReleased = new Promise<void>((resolve) => (releaseRequest = resolve));

    mockCollaborators(async () => {
      // AWSClientFactory is the first ambient pool.query() user inside
      // discovery; hold it until the "response" has been sent and the
      // request client released, as happens with a real 30-120s scan.
      await requestReleased;
      ambientDuringDiscovery = requestContext.getStore();
      const { rows } = await appPool.query(
        "SELECT current_setting('app.current_organization_id', true) AS tag"
      );
      ambientTag = rows[0].tag;
    });

    requestContext.run(requestClient, () => {
      // aws.routes.ts POST /accounts: fire-and-forget, then 201.
      discovery = new AWSResourceDiscoveryService(p).discoverAllResources(orgId);
    });
    requestClient.release(); // res 'finish'
    releaseRequest();
    await discovery;

    expect(ambientDuringDiscovery).toBeDefined();
    expect(ambientDuringDiscovery).not.toBe(requestClient);
    expect(ambientTag).toBe(orgId);
    // Nothing discovery did -- ambient pool.query() included -- touched the
    // request client. (The tenant-tag reset its own release() issues goes
    // through the unwrapped query captured at checkout, so it isn't counted.)
    expect(requestClientQuery).not.toHaveBeenCalled();
    expect(await orphanState(resourceId)).toEqual({ is_orphaned: true, savings: 0 });
  });
});
