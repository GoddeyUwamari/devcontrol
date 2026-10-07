/**
 * Shared fixtures for the role-gate route suites: an Enterprise organization
 * with one active member per role, real routes over an in-process HTTP server
 * against live Postgres, and requests authenticated as a chosen member.
 *
 * Only authService.verifyToken is stubbed here (to choose the caller). The
 * role a gate sees is always the caller's current membership row.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import { errorHandler } from '../../middleware/error-handler';
import { authService } from '../../services/auth.service';
import { pool as appPool } from '../../config/database';

export type Role = 'owner' | 'admin' | 'member' | 'viewer';
export const ROLES: Role[] = ['viewer', 'member', 'admin', 'owner'];

export const MEMBER_REFUSAL = {
  success: false,
  error: 'Insufficient permissions',
  required: ['owner', 'admin', 'member'],
};
export const ADMIN_REFUSAL = {
  success: false,
  error: 'Insufficient permissions',
  required: ['owner', 'admin'],
};

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

export function createRoleGateHarness(label: string) {
  const pool = new Pool(dbConfig());
  const createdOrgIds: string[] = [];
  const createdUserIds: string[] = [];
  let server: http.Server | undefined;
  let baseUrl = '';

  const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function insertOrg(): Promise<string> {
    const suffix = uniqueSuffix();
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
       VALUES ($1, $2, $1, 'enterprise', 'active') RETURNING id`,
      [`${label} ${suffix}`, `${label}-${suffix}`]
    );
    createdOrgIds.push(rows[0].id);
    return rows[0].id as string;
  }

  async function insertUser(tag: string): Promise<{ id: string; email: string }> {
    const email = `${label}-${tag}-${uniqueSuffix()}@example.com`;
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Role Gate User') RETURNING id`,
      [email]
    );
    createdUserIds.push(rows[0].id);
    return { id: rows[0].id as string, email };
  }

  async function addMembership(orgId: string, userId: string, role: Role): Promise<void> {
    await pool.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
       VALUES ($1, $2, $3, NOW(), true)`,
      [orgId, userId, role]
    );
  }

  /** An Enterprise organization (every plan gate passes) with one member per role. */
  async function buildOrg() {
    const orgId = await insertOrg();
    const users = {} as Record<Role, string>;
    const emails = {} as Record<Role, string>;
    for (const role of ROLES) {
      const user = await insertUser(role);
      await addMembership(orgId, user.id, role);
      users[role] = user.id;
      emails[role] = user.email;
    }
    return { orgId, ...users, emails };
  }

  /** Serve `mount`ed routers under /api, with the application's error handler. */
  async function listen(mount: (app: express.Express) => void): Promise<void> {
    const app = express();
    app.use(express.json());
    mount(app);
    app.use(errorHandler);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api`;
  }

  /**
   * A request authenticated as `userId` in `orgId`. The token's role CLAIM
   * defaults to 'owner', so a refusal is proven to come from the caller's
   * current membership rather than the claim.
   */
  function sendAs(orgId: string, userId: string, method: string, route: string, body?: unknown, jwtRole: Role = 'owner') {
    jest.spyOn(authService, 'verifyToken').mockReturnValue({
      userId,
      email: 'token-claim@example.com',
      organizationId: orgId,
      role: jwtRole,
      type: 'access',
    } as unknown as ReturnType<typeof authService.verifyToken>);
    return fetch(`${baseUrl}${route}`, {
      method,
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** Stop the server, run `cleanup` for suite-owned rows, then remove the fixtures. */
  async function close(cleanup?: (orgIds: string[], userIds: string[]) => Promise<void>): Promise<void> {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (cleanup) await cleanup(createdOrgIds, createdUserIds);
    await pool.query('DELETE FROM analytics_events WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM audit_logs WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query(
      'DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)',
      [createdOrgIds, createdUserIds]
    );
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
    await pool.end();
    await appPool.end();
  }

  return { pool, buildOrg, insertUser, addMembership, listen, sendAs, close };
}

export type RoleGateOrg = Awaited<ReturnType<ReturnType<typeof createRoleGateHarness>['buildOrg']>>;
