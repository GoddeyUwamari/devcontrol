/**
 * Proves the SLO 3A API's server-side authorization boundary: requireEnterprise (the
 * exact same middleware slo.routes.ts uses, not a new mechanism) rejects Free/Starter/
 * Pro organizations and allows Enterprise, against real organization rows in Postgres.
 * Same shape as subscription-limits.middleware.test.ts: plain mock Request/Response/
 * next, no HTTP server involved, real DB for the actual tier lookup.
 *
 * This is deliberately a middleware-level test, not a route-level one — this codebase
 * has no HTTP-integration-test convention (no supertest usage anywhere), and
 * requireEnterprise is the actual mechanism slo.routes.ts installs via `router.use(...)`
 * for every one of its routes, so proving requireEnterprise's real-DB behavior here
 * proves the security boundary those routes rely on.
 */

import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { requireEnterprise } from '../subscription.middleware';
import { pool as appPool } from '../../config/database';

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
const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(tier: 'free' | 'starter' | 'pro' | 'enterprise'): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`SLO Gating Org ${suffix}`, `slo-gating-org-${suffix}`, `SLO Gating Org ${suffix}`, tier]
  );
  const id = rows[0].id as string;
  createdOrgIds.push(id);
  return id;
}

function mockRes(): Response {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

afterAll(async () => {
  await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [createdOrgIds]);
  await pool.end();
  // requireEnterprise's own DB lookup (getOrganizationTier) runs through the app-wide
  // pool singleton, not this file's own `pool` — close it too so Jest doesn't report
  // an open handle, same convention as cloudwatch.service.eks.test.ts.
  await appPool.end();
}, 15000);

describe('requireEnterprise gates the SLO API exactly as slo.routes.ts relies on', () => {
  it.each(['free', 'starter', 'pro'] as const)('(1.%s) %s organizations are denied with 402 TIER_REQUIRED', async (tier) => {
    const organizationId = await insertOrg(tier);
    const req = { user: { userId: 'u1', email: 'x@example.com', organizationId, role: 'owner' }, organizationId } as unknown as Request;
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    await requireEnterprise(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);
    expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({ success: false, code: 'TIER_REQUIRED' });
  });

  it('(2) an enterprise organization is allowed through', async () => {
    const organizationId = await insertOrg('enterprise');
    const req = { user: { userId: 'u1', email: 'x@example.com', organizationId, role: 'owner' }, organizationId } as unknown as Request;
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    await requireEnterprise(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('(3) an unauthenticated request (no req.user/organizationId) is rejected with 401, not 402', async () => {
    const req = {} as Request;
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    await requireEnterprise(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
