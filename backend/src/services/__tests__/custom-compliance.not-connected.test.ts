/**
 * AWS connect PR C (C-a), C-D6: a compliance scan needs an AWS connection.
 *
 *   - No eligible connection: the HTTP start answers 409 NOT_CONNECTED with the
 *     approved text; no scan row is created and no lock is taken (not even
 *     taken and released: every statement on the claim client is recorded).
 *     The blocking executeScan() throws ScanNotConnectedError, also with no row.
 *   - Connected: the scan starts and completes as before.
 *   - The connection goes away after the start check (a race): the scan body's
 *     fence refuses it (no connection is never a pass). Its own row is failed
 *     with the approved connection-changed text, and no finding is written.
 *
 * Real Postgres. Placeholders only.
 */
import { Pool } from 'pg';
import { Request, Response } from 'express';
import { CustomComplianceService, SCAN_CONNECTION_CHANGED_MESSAGE, ScanNotConnectedError } from '../custom-compliance.service';
import { ComplianceFrameworksController } from '../../controllers/compliance-frameworks.controller';
import { AWS_NOT_CONNECTED_CODE, COMPLIANCE_SCAN_NOT_CONNECTED_MESSAGE } from '../aws-connection-messages';
import * as fence from '../aws-connection-fence';
import { connectPlaceholderAccount, removePlaceholderAccounts } from './helpers/scan-source';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const service = new CustomComplianceService(pool);
const createdOrgIds: string[] = [];

const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'enterprise', 'active') RETURNING id`,
    [`Scan Not Connected Org ${suffix}`, `scan-not-connected-org-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertFrameworkWithRule(orgId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO compliance_frameworks (organization_id, name, framework_type) VALUES ($1, $2, 'custom') RETURNING id`,
    [orgId, `Framework ${uniqueSuffix()}`]
  );
  await pool.query(
    `INSERT INTO compliance_framework_rules
       (framework_id, organization_id, rule_code, title, severity, category, rule_type, conditions, recommendation)
     VALUES ($1, $2, $3, 'Encryption required', 'high', 'encryption', 'property_check',
             '{"property":"is_encrypted","operator":"equals","value":true}', 'Enable encryption')`,
    [rows[0].id, orgId, `RULE-${uniqueSuffix()}`]
  );
  return rows[0].id as string;
}

async function insertResource(orgId: string): Promise<void> {
  const suffix = uniqueSuffix();
  await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status, is_encrypted)
     VALUES ($1, $2, $3, 's3', 'us-east-1', 'active', true)`,
    [orgId, `arn:aws:s3:::bucket-${suffix}`, `bucket-${suffix}`]
  );
}

const scanRows = async (orgId: string) =>
  (await pool.query(`SELECT status, error_message FROM compliance_scans WHERE organization_id = $1`, [orgId])).rows;
const findingCount = async (orgId: string) =>
  (await pool.query(`SELECT count(*)::int AS n FROM compliance_scan_findings f JOIN compliance_scans s ON s.id = f.scan_id WHERE s.organization_id = $1`, [orgId])).rows[0].n;

afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await removePlaceholderAccounts(pool, createdOrgIds);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('custom compliance: a scan needs an AWS connection', () => {
  it('no connection: the HTTP start answers 409 NOT_CONNECTED with the approved text, and no scan row exists', async () => {
    const orgId = await insertOrg();
    const frameworkId = await insertFrameworkWithRule(orgId);
    // The fixture table exists in every database the scans run against.
    await connectPlaceholderAccount(pool, (await insertOrg()));

    expect(await service.startScan(frameworkId, orgId)).toEqual({ status: 'not_connected' });
    expect(await scanRows(orgId)).toEqual([]);

    const controller = new ComplianceFrameworksController(pool);
    const out: { status: number; body: unknown } = { status: 200, body: undefined };
    const res = {
      status(code: number) { out.status = code; return this; },
      json(body: unknown) { out.body = body; return this; },
    } as unknown as Response;
    await controller.executeScan({ params: { id: frameworkId }, body: {}, organizationId: orgId, user: { organizationId: orgId } } as unknown as Request, res);
    expect(out).toEqual({ status: 409, body: { success: false, error: AWS_NOT_CONNECTED_CODE, message: COMPLIANCE_SCAN_NOT_CONNECTED_MESSAGE } });
    expect(COMPLIANCE_SCAN_NOT_CONNECTED_MESSAGE).toBe('Connect an AWS account to run a compliance scan.');
    expect(await scanRows(orgId)).toEqual([]);
  });

  it('no connection: no advisory lock is taken, not even taken and released (every statement on the claim client is recorded)', async () => {
    const orgId = await insertOrg();
    const frameworkId = await insertFrameworkWithRule(orgId);
    const statements: string[] = [];
    const realConnect = pool.connect.bind(pool) as any;
    // pool.query() calls connect(callback) internally: those pass straight through.
    jest.spyOn(pool, 'connect').mockImplementation(((...args: any[]) => {
      if (args.length > 0) return realConnect(...args);
      return recordedClient();
    }) as any);
    const recordedClient = async () => {
      const client = await realConnect();
      const realQuery = client.query.bind(client);
      jest.spyOn(client, 'query').mockImplementation(((text: any, ...rest: any[]) => {
        statements.push(typeof text === 'string' ? text : String(text?.text ?? ''));
        return (realQuery as any)(text, ...rest);
      }) as any);
      return client;
    };
    const tryLock = jest.spyOn(service as any, 'tryLock');

    expect(await service.startScan(frameworkId, orgId)).toEqual({ status: 'not_connected' });
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter((sql) => /advisory/i.test(sql))).toEqual([]);
    expect(tryLock).not.toHaveBeenCalled();
    expect(await scanRows(orgId)).toEqual([]);
  });

  it('no connection: executeScan throws ScanNotConnectedError and creates no row', async () => {
    const orgId = await insertOrg();
    const frameworkId = await insertFrameworkWithRule(orgId);
    await expect(service.executeScan(frameworkId, orgId)).rejects.toBeInstanceOf(ScanNotConnectedError);
    expect(await scanRows(orgId)).toEqual([]);
  });

  it('connected: the scan runs and completes as before', async () => {
    const orgId = await insertOrg();
    await connectPlaceholderAccount(pool, orgId);
    const frameworkId = await insertFrameworkWithRule(orgId);
    await insertResource(orgId);
    const scan = await service.executeScan(frameworkId, orgId);
    expect(scan.status).toBe('completed');
    expect(await findingCount(orgId)).toBe(1);
  });

  it('the connection is gone by the time the body runs: the fence refuses, the row is failed with the approved text, no finding', async () => {
    const orgId = await insertOrg();
    await connectPlaceholderAccount(pool, orgId);
    const frameworkId = await insertFrameworkWithRule(orgId);
    await insertResource(orgId);
    // The start check sees the connection; the body's own read then finds none.
    const real = fence.currentConnectionIdentity;
    let calls = 0;
    jest.spyOn(fence, 'currentConnectionIdentity').mockImplementation(async (db, org) => {
      calls += 1;
      if (calls === 1) return real(db, org);
      await pool.query(`DELETE FROM aws_accounts WHERE org_id = $1`, [org]);
      return real(db, org);
    });
    await expect(service.executeScan(frameworkId, orgId)).rejects.toBeInstanceOf(fence.ConnectionChangedError);
    expect(await scanRows(orgId)).toEqual([{ status: 'failed', error_message: SCAN_CONNECTION_CHANGED_MESSAGE }]);
    expect(await findingCount(orgId)).toBe(0);
  });
});
