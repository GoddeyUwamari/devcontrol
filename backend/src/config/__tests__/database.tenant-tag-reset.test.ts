/**
 * Central pool hygiene: a connection that carries app.current_organization_id
 * must have it cleared before it goes back to the pool, and must be destroyed
 * instead if that clearing fails (installTenantTagReset in config/database.ts).
 *
 * Every RLS-sensitive assertion runs as a throwaway NOSUPERUSER NOBYPASSRLS
 * role -- the same category of role production's `devcontrol` is -- because
 * the CI/dev connecting user is `postgres`, a superuser RLS never restricts.
 * Same technique as compliance-framework-security-foundation-migration.test.ts
 * (a superuser session SET ROLE-ing into a lesser role), applied at connection
 * startup via the libpq `options` parameter (`-c role=...`) so that *every*
 * connection a pool opens runs as that role -- matching the production shape
 * captured 2026-09-26 (session_user=postgres, current_user=devcontrol). Pools
 * under test use max: 1 so the next checkout is provably the same physical
 * connection (pg_backend_pid()) unless it was destroyed.
 *
 * The final describe block covers the empty-string trap: a cleared tag reads
 * back as '' (never NULL again), and the onboarding_progress / analytics_events
 * policies cast it with ::uuid. It exercises every code path that touches
 * those two tables on a connection this reset has cleared.
 */
import { Pool, PoolClient } from 'pg';

// Services under test import `pool` from config/database; point it at the
// role-scoped pool built in beforeAll. Everything else (installTenantTagReset,
// requestContext, ...) stays the real implementation.
const mockPools: { app?: Pool } = {};
jest.mock('../database', () => {
  const actual = jest.requireActual('../database');
  return {
    ...actual,
    get pool() {
      return mockPools.app;
    },
  };
});

import { installTenantTagReset } from '../database';
import { trackFunnelEvent, trackFunnelEventOnce } from '../../services/analyticsEvents';
import { getActivationFunnelSummary } from '../../services/activationFunnel.service';
import { onboardingService } from '../../services/onboarding.service';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const ROLE = `tenant_reset_test_${suffix}`;
const admin = new Pool(dbConfig());
const rolePools: Pool[] = [];
const createdOrgIds: string[] = [];

function rolePool({ reset }: { reset: boolean }): Pool {
  const p = new Pool({ ...dbConfig(), max: 1, options: `-c role=${ROLE}` });
  rolePools.push(p);
  return reset ? installTenantTagReset(p) : p;
}

async function insertOrg(label: string): Promise<string> {
  const s = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await admin.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Tenant Reset ${s}`, `tenant-reset-${s}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function tag(client: PoolClient, orgId: string): Promise<void> {
  await client.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
}

async function stateOf(client: PoolClient) {
  const { rows } = await client.query(
    `SELECT pg_backend_pid() AS pid, current_user AS "user",
            current_setting('app.current_organization_id', true) AS tag`
  );
  return rows[0] as { pid: number; user: string; tag: string | null };
}

/** Checks out, tags for `orgId`, releases -- leaving the one pooled connection in the "cleared" state. */
async function leaveClearedConnection(p: Pool, orgId: string): Promise<number> {
  const c = await p.connect();
  await tag(c, orgId);
  const { pid } = await stateOf(c);
  c.release();
  return pid;
}

let orgA: string;
let orgB: string;

beforeAll(async () => {
  await admin.query(`CREATE ROLE ${ROLE} NOSUPERUSER NOBYPASSRLS`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
  await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`);

  orgA = await insertOrg('a');
  orgB = await insertOrg('b');
  await admin.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status)
     VALUES ($1, $2, 'bucket-a', 's3', 'us-east-1', 'active')`,
    [orgA, `arn:aws:s3:::tenant-reset-${suffix}`]
  );
});

afterAll(async () => {
  await Promise.all(rolePools.map((p) => p.end()));
  if (createdOrgIds.length > 0) {
    await admin.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await admin.query(`DROP OWNED BY ${ROLE}`);
  await admin.query(`DROP ROLE ${ROLE}`);
  await admin.end();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('test harness sanity', () => {
  it('role-scoped pools really run as a non-superuser that RLS restricts', async () => {
    const p = rolePool({ reset: true });
    const c = await p.connect();
    try {
      const { rows } = await c.query(
        `SELECT current_user AS "user", session_user AS "session", r.rolsuper, r.rolbypassrls
         FROM pg_roles r WHERE r.rolname = current_user`
      );
      expect(rows[0]).toEqual({ user: ROLE, session: dbConfig().user, rolsuper: false, rolbypassrls: false });

      // Untagged: RLS hides orgA's row. Tagged: it is visible.
      const untagged = await c.query('SELECT count(*)::int AS n FROM aws_resources WHERE organization_id = $1', [orgA]);
      expect(untagged.rows[0].n).toBe(0);
      await tag(c, orgA);
      const tagged = await c.query('SELECT count(*)::int AS n FROM aws_resources WHERE organization_id = $1', [orgA]);
      expect(tagged.rows[0].n).toBe(1);
    } finally {
      c.release();
    }
  });
});

describe('installTenantTagReset -- tag cleared before a connection returns to the pool', () => {
  it('negative control: WITHOUT the reset, the next checkout inherits the prior org tag and its RLS-visible rows', async () => {
    const p = rolePool({ reset: false });
    const pid = await leaveClearedConnection(p, orgA);

    const next = await p.connect();
    try {
      expect(await stateOf(next)).toMatchObject({ pid, tag: orgA });
      const { rows } = await next.query('SELECT count(*)::int AS n FROM aws_resources');
      expect(rows[0].n).toBe(1);
    } finally {
      next.release();
    }
  });

  it('release(): the same physical connection comes back with the tag cleared and sees no tenant rows', async () => {
    const p = rolePool({ reset: true });
    // No await/delay between release() and connect(): with max: 1 the checkout
    // below can only be satisfied once the reset has finished and the
    // connection is actually back in the pool.
    const pid = await leaveClearedConnection(p, orgA);

    const next = await p.connect();
    try {
      expect(await stateOf(next)).toEqual({ pid, user: ROLE, tag: '' });
      const { rows } = await next.query('SELECT count(*)::int AS n FROM aws_resources');
      expect(rows[0].n).toBe(0);
    } finally {
      next.release();
    }
  });

  it('a later checkout tagged for another org sees only that org -- never the previous tenant', async () => {
    const p = rolePool({ reset: true });
    const pid = await leaveClearedConnection(p, orgA);

    const next = await p.connect();
    try {
      await tag(next, orgB);
      expect(await stateOf(next)).toMatchObject({ pid, tag: orgB });
      const { rows } = await next.query('SELECT count(*)::int AS n FROM aws_resources');
      expect(rows[0].n).toBe(0);
    } finally {
      next.release();
    }
  });

  it('a connection that never received the tag is left exactly as-is (still NULL, not converted to \'\')', async () => {
    const p = rolePool({ reset: true });
    const first = await p.connect();
    const before = await stateOf(first);
    expect(before.tag).toBeNull();
    first.release();

    const next = await p.connect();
    try {
      expect(await stateOf(next)).toEqual({ pid: before.pid, user: ROLE, tag: null });
    } finally {
      next.release();
    }
  });

  it('release(err) keeps pg-pool semantics: the connection is destroyed, not reset and returned', async () => {
    const p = rolePool({ reset: true });
    const c = await p.connect();
    await tag(c, orgA);
    const { pid } = await stateOf(c);
    const querySpy = jest.spyOn(c, 'query');
    c.release(new Error('caller-reported failure'));
    expect(querySpy).not.toHaveBeenCalled();

    const next = await p.connect();
    try {
      const state = await stateOf(next);
      expect(state.pid).not.toBe(pid);
      expect(state.tag).toBeNull();
    } finally {
      next.release();
    }
  });

  it('release(true) is also treated as destroy, as in pg-pool', async () => {
    const p = rolePool({ reset: true });
    const c = await p.connect();
    const { pid } = await stateOf(c);
    c.release(true);

    const next = await p.connect();
    try {
      expect((await stateOf(next)).pid).not.toBe(pid);
    } finally {
      next.release();
    }
  });

  it('if the reset fails (released inside an aborted transaction), the tagged connection is destroyed', async () => {
    const p = rolePool({ reset: true });
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const c = await p.connect();
    await tag(c, orgA);
    const { pid } = await stateOf(c);
    await c.query('BEGIN');
    await expect(c.query('SELECT 1/0')).rejects.toThrow(/division by zero/);
    c.release(); // caller forgot ROLLBACK -- reset cannot run in an aborted transaction

    const next = await p.connect();
    try {
      const state = await stateOf(next);
      expect(state.pid).not.toBe(pid);
      expect(state.tag).toBeNull();
      const { rows } = await next.query('SELECT count(*)::int AS n FROM aws_resources');
      expect(rows[0].n).toBe(0);
    } finally {
      next.release();
    }
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('Failed to clear tenant tag on release'),
      expect.stringMatching(/current transaction is aborted/)
    );
  });

  it('a connection that never ran tag SQL is released exactly as pg-pool would: no extra query, same connection reused', async () => {
    const p = rolePool({ reset: true });
    const c = await p.connect();
    const { rows } = await c.query('SELECT pg_backend_pid() AS pid');
    const querySpy = jest.spyOn(c, 'query');
    c.release();
    expect(querySpy).not.toHaveBeenCalled();

    const next = await p.connect();
    try {
      const after = await next.query('SELECT pg_backend_pid() AS pid');
      expect(after.rows[0].pid).toBe(rows[0].pid);
    } finally {
      next.release();
    }
  });

  it('the tagged flag clears after a successful reset, so the next untagged use of that connection costs nothing extra', async () => {
    const p = rolePool({ reset: true });
    await leaveClearedConnection(p, orgA);

    const next = await p.connect();
    await next.query('SELECT 1');
    const querySpy = jest.spyOn(next, 'query');
    next.release();
    expect(querySpy).not.toHaveBeenCalled();
  });

  it('double release still throws pg-pool\'s own error', async () => {
    const p = rolePool({ reset: true });
    const c = await p.connect();
    c.release();
    expect(() => c.release()).toThrow('Release called on client which has already been released to the pool.');
  });

  it('double release of a TAGGED connection throws synchronously, causes no unhandled rejection, and returns the connection once', async () => {
    const p = rolePool({ reset: true });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const c = await p.connect();
      await tag(c, orgA);
      const { pid } = await stateOf(c);
      c.release(); // reset now in flight
      expect(() => c.release()).toThrow('Release called on client which has already been released to the pool.');

      // With max: 1 this resolves only once the in-flight reset has completed
      // and pg-pool's own release has run -- a second releaseToPool() from the
      // reset callback would throw inside the .then and surface below.
      const next = await p.connect();
      try {
        expect(await stateOf(next)).toMatchObject({ pid, tag: '' });
      } finally {
        next.release();
      }
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(p.totalCount).toBe(1);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('a tag set through a QueryConfig object ({ text, values }) is detected and cleared', async () => {
    const p = rolePool({ reset: true });
    const c = await p.connect();
    await c.query({ text: "SELECT set_config('app.current_organization_id', $1, false)", values: [orgA] });
    const { rows } = await c.query('SELECT pg_backend_pid() AS pid');
    c.release();

    const next = await p.connect();
    try {
      expect(await stateOf(next)).toMatchObject({ pid: rows[0].pid, tag: '' });
    } finally {
      next.release();
    }
  });

  it('the callback form of connect() gets the same reset', async () => {
    const p = rolePool({ reset: true });
    const { client, done } = await new Promise<{ client: PoolClient; done: (err?: any) => void }>((resolve, reject) =>
      p.connect((err, client, done) => (err || !client ? reject(err) : resolve({ client, done })))
    );
    await tag(client, orgA);
    const { pid } = await stateOf(client);
    done();

    const next = await p.connect();
    try {
      expect(await stateOf(next)).toMatchObject({ pid, tag: '' });
    } finally {
      next.release();
    }
  });
});

describe('installTenantTagReset -- pool.query() internal client lifecycle', () => {
  it('pool.query() works and returns its connection to the pool', async () => {
    const p = rolePool({ reset: true });
    const first = await p.query('SELECT pg_backend_pid() AS pid');
    const second = await p.query('SELECT pg_backend_pid() AS pid');
    expect(second.rows[0].pid).toBe(first.rows[0].pid);
    expect(p.totalCount).toBe(1);
  });

  it('a tag set by a bare pool.query() is cleared when pool.query() releases its client', async () => {
    const p = rolePool({ reset: true });
    await p.query("SELECT set_config('app.current_organization_id', $1, false)", [orgA]);
    const { rows } = await p.query(
      "SELECT current_setting('app.current_organization_id', true) AS tag, (SELECT count(*)::int FROM aws_resources) AS n"
    );
    expect(rows[0]).toEqual({ tag: '', n: 0 });
  });

  it('a failed pool.query() still rejects and still destroys its connection (pg-pool release(err))', async () => {
    const p = rolePool({ reset: true });
    const { rows } = await p.query('SELECT pg_backend_pid() AS pid');
    await expect(p.query('SELECT 1/0')).rejects.toThrow(/division by zero/);
    const after = await p.query('SELECT pg_backend_pid() AS pid');
    expect(after.rows[0].pid).not.toBe(rows[0].pid);
  });
});

describe('the application pool has the reset installed', () => {
  it('config/database.ts pool clears a tag before the connection is reused', async () => {
    const realPool: Pool = jest.requireActual('../database').pool;
    try {
      const c = await realPool.connect();
      await tag(c, orgA);
      const { pid } = await stateOf(c);
      const returned = new Promise<void>((resolve) => realPool.once('release', () => resolve()));
      c.release();
      await returned; // pg-pool emits 'release' as the reset completes and the client goes back to idle

      // pg-pool reuses the most recently idled client first.
      const next = await realPool.connect();
      try {
        expect(await stateOf(next)).toMatchObject({ pid, tag: '' });
      } finally {
        next.release();
      }
    } finally {
      await realPool.end();
    }
  });
});

/**
 * The empty-string trap. After a cleared tag, current_setting(..., true)
 * returns '' and the onboarding_progress / analytics_events policies'
 * `::uuid` cast raises 22P02. These tests run every path that touches those
 * two tables on a connection this reset has just cleared (the "reset
 * connection"), as the non-superuser role.
 */
describe('empty-string trap: onboarding_progress / analytics_events on a reset connection', () => {
  beforeEach(() => {
    mockPools.app = rolePool({ reset: true });
  });

  async function expectResetConnection(): Promise<void> {
    const c = await mockPools.app!.connect();
    try {
      expect((await stateOf(c)).tag).toBe('');
    } finally {
      c.release();
    }
  }

  it('trackFunnelEventOnce (transaction-local tag) still records on a reset connection', async () => {
    await leaveClearedConnection(mockPools.app!, orgB);
    await expectResetConnection();
    const errorLog = jest.spyOn(console, 'error');

    await expect(trackFunnelEventOnce({ organizationId: orgA, eventName: 'signup_completed' })).resolves.toBe(true);
    expect(errorLog).not.toHaveBeenCalled();
    const { rows } = await admin.query(
      `SELECT count(*)::int AS n FROM analytics_events WHERE organization_id = $1 AND event_name = 'signup_completed'`,
      [orgA]
    );
    expect(rows[0].n).toBe(1);
  });

  it('trackFunnelEvent -> track_event() still records on a reset connection', async () => {
    await leaveClearedConnection(mockPools.app!, orgB);
    const errorLog = jest.spyOn(console, 'error');

    await trackFunnelEvent({ organizationId: orgA, eventName: 'checkout_started' });
    expect(errorLog).not.toHaveBeenCalled();
    const { rows } = await admin.query(
      `SELECT count(*)::int AS n FROM analytics_events WHERE organization_id = $1 AND event_name = 'checkout_started'`,
      [orgA]
    );
    expect(rows[0].n).toBe(1);
  });

  it('getActivationFunnelSummary (transaction-local read of analytics_events) still works on a reset connection', async () => {
    await admin.query(
      `INSERT INTO analytics_events (organization_id, event_name, event_category) VALUES ($1, 'discovery_completed', 'funnel')`,
      [orgA]
    );
    await leaveClearedConnection(mockPools.app!, orgB);

    const summary = await getActivationFunnelSummary();
    const discovery = summary.stages.find((s) => s.event === 'discovery_completed');
    expect(discovery?.organizations).toBeGreaterThanOrEqual(1);
  });

  it('onboardingService.getStatus (session tag on its own client) reads/writes onboarding_progress on a reset connection', async () => {
    await admin.query(
      `INSERT INTO onboarding_progress (organization_id, current_stage) VALUES ($1, 'welcome') ON CONFLICT (organization_id) DO NOTHING`,
      [orgA]
    );
    await leaveClearedConnection(mockPools.app!, orgB);

    const status = await onboardingService.getStatus(orgA, '00000000-0000-0000-0000-000000000000');
    expect(status).toBeDefined();
  });

  /**
   * Registration (auth.service.ts register / organization.service.ts
   * createOrganization) is the one app path that reaches onboarding_progress
   * with NO tenant tag: INSERT INTO organizations fires
   * initialize_onboarding_for_organization(), which inserts the new org's
   * onboarding_progress row under the caller's RLS. As a non-superuser it is
   * rejected in EVERY tag state -- untagged (NULL), stale other-org tag (what
   * a pooled connection carried before this reset existed), and cleared ('')
   * -- only the error code differs. Characterization of a pre-existing
   * condition, so the reset is shown not to change the outcome; fixing it is
   * a separate policy/trigger decision.
   */
  it('registration trigger path: rejected as non-superuser before and after the reset (pre-existing, outcome unchanged)', async () => {
    const insertOrgSql = `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
                          VALUES ('x', $1, 'x', 'free', 'free')`;
    const p = mockPools.app!;

    // NULL: brand-new connection, never tagged.
    const fresh = await p.connect();
    expect((await stateOf(fresh)).tag).toBeNull();
    await expect(fresh.query(insertOrgSql, [`reg-null-${suffix}`])).rejects.toMatchObject({ code: '42501' });
    fresh.release();

    // Stale other-org tag (pre-reset pool behavior).
    const stale = await p.connect();
    await tag(stale, orgB);
    await expect(stale.query(insertOrgSql, [`reg-stale-${suffix}`])).rejects.toMatchObject({ code: '42501' });
    stale.release();

    // Cleared by the reset.
    const cleared = await p.connect();
    expect((await stateOf(cleared)).tag).toBe('');
    await expect(cleared.query(insertOrgSql, [`reg-cleared-${suffix}`])).rejects.toMatchObject({ code: '22P02' });
    cleared.release();
  });

  /**
   * No backend code path inserts an anonymous (organization_id NULL)
   * analytics event -- every insert passes a real org and runs tagged -- but
   * the policy allows one, so this pins down exactly what the reset changes
   * for such an insert if one is ever added outside a tagged context: it
   * would fail on a cleared connection where it succeeds on a never-tagged
   * one. Documents the policy limitation; NULLIF in the policy would lift it.
   */
  it('anonymous analytics insert: allowed on a never-tagged connection, rejected on a cleared one (no app path does this)', async () => {
    const p = mockPools.app!;
    const anon = `INSERT INTO analytics_events (organization_id, event_name) VALUES (NULL, $1)`;

    const fresh = await p.connect();
    try {
      await fresh.query('BEGIN');
      await expect(fresh.query(anon, [`anon-null-${suffix}`])).resolves.toBeDefined();
      await fresh.query('ROLLBACK');
    } finally {
      fresh.release();
    }

    await leaveClearedConnection(p, orgB);
    const cleared = await p.connect();
    try {
      await expect(cleared.query(anon, [`anon-cleared-${suffix}`])).rejects.toMatchObject({ code: '22P02' });
    } finally {
      cleared.release();
    }
  });
});
