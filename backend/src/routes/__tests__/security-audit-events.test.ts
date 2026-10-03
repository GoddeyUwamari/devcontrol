/**
 * Explicit audit events for security-sensitive business actions, end to end:
 * the real routes, controllers, and services over an in-process HTTP server
 * against live Postgres, writing through the real auditEvents writer.
 *
 * Each event must be recorded only after its business action succeeded, with
 * the acting organization and user, the resource, request IP and user agent,
 * and no credential material; and an audit-write failure must never fail the
 * business action. Only authService.verifyToken (to choose the caller) and the
 * invitation email are stubbed.
 *
 * Tenant isolation of the writer itself (a non-superuser role under
 * audit_logs' RLS) is proven in services/__tests__/auditEvents.service.test.ts.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import organizationRoutes from '../organizations.routes';
import apiKeysRoutes from '../api-keys.routes';
import { createSAMLRoutes } from '../saml.routes';
import { authService } from '../../services/auth.service';
import { emailService } from '../../services/email.service';
import { auditEvents, createAuditEventWriter } from '../../services/auditEvents.service';
import { pool as appPool } from '../../config/database';
import type { PoolClient } from 'pg';

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
const createdUserIds: string[] = [];
const fixtureTablesCreated: string[] = [];

const CLIENT_IP = '203.0.113.50';
const USER_AGENT = 'SecurityAuditTest/1.0';
const IDP_CERT = '-----BEGIN CERTIFICATE-----\nMIIBfakeAuditTestCertificateBody\n-----END CERTIFICATE-----';

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function tableExists(tableName: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT to_regclass($1) AS reg', [`public.${tableName}`]);
  return rows[0].reg !== null;
}

// api_keys and sso_configurations are not created by the canonical migrations
// CI bootstraps -- same shapes as aws-connection-api-key-authorization.test.ts
// and saml-sso-authorization.test.ts. Create only what is missing, drop only
// what was created here.
async function ensureFixtureSchema(): Promise<void> {
  if (!(await tableExists('api_keys'))) {
    await pool.query(`
      CREATE TABLE api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        key_hash TEXT NOT NULL,
        prefix VARCHAR(20) NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT '{}',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ,
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
      )
    `);
    fixtureTablesCreated.push('api_keys');
  }
  if (!(await tableExists('sso_configurations'))) {
    await pool.query(`
      CREATE TABLE sso_configurations (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        provider_name     VARCHAR(100) NOT NULL DEFAULT 'SAML IdP',
        idp_entity_id     TEXT NOT NULL,
        idp_sso_url       TEXT NOT NULL,
        idp_certificate   TEXT NOT NULL,
        sp_entity_id      TEXT NOT NULL,
        attribute_mapping JSONB NOT NULL DEFAULT '{"email":"email","name":"displayName"}',
        allowed_domains   JSONB NOT NULL DEFAULT '[]',
        is_active         BOOLEAN NOT NULL DEFAULT false,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id)
      )`);
    fixtureTablesCreated.push('sso_configurations');
  }
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, max_services, max_users)
     VALUES ($1, $2, $3, 'enterprise', 10, 50) RETURNING id`,
    [`Audit Events ${suffix}`, `audit-events-${suffix}`, `Audit Events ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(label: string, email?: string): Promise<{ id: string; email: string }> {
  const address = email ?? `audit-events-${label}-${uniqueSuffix()}@example.com`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Audit Events User') RETURNING id`,
    [address]
  );
  createdUserIds.push(rows[0].id);
  return { id: rows[0].id as string, email: address };
}

async function member(orgId: string, role: string): Promise<string> {
  const user = await insertUser(role);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, $3, NOW(), true)`,
    [orgId, user.id, role]
  );
  return user.id;
}

/**
 * A personal workspace the user owns -- the organization their own session
 * is bound to, as every signed-in user has (authenticate requires it).
 */
async function homeOrgFor(userId: string): Promise<string> {
  const orgId = await insertOrg();
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, 'owner', NOW(), true)`,
    [orgId, userId]
  );
  return orgId;
}

async function buildOrg() {
  const orgId = await insertOrg();
  return {
    orgId,
    owner: await member(orgId, 'owner'),
    admin: await member(orgId, 'admin'),
    member: await member(orgId, 'member'),
  };
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  await ensureFixtureSchema();
  const app = express();
  // Same as server.ts, so req.ip is the client address behind the proxy.
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/organizations', organizationRoutes);
  app.use('/api/keys', apiKeysRoutes);
  app.use('/api/auth/saml', createSAMLRoutes());
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

beforeEach(() => {
  jest.spyOn(emailService, 'sendInvitationEmail').mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM audit_logs WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM api_keys WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM organization_invitations WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query(
    'DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)',
    [createdOrgIds, createdUserIds]
  );
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  for (const table of fixtureTablesCreated) {
    await pool.query(`DROP TABLE IF EXISTS ${table}`);
  }
  await pool.end();
});

/** Requests as `userId` in `orgId`, from CLIENT_IP with USER_AGENT. */
function as(userId: string, orgId: string, jwtRole = 'owner') {
  return (method: string, path: string, body?: unknown) => {
    jest.spyOn(authService, 'verifyToken').mockReturnValue({
      userId,
      email: 'audit-events-caller@example.com',
      organizationId: orgId,
      role: jwtRole,
      type: 'access',
    } as unknown as ReturnType<typeof authService.verifyToken>);
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
        'X-Forwarded-For': CLIENT_IP,
        'User-Agent': USER_AGENT,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
}

async function events(orgId: string, action: string) {
  const { rows } = await pool.query(
    `SELECT organization_id, user_id, action, resource_type, resource_id,
            ip_address, user_agent, changes, metadata
       FROM audit_logs WHERE organization_id = $1 AND action = $2 ORDER BY created_at`,
    [orgId, action]
  );
  return rows;
}

/** Makes every audit write fail inside the real writer (its connection cannot be acquired). */
function failAuditWrites() {
  const failing = createAuditEventWriter({
    connect: () => Promise.reject(new Error('audit database unavailable')),
  } as unknown as Parameters<typeof createAuditEventWriter>[0]);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(auditEvents, 'record').mockImplementation(failing.record);
}

/**
 * Lets the service's own transaction run its real mutation, then fails that
 * transaction's COMMIT so the service rolls it back -- a change that passed
 * authorization but never committed. Only a connection that ran `mutation`
 * is affected (the audit writer's own connection never does); each wrapped
 * connection gets its real query/release back before it returns to the pool.
 * Returns how many transactions were made to fail.
 */
function failCommitAfter(mutation: RegExp): { failedCommits: number } {
  const state = { failedCommits: 0 };
  const realConnect = appPool.connect.bind(appPool) as () => Promise<PoolClient>;
  jest.spyOn(appPool, 'connect').mockImplementation((async () => {
    const client = await realConnect();
    const realQuery = client.query;
    const realRelease = client.release;
    let mutated = false;
    client.query = ((text: unknown, ...rest: unknown[]) => {
      const sql = typeof text === 'string' ? text : (text as { text?: string } | null)?.text;
      if (typeof sql === 'string' && mutation.test(sql)) mutated = true;
      if (sql === 'COMMIT' && mutated) {
        state.failedCommits += 1;
        return Promise.reject(new Error('simulated COMMIT failure'));
      }
      return (realQuery as (...args: unknown[]) => unknown).call(client, text, ...rest);
    }) as PoolClient['query'];
    client.release = ((err?: Error | boolean) => {
      client.query = realQuery;
      client.release = realRelease;
      return realRelease.call(client, err);
    }) as PoolClient['release'];
    return client;
  }) as unknown as typeof appPool.connect);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  return state;
}

function expectRequestMetadata(row: { ip_address: string; user_agent: string }) {
  expect(row.ip_address).toBe(CLIENT_IP);
  expect(row.user_agent).toBe(USER_AGENT);
}

async function membershipId(orgId: string, userId: string): Promise<string | null> {
  const { rows } = await pool.query(
    'SELECT id FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
    [orgId, userId]
  );
  return rows[0]?.id ?? null;
}

describe('invitation created', () => {
  it('existing user: records the pending membership, the inviter, and no invitation token', async () => {
    const org = await buildOrg();
    const invitee = await insertUser('invitee');

    const res = await as(org.owner, org.orgId)('POST', `/organizations/${org.orgId}/invite`, {
      email: invitee.email,
      role: 'member',
    });
    expect(res.status).toBe(200);

    const { rows: pending } = await pool.query(
      'SELECT id, invitation_token FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
      [org.orgId, invitee.id]
    );
    const rows = await events(org.orgId, 'organization_invitation.created');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: org.orgId,
      user_id: org.owner,
      resource_type: 'organization_membership',
      resource_id: pending[0].id,
      changes: null,
      metadata: { role: 'member', inviteeUserId: invitee.id },
    });
    expectRequestMetadata(rows[0]);
    expect(JSON.stringify(rows[0])).not.toContain(pending[0].invitation_token);
  });

  it('new email: records the standalone invitation and no token or address', async () => {
    const org = await buildOrg();
    const email = `audit-events-new-${uniqueSuffix()}@example.com`;

    const res = await as(org.owner, org.orgId)('POST', `/organizations/${org.orgId}/invite`, { email, role: 'viewer' });
    expect(res.status).toBe(200);

    const { rows: invitation } = await pool.query(
      'SELECT id, invitation_token FROM organization_invitations WHERE organization_id = $1 AND lower(email) = $2',
      [org.orgId, email]
    );
    const rows = await events(org.orgId, 'organization_invitation.created');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: org.owner,
      resource_type: 'organization_invitation',
      resource_id: invitation[0].id,
      metadata: { role: 'viewer' },
    });
    expectRequestMetadata(rows[0]);
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain(invitation[0].invitation_token);
    expect(serialized).not.toContain(email);
  });

  it('a refused invitation records nothing', async () => {
    const org = await buildOrg();
    const res = await as(org.member, org.orgId)('POST', `/organizations/${org.orgId}/invite`, {
      email: `audit-events-refused-${uniqueSuffix()}@example.com`,
      role: 'member',
    });
    expect(res.status).toBe(403);
    expect(await events(org.orgId, 'organization_invitation.created')).toHaveLength(0);
  });
});

describe('invitation accepted', () => {
  it('existing-user invitation: records the accepting user as actor and the joined membership', async () => {
    const org = await buildOrg();
    const invitee = await insertUser('accepter');
    const home = await homeOrgFor(invitee.id);
    await as(org.owner, org.orgId)('POST', `/organizations/${org.orgId}/invite`, { email: invitee.email, role: 'member' });
    const { rows } = await pool.query(
      'SELECT id, invitation_token FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
      [org.orgId, invitee.id]
    );

    const res = await as(invitee.id, home)('POST', '/organizations/accept-invitation', {
      invitationToken: rows[0].invitation_token,
    });
    expect(res.status).toBe(200);

    const accepted = await events(org.orgId, 'organization_invitation.accepted');
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      organization_id: org.orgId,
      user_id: invitee.id,
      resource_type: 'organization_membership',
      resource_id: rows[0].id,
      metadata: { role: 'member', invitedBy: org.owner },
    });
    expectRequestMetadata(accepted[0]);
    expect(JSON.stringify(accepted[0])).not.toContain(rows[0].invitation_token);
    // The accepting user's own organization gets no event.
    expect(await events(home, 'organization_invitation.accepted')).toHaveLength(0);
  });

  it('standalone invitation: records the new membership and the invitation it came from', async () => {
    const org = await buildOrg();
    const email = `audit-events-later-${uniqueSuffix()}@example.com`;
    await as(org.owner, org.orgId)('POST', `/organizations/${org.orgId}/invite`, { email, role: 'viewer' });
    const { rows: invitation } = await pool.query(
      'SELECT id, invitation_token FROM organization_invitations WHERE organization_id = $1 AND lower(email) = $2',
      [org.orgId, email]
    );
    const registered = await insertUser('later', email);
    const home = await homeOrgFor(registered.id);

    const res = await as(registered.id, home)('POST', '/organizations/accept-invitation', {
      invitationToken: invitation[0].invitation_token,
    });
    expect(res.status).toBe(200);

    const accepted = await events(org.orgId, 'organization_invitation.accepted');
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      user_id: registered.id,
      resource_type: 'organization_membership',
      resource_id: await membershipId(org.orgId, registered.id),
      metadata: { role: 'viewer', invitedBy: org.owner, invitationId: invitation[0].id },
    });
    expectRequestMetadata(accepted[0]);
    expect(JSON.stringify(accepted[0])).not.toContain(invitation[0].invitation_token);
  });

  it('an invalid token records nothing', async () => {
    const org = await buildOrg();
    const res = await as(org.member, org.orgId)('POST', '/organizations/accept-invitation', {
      invitationToken: 'not-a-real-token',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await events(org.orgId, 'organization_invitation.accepted')).toHaveLength(0);
  });
});

describe('role changed', () => {
  it('records the persisted transition in changes', async () => {
    const org = await buildOrg();
    const target = await membershipId(org.orgId, org.member);

    const res = await as(org.owner, org.orgId)('PATCH', `/organizations/${org.orgId}/members/${org.member}/role`, {
      role: 'admin',
    });
    expect(res.status).toBe(200);

    const rows = await events(org.orgId, 'organization_membership.role_changed');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: org.orgId,
      user_id: org.owner,
      resource_type: 'organization_membership',
      resource_id: target,
      changes: { from: 'member', to: 'admin' },
      metadata: { userId: org.member },
    });
    expectRequestMetadata(rows[0]);
  });

  it('a change that passed authorization but was rolled back (COMMIT failed) records nothing', async () => {
    const org = await buildOrg();
    const commit = failCommitAfter(/^\s*UPDATE organization_memberships\s+SET role/);

    const res = await as(org.owner, org.orgId)('PATCH', `/organizations/${org.orgId}/members/${org.member}/role`, {
      role: 'admin',
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(commit.failedCommits).toBe(1);
    const { rows } = await pool.query(
      'SELECT role FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
      [org.orgId, org.member]
    );
    expect(rows[0].role).toBe('member');
    expect(await events(org.orgId, 'organization_membership.role_changed')).toHaveLength(0);
  });

  it('setting the same role, or a refused change, records nothing', async () => {
    const org = await buildOrg();
    expect(
      (await as(org.owner, org.orgId)('PATCH', `/organizations/${org.orgId}/members/${org.member}/role`, { role: 'member' }))
        .status
    ).toBe(200);
    expect(
      (await as(org.admin, org.orgId)('PATCH', `/organizations/${org.orgId}/members/${org.owner}/role`, { role: 'member' }))
        .status
    ).toBe(403);
    expect(await events(org.orgId, 'organization_membership.role_changed')).toHaveLength(0);
  });
});

describe('member removed', () => {
  it('records the removed membership and member', async () => {
    const org = await buildOrg();
    const target = await membershipId(org.orgId, org.member);

    const res = await as(org.admin, org.orgId)('DELETE', `/organizations/${org.orgId}/members/${org.member}`);
    expect(res.status).toBe(200);
    expect(await membershipId(org.orgId, org.member)).toBeNull();

    const rows = await events(org.orgId, 'organization_membership.removed');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: org.orgId,
      user_id: org.admin,
      resource_type: 'organization_membership',
      resource_id: target,
      metadata: { userId: org.member, role: 'member', pendingInvitation: false },
    });
    expectRequestMetadata(rows[0]);
  });

  it('a removal that passed authorization but was rolled back (COMMIT failed) records nothing', async () => {
    const org = await buildOrg();
    const target = await membershipId(org.orgId, org.member);
    const commit = failCommitAfter(/^\s*DELETE FROM organization_memberships/);

    const res = await as(org.owner, org.orgId)('DELETE', `/organizations/${org.orgId}/members/${org.member}`);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(commit.failedCommits).toBe(1);
    expect(await membershipId(org.orgId, org.member)).toBe(target);
    expect(await events(org.orgId, 'organization_membership.removed')).toHaveLength(0);
  });

  it('a refused removal records nothing', async () => {
    const org = await buildOrg();
    const res = await as(org.admin, org.orgId)('DELETE', `/organizations/${org.orgId}/members/${org.owner}`);
    expect(res.status).toBe(403);
    expect(await events(org.orgId, 'organization_membership.removed')).toHaveLength(0);
  });
});

describe('SSO configuration', () => {
  const ssoConfig = {
    providerName: 'Audit IdP',
    idpEntityId: 'https://idp.example.test/entity',
    idpSsoUrl: 'https://idp.example.test/sso',
    idpCertificate: IDP_CERT,
    isActive: true,
  };

  it('set: records the configuration id and state, never the certificate', async () => {
    const org = await buildOrg();

    const res = await as(org.owner, org.orgId)('POST', '/auth/saml/config', ssoConfig);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };

    const rows = await events(org.orgId, 'sso_configuration.set');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: org.orgId,
      user_id: org.owner,
      resource_type: 'sso_configuration',
      resource_id: body.data.id,
      metadata: { isActive: true },
    });
    expectRequestMetadata(rows[0]);
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain('MIIBfakeAuditTestCertificateBody');
    expect(serialized).not.toContain('BEGIN CERTIFICATE');
  });

  it('deleted: records the deleted configuration; deleting when none exists records nothing', async () => {
    const org = await buildOrg();
    const saved = (await (await as(org.owner, org.orgId)('POST', '/auth/saml/config', ssoConfig)).json()) as {
      data: { id: string };
    };

    expect((await as(org.owner, org.orgId)('DELETE', '/auth/saml/config')).status).toBe(200);
    expect((await as(org.owner, org.orgId)('DELETE', '/auth/saml/config')).status).toBe(200);

    const rows = await events(org.orgId, 'sso_configuration.deleted');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: org.owner,
      resource_type: 'sso_configuration',
      resource_id: saved.data.id,
    });
    expectRequestMetadata(rows[0]);
  });

  it('a non-owner is refused and nothing is recorded', async () => {
    const org = await buildOrg();
    expect((await as(org.admin, org.orgId, 'owner')('POST', '/auth/saml/config', ssoConfig)).status).toBe(403);
    expect(await events(org.orgId, 'sso_configuration.set')).toHaveLength(0);
  });
});

describe('API keys', () => {
  it('created and revoked: records the key id, never the raw key, hash, or prefix', async () => {
    const org = await buildOrg();

    const created = await as(org.admin, org.orgId)('POST', '/keys', { name: 'ci' });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { data: { id: string; raw_key: string } };
    const { rows: key } = await pool.query('SELECT key_hash, prefix FROM api_keys WHERE id = $1', [body.data.id]);

    expect((await as(org.owner, org.orgId)('DELETE', `/keys/${body.data.id}`)).status).toBe(200);

    const createdRows = await events(org.orgId, 'api_key.created');
    const revokedRows = await events(org.orgId, 'api_key.revoked');
    expect(createdRows).toHaveLength(1);
    expect(revokedRows).toHaveLength(1);
    expect(createdRows[0]).toMatchObject({
      organization_id: org.orgId,
      user_id: org.admin,
      resource_type: 'api_key',
      resource_id: body.data.id,
      metadata: { scopes: ['read:metrics', 'read:costs'] },
    });
    expect(revokedRows[0]).toMatchObject({
      organization_id: org.orgId,
      user_id: org.owner,
      resource_type: 'api_key',
      resource_id: body.data.id,
    });
    expectRequestMetadata(createdRows[0]);
    expectRequestMetadata(revokedRows[0]);
    const serialized = JSON.stringify([createdRows, revokedRows]);
    expect(serialized).not.toContain(body.data.raw_key);
    expect(serialized).not.toContain(key[0].key_hash);
    expect(serialized).not.toContain(key[0].prefix);
  });

  it('revoking an already-revoked key records nothing more', async () => {
    const org = await buildOrg();
    const body = (await (await as(org.owner, org.orgId)('POST', '/keys', { name: 'ci' })).json()) as { data: { id: string } };
    expect((await as(org.owner, org.orgId)('DELETE', `/keys/${body.data.id}`)).status).toBe(200);
    expect((await as(org.owner, org.orgId)('DELETE', `/keys/${body.data.id}`)).status).toBe(404);
    expect(await events(org.orgId, 'api_key.revoked')).toHaveLength(1);
  });
});

describe('an audit-write failure never fails the business action', () => {
  it('invitation created', async () => {
    const org = await buildOrg();
    const invitee = await insertUser('fail-invitee');
    failAuditWrites();
    const res = await as(org.owner, org.orgId)('POST', `/organizations/${org.orgId}/invite`, {
      email: invitee.email,
      role: 'member',
    });
    expect(res.status).toBe(200);
    expect(await membershipId(org.orgId, invitee.id)).not.toBeNull();
    expect(await events(org.orgId, 'organization_invitation.created')).toHaveLength(0);
  });

  it('invitation accepted', async () => {
    const org = await buildOrg();
    const invitee = await insertUser('fail-accepter');
    await as(org.owner, org.orgId)('POST', `/organizations/${org.orgId}/invite`, { email: invitee.email, role: 'member' });
    const { rows } = await pool.query(
      'SELECT invitation_token FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
      [org.orgId, invitee.id]
    );
    failAuditWrites();
    const res = await as(invitee.id, await homeOrgFor(invitee.id))('POST', '/organizations/accept-invitation', {
      invitationToken: rows[0].invitation_token,
    });
    expect(res.status).toBe(200);
    const { rows: joined } = await pool.query(
      'SELECT is_active, invitation_token FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
      [org.orgId, invitee.id]
    );
    expect(joined[0]).toEqual({ is_active: true, invitation_token: null });
  });

  it('role changed', async () => {
    const org = await buildOrg();
    failAuditWrites();
    const res = await as(org.owner, org.orgId)('PATCH', `/organizations/${org.orgId}/members/${org.member}/role`, {
      role: 'viewer',
    });
    expect(res.status).toBe(200);
    const { rows } = await pool.query(
      'SELECT role FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
      [org.orgId, org.member]
    );
    expect(rows[0].role).toBe('viewer');
  });

  it('member removed', async () => {
    const org = await buildOrg();
    failAuditWrites();
    expect((await as(org.owner, org.orgId)('DELETE', `/organizations/${org.orgId}/members/${org.member}`)).status).toBe(200);
    expect(await membershipId(org.orgId, org.member)).toBeNull();
  });

  it('SSO configuration set and deleted', async () => {
    const org = await buildOrg();
    failAuditWrites();
    const set = await as(org.owner, org.orgId)('POST', '/auth/saml/config', {
      idpEntityId: 'https://idp.example.test/entity',
      idpSsoUrl: 'https://idp.example.test/sso',
      idpCertificate: IDP_CERT,
    });
    expect(set.status).toBe(200);
    expect((await as(org.owner, org.orgId)('DELETE', '/auth/saml/config')).status).toBe(200);
    const { rows } = await pool.query('SELECT 1 FROM sso_configurations WHERE organization_id = $1', [org.orgId]);
    expect(rows).toHaveLength(0);
  });

  it('API key created and revoked', async () => {
    const org = await buildOrg();
    failAuditWrites();
    const created = await as(org.owner, org.orgId)('POST', '/keys', { name: 'ci' });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { data: { id: string } };
    expect((await as(org.owner, org.orgId)('DELETE', `/keys/${body.data.id}`)).status).toBe(200);
    const { rows } = await pool.query('SELECT status FROM api_keys WHERE id = $1', [body.data.id]);
    expect(rows[0].status).toBe('revoked');
  });
});
