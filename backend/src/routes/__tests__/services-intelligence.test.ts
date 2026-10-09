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
 *   - Health and cost are reported as not evaluated; findings keep their
 *     stable key and verification marker; remediation is a read-only
 *     indication from ACTIVE cost recommendations.
 *
 * Real route over an in-process HTTP server against live Postgres. Only
 * authService.verifyToken is stubbed (to choose the caller). Every
 * identifier is synthetic.
 */
import { randomUUID } from 'crypto';
import servicesIntelligenceRoutes from '../services-intelligence.routes';
import { MEMBERSHIP_REVOKED_CODE } from '../../middleware/auth.middleware';
import { ISSUE_EC2_IDLE_INSTANCE, ISSUE_S3_LIFECYCLE_OPTIMIZATION } from '../../config/optimization-rules';
import { pool as appPool } from '../../config/database';
import { authService } from '../../services/auth.service';
import { ServicesIntelligenceRepository } from '../../repositories/services-intelligence.repository';
import { servicesIntelligenceResponseSchema } from '../../services/__tests__/services-intelligence-contract';
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

  await harness.listen((app) => app.use('/api/services/intelligence', servicesIntelligenceRoutes));
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
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

describe('health and cost are not evaluated', () => {
  it('for every resource and every service, whatever the lifecycle state or stored cost estimate', async () => {
    const data = await intelligence(a);

    for (const resource of allResources(data)) {
      expect(resource.health).toEqual({ state: 'not_evaluated', group: null, reasons: [], signal: null });
      expect(resource.cost).toEqual({ state: 'not_evaluated', amount: null, basis: null, display: null });
    }
    for (const service of data.services) {
      expect(service.health).toEqual({ state: 'not_evaluated', resource_counts: null });
      expect(service.cost).toEqual({ state: 'not_evaluated', amount: null, priced_resources: null, unpriced_resources: null });
    }
    for (const capability of Object.values(data.capabilities)) {
      expect(capability.health.state).toBe('not_evaluated');
      expect(capability.pricing.state).toBe('not_evaluated');
    }
    // Neither the stored estimate nor a recommendation's savings is carried anywhere.
    const serialized = JSON.stringify(data);
    for (const leaked of ['123.45', '42.00', 'estimated_monthly_cost', 'potential_savings']) {
      expect(serialized).not.toContain(leaked);
    }
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
      'capabilities', 'contract_version', 'discovery', 'generated_at',
      'organization_id', 'remediation_execution_enabled', 'services', 'totals', 'unassigned',
    ]);
  });
});
