/**
 * GET /api/services/intelligence: authentication, authorization, tenant
 * isolation, grouping, and the truthfulness of what it reports.
 *
 * Policy under test:
 *   - 401 without a token and for a revoked membership (MEMBERSHIP_REVOKED);
 *     every role with an active membership may read, viewers included. The
 *     decision is made on the caller's CURRENT membership, never the JWT
 *     role claim.
 *   - The organization is the authenticated caller's. Nothing the client
 *     sends selects a tenant.
 *   - Tenant isolation holds twice over, and each layer is proven alone:
 *       * explicit organization predicates -- the suite's role is not subject
 *         to RLS (see the precondition test), so every isolation assertion
 *         made through the route passes only because of the predicates;
 *       * the RLS policies -- the same statements, run as a role RLS applies
 *         to and asked for another organization's rows, return none.
 *   - Resource health is read from the Resource checks evaluator's cache
 *     (never evaluated here, never an AWS call); with no recent evaluation a
 *     checked resource is no_signal. Per resource it agrees with what the
 *     Dashboard's evaluator reported, apart from one documented difference.
 *   - Cost is reported as not evaluated; findings keep their
 *     stable key and verification marker; remediation is a read-only
 *     indication from ACTIVE cost recommendations.
 *
 * Real route over an in-process HTTP server against live Postgres. Only
 * authService.verifyToken is stubbed (to choose the caller). Every
 * identifier is synthetic.
 */
import { randomUUID } from 'crypto';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { EC2Client } from '@aws-sdk/client-ec2';
import { ECSClient } from '@aws-sdk/client-ecs';
import { EKSClient } from '@aws-sdk/client-eks';
import { RDSClient } from '@aws-sdk/client-rds';
import servicesIntelligenceRoutes from '../services-intelligence.routes';
import cloudwatchRoutes from '../cloudwatch.routes';
import { MEMBERSHIP_REVOKED_CODE } from '../../middleware/auth.middleware';
import { ISSUE_EC2_IDLE_INSTANCE, ISSUE_S3_LIFECYCLE_OPTIMIZATION } from '../../config/optimization-rules';
import { pool as appPool } from '../../config/database';
import { authService } from '../../services/auth.service';
import { AWSClientFactory } from '../../services/aws-client-factory.service';
import awsCostService from '../../services/aws-cost.service';
import { CloudWatchService, CloudWatchServiceHealth, cloudWatchService } from '../../services/cloudwatch.service';
import { ServicesIntelligenceRepository } from '../../repositories/services-intelligence.repository';
import { servicesIntelligenceResponseSchema, servicesIntelligenceSchema } from '../../services/__tests__/services-intelligence-contract';
import { ServicesIntelligence, Resource } from '../../types/services-intelligence.types';
import { createRoleGateHarness, Role, RoleGateOrg } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

const harness = createRoleGateHarness('services-intelligence');
const { pool } = harness;

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// The same AWS-side id in both organizations: a join that matched on the
// resource id alone would cross tenants.
const SHARED_INSTANCE_ID = `i-shared-${suffix}`;
const FAKE_ACCOUNT = '000000000000';

const COMPLETED_AT = new Date('2026-01-01T10:00:00.000Z');

interface Seeded {
  org: RoleGateOrg;
  label: string;
  teamId: string;
  serviceId: string;
  emptyServiceId: string;
  instanceId: string;
  bucketId: string;
  terminatedId: string;
  idleRecId: string;
  lifecycleRecId: string;
  resolvedRecId: string;
  completedJobId: string;
  latestJobId: string;
}

async function insertService(orgId: string, name: string, teamId: string | null): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO services (name, template, owner, status, organization_id, team_id)
     VALUES ($1, 'api', 'declared-owner@example.com', 'active', $2, $3) RETURNING id`,
    [name, orgId, teamId]
  );
  return rows[0].id as string;
}

async function insertResource(
  orgId: string,
  r: {
    arn: string;
    resourceId: string;
    name: string | null;
    type: string;
    region: string;
    status: string | null;
    issues?: unknown[];
    serviceId?: string | null;
  }
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status,
        compliance_issues, service_id, estimated_monthly_cost, last_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, 123.45, NOW()) RETURNING id`,
    [orgId, r.arn, r.resourceId, r.name, r.type, r.region, r.status, JSON.stringify(r.issues ?? []), r.serviceId ?? null]
  );
  return rows[0].id as string;
}

async function insertRecommendation(
  orgId: string,
  rec: { resourceId: string; resourceType: string; issue: string; status?: string }
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO cost_recommendations
       (organization_id, resource_id, resource_type, issue, potential_savings, severity, status)
     VALUES ($1, $2, $3, $4, 42.00, 'HIGH', $5) RETURNING id`,
    [orgId, rec.resourceId, rec.resourceType, rec.issue, rec.status ?? 'ACTIVE']
  );
  return rows[0].id as string;
}

async function insertJob(orgId: string, status: string, completedAt: Date | null, createdAt: Date): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, completed_at, created_at)
     VALUES ($1, $2, $4, $3, $4) RETURNING id`,
    [orgId, status, completedAt, createdAt]
  );
  return rows[0].id as string;
}

async function seed(label: string, region: string): Promise<Seeded> {
  const org = await harness.buildOrg();
  const { orgId } = org;

  const team = await pool.query(
    `INSERT INTO teams (name, owner, organization_id) VALUES ($1, 'owner@example.com', $2) RETURNING id`,
    [`si-team-${label}-${suffix}`, orgId]
  );
  const teamId = team.rows[0].id as string;
  const serviceId = await insertService(orgId, `si-service-${label}-${suffix}`, teamId);
  const emptyServiceId = await insertService(orgId, `si-empty-${label}-${suffix}`, null);

  const instanceId = await insertResource(orgId, {
    arn: `arn:aws:ec2:${region}:${FAKE_ACCOUNT}:instance/${SHARED_INSTANCE_ID}`,
    resourceId: SHARED_INSTANCE_ID,
    name: `si-instance-${label}`,
    type: 'ec2',
    region,
    status: 'running',
    serviceId,
    issues: [
      {
        severity: 'high',
        category: 'public_access',
        issue: `si-finding-${label}-instance`,
        recommendation: 'synthetic',
        findingKey: `si.${label}.instance.key`,
        provenance: 'OBSERVED',
      },
    ],
  });
  const bucketId = await insertResource(orgId, {
    arn: `arn:aws:s3:::si-bucket-${label}-${suffix}`,
    resourceId: `si-bucket-${label}-${suffix}`,
    name: null,
    type: 's3',
    region: 'test-region-9',
    status: 'active',
    issues: [
      {
        severity: 'critical',
        category: 'public_access',
        issue: `si-finding-${label}-carried`,
        recommendation: 'synthetic',
        findingKey: `si.${label}.bucket.carried`,
        provenance: 'OBSERVED',
        verification: 'unverified',
      },
      { severity: 'medium', category: 'encryption', issue: `si-finding-${label}-legacy`, recommendation: 'synthetic' },
    ],
  });
  const terminatedId = await insertResource(orgId, {
    arn: `arn:aws:ec2:${region}:${FAKE_ACCOUNT}:instance/i-gone-${label}-${suffix}`,
    resourceId: `i-gone-${label}-${suffix}`,
    name: `si-terminated-${label}`,
    type: 'ec2',
    region: 'test-region-terminated',
    status: 'terminated',
    serviceId,
  });

  const idleRecId = await insertRecommendation(orgId, {
    resourceId: SHARED_INSTANCE_ID,
    resourceType: 'EC2',
    issue: ISSUE_EC2_IDLE_INSTANCE,
  });
  const lifecycleRecId = await insertRecommendation(orgId, {
    resourceId: `si-bucket-${label}-${suffix}`,
    resourceType: 'S3',
    issue: ISSUE_S3_LIFECYCLE_OPTIMIZATION,
  });
  const resolvedRecId = await insertRecommendation(orgId, {
    resourceId: SHARED_INSTANCE_ID,
    resourceType: 'EC2',
    issue: 'Old-Generation Instance',
    status: 'RESOLVED',
  });

  await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, region) VALUES ($1, $2, $3, $4)`,
    [orgId, `arn:aws:iam::${FAKE_ACCOUNT}:role/si-${label}`, `si-${label}-${suffix}`.slice(0, 32), region]
  );
  const completedJobId = await insertJob(orgId, 'completed', COMPLETED_AT, new Date('2026-01-01T09:00:00.000Z'));
  const latestJobId = await insertJob(orgId, 'failed', new Date('2026-01-02T10:00:00.000Z'), new Date('2026-01-02T09:00:00.000Z'));

  return {
    org, label, teamId, serviceId, emptyServiceId, instanceId, bucketId, terminatedId,
    idleRecId, lifecycleRecId, resolvedRecId, completedJobId, latestJobId,
  };
}

/** Every value of `seeded` that must never appear in another organization's response. */
function identifiersOf(seeded: Seeded): string[] {
  return [
    seeded.org.orgId, seeded.teamId, seeded.serviceId, seeded.emptyServiceId, seeded.instanceId,
    seeded.bucketId, seeded.terminatedId, seeded.idleRecId, seeded.lifecycleRecId, seeded.resolvedRecId,
    seeded.completedJobId, seeded.latestJobId,
    `si-service-${seeded.label}-`, `si-empty-${seeded.label}-`, `si-team-${seeded.label}-`,
    `si-instance-${seeded.label}`, `si-bucket-${seeded.label}-`, `si-finding-${seeded.label}-`,
    `si.${seeded.label}.`,
  ];
}

async function read(orgId: string, userId: string, route = '/services/intelligence') {
  const res = await harness.sendAs(orgId, userId, 'GET', route);
  return { status: res.status, body: (await res.json()) as any };
}

async function intelligence(seeded: Seeded, role: Role = 'member'): Promise<ServicesIntelligence> {
  const { status, body } = await read(seeded.org.orgId, seeded.org[role]);
  expect(status).toBe(200);
  return body.data as ServicesIntelligence;
}

function allResources(data: ServicesIntelligence): Resource[] {
  return [...data.services.flatMap((s) => s.resources.items), ...data.unassigned.resources];
}

let a: Seeded;
let b: Seeded;
let empty: RoleGateOrg;
/** In organization A, pointing at a service of organization B. */
let crossReferencedId: string;

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  a = await seed('alpha', 'test-region-1');
  b = await seed('beta', 'test-region-2');
  empty = await harness.buildOrg();

  // The single-column foreign key accepts this; nothing may follow it.
  crossReferencedId = await insertResource(a.org.orgId, {
    arn: `arn:aws:sqs:test-region-1:${FAKE_ACCOUNT}:si-cross-${suffix}`,
    resourceId: `si-cross-${suffix}`,
    name: 'si-instance-alpha-cross',
    type: 'sqs',
    region: 'test-region-1',
    status: 'active',
    serviceId: b.serviceId,
  });

  // Likewise for a service's team: the single-column foreign key accepts a
  // team of another organization.
  await pool.query('UPDATE services SET team_id = $2 WHERE id = $1', [a.emptyServiceId, b.teamId]);

  await harness.listen((app) => {
    app.use('/api/services/intelligence', servicesIntelligenceRoutes);
    // The Dashboard's Resource checks endpoint: the one that fills the cache health is read from.
    app.use('/api/cloudwatch', cloudwatchRoutes);
  });
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  // No evaluation carries over from one test to the next.
  (cloudWatchService as any).metricsCache.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await harness.close(async (orgIds) => {
    await pool.query('DELETE FROM cost_recommendations WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM resource_discovery_jobs WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM services WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM teams WHERE organization_id = ANY($1)', [orgIds]);
  });
});

// ─── Authentication and authorization ───────────────────────────────────────

describe('authentication', () => {
  it('401 without a token', async () => {
    const res = await fetch(`${harness.url()}/services/intelligence`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'No authentication token provided' });
  });

  it('401 MEMBERSHIP_REVOKED for a caller whose membership is no longer active, and no data', async () => {
    const user = await harness.insertUser('revoked');
    await harness.addMembership(a.org.orgId, user.id, 'owner');
    expect((await read(a.org.orgId, user.id)).status).toBe(200);

    await pool.query(
      'UPDATE organization_memberships SET is_active = false WHERE organization_id = $1 AND user_id = $2',
      [a.org.orgId, user.id]
    );
    const { status, body } = await read(a.org.orgId, user.id);
    expect(status).toBe(401);
    expect(body).toEqual({
      success: false,
      error: 'Organization membership is not active',
      code: MEMBERSHIP_REVOKED_CODE,
    });
  });

  it('401 MEMBERSHIP_REVOKED for a member of another organization presenting this organization in the token', async () => {
    const { status, body } = await read(a.org.orgId, b.org.owner);
    expect(status).toBe(401);
    expect(body.code).toBe(MEMBERSHIP_REVOKED_CODE);
    expect(body.data).toBeUndefined();
  });
});

describe('authorization: any active membership, by current membership', () => {
  it.each(['viewer', 'member', 'admin', 'owner'] as const)('%s can read', async (role) => {
    const res = await harness.sendAs(a.org.orgId, a.org[role], 'GET', '/services/intelligence');
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.organization_id).toBe(a.org.orgId);
  });

  it('a viewer receives the same data as an owner, and only its own organization\'s', async () => {
    const asViewer = await intelligence(a, 'viewer');
    const asOwner = await intelligence(a, 'owner');
    expect({ ...asViewer, generated_at: null }).toEqual({ ...asOwner, generated_at: null });

    const serialized = JSON.stringify(asViewer);
    for (const identifier of identifiersOf(b)) {
      expect(serialized).not.toContain(identifier);
    }
    expect(allResources(asViewer).map((r) => r.id).sort()).toEqual([a.instanceId, a.bucketId, crossReferencedId].sort());
  });

  it('a viewer of another organization is refused: the role alone admits no one', async () => {
    const { status, body } = await read(a.org.orgId, b.org.viewer);
    expect(status).toBe(401);
    expect(body.code).toBe(MEMBERSHIP_REVOKED_CODE);
  });

  it('a viewer whose membership is revoked gets 401 MEMBERSHIP_REVOKED on the next request', async () => {
    const user = await harness.insertUser('revoked-viewer');
    await harness.addMembership(a.org.orgId, user.id, 'viewer');
    expect((await read(a.org.orgId, user.id)).status).toBe(200);

    await pool.query(
      'UPDATE organization_memberships SET is_active = false WHERE organization_id = $1 AND user_id = $2',
      [a.org.orgId, user.id]
    );
    const { status, body } = await read(a.org.orgId, user.id);
    expect(status).toBe(401);
    expect(body).toEqual({
      success: false,
      error: 'Organization membership is not active',
      code: MEMBERSHIP_REVOKED_CODE,
    });
  });

  it('a membership whose stored role is not a known role is refused', async () => {
    const user = await harness.insertUser('unknown-role');
    await harness.addMembership(a.org.orgId, user.id, 'viewer');
    await pool.query(
      `UPDATE organization_memberships SET role = 'auditor' WHERE organization_id = $1 AND user_id = $2`,
      [a.org.orgId, user.id]
    ).catch(() => { /* a role constraint may refuse the row; then there is nothing to test */ });
    const { rows } = await pool.query(
      'SELECT role FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
      [a.org.orgId, user.id]
    );
    if (rows[0].role !== 'auditor') return;

    const { status, body } = await read(a.org.orgId, user.id);
    expect(status).toBe(401);
    expect(body.data).toBeUndefined();
  });
});

// ─── Remediation execution flag ─────────────────────────────────────────────

describe('remediation_execution_enabled', () => {
  const original = process.env.ENABLE_AUTOMATED_REMEDIATION;
  afterEach(() => {
    if (original === undefined) delete process.env.ENABLE_AUTOMATED_REMEDIATION;
    else process.env.ENABLE_AUTOMATED_REMEDIATION = original;
  });

  it('is true only when ENABLE_AUTOMATED_REMEDIATION is exactly "true"', async () => {
    process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
    expect((await intelligence(a, 'viewer')).remediation_execution_enabled).toBe(true);
  });

  it.each([undefined, 'false', 'TRUE', 'True', ' true', 'true ', '1', 'yes', ''])('is false for %p', async (value) => {
    if (value === undefined) delete process.env.ENABLE_AUTOMATED_REMEDIATION;
    else process.env.ENABLE_AUTOMATED_REMEDIATION = value;
    expect((await intelligence(a, 'viewer')).remediation_execution_enabled).toBe(false);
  });

  it('changes nothing else: the same eligibility is reported either way', async () => {
    const findings = async () =>
      allResources(await intelligence(a)).flatMap((r) => r.findings).filter((f) => f.remediation !== null);

    process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
    const enabled = await findings();
    process.env.ENABLE_AUTOMATED_REMEDIATION = 'false';
    expect(await findings()).toEqual(enabled);
    expect(enabled).toHaveLength(1);
  });
});

// ─── Tenant isolation ───────────────────────────────────────────────────────

describe('precondition: RLS cannot be what makes the route-level isolation tests pass', () => {
  it('the connecting role is not subject to row-level security', async () => {
    const { rows } = await pool.query(
      'SELECT rolsuper OR rolbypassrls AS bypasses FROM pg_roles WHERE rolname = current_user'
    );
    expect(rows[0].bypasses).toBe(true);
  });
});

describe('tenant isolation by explicit organization predicates', () => {
  it.each([
    ['alpha', () => a, () => b],
    ['beta', () => b, () => a],
  ] as const)('%s receives its own resources and service groups and nothing of the other organization', async (_label, own, other) => {
    const data = await intelligence(own());
    const serialized = JSON.stringify(data);

    expect(data.organization_id).toBe(own().org.orgId);
    expect(data.services.map((s) => s.id).sort()).toEqual([own().serviceId, own().emptyServiceId].sort());
    for (const identifier of identifiersOf(other())) {
      expect(serialized).not.toContain(identifier);
    }
  });

  it('findings come only from the organization\'s own resources', async () => {
    const titles = (data: ServicesIntelligence) =>
      allResources(data).flatMap((r) => r.findings).filter((f) => f.source === 'resource_scan').map((f) => f.title).sort();

    expect(titles(await intelligence(a))).toEqual(
      ['si-finding-alpha-carried', 'si-finding-alpha-instance', 'si-finding-alpha-legacy']
    );
    expect(titles(await intelligence(b))).toEqual(
      ['si-finding-beta-carried', 'si-finding-beta-instance', 'si-finding-beta-legacy']
    );
  });

  it('a recommendation is joined only within its organization, even when both organizations have the same resource id', async () => {
    const recommendationIds = (data: ServicesIntelligence) =>
      allResources(data).flatMap((r) => r.findings).filter((f) => f.source === 'cost_recommendation').map((f) => f.source_id).sort();

    expect(recommendationIds(await intelligence(a))).toEqual([a.idleRecId, a.lifecycleRecId].sort());
    expect(recommendationIds(await intelligence(b))).toEqual([b.idleRecId, b.lifecycleRecId].sort());
  });

  it('a resource referencing another organization\'s service is unassigned at home and absent from the other organization', async () => {
    const home = await intelligence(a);
    const cross = home.unassigned.resources.find((r) => r.id === crossReferencedId);
    expect(cross).toMatchObject({ id: crossReferencedId, service_id: null });
    expect(home.services.flatMap((s) => s.resources.items).map((r) => r.id)).not.toContain(crossReferencedId);
    expect(JSON.stringify(home)).not.toContain(b.serviceId);

    const foreign = await intelligence(b);
    expect(JSON.stringify(foreign)).not.toContain(crossReferencedId);
    expect(foreign.services.find((s) => s.id === b.serviceId)!.resources).toMatchObject({ count: 1, by_type: { ec2: 1 } });
  });

  it('the joins themselves resolve a foreign service or team reference to NULL, with RLS not in play', async () => {
    // Straight from the statements, as the RLS-exempt role and with no tenant
    // tag: only the join predicates can be what hides organization B here.
    const rows = await new ServicesIntelligenceRepository().readWith(pool, a.org.orgId);

    expect(rows.resources.find((r) => r.id === crossReferencedId)!.service_id).toBeNull();
    expect(rows.resources.find((r) => r.id === a.instanceId)!.service_id).toBe(a.serviceId);
    expect(rows.services.find((s) => s.id === a.emptyServiceId)).toMatchObject({ team_id: null, team_name: null });
    expect(rows.services.find((s) => s.id === a.serviceId)).toMatchObject({ team_id: a.teamId });
  });

  it('nothing the client sends selects the tenant', async () => {
    const baseline = await intelligence(a);
    const other = b.org.orgId;
    const route =
      `/services/intelligence?organization_id=${other}&organizationId=${other}&org_id=${other}&orgId=${other}`;

    jest.spyOn(authService, 'verifyToken').mockReturnValue({
      userId: a.org.member,
      email: 'token-claim@example.com',
      organizationId: a.org.orgId,
      role: 'member',
      type: 'access',
    } as unknown as ReturnType<typeof authService.verifyToken>);
    const res = await fetch(`${harness.url()}${route}`, {
      headers: {
        Authorization: 'Bearer test-token',
        'X-Organization-Id': other,
        'X-Org-Id': other,
      },
    });
    expect(res.status).toBe(200);
    const data = ((await res.json()) as any).data as ServicesIntelligence;
    expect(data.organization_id).toBe(a.org.orgId);
    expect(allResources(data).map((r) => r.id).sort()).toEqual(allResources(baseline).map((r) => r.id).sort());
  });

  it('an organization with nothing gets empty groups, not another organization\'s data', async () => {
    const { status, body } = await read(empty.orgId, empty.member);
    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      organization_id: empty.orgId,
      discovery: null,
      totals: { resources: 0, services: 0, unassigned_resources: 0 },
      services: [],
      unassigned: { resources: [] },
    });
  });
});

describe('organization context and RLS', () => {
  it('the read runs in one read-only transaction on a connection tagged for the caller\'s organization', async () => {
    const statements: Array<{ text: string; values?: unknown[] }> = [];
    const patched: Array<{ client: any; query: unknown }> = [];
    const realConnect = appPool.connect.bind(appPool);
    let checkouts = 0;
    jest.spyOn(appPool, 'connect').mockImplementation((async () => {
      const client: any = await realConnect();
      const query = client.query;
      const index = checkouts++;
      patched.push({ client, query });
      client.query = (text: any, values?: any) => {
        // Checkout 0 is authenticate's connection; checkout 1 is the repository's.
        if (index === 1 && typeof text === 'string') statements.push({ text, values });
        return query.call(client, text, values);
      };
      return client;
    }) as any);

    try {
      expect((await read(a.org.orgId, a.org.member)).status).toBe(200);
    } finally {
      // Pooled clients are reused: put their query back.
      for (const { client, query } of patched) client.query = query;
    }
    expect(checkouts).toBe(2);

    const texts = statements.map((s) => s.text.replace(/\s+/g, ' ').trim());
    expect(texts[0]).toBe('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(texts[1]).toBe("SELECT set_config('app.current_organization_id', $1, true)");
    expect(statements[1].values).toEqual([a.org.orgId]);
    expect(texts[texts.length - 1]).toBe('COMMIT');

    // Every statement in between is a SELECT bound to the caller's organization.
    const reads = statements.slice(2, -1);
    expect(reads.length).toBeGreaterThan(0);
    for (const statement of reads) {
      expect(statement.text.trim()).toMatch(/^SELECT/);
      expect(statement.values).toEqual([a.org.orgId]);
    }
  });

  it('under a role RLS applies to, the same statements return only the tagged organization, whatever organization is asked for', async () => {
    const repository = new ServicesIntelligenceRepository();
    const role = `si_rls_probe_${randomUUID().replace(/-/g, '')}`;
    const client = await pool.connect();
    try {
      // Rolled back: the role never outlives this test. pg_read_all_data
      // grants SELECT and does not bypass RLS.
      await client.query('BEGIN');
      await client.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
      await client.query(`GRANT pg_read_all_data TO ${role}`);
      await client.query(`SET LOCAL ROLE ${role}`);
      const subject = await client.query(
        'SELECT rolsuper OR rolbypassrls AS bypasses FROM pg_roles WHERE rolname = current_user'
      );
      expect(subject.rows[0].bypasses).toBe(false);

      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [a.org.orgId]);

      const own = await repository.readWith(client, a.org.orgId);
      expect(own.resources.map((r) => r.id).sort()).toEqual([a.instanceId, a.bucketId, crossReferencedId].sort());
      expect(own.services.map((s) => s.id).sort()).toEqual([a.serviceId, a.emptyServiceId].sort());
      expect(own.recommendations.map((r) => r.id).sort()).toEqual([a.idleRecId, a.lifecycleRecId].sort());
      expect(own.lastDiscoveryJob?.id).toBe(a.latestJobId);
      // RLS hides organization B's service from the join as well.
      expect(own.resources.find((r) => r.id === crossReferencedId)!.service_id).toBeNull();

      // Tagged for A, asking for B: the policies return nothing of B.
      const foreign = await repository.readWith(client, b.org.orgId);
      expect(foreign.resources).toEqual([]);
      expect(foreign.services).toEqual([]);
      expect(foreign.recommendations).toEqual([]);
      expect(foreign.lastDiscoveryJob).toBeNull();
      expect(foreign.inventoryRefreshedAt).toBeNull();

      // With no tag at all, nothing is visible.
      await client.query("SELECT set_config('app.current_organization_id', '', true)");
      const untagged = await repository.readWith(client, a.org.orgId);
      expect(untagged.resources).toEqual([]);
      expect(untagged.services).toEqual([]);
      expect(untagged.recommendations).toEqual([]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

// ─── Grouping and data correctness ──────────────────────────────────────────

describe('grouping', () => {
  it('a resource with a same-organization service is under that service; one without is unassigned', async () => {
    const data = await intelligence(a);

    const service = data.services.find((s) => s.id === a.serviceId)!;
    expect(service.resources.items.map((r) => r.id)).toEqual([a.instanceId]);
    expect(service.resources).toMatchObject({ count: 1, by_type: { ec2: 1 } });
    expect(service.resources.items[0].service_id).toBe(a.serviceId);
    expect(service.team).toEqual({ id: a.teamId, name: `si-team-alpha-${suffix}` });
    expect(service.owner_declared).toBe('declared-owner@example.com');

    expect(data.unassigned.resources.map((r) => r.id).sort()).toEqual([a.bucketId, crossReferencedId].sort());
    expect(data.unassigned.resources.every((r) => r.service_id === null)).toBe(true);

    const emptyService = data.services.find((s) => s.id === a.emptyServiceId)!;
    expect(emptyService.resources).toEqual({ count: 0, by_type: {}, items: [] });
    expect(emptyService.team).toBeNull();
  });

  it('no resource appears twice, terminated resources are not inventory, and the totals agree with the groups', async () => {
    const data = await intelligence(a);
    const ids = allResources(data).map((r) => r.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual([a.instanceId, a.bucketId, crossReferencedId].sort());
    expect(ids).not.toContain(a.terminatedId);
    expect(data.totals).toEqual({ resources: 3, services: 2, unassigned_resources: 2 });
  });

  it('reports canonical identity from the columns', async () => {
    const data = await intelligence(a);
    const bucket = data.unassigned.resources.find((r) => r.id === a.bucketId)!;
    expect(bucket).toMatchObject({
      arn: `arn:aws:s3:::si-bucket-alpha-${suffix}`,
      resource_id: `si-bucket-alpha-${suffix}`,
      name: null,
      type: 's3',
      region: 'test-region-9',
      lifecycle_state: 'active',
    });
  });
});

describe('findings', () => {
  it('keep their stable key and their verification marker, including unverified', async () => {
    const data = await intelligence(a);
    const bucket = data.unassigned.resources.find((r) => r.id === a.bucketId)!;
    const scan = bucket.findings.filter((f) => f.source === 'resource_scan');

    expect(scan).toEqual([
      {
        source: 'resource_scan',
        source_id: null,
        finding_key: 'si.alpha.bucket.carried',
        verification: 'unverified',
        severity: 'critical',
        source_severity: 'critical',
        category: 'public_access',
        title: 'si-finding-alpha-carried',
        provenance: 'OBSERVED',
        remediation: null,
      },
      {
        source: 'resource_scan',
        source_id: null,
        finding_key: null,
        verification: null,
        severity: 'medium',
        source_severity: 'medium',
        category: 'encryption',
        title: 'si-finding-alpha-legacy',
        provenance: null,
        remediation: null,
      },
    ]);
  });

  it('a finding with no verification marker is not reported as verified', async () => {
    const data = await intelligence(a);
    const instance = data.services.find((s) => s.id === a.serviceId)!.resources.items[0];
    expect(instance.findings[0]).toMatchObject({ finding_key: 'si.alpha.instance.key', verification: null });
  });
});

describe('cost is not evaluated', () => {
  it('for every resource and every service, whatever the stored cost estimate', async () => {
    const data = await intelligence(a);

    for (const resource of allResources(data)) {
      expect(resource.cost).toEqual({ state: 'not_evaluated', amount: null, basis: null, display: null });
    }
    for (const service of data.services) {
      expect(service.cost).toEqual({ state: 'not_evaluated', amount: null, priced_resources: null, unpriced_resources: null });
    }
    for (const capability of Object.values(data.capabilities)) {
      expect(capability.pricing.state).toBe('not_evaluated');
    }
    // Neither the stored estimate nor a recommendation's savings is carried anywhere.
    const serialized = JSON.stringify(data);
    for (const leaked of ['123.45', '42.00', 'estimated_monthly_cost', 'potential_savings']) {
      expect(serialized).not.toContain(leaked);
    }
  });
});

// ─── Resource health ────────────────────────────────────────────────────────
// Health is read from the cache GET /api/cloudwatch/metrics fills (the
// Dashboard's Resource checks). These tests fill it the way the Dashboard
// does -- through that route -- and never let the intelligence read evaluate.

const FORBIDDEN_HEALTH_WORDS = /healthy|unhealthy|at[ _-]?risk|degraded/i;

/** Every string value under a `health` key, at any depth. */
function healthValues(node: unknown, inHealth = false, out: string[] = []): string[] {
  if (typeof node === 'string') { if (inHealth) out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => healthValues(n, inHealth, out)); return out; }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) healthValues(value, inHealth || key === 'health', out);
  }
  return out;
}

function evaluatorRow(resourceDbId: string, overrides: Partial<CloudWatchServiceHealth> = {}): CloudWatchServiceHealth {
  return {
    resourceId: SHARED_INSTANCE_ID,
    resourceDbId,
    resourceSortName: null,
    name: 'si-evaluated',
    description: 'synthetic',
    resourceType: 'ec2',
    status: 'healthy',
    uptime: 100,
    responseTimeMs: null,
    errorRate: null,
    critical: true,
    monitored: true,
    ...overrides,
  };
}

/** Fill `orgId`'s cache as the Dashboard does, with the evaluator's result replaced by `services`. */
async function dashboardLoadsResourceChecks(orgId: string, userId: string, services: CloudWatchServiceHealth[]): Promise<string> {
  const capturedAt = new Date().toISOString();
  const compute = jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockResolvedValueOnce({
    healthSummary: { total: 0, healthy: 0, degraded: 0, critical: 0, down: 0, monitored: 0 },
    services,
    capturedAt,
  });
  const res = await harness.sendAs(orgId, userId, 'GET', '/cloudwatch/metrics');
  expect(res.status).toBe(200);
  expect(compute).toHaveBeenCalledTimes(1);
  compute.mockRestore();
  return capturedAt;
}

function ageCachedEvaluation(orgId: string, minutes: number): void {
  const entry = (cloudWatchService as any).metricsCache.get(`${orgId}:1h`);
  entry.cachedAt = Date.now() - minutes * 60 * 1000;
}

function instanceOf(data: ServicesIntelligence, seeded: Seeded): Resource {
  return data.services.find((s) => s.id === seeded.serviceId)!.resources.items[0];
}

describe('resource health: cache miss', () => {
  it('reports no_signal with a reason for checked types, not_supported for the rest, and calls neither the evaluator nor AWS', async () => {
    const createClients = jest.spyOn(AWSClientFactory, 'createClients');
    const compute = jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics');

    const data = await intelligence(a);

    expect(createClients).not.toHaveBeenCalled();
    expect(compute).not.toHaveBeenCalled();
    expect(data.health).toEqual({ evaluated_at: null, source: null, range: '1h', cache: 'miss', max_age_seconds: 900 });
    expect(instanceOf(data, a).health).toEqual({
      state: 'no_signal',
      group: null,
      reasons: [{ kind: 'evaluation_unavailable' }],
      signal: null,
      checks: [],
      evaluated_at: null,
      source: null,
    });
    for (const resource of data.unassigned.resources) {
      expect(['s3', 'sqs']).toContain(resource.type);
      expect(resource.health).toEqual({
        state: 'not_supported', group: null, reasons: [], signal: null, checks: [], evaluated_at: null, source: null,
      });
    }
    expect(data.services.find((s) => s.id === a.serviceId)!.health).toEqual({
      state: 'not_evaluated',
      resource_counts: { checks_passing: 0, check_failing: 0, no_signal: 1, not_supported: 0 },
    });
  });

  it('reading intelligence does not fill the cache: the next read is still a miss', async () => {
    await intelligence(a);
    expect((await intelligence(a)).health.cache).toBe('miss');
    expect(cloudWatchService.peekCachedMetrics(a.org.orgId, 15 * 60 * 1000)).toBeNull();
  });
});

describe('resource health: read from the Resource checks cache', () => {
  it('after the Dashboard loads its checks, the same result is reported with its evaluation time and no further evaluation', async () => {
    const capturedAt = await dashboardLoadsResourceChecks(a.org.orgId, a.org.viewer, [evaluatorRow(a.instanceId)]);
    const createClients = jest.spyOn(AWSClientFactory, 'createClients');
    const compute = jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics');

    const data = await intelligence(a, 'viewer');

    expect(createClients).not.toHaveBeenCalled();
    expect(compute).not.toHaveBeenCalled();
    expect(data.health).toEqual({
      evaluated_at: capturedAt, source: 'resource_checks_cache', range: '1h', cache: 'hit', max_age_seconds: 900,
    });
    expect(instanceOf(data, a).health).toEqual({
      state: 'checks_passing',
      group: null,
      reasons: [],
      signal: null,
      checks: [{ name: 'ec2_status_check', result: 'passing', observed_at: capturedAt }],
      evaluated_at: capturedAt,
      source: 'resource_checks_cache',
    });
    expect(data.services.find((s) => s.id === a.serviceId)!.health.resource_counts).toEqual({
      checks_passing: 1, check_failing: 0, no_signal: 0, not_supported: 0,
    });
  });

  it('an evaluation with no row for the resource (its type block failed) is no_signal, evaluation_unavailable', async () => {
    const capturedAt = await dashboardLoadsResourceChecks(a.org.orgId, a.org.member, []);
    expect(instanceOf(await intelligence(a), a).health).toMatchObject({
      state: 'no_signal', reasons: [{ kind: 'evaluation_unavailable' }], checks: [], evaluated_at: capturedAt,
    });
  });

  it('an undetermined result is no_signal, never passing', async () => {
    await dashboardLoadsResourceChecks(a.org.orgId, a.org.member, [
      evaluatorRow(a.instanceId, { status: 'unknown', uptime: null, monitored: false }),
    ]);
    const health = instanceOf(await intelligence(a), a).health;
    expect(health.state).toBe('no_signal');
    expect(health.reasons).toEqual([{ kind: 'no_telemetry' }]);
    expect(health.checks.map((c) => c.result)).toEqual(['undetermined']);
  });

  it('serves an evaluation up to 15 minutes old; an older one is a miss, with no AWS call', async () => {
    const capturedAt = await dashboardLoadsResourceChecks(a.org.orgId, a.org.member, [evaluatorRow(a.instanceId)]);
    const createClients = jest.spyOn(AWSClientFactory, 'createClients');
    const compute = jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics');

    ageCachedEvaluation(a.org.orgId, 14);
    const recent = await intelligence(a);
    expect(recent.health).toMatchObject({ cache: 'hit', evaluated_at: capturedAt });
    expect(instanceOf(recent, a).health.state).toBe('checks_passing');

    ageCachedEvaluation(a.org.orgId, 16);
    const stale = await intelligence(a);
    expect(stale.health).toMatchObject({ cache: 'miss', evaluated_at: null, source: null });
    expect(instanceOf(stale, a).health).toMatchObject({
      state: 'no_signal', reasons: [{ kind: 'evaluation_unavailable' }], checks: [], evaluated_at: null,
    });
    expect(createClients).not.toHaveBeenCalled();
    expect(compute).not.toHaveBeenCalled();
  });

  it('the response still satisfies the strict contract on a hit', async () => {
    await dashboardLoadsResourceChecks(a.org.orgId, a.org.member, [evaluatorRow(a.instanceId, { status: 'critical' })]);
    const { body } = await read(a.org.orgId, a.org.member);
    const parsed = servicesIntelligenceResponseSchema.safeParse(body);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(instanceOf(body.data, a).health.state).toBe('check_failing');
  });
});

describe('resource health: tenant isolation', () => {
  it("each organization reads only its own evaluation, even when another's holds a row for its resource", async () => {
    await dashboardLoadsResourceChecks(a.org.orgId, a.org.member, [evaluatorRow(a.instanceId)]);
    // Organization B's evaluation: its own instance failing, plus a row that
    // claims organization A's resource id.
    await dashboardLoadsResourceChecks(b.org.orgId, b.org.member, [
      evaluatorRow(b.instanceId, { status: 'critical', name: 'si-evaluated-beta' }),
      evaluatorRow(a.instanceId, { status: 'critical', name: 'si-evaluated-beta-claims-alpha' }),
    ]);

    const alpha = await intelligence(a);
    const beta = await intelligence(b);

    expect(instanceOf(alpha, a).health.state).toBe('checks_passing');
    expect(instanceOf(beta, b).health.state).toBe('check_failing');
    expect(alpha.services.find((s) => s.id === a.serviceId)!.health.resource_counts.check_failing).toBe(0);
    for (const identifier of identifiersOf(b)) expect(JSON.stringify(alpha)).not.toContain(identifier);
    for (const identifier of identifiersOf(a)) expect(JSON.stringify(beta)).not.toContain(identifier);
  });

  it("with only another organization's evaluation cached, an organization gets a miss", async () => {
    await dashboardLoadsResourceChecks(b.org.orgId, b.org.member, [
      evaluatorRow(b.instanceId),
      evaluatorRow(a.instanceId),
    ]);

    const alpha = await intelligence(a);

    expect(alpha.health).toMatchObject({ cache: 'miss', evaluated_at: null });
    expect(instanceOf(alpha, a).health).toMatchObject({ state: 'no_signal', reasons: [{ kind: 'evaluation_unavailable' }] });
    expect((await intelligence(b)).health.cache).toBe('hit');
  });

  it('a caller-supplied organization does not select whose evaluation is read', async () => {
    await dashboardLoadsResourceChecks(b.org.orgId, b.org.member, [evaluatorRow(b.instanceId, { status: 'critical' })]);
    const other = b.org.orgId;
    const { status, body } = await read(a.org.orgId, a.org.member, `/services/intelligence?organization_id=${other}&organizationId=${other}`);
    expect(status).toBe(200);
    expect(body.data.health.cache).toBe('miss');
  });
});

// ─── Agreement with the Dashboard's Resource checks ─────────────────────────
// A REAL evaluator sweep (CloudWatchService.computeMetrics, unmocked) over a
// synthetic fleet, with only the AWS clients faked. GET /api/cloudwatch/metrics
// returns what the Dashboard shows; the intelligence endpoint must report the
// same result for every resource, except for the one documented difference.

describe('resource health: agreement with the Dashboard evaluator', () => {
  type Fleet = Record<string, { id: string; awsId: string }>;
  let org: RoleGateOrg;
  let fleet: Fleet;
  let sends: jest.Mock[];

  // name -> [type, lifecycle state, metadata]
  const FLEET_SPEC: Record<string, [string, string, Record<string, unknown> | null]> = {
    volOk: ['ebs', 'available', null],
    volImpaired: ['ebs', 'in-use', null],
    volWarning: ['ebs', 'available', null],
    volInsufficient: ['ebs', 'available', null],
    volError: ['ebs', 'error', null],
    volDeleting: ['ebs', 'deleting', null],
    volCreating: ['ebs', 'creating', null],
    ec2StatusChecks: ['ec2', 'running', null],
    ec2CpuLow: ['ec2', 'running', null],
    ec2CpuHigh: ['ec2', 'running', null],
    ec2Stopped: ['ec2', 'stopped', null],
    ec2Silent: ['ec2', 'running', null],
    alb: ['load-balancer', 'active', { type: 'application' }],
    nlb: ['load-balancer', 'active', { type: 'network' }],
    database: ['rds', 'available', null],
    bucket: ['s3', 'active', null],
    fnFailed: ['lambda', 'Failed', null],
    fnInactive: ['lambda', 'Inactive', null],
  };

  beforeAll(async () => {
    org = await harness.buildOrg();
    await pool.query(
      `INSERT INTO aws_accounts (org_id, role_arn, account_id, region, status, external_id, connected_at)
       VALUES ($1, $2, $3, 'test-region-1', 'active', 'si-external-id', NOW())`,
      [org.orgId, `arn:aws:iam::${FAKE_ACCOUNT}:role/si-health`, `si-health-${suffix}`.slice(0, 32)]
    );
    fleet = {};
    for (const [name, [type, status, metadata]] of Object.entries(FLEET_SPEC)) {
      const awsId = `si-${name.toLowerCase()}-${suffix}`;
      const arn = type === 'load-balancer'
        ? `arn:aws:elasticloadbalancing:test-region-1:${FAKE_ACCOUNT}:loadbalancer/app/${awsId}/0000000000000000`
        : `arn:aws:${type}:test-region-1:${FAKE_ACCOUNT}:synthetic/${awsId}`;
      const { rows } = await pool.query(
        `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, metadata)
         VALUES ($1, $2, $3, $3, $4, 'test-region-1', $5, $6) RETURNING id`,
        [org.orgId, arn, awsId, type, status, metadata ? JSON.stringify(metadata) : null]
      );
      fleet[name] = { id: rows[0].id as string, awsId };
    }
  });

  /** CloudWatch datapoints by `${dimension value}|${metric}`; anything absent has no datapoints. */
  function fakeAwsClients() {
    const datapoints: Record<string, number> = {
      [`${fleet.ec2StatusChecks.awsId}|StatusCheckFailed`]: 0,
      [`${fleet.ec2StatusChecks.awsId}|CPUUtilization`]: 12,
      [`${fleet.ec2CpuLow.awsId}|CPUUtilization`]: 10,
      [`${fleet.ec2CpuHigh.awsId}|CPUUtilization`]: 95,
      [`app/${fleet.alb.awsId}/0000000000000000|TargetResponseTime`]: 0.2,
      [`app/${fleet.alb.awsId}/0000000000000000|RequestCount`]: 100,
    };
    const cloudWatchSend = jest.fn(async (command: any) => ({
      MetricDataResults: (command?.input?.MetricDataQueries ?? []).map((q: any) => {
        const key = `${q.MetricStat.Metric.Dimensions[0].Value}|${q.MetricStat.Metric.MetricName}`;
        return key in datapoints
          ? { Id: q.Id, StatusCode: 'Complete', Timestamps: [new Date()], Values: [datapoints[key]] }
          : { Id: q.Id, StatusCode: 'Complete', Timestamps: [], Values: [] };
      }),
    }));
    const volumeStatus: Record<string, string> = {
      [fleet.volOk.awsId]: 'ok',
      [fleet.volImpaired.awsId]: 'impaired',
      [fleet.volWarning.awsId]: 'warning',
      [fleet.volInsufficient.awsId]: 'insufficient-data',
      [fleet.volError.awsId]: 'ok',
    };
    const ec2Send = jest.fn(async () => ({
      VolumeStatuses: Object.entries(volumeStatus).map(([VolumeId, Status]) => ({ VolumeId, VolumeStatus: { Status }, Events: [] })),
    }));
    const otherSend = jest.fn(async () => ({}));
    // Real SDK client objects (the EC2 paginator requires one) whose `send` never reaches AWS.
    const faked = <T extends { send: unknown }>(client: T, send: jest.Mock): T => {
      (client as any).send = send;
      return client;
    };
    const sdk = { region: 'us-east-1' };
    const cloudWatch = faked(new CloudWatchClient(sdk), cloudWatchSend);
    const createClients = jest.spyOn(AWSClientFactory, 'createClients').mockImplementation(async () => ({
      enabled: true,
      region: 'test-region-1',
      cloudWatch,
      ec2: faked(new EC2Client(sdk), ec2Send),
      ecs: faked(new ECSClient(sdk), otherSend),
      eks: faked(new EKSClient(sdk), otherSend),
      rds: faked(new RDSClient(sdk), otherSend),
      getCloudWatchClientForRegion: () => cloudWatch,
    } as any));
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({ total: 0, byService: [], period: { start: '', end: '' } } as any);
    sends = [cloudWatchSend, ec2Send, otherSend];
    return { createClients };
  }

  async function dashboard() {
    const res = await harness.sendAs(org.orgId, org.viewer, 'GET', '/cloudwatch/metrics?pageSize=200');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.pagination.hasMore).toBe(false);
    return body.data as { services: CloudWatchServiceHealth[]; healthSummary: Record<string, number>; capturedAt: string };
  }

  async function healthById(): Promise<{ data: ServicesIntelligence; byId: Map<string, Resource['health']> }> {
    const { status, body } = await read(org.orgId, org.viewer);
    expect(status).toBe(200);
    const data = body.data as ServicesIntelligence;
    return { data, byId: new Map(allResources(data).map((r) => [r.id, r.health])) };
  }

  const nameOf = (id: string) => Object.entries(fleet).find(([, r]) => r.id === id)![0];

  it('reports, for every resource, exactly what the evaluator reported -- apart from the documented difference', async () => {
    const { createClients } = fakeAwsClients();
    const shown = await dashboard();
    const awsCalls = sends.map((s) => s.mock.calls.length);
    expect(awsCalls[0]).toBeGreaterThan(0);
    expect(awsCalls[1]).toBeGreaterThan(0);
    expect(createClients).toHaveBeenCalledTimes(1);

    const { data, byId } = await healthById();

    // The intelligence read used the cached evaluation: not one more AWS call.
    expect(sends.map((s) => s.mock.calls.length)).toEqual(awsCalls);
    expect(createClients).toHaveBeenCalledTimes(1);
    expect(data.health).toEqual({
      evaluated_at: shown.capturedAt, source: 'resource_checks_cache', range: '1h', cache: 'hit', max_age_seconds: 900,
    });

    // What the evaluator said, per resource (the Dashboard's per-row result).
    const evaluator = Object.fromEntries(shown.services.map((s) => [nameOf(s.resourceDbId), `${s.status}${s.monitored ? '' : ' (no telemetry)'}`]));
    expect(evaluator).toEqual({
      volOk: 'healthy',
      volImpaired: 'critical',
      volWarning: 'degraded',
      volInsufficient: 'unknown',
      volError: 'down',
      volDeleting: 'down',
      volCreating: 'unknown (no telemetry)',
      ec2StatusChecks: 'healthy',
      ec2CpuLow: 'healthy',
      ec2CpuHigh: 'degraded',
      ec2Stopped: 'down (no telemetry)',
      ec2Silent: 'unknown (no telemetry)',
      alb: 'healthy',
      database: 'healthy (no telemetry)',
      fnFailed: 'down (no telemetry)',
      fnInactive: 'down (no telemetry)',
    });

    // What the intelligence endpoint says for the same resources.
    const reported = Object.fromEntries(
      Object.entries(fleet).map(([name, r]) => {
        const health = byId.get(r.id)!;
        return [name, [health.state, ...health.reasons.map((x) => x.kind), ...health.checks.map((c) => `${c.name}=${c.result}`)].join(' ')];
      })
    );
    expect(reported).toEqual({
      volOk: 'checks_passing ebs_volume_status_check=passing',
      volImpaired: 'check_failing ebs_volume_status_check=failing',
      volWarning: 'check_failing ebs_volume_status_check=failing',
      volInsufficient: 'no_signal undetermined ebs_volume_status_check=undetermined',
      volError: 'check_failing ebs_volume_status_check=failing',
      volDeleting: 'no_signal not_running ebs_volume_status_check=undetermined',
      volCreating: 'no_signal no_telemetry ebs_volume_status_check=undetermined',
      ec2StatusChecks: 'checks_passing ec2_status_check=passing',
      ec2CpuLow: 'checks_passing ec2_cpu_threshold=passing',
      ec2CpuHigh: 'check_failing ec2_cpu_threshold=failing',
      ec2Stopped: 'no_signal not_running ec2_status_check=undetermined',
      ec2Silent: 'no_signal no_telemetry ec2_status_check=undetermined',
      alb: 'checks_passing alb_response_time_threshold=passing',
      nlb: 'not_supported',
      database: 'not_supported',
      bucket: 'not_supported',
      fnFailed: 'check_failing lambda_error_rate_threshold=failing',
      fnInactive: 'no_signal not_running lambda_error_rate_threshold=undetermined',
    });

    // Row by row: the Dashboard's rule for a row (as components/monitoring/
    // ServiceHealthTable.tsx's checkResultLabel and lib/resource-checks.ts's
    // checkCountsFrom apply it) against the state reported here.
    const differences: string[] = [];
    for (const row of shown.services) {
      const name = nameOf(row.resourceDbId);
      const state = byId.get(row.resourceDbId)!.state;
      if (state === 'not_supported') { expect(row.monitored).toBe(false); continue; }
      const dashboardSays = !row.monitored ? 'not counted'
        : row.status === 'healthy' ? 'no issues'
        : row.status === 'unknown' ? 'undetermined'
        : 'with issues';
      const agrees =
        (dashboardSays === 'no issues' && state === 'checks_passing') ||
        (dashboardSays === 'with issues' && state === 'check_failing') ||
        ((dashboardSays === 'undetermined' || dashboardSays === 'not counted') && state === 'no_signal');
      if (!agrees) differences.push(`${name}: dashboard ${dashboardSays}, here ${state}`);
    }
    // The documented difference, and nothing else: 'down' is decided by the
    // recorded lifecycle state, not counted as an issue wholesale.
    expect(differences.sort()).toEqual([
      'fnFailed: dashboard not counted, here check_failing',
      'volDeleting: dashboard with issues, here no_signal',
    ]);
    for (const row of shown.services.filter((s) => s.status !== 'down')) {
      expect(differences.some((d) => d.startsWith(`${nameOf(row.resourceDbId)}:`))).toBe(false);
    }

    // The counts the Dashboard shows (healthSummary, as checkCountsFrom reads it).
    const summary = shown.healthSummary;
    expect(summary).toEqual({ total: 16, monitored: 10, healthy: 4, degraded: 2, critical: 1, down: 2 });
    const states = [...byId.values()].map((h) => h.state);
    const count = (state: string) => states.filter((s) => s === state).length;
    expect({ passing: count('checks_passing'), failing: count('check_failing'), noSignal: count('no_signal'), notSupported: count('not_supported') })
      .toEqual({ passing: 4, failing: 5, noSignal: 6, notSupported: 3 });
    // Passing agrees exactly.
    expect(count('checks_passing')).toBe(summary.healthy);
    // Failing = the Dashboard's degraded + critical, plus the 'down' rows whose lifecycle state is a failure.
    expect(count('check_failing')).toBe(summary.degraded + summary.critical + ['volError', 'fnFailed'].length);
    // The Dashboard's "undetermined" (reporting, no result) is a subset of no_signal.
    const undetermined = summary.monitored - summary.healthy - (summary.degraded + summary.critical + summary.down);
    expect(undetermined).toBe(1);
    expect([...byId.values()].filter((h) => h.reasons.some((r) => r.kind === 'undetermined'))).toHaveLength(undetermined);

    for (const value of healthValues(data)) expect(value).not.toMatch(FORBIDDEN_HEALTH_WORDS);
    const parsed = servicesIntelligenceSchema.safeParse(data);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it('a failed type block leaves its resources no_signal (evaluation_unavailable), never passing', async () => {
    fakeAwsClients();
    // The EBS block throws outright; every other block still evaluates.
    jest.spyOn(CloudWatchService.prototype as any, 'evaluateEbsVolumes').mockRejectedValue(new Error('synthetic failure'));
    const shown = await dashboard();
    expect(shown.services.some((s) => s.resourceType === 'ebs')).toBe(false);

    const { byId } = await healthById();

    for (const name of ['volOk', 'volImpaired', 'volWarning', 'volInsufficient', 'volError', 'volDeleting', 'volCreating']) {
      expect(byId.get(fleet[name].id)).toMatchObject({
        state: 'no_signal', reasons: [{ kind: 'evaluation_unavailable' }], checks: [], evaluated_at: shown.capturedAt,
      });
    }
    expect(byId.get(fleet.ec2StatusChecks.id)!.state).toBe('checks_passing');
  });

  it('with AWS unreachable for every check, nothing is passing and nothing is failing', async () => {
    fakeAwsClients();
    for (const send of sends) send.mockRejectedValue(new Error('synthetic: not authorized'));
    await dashboard();

    const { byId } = await healthById();

    const states = new Set(
      Object.entries(fleet)
        .filter(([name]) => !['volError', 'fnFailed'].includes(name)) // failures recorded in inventory, not by AWS
        .map(([, r]) => byId.get(r.id)!.state)
    );
    expect([...states].sort()).toEqual(['no_signal', 'not_supported']);
  });
});

describe('remediation eligibility', () => {
  it('comes only from ACTIVE recommendations, and only where an existing action applies', async () => {
    const data = await intelligence(a);
    const instance = data.services.find((s) => s.id === a.serviceId)!.resources.items[0];
    const bucket = data.unassigned.resources.find((r) => r.id === a.bucketId)!;

    expect(instance.findings.filter((f) => f.source === 'cost_recommendation')).toEqual([
      {
        source: 'cost_recommendation',
        source_id: a.idleRecId,
        finding_key: null,
        verification: null,
        severity: 'high',
        source_severity: 'HIGH',
        category: 'cost',
        title: ISSUE_EC2_IDLE_INSTANCE,
        provenance: null,
        remediation: {
          available: true,
          path: 'cost_recommendation_execute',
          action_type: 'stop_instance',
          recommendation_id: a.idleRecId,
          requires: { role: 'admin', plan: 'enterprise' },
        },
      },
    ]);
    expect(bucket.findings.filter((f) => f.source === 'cost_recommendation')).toMatchObject([
      { source_id: a.lifecycleRecId, remediation: null },
    ]);
    expect(JSON.stringify(data)).not.toContain(a.resolvedRecId);

    // Scan findings never carry a remediation.
    expect(allResources(data).flatMap((r) => r.findings).filter((f) => f.source === 'resource_scan').every((f) => f.remediation === null)).toBe(true);
  });

  it('reading changes nothing', async () => {
    const snapshot = async () => ({
      recommendations: (await pool.query(
        'SELECT id, status, updated_at, resolved_at FROM cost_recommendations WHERE organization_id = $1 ORDER BY id',
        [a.org.orgId]
      )).rows,
      resources: (await pool.query(
        'SELECT id, status, service_id, updated_at FROM aws_resources WHERE organization_id = $1 ORDER BY id',
        [a.org.orgId]
      )).rows,
      jobs: (await pool.query(
        'SELECT count(*)::int AS n FROM resource_discovery_jobs WHERE organization_id = $1',
        [a.org.orgId]
      )).rows,
      audit: (await pool.query(
        'SELECT count(*)::int AS n FROM audit_logs WHERE organization_id = $1',
        [a.org.orgId]
      )).rows,
    });

    const before = await snapshot();
    await intelligence(a, 'owner');
    await intelligence(a, 'admin');
    expect(await snapshot()).toEqual(before);
  });
});

describe('discovery provenance and freshness', () => {
  it('reports the latest attempt and, separately, the latest clean completion', async () => {
    const data = await intelligence(a);
    expect(data.discovery).toEqual({
      primary_region: 'test-region-1',
      scope: 'single_region_plus_global',
      // The terminated row's region is not inventory.
      regions_present: ['test-region-1', 'test-region-9'],
      last_attempt: {
        job_id: a.latestJobId,
        started_at: '2026-01-02T09:00:00.000Z',
        completed_at: '2026-01-02T10:00:00.000Z',
        status: 'failed',
      },
      inventory_refreshed_at: COMPLETED_AT.toISOString(),
    });
  });

  it('makes no freshness claim when no job completed cleanly', async () => {
    const org = await harness.buildOrg();
    await insertJob(org.orgId, 'failed', new Date('2026-01-03T10:00:00.000Z'), new Date('2026-01-03T09:00:00.000Z'));

    const { body } = await read(org.orgId, org.member);
    expect(body.data.discovery).toMatchObject({
      primary_region: null,
      last_attempt: { status: 'failed' },
      inventory_refreshed_at: null,
    });
  });
});

// ─── Contract ───────────────────────────────────────────────────────────────

describe('response contract', () => {
  it.each([
    ['a populated organization', () => [a.org.orgId, a.org.member]],
    ['an empty organization', () => [empty.orgId, empty.member]],
  ] as const)('the response for %s satisfies the strict schema', async (_label, caller) => {
    const [orgId, userId] = caller();
    const { status, body } = await read(orgId, userId);
    expect(status).toBe(200);

    const parsed = servicesIntelligenceResponseSchema.safeParse(body);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it('has exactly these top-level keys', async () => {
    expect(Object.keys(await intelligence(a)).sort()).toEqual([
      'capabilities', 'contract_version', 'discovery', 'generated_at', 'health',
      'organization_id', 'remediation_execution_enabled', 'services', 'totals', 'unassigned',
    ]);
  });
});
