/**
 * Live-DB coverage for AccountSecurityFindingsController's disposition endpoints
 * (acknowledge/dismiss/accept-risk) and the GET /account-findings projection —
 * real controller + real Postgres, fake req/res (same pattern as
 * stripe-checkout-session.security.test.ts). No HTTP layer involved.
 */
import { Request, Response } from 'express';
import { Pool } from 'pg';
import { AccountSecurityFindingsController } from '../account-security-findings.controller';
import { AccountSecurityFindingsRepository, NewAccountFinding } from '../../repositories/account-security-findings.repository';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const pool = new Pool(dbConfig());
const controller = new AccountSecurityFindingsController();
const repository = new AccountSecurityFindingsRepository();
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`Disposition Ctrl Org ${suffix}`, `disposition-ctrl-org-${suffix}`, `Disposition Ctrl Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'not-a-real-hash', 'Test User') RETURNING id`,
    [`disposition-ctrl-user-${suffix}@example.test`]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id as string;
}

function fakeFinding(overrides: Partial<NewAccountFinding> = {}): NewAccountFinding {
  return {
    findingKey: `key-${uniqueSuffix()}`,
    category: 'networking',
    severity: 'critical',
    title: 'Security group "test-sg" (sg-test) allows SSH (port 22) from anywhere (0.0.0.0/0)',
    recommendation: 'Restrict SSH access.',
    resourceIdentifier: 'arn:aws:ec2:us-east-1:123456789012:security-group/sg-test',
    region: 'us-east-1',
    evidence: {
      schema_version: 1,
      security_group_id: 'sg-test',
      security_group_name: 'test-sg',
      region: 'us-east-1',
      direction: 'ingress',
      protocol: 'tcp',
      from_port: 22,
      to_port: 22,
      ip_version: 'v4',
      cidr: '0.0.0.0/0',
      detected_at: new Date().toISOString(),
    },
    ...overrides,
  };
}

async function seedFinding(orgId: string): Promise<string> {
  const finding = fakeFinding();
  await repository.reconcileScan(orgId, new Date(), [finding]);
  const active = await repository.getActive(orgId);
  const match = active.find((f) => f.finding_key === finding.findingKey);
  if (!match) throw new Error('seedFinding: finding was not persisted');
  return match.id;
}

function mockReqRes(params: Record<string, string>, body: any, organizationId: string, userId: string) {
  const req = {
    user: { organizationId, userId, email: `user-${uniqueSuffix()}@example.com`, role: 'admin' },
    params,
    body,
  } as unknown as Request;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;

  return { req, res, json, status };
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  if (createdUserIds.length > 0) {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  }
  await pool.end();
});

describe('AccountSecurityFindingsController.acknowledge', () => {
  it('succeeds without a note', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const findingId = await seedFinding(orgId);

    const { req, res, json, status } = mockReqRes({ id: findingId }, {}, orgId, userId);
    await controller.acknowledge(req, res);

    expect(status).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: expect.objectContaining({ disposition: 'acknowledged', derived_status: 'acknowledged' }) })
    );
  });
});

describe('AccountSecurityFindingsController.dismiss', () => {
  it('rejects an empty note with 400', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const findingId = await seedFinding(orgId);

    const { req, res, status, json } = mockReqRes({ id: findingId }, { note: '   ' }, orgId, userId);
    await controller.dismiss(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('rejects a missing note with 400', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const findingId = await seedFinding(orgId);

    const { req, res, status } = mockReqRes({ id: findingId }, {}, orgId, userId);
    await controller.dismiss(req, res);

    expect(status).toHaveBeenCalledWith(400);
  });

  it('persists a non-empty note', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const findingId = await seedFinding(orgId);

    const { req, res, json, status } = mockReqRes({ id: findingId }, { note: 'Known false positive' }, orgId, userId);
    await controller.dismiss(req, res);

    expect(status).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: expect.objectContaining({ disposition: 'dismissed', disposition_note: 'Known false positive' }) })
    );
  });
});

describe('AccountSecurityFindingsController.acceptRisk', () => {
  it('rejects an empty note with 400', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const findingId = await seedFinding(orgId);

    const { req, res, status } = mockReqRes({ id: findingId }, { note: '' }, orgId, userId);
    await controller.acceptRisk(req, res);

    expect(status).toHaveBeenCalledWith(400);
  });

  it('succeeds with a note', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const findingId = await seedFinding(orgId);

    const { req, res, json, status } = mockReqRes({ id: findingId }, { note: 'Approved by security, SEC-42' }, orgId, userId);
    await controller.acceptRisk(req, res);

    expect(status).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: expect.objectContaining({ disposition: 'accepted_risk' }) })
    );
  });
});

describe('disposition endpoints reject an already-resolved finding', () => {
  it('returns 409 for acknowledge on a resolved finding', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const finding = fakeFinding();
    await repository.reconcileScan(orgId, new Date(), [finding], ['networking']);
    const [row] = await repository.getActive(orgId);

    // A complete scan that no longer sees it -> verified resolved
    await repository.reconcileScan(orgId, new Date(), [], ['networking']);

    const { req, res, status, json } = mockReqRes({ id: row.id }, {}, orgId, userId);
    await controller.acknowledge(req, res);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('returns 404 for a nonexistent finding id', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();

    const { req, res, status } = mockReqRes({ id: '00000000-0000-0000-0000-000000000000' }, {}, orgId, userId);
    await controller.acknowledge(req, res);

    expect(status).toHaveBeenCalledWith(404);
  });
});

describe('GET /account-findings exposes the new projection', () => {
  it('includes derived_status, evidence, and framework_mapping for each finding', async () => {
    const orgId = await insertOrg();
    await seedFinding(orgId);

    const { req, res, json } = mockReqRes({}, {}, orgId, 'unused');
    (req as any).query = {};
    await controller.getActive(req, res);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            derived_status: 'active',
            evidence: expect.objectContaining({ security_group_id: 'sg-test' }),
            framework_mapping: expect.objectContaining({ framework: 'CIS AWS Foundations Benchmark', control: '5.3' }),
          }),
        ]),
      })
    );
  });
});
