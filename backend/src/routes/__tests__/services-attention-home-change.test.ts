/**
 * Multi-region PR 3c (moved from PR 3a, G1): after a home-region change, the old home
 * region's cost-only attention leaves BOTH /stats numbers, needs_attention and
 * attention_scope, and the ?needs_attention=true list. HR-1's change transaction
 * deletes the old home's ACTIVE home-scoped cost findings (home-region.service.ts
 * step 4), so nothing on the page filters by region to get there (locked contract 8).
 *
 *   - a running EC2 instance in us-east-1 (the home region) whose only finding is an
 *     ACTIVE HIGH idle-instance cost finding: needs attention, in us-east-1;
 *   - an RDS instance in eu-west-1 with a HIGH compliance finding: needs attention,
 *     unaffected by the change;
 *   - after PUT /api/aws/accounts/home-region { us-west-2 }: needs_attention 2 → 1,
 *     attention_scope.regions 2 → 1, the list holds the eu-west-1 row only;
 *   - a refused change (a member) leaves all three as they were.
 *
 * Real routes over live Postgres; only authService.verifyToken and the background scan
 * are stubbed. Placeholders only.
 */
import awsRoutes from '../aws.routes';
import servicesRoutes from '../services.routes';
import { AWSResourceDiscoveryService } from '../../services/awsResourceDiscovery';
import { ISSUE_EC2_IDLE_INSTANCE } from '../../config/optimization-rules';
import { createRoleGateHarness } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';
import { HOME_REGION_FIXTURE_TABLES, homeRegionRouteFixtures, type Org } from './home-region-route-fixtures';

const harness = createRoleGateHarness('services-attention-home-change');
const { pool } = harness;
const { connectedOrg, put } = homeRegionRouteFixtures(harness);

const HIGH_FINDING = { severity: 'high', category: 'public_access', issue: 'RDS instance is publicly accessible', recommendation: 'r', provenance: 'OBSERVED' };

let seq = 0;
async function resource(org: Org, type: string, region: string, status: string, issues: unknown[] = []): Promise<string> {
  seq += 1;
  const id = `att-${seq}-${org.orgId.slice(0, 8)}`;
  await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, tags, metadata, compliance_issues)
     VALUES ($1, $2, $3, $3, $4, $5, $6, '{}', '{}', $7::jsonb)`,
    [org.orgId, `arn:aws:${type}:${region}:${org.accountId}:thing/${id}`, id, type, region, status, JSON.stringify(issues)]
  );
  return id;
}

async function costFinding(org: Org, resourceId: string, region: string) {
  await pool.query(
    `INSERT INTO cost_recommendations (organization_id, resource_id, resource_name, resource_type, issue, description, potential_savings, severity, aws_region, metadata, status)
     VALUES ($1, $2, $2, 'EC2', $3, 'placeholder', 60, 'HIGH', $4, '{}', 'ACTIVE')`,
    [org.orgId, resourceId, ISSUE_EC2_IDLE_INSTANCE, region]
  );
}

async function seeded(): Promise<Org> {
  const org = await connectedOrg();
  const idle = await resource(org, 'ec2', 'us-east-1', 'running');
  await costFinding(org, idle, 'us-east-1');
  await resource(org, 'rds', 'eu-west-1', 'available', [HIGH_FINDING]);
  await resource(org, 'ec2', 'us-west-2', 'running'); // healthy, in the new home region
  return org;
}

async function attention(org: Org) {
  const { stats } = await (await harness.sendAs(org.orgId, org.viewer, 'GET', '/services/stats')).json();
  const list = await (await harness.sendAs(org.orgId, org.viewer, 'GET', '/services?needs_attention=true&page=1&limit=50')).json();
  return {
    needs_attention: stats.needs_attention as number,
    attention_scope: stats.attention_scope as { regions: number; global: number },
    listRegions: (list.services as Array<{ aws_region: string }>).map((s) => s.aws_region).sort(),
  };
}

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await harness.listen((app) => {
    app.use('/api/services', servicesRoutes);
    app.use('/api/aws', awsRoutes);
  });
});

beforeEach(() => {
  jest.spyOn(AWSResourceDiscoveryService.prototype, 'discoverAllResources').mockResolvedValue({
    job_id: 'stub-job', resources_discovered: 0, resources_updated: 0, resources_deleted: 0, errors: [], warnings: [],
  } as any);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await harness.close(async (orgIds) => {
    for (const table of [...HOME_REGION_FIXTURE_TABLES, 'resource_discovery_jobs']) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [orgIds]);
    }
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
  });
});

describe("after a home-region change the old home's cost-only attention leaves needs_attention AND attention_scope", () => {
  it('before: 2 resources in 2 regions; after the change to us-west-2: 1 in 1 region (eu-west-1 only)', async () => {
    const org = await seeded();
    expect(await attention(org)).toEqual({ needs_attention: 2, attention_scope: { regions: 2, global: 0 }, listRegions: ['eu-west-1', 'us-east-1'] });
    const res = await put(org, { region: 'us-west-2' });
    expect(res.status).toBe(200);
    expect((await res.json()).data.cost_findings_removed).toEqual({ total: 1, by_issue: { [ISSUE_EC2_IDLE_INSTANCE]: 1 } });
    expect(await attention(org)).toEqual({ needs_attention: 1, attention_scope: { regions: 1, global: 0 }, listRegions: ['eu-west-1'] });
  });

  it('a refused change (a member, UI bypassed) leaves both numbers and the list as they were', async () => {
    const org = await seeded();
    const before = await attention(org);
    expect((await put(org, { region: 'us-west-2' }, org.member)).status).toBe(403);
    expect(await attention(org)).toEqual(before);
  });
});
