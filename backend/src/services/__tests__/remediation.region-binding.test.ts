/**
 * Binding a missing workflow region is a guarded write (multi-region plan M1
 * review nit, landed in M2):
 *
 *   - the UPDATE applies only while action_params.region is still missing,
 *     for that workflow id and organization;
 *   - when it applies to no row, the stored region is read back: the same
 *     region is accepted, a different one is refused with a conflict before
 *     credentials or any AWS call, and a still-missing one is refused as
 *     unknown. Success is never reported without a verified write.
 *
 * The first block drives execute() through a fake Pool; the second races two
 * real bindings against live Postgres. Every ID here is a placeholder.
 */
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { EC2Client } from '@aws-sdk/client-ec2';
import * as platformSts from '../platform-sts';
import {
  RemediationService,
  REGION_BINDING_CONFLICT_MESSAGE,
  REGION_UNKNOWN_MESSAGE,
  isRegionBlocked,
} from '../remediation.service';
import { pool as appPool } from '../../config/database';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';

const RESOURCE_ID = 'i-1234567890abcdef0';
const WORKFLOW = {
  id: 'wf-binding',
  organization_id: 'org-binding',
  recommendation_id: null,
  resource_id: RESOURCE_ID,
  resource_type: 'EC2',
  action_type: 'stop_instance',
  action_params: { resource_id: RESOURCE_ID } as Record<string, unknown>,
  estimated_savings: 5,
  risk_level: 'low',
  status: 'approved',
  rollback_available: true,
  execution_log: null,
};

const isBindingUpdate = (sql: string) => /^\s*UPDATE remediation_workflows\s+SET action_params = jsonb_set/.test(sql);
const isRegionReread = (sql: string) => /SELECT action_params->>'region' AS region FROM remediation_workflows/.test(sql);

/**
 * A Pool whose inventory holds the resource in eu-west-1, whose binding UPDATE
 * reports `rowCount`, and whose read-back returns `storedRegion`.
 */
function fakePool(rowCount: number, storedRegion: string | null) {
  const query = jest.fn(async (sql: string) => {
    if (/FROM aws_resources/.test(sql)) return { rows: [{ region: 'eu-west-1' }] };
    if (/FROM aws_accounts/.test(sql)) {
      return { rows: [{ role_arn: 'arn:aws:iam::111122223333:role/devcontrol-remediation', account_id: '111122223333', external_id: 'external-id-1', status: 'active' }] };
    }
    if (isBindingUpdate(sql)) return { rows: [], rowCount };
    if (isRegionReread(sql)) return { rows: storedRegion === undefined ? [] : [{ region: storedRegion }] };
    return { rows: [WORKFLOW], rowCount: 1 };
  });
  return { query } as any;
}

const ENV_BEFORE = { ...process.env };

beforeEach(() => {
  process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
  delete process.env.DEVCONTROL_PROD_INSTANCE_ID;
  delete process.env.DEVCONTROL_OPERATIONAL_ORG_ID;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ENV_BEFORE };
  jest.restoreAllMocks();
});

describe('execute binds a missing region with a guarded write', () => {
  it('the UPDATE requires a missing region, the workflow id and the organization', async () => {
    jest.spyOn(platformSts, 'assumeRoleAsPlatform').mockResolvedValue({
      Credentials: { AccessKeyId: 'ASIATEMP', SecretAccessKey: 'temp-secret', SessionToken: 'temp-token' },
    } as any);
    jest.spyOn(EC2Client.prototype as any, 'send').mockResolvedValue({});
    const pool = fakePool(1, null);

    await new RemediationService(pool).execute(WORKFLOW.id, 'org-binding', 'user-1');

    const update = pool.query.mock.calls.find(([sql]: [string]) => isBindingUpdate(sql));
    expect(update[0]).toMatch(/WHERE id = \$2 AND organization_id = \$3\s+AND \(\(action_params->>'region'\) IS NULL OR \(action_params->>'region'\) = ''\)/);
    expect(update[1]).toEqual(['eu-west-1', WORKFLOW.id, 'org-binding']);
    // One row written: nothing is read back.
    expect(pool.query.mock.calls.some(([sql]: [string]) => isRegionReread(sql))).toBe(false);
  });

  it('another request bound a different region: refused as a conflict, no credentials, no AWS call', async () => {
    const pool = fakePool(0, 'us-west-2');
    const service = new RemediationService(pool);
    const getCreds = jest.spyOn(service as any, 'getAWSCredentials');
    const assumeRole = jest.spyOn(platformSts, 'assumeRoleAsPlatform');
    const ec2Send = jest.spyOn(EC2Client.prototype, 'send');

    await expect(service.execute(WORKFLOW.id, 'org-binding', 'user-1')).rejects.toThrow(REGION_BINDING_CONFLICT_MESSAGE);

    expect(isRegionBlocked(REGION_BINDING_CONFLICT_MESSAGE)).toBe(true);
    expect(getCreds).not.toHaveBeenCalled();
    expect(assumeRole).not.toHaveBeenCalled();
    expect(ec2Send).not.toHaveBeenCalled();
  });

  it('another request bound the same region: accepted, and every EC2 call goes to it', async () => {
    jest.spyOn(platformSts, 'assumeRoleAsPlatform').mockResolvedValue({
      Credentials: { AccessKeyId: 'ASIATEMP', SecretAccessKey: 'temp-secret', SessionToken: 'temp-token' },
    } as any);
    const regions: string[] = [];
    jest.spyOn(EC2Client.prototype as any, 'send').mockImplementation(async function (this: any) {
      regions.push(await this.config.region());
      return {};
    });
    const pool = fakePool(0, 'eu-west-1');

    await new RemediationService(pool).execute(WORKFLOW.id, 'org-binding', 'user-1');

    expect(pool.query.mock.calls.some(([sql]: [string]) => isRegionReread(sql))).toBe(true);
    expect(regions.length).toBeGreaterThan(0);
    expect(new Set(regions)).toEqual(new Set(['eu-west-1']));
  });

  it.each([['still missing', null], ['the row is gone', undefined]] as const)(
    'nothing written and the region %s: refused as unknown, no credentials',
    async (_label, stored) => {
      const pool = fakePool(0, stored as any);
      const service = new RemediationService(pool);
      const getCreds = jest.spyOn(service as any, 'getAWSCredentials');

      await expect(service.execute(WORKFLOW.id, 'org-binding', 'user-1')).rejects.toThrow(REGION_UNKNOWN_MESSAGE);
      expect(getCreds).not.toHaveBeenCalled();
    }
  );
});

describe('two bindings race on live Postgres', () => {
  const db = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    await ensureSharedFixtureTable(db, 'remediation_workflows');
  });

  afterAll(async () => {
    await db.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
    await db.end();
    await appPool.end();
  });

  async function workflowWithoutRegion(): Promise<{ orgId: string; workflow: any }> {
    const suffix = randomUUID().slice(0, 8);
    const org = await db.query(
      `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
       VALUES ($1, $2, $1, 'enterprise', 'active') RETURNING id`,
      [`Region Binding ${suffix}`, `region-binding-${suffix}`]
    );
    const orgId = org.rows[0].id as string;
    createdOrgIds.push(orgId);
    const { rows } = await db.query(
      `INSERT INTO remediation_workflows (organization_id, resource_id, resource_type, action_type, action_params, risk_level, status)
       VALUES ($1, $2, 'EC2', 'stop_instance', $3, 'low', 'approved') RETURNING *`,
      [orgId, RESOURCE_ID, JSON.stringify({ resource_id: RESOURCE_ID })]
    );
    return { orgId, workflow: rows[0] };
  }

  const storedRegion = async (id: string) =>
    (await db.query(`SELECT action_params->>'region' AS region FROM remediation_workflows WHERE id = $1`, [id])).rows[0].region;

  it('different regions: exactly one binding is stored, the other is refused as a conflict', async () => {
    const { orgId, workflow } = await workflowWithoutRegion();
    const bind = (region: string) =>
      (new RemediationService(db) as any).bindRegion({ ...workflow, action_params: { ...workflow.action_params } }, orgId, region);

    const results = await Promise.allSettled([bind('eu-west-1'), bind('us-west-2')]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toBe(REGION_BINDING_CONFLICT_MESSAGE);
    const winner = results[0].status === 'fulfilled' ? 'eu-west-1' : 'us-west-2';
    expect(await storedRegion(workflow.id)).toBe(winner);
  });

  it('the same region: both bindings succeed and it is stored once', async () => {
    const { orgId, workflow } = await workflowWithoutRegion();
    const bind = () =>
      (new RemediationService(db) as any).bindRegion({ ...workflow, action_params: { ...workflow.action_params } }, orgId, 'eu-west-1');

    await expect(Promise.all([bind(), bind()])).resolves.toEqual([undefined, undefined]);
    expect(await storedRegion(workflow.id)).toBe('eu-west-1');
  });

  it("another organization's id never binds the workflow", async () => {
    const { workflow } = await workflowWithoutRegion();

    await expect((new RemediationService(db) as any).bindRegion(workflow, randomUUID(), 'eu-west-1')).rejects.toThrow(REGION_UNKNOWN_MESSAGE);
    expect(await storedRegion(workflow.id)).toBeNull();
  });
});
