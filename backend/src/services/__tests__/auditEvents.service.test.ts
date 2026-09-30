/**
 * The explicit audit-event writer under audit_logs' row-level security.
 *
 * audit_logs is owned by postgres with RLS enabled, and its insert policy
 * requires organization_id = current_setting('app.current_organization_id').
 * Superusers and table owners bypass that, so these tests run the real writer
 * (createAuditEventWriter) through a dedicated NON-superuser, non-BYPASSRLS
 * role holding only SELECT/INSERT on audit_logs -- the same position the
 * production application role is in. Reads for assertions use the privileged
 * pool.
 */
import { Pool, PoolClient } from 'pg';
import {
  createAuditEventWriter,
  AuditEvent,
  AuditEventAction,
  AuditEventResourceType,
} from '../auditEvents.service';

const RLS_ROLE = 'audit_events_rls_test';
// A local test-only login for the role created below; not a real credential.
const RLS_ROLE_PASSWORD = 'audit-events-rls-test-only';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const admin = new Pool(dbConfig());
let rlsPool: Pool;
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await admin.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free') RETURNING id`,
    [`Audit RLS ${suffix}`, `audit-rls-${suffix}`, `Audit RLS ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(): Promise<string> {
  const { rows } = await admin.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Audit RLS User') RETURNING id`,
    [`audit-rls-${uniqueSuffix()}@example.com`]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id as string;
}

async function auditRowsFor(orgId: string) {
  const { rows } = await admin.query(
    `SELECT organization_id, user_id, action, resource_type, resource_id,
            ip_address, user_agent, changes, metadata
       FROM audit_logs WHERE organization_id = $1 ORDER BY created_at`,
    [orgId]
  );
  return rows;
}

beforeAll(async () => {
  await admin.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RLS_ROLE}') THEN
        CREATE ROLE ${RLS_ROLE} LOGIN PASSWORD '${RLS_ROLE_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${RLS_ROLE}`);
  await admin.query(`GRANT SELECT, INSERT ON audit_logs TO ${RLS_ROLE}`);
  rlsPool = new Pool({ ...dbConfig(), user: RLS_ROLE, password: RLS_ROLE_PASSWORD });
});

afterAll(async () => {
  await rlsPool.end();
  await admin.query('DELETE FROM audit_logs WHERE organization_id = ANY($1)', [createdOrgIds]);
  await admin.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await admin.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await admin.query(`DROP OWNED BY ${RLS_ROLE}`);
  await admin.query(`DROP ROLE IF EXISTS ${RLS_ROLE}`);
  await admin.end();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('preconditions: RLS is actually enforced for the writer role', () => {
  it('the role is not a superuser, cannot bypass RLS, and does not own audit_logs, which has RLS enabled', async () => {
    const role = await admin.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1', [RLS_ROLE]);
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });

    const table = await admin.query(
      `SELECT relrowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname = 'audit_logs'`
    );
    expect(table.rows[0].relrowsecurity).toBe(true);
    expect(table.rows[0].owner).not.toBe(RLS_ROLE);
  });

  it('without the organization context, an INSERT by this role is rejected', async () => {
    const orgA = await insertOrg();
    await expect(
      rlsPool.query(
        `INSERT INTO audit_logs (organization_id, action, resource_type) VALUES ($1, 'api_key.created', 'api_key')`,
        [orgA]
      )
    ).rejects.toThrow(/row-level security/);
    expect(await auditRowsFor(orgA)).toHaveLength(0);
  });

  it('with the context set to A, an event tagged as organization B is rejected', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const client = await rlsPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [orgA]);
      await expect(
        client.query(
          `INSERT INTO audit_logs (organization_id, action, resource_type) VALUES ($1, 'api_key.created', 'api_key')`,
          [orgB]
        )
      ).rejects.toThrow(/row-level security/);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(await auditRowsFor(orgB)).toHaveLength(0);
  });
});

describe('createAuditEventWriter under RLS', () => {
  it('writes an organization A event as A and an organization B event as B', async () => {
    const writer = createAuditEventWriter(rlsPool);
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const actorA = await insertUser();
    const actorB = await insertUser();

    await writer.record({
      organizationId: orgA,
      actorId: actorA,
      action: 'api_key.created',
      resourceType: 'api_key',
      resourceId: null,
      request: { ipAddress: '203.0.113.10', userAgent: 'AuditTest/A' },
    });
    await writer.record({
      organizationId: orgB,
      actorId: actorB,
      action: 'api_key.revoked',
      resourceType: 'api_key',
      resourceId: null,
      request: { ipAddress: '203.0.113.11', userAgent: 'AuditTest/B' },
    });

    const a = await auditRowsFor(orgA);
    const b = await auditRowsFor(orgB);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]).toMatchObject({
      organization_id: orgA,
      user_id: actorA,
      action: 'api_key.created',
      ip_address: '203.0.113.10',
      user_agent: 'AuditTest/A',
    });
    expect(b[0]).toMatchObject({
      organization_id: orgB,
      user_id: actorB,
      action: 'api_key.revoked',
      ip_address: '203.0.113.11',
      user_agent: 'AuditTest/B',
    });
  });

  it('every event shape persists under RLS, with its resource id, changes, and metadata', async () => {
    const writer = createAuditEventWriter(rlsPool);
    const orgId = await insertOrg();
    const actorId = await insertUser();
    const resourceId = '11111111-2222-4333-8444-555555555555';

    const shapes: Array<[AuditEventAction, AuditEventResourceType]> = [
      ['organization_invitation.created', 'organization_invitation'],
      ['organization_invitation.created', 'organization_membership'],
      ['organization_invitation.accepted', 'organization_membership'],
      ['organization_membership.role_changed', 'organization_membership'],
      ['organization_membership.removed', 'organization_membership'],
      ['sso_configuration.set', 'sso_configuration'],
      ['sso_configuration.deleted', 'sso_configuration'],
      ['api_key.created', 'api_key'],
      ['api_key.revoked', 'api_key'],
      ['aws_account.connected', 'aws_account'],
    ];
    for (const [action, resourceType] of shapes) {
      await writer.record({
        organizationId: orgId,
        actorId,
        action,
        resourceType,
        resourceId: resourceType === 'aws_account' ? null : resourceId,
        changes: action === 'organization_membership.role_changed' ? { from: 'member', to: 'admin' } : null,
        metadata: { shape: `${action}/${resourceType}` },
        request: null,
      });
    }

    const rows = await auditRowsFor(orgId);
    expect(rows.map((r) => [r.action, r.resource_type])).toEqual(shapes);
    const roleChange = rows.find((r) => r.action === 'organization_membership.role_changed');
    expect(roleChange.changes).toEqual({ from: 'member', to: 'admin' });
    expect(rows.find((r) => r.action === 'aws_account.connected').resource_id).toBeNull();
    expect(rows.find((r) => r.action === 'api_key.created').resource_id).toBe(resourceId);
    // No request: IP and user agent stay null rather than invented.
    expect(rows.every((r) => r.ip_address === null && r.user_agent === null)).toBe(true);
  });
});

describe('createAuditEventWriter failure handling', () => {
  const event: AuditEvent = {
    organizationId: '00000000-0000-4000-8000-000000000000',
    actorId: null,
    action: 'api_key.created',
    resourceType: 'api_key',
  };

  it('resolves and logs when no connection can be acquired', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const writer = createAuditEventWriter({
      connect: () => Promise.reject(new Error('pool exhausted')),
    } as unknown as Pick<Pool, 'connect'>);

    await expect(writer.record(event)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('[AuditEvents] Failed to record api_key.created:', expect.any(Error));
  });

  it('rolls back, releases the connection, and resolves when the INSERT fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const statements: string[] = [];
    const release = jest.fn();
    const client = {
      query: jest.fn(async (text: string) => {
        statements.push(text.trim().split(/\s+/)[0]);
        if (text.includes('INSERT INTO audit_logs')) throw new Error('new row violates row-level security policy');
        return { rows: [] };
      }),
      release,
    } as unknown as PoolClient;
    const writer = createAuditEventWriter({ connect: async () => client } as unknown as Pick<Pool, 'connect'>);

    await expect(writer.record(event)).resolves.toBeUndefined();
    expect(statements).toEqual(['BEGIN', 'SELECT', 'INSERT', 'ROLLBACK']);
    expect(release).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
