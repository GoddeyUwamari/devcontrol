/**
 * Request connection lease: once a request's connection is released, it is
 * never reached through the request context again, and request work that
 * queries after that runs on a fresh connection tagged for the organization
 * verified for the request -- never request input, never a default.
 *
 * Part 1 exercises the handle directly with a fake pool, so every checkout,
 * statement and release is counted exactly. Part 2 goes through the real
 * `authenticate` and `runWithOrgClient` against live Postgres and records
 * every checkout the application pool makes.
 */
import express, { NextFunction, Request, Response } from 'express';
import http from 'http';
import util from 'util';
import { EventEmitter } from 'events';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { Pool, PoolClient } from 'pg';
import {
  createRequestClientHandle,
  pool as appPool,
  requestContext,
  RequestContextReleasedError,
} from '../../config/database';
import { authenticate, runWithOrgClient } from '../auth.middleware';
import { leaseRequestClient } from '../request-lifecycle';
import { authService } from '../../services/auth.service';

const TAG_SQL_PATTERN = /set_config\('app\.current_organization_id'/;
const SET_TAG_SQL = "SELECT set_config('app.current_organization_id', $1, false)";

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { opened, open };
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Statements that need one session across statements; all rejected after release. */
const SESSION_BOUND = [
  'BEGIN',
  'begin transaction isolation level serializable',
  'START TRANSACTION',
  'COMMIT',
  'END',
  'ROLLBACK',
  'ABORT',
  'SAVEPOINT s1',
  'RELEASE SAVEPOINT s1',
  'SET statement_timeout = 0',
  "SET LOCAL app.current_organization_id = 'x'",
  'RESET ALL',
  'DISCARD ALL',
  'PREPARE p AS SELECT 1',
  'EXECUTE p',
  'DEALLOCATE p',
  'LISTEN changes',
  'UNLISTEN *',
  'DECLARE c CURSOR FOR SELECT 1',
  'FETCH 1 FROM c',
  'MOVE 1 IN c',
  'CLOSE c',
  'LOCK TABLE organizations',
  'SELECT pg_advisory_lock(42)',
  'SELECT pg_try_advisory_lock(42)',
  'SELECT pg_advisory_unlock_all()',
  "SELECT set_config('app.current_organization_id', 'x', false)",
  'CREATE TEMP TABLE t (id int)',
  'CREATE TEMPORARY TABLE t (id int)',
  '  -- leading comment\n  BEGIN',
  '/* block */ COMMIT',
  'SELECT 1; BEGIN',
  'SELECT 1; /* c */ BEGIN',
  'SELECT 1; SET search_path = x',
  'SELECT 1; -- c\nSET search_path = x',
  'SELECT * INTO TEMP t FROM organizations',
  'SELECT * INTO TEMPORARY TABLE t FROM organizations',
  'CALL some_procedure()',
  'DO $$ BEGIN PERFORM 1; END $$',
  'DO $$ BEGIN PERFORM 1 END $$',
  'SELECT "set_config"(\'a\', \'b\', false)',
  'SELECT "pg_catalog"."set_config"(\'a\', \'b\', false)',
  "SELECT pg_catalog.set_config('a', 'b', false)",
  "SELECT set_config/* c */('a', 'b', false)",
  "SELECT '/*', set_config('a', 'b', false), '*/'",
  'SELECT pg_advisory_xact_lock(1)',
  '/* /* nested */ */ BEGIN',
  '/* /* nested */ SELECT */ BEGIN',
  '/* unterminated BEGIN',
  '-- only a comment',
  '',
  'TRUNCATE organizations',
  'REFRESH MATERIALIZED VIEW mv',
  'EXPLAIN SELECT 1',
];

/** Ordinary single-round-trip statements that must still run after release. */
const SINGLE_STATEMENT = [
  'SELECT 1',
  "SELECT current_setting('app.current_organization_id', true) AS tag",
  'UPDATE organizations SET name = $1 WHERE id = $2',
  'INSERT INTO t (a) VALUES ($1) ON CONFLICT (a) DO UPDATE SET a = EXCLUDED.a',
  "SELECT CASE WHEN true THEN 1 ELSE 0 END AS settled, 'BEGIN' AS label",
  'WITH x AS (SELECT 1) SELECT * FROM x',
  'DELETE FROM t WHERE id = $1',
  "INSERT INTO t (a) VALUES (1) ON CONFLICT (a) DO NOTHING",
  'VALUES (1), (2)',
  'SELECT 1;',
  '-- leading comment\nSELECT 1',
  '/* leading */ UPDATE t SET a = 1',
  '/* /* nested */ still comment */ SELECT 1',
  // Lookalike identifiers, not the pg_settings view or a temporary schema.
  'SELECT pg_temperature FROM sensors',
  'SELECT pg_settings_snapshot FROM audit_config',
];

/**
 * Writes to pg_settings (a session-level SET) and objects in the session's
 * temporary schema; each would leave state on a pooled connection.
 */
const SESSION_OBJECTS = [
  "UPDATE pg_settings\nSET setting = '1234'\nWHERE name = 'statement_timeout'",
  "UPDATE pg_catalog.pg_settings\nSET setting = '1234'\nWHERE name = 'statement_timeout'",
  "WITH x AS (\n  UPDATE pg_settings\n  SET setting = '1234'\n  WHERE name = 'statement_timeout'\n  RETURNING *\n)\nSELECT * FROM x",
  'SELECT 1 INTO pg_temp.test_guard',
  'SELECT 1 INTO "pg_temp".test_guard',
  'INSERT INTO pg_temp.test_guard VALUES (1)',
  // Quoting, case, comments and whitespace around the same names.
  'UPDATE "pg_settings" SET setting = \'1234\' WHERE name = \'statement_timeout\'',
  'UPDATE "pg_catalog"."pg_settings" SET setting = \'1234\' WHERE name = \'statement_timeout\'',
  "UPDATE PG_CATALOG.PG_SETTINGS SET setting = '1234' WHERE name = 'statement_timeout'",
  "UPDATE pg_catalog./* c */pg_settings SET setting = '1234' WHERE name = 'statement_timeout'",
  "/* lead */ -- lead\nUPDATE pg_settings SET setting = '1234' WHERE name = 'search_path'",
  'SELECT 1 INTO pg_temp_3.test_guard',
  'SELECT 1 INTO PG_TEMP.test_guard',
  'INSERT INTO "pg_temp"."test_guard" VALUES (1)',
  'INSERT INTO pg_temp /* c */ . test_guard VALUES (1)',
  'INSERT INTO\n  pg_temp.test_guard VALUES (1)',
  'WITH x AS (INSERT INTO pg_temp.test_guard VALUES (1) RETURNING 1) SELECT * FROM x',
];

// ─── Part 1: the handle and lease, with a fake pool ────────────────────────

type FakeClient = PoolClient & { query: jest.Mock; release: jest.Mock };

function fakeClient(label: string): FakeClient {
  return {
    label,
    query: jest.fn(async () => ({ rows: [{ via: label }] })),
    release: jest.fn(),
  } as unknown as FakeClient;
}

function fakeSource(...clients: FakeClient[]) {
  const queue = [...clients];
  return {
    connect: jest.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('no fake connection left');
      return next;
    }),
  };
}

const ORG_A = randomUUID();

describe('createRequestClientHandle', () => {
  it('before revoke, every query runs on the request client', async () => {
    const original = fakeClient('original');
    const source = fakeSource();
    const { handle } = createRequestClientHandle(original, ORG_A, source as unknown as Pool);
    await expect(handle.query('SELECT 1', [2])).resolves.toEqual({ rows: [{ via: 'original' }] });
    expect(original.query).toHaveBeenCalledWith('SELECT 1', [2]);
    expect(source.connect).not.toHaveBeenCalled();
  });

  it('after revoke, a query runs on a fresh checkout: tag with the verified org, then the query, then release once', async () => {
    const original = fakeClient('original');
    const fresh = fakeClient('fresh');
    const source = fakeSource(fresh);
    const { handle, revoke } = createRequestClientHandle(original, ORG_A, source as unknown as Pool);
    revoke();

    await expect(handle.query('INSERT INTO t VALUES ($1)', [7])).resolves.toEqual({ rows: [{ via: 'fresh' }] });
    expect(original.query).not.toHaveBeenCalled();
    expect(source.connect).toHaveBeenCalledTimes(1);
    expect(fresh.query.mock.calls).toEqual([
      [SET_TAG_SQL, [ORG_A]],
      ['INSERT INTO t VALUES ($1)', [7]],
    ]);
    expect(fresh.release).toHaveBeenCalledTimes(1);
    expect(fresh.release).toHaveBeenCalledWith();
    expect(fresh.query.mock.invocationCallOrder[1]).toBeLessThan(fresh.release.mock.invocationCallOrder[0]);
  });

  it.each([['before'], ['after']])('%s revoke, nothing but query is reachable on the handle', (when) => {
    const original = fakeClient('original');
    const { handle, revoke } = createRequestClientHandle(original, ORG_A, fakeSource() as unknown as Pool);
    if (when === 'after') revoke();
    expect(() => handle.release()).toThrow(RequestContextReleasedError);
    expect(() => (handle as any).processID).toThrow(RequestContextReleasedError);
    expect(() => { (handle as any).query = jest.fn(); }).toThrow(RequestContextReleasedError);
    expect(() => Object.defineProperty(handle, 'x', { value: 1 })).toThrow(RequestContextReleasedError);
    expect(() => delete (handle as any).query).toThrow(RequestContextReleasedError);
    expect(Object.getOwnPropertyDescriptor(handle, 'release')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(handle, 'query')).toBeUndefined();
    expect(Object.getPrototypeOf(handle)).toBeNull();
    expect(original.release).not.toHaveBeenCalled();
  });

  it.each([['before'], ['after']])('%s revoke, implicit lookups read as absent: await, JSON, inspection and coercion do not throw or expose the client', async (when) => {
    const original = fakeClient('original');
    (original as any).secret = 'client-internal-value';
    const { handle, revoke } = createRequestClientHandle(original, ORG_A, fakeSource() as unknown as Pool);
    if (when === 'after') revoke();

    expect((handle as any).then).toBeUndefined();
    expect((handle as any).toJSON).toBeUndefined();
    expect((handle as any)[Symbol.toPrimitive]).toBeUndefined();
    expect((handle as any)[Symbol.toStringTag]).toBeUndefined();
    expect((handle as any)[util.inspect.custom]).toBeUndefined();
    expect((handle as any)[Symbol.iterator]).toBeUndefined();

    await expect(Promise.resolve(handle)).resolves.toBe(handle);
    const awaited = await (async () => handle)();
    expect(awaited).toBe(handle);

    const json = JSON.stringify(handle);
    const inspected = util.inspect(handle, { depth: 5 });
    const logged: string[] = [];
    const log = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(util.format(...args));
    });
    try {
      console.log(handle);
      console.log('%o', handle);
    } finally {
      log.mockRestore();
    }
    expect(() => String(Object.prototype.toString.call(handle))).not.toThrow();
    for (const text of [json, inspected, ...logged]) {
      expect(text).not.toMatch(/client-internal-value|original|release|query/);
    }
    expect(json).toBe('{}');

    // Real client properties still throw.
    for (const prop of ['release', 'on', 'escapeLiteral', 'escapeIdentifier', 'connection', 'processID', 'secret']) {
      expect(() => (handle as any)[prop]).toThrow(RequestContextReleasedError);
    }
  });

  it('a query function captured before release goes to a fresh tagged checkout after release, never the released client', async () => {
    const original = fakeClient('original');
    const fresh = fakeClient('fresh');
    const source = fakeSource(fresh);
    const { handle, revoke } = createRequestClientHandle(original, ORG_A, source as unknown as Pool);
    const query = handle.query;
    await expect(query('SELECT before_release')).resolves.toEqual({ rows: [{ via: 'original' }] });

    revoke();
    await expect(query('SELECT after_release')).resolves.toEqual({ rows: [{ via: 'fresh' }] });
    expect(original.query.mock.calls).toEqual([['SELECT before_release']]);
    expect(source.connect).toHaveBeenCalledTimes(1);
    expect(fresh.query.mock.calls).toEqual([[SET_TAG_SQL, [ORG_A]], ['SELECT after_release']]);
    expect(fresh.release).toHaveBeenCalledTimes(1);
  });

  it('a checkout failure rejects with that error and runs nothing', async () => {
    const original = fakeClient('original');
    const checkoutError = new Error('pool exhausted');
    const source = { connect: jest.fn(async () => { throw checkoutError; }) };
    const { handle, revoke } = createRequestClientHandle(original, ORG_A, source as unknown as Pool);
    revoke();
    await expect(handle.query('INSERT INTO t VALUES (1)')).rejects.toBe(checkoutError);
    expect(original.query).not.toHaveBeenCalled();
  });

  it('a tag failure rejects, never runs the query, and destroys the fresh connection (release(err), once)', async () => {
    const original = fakeClient('original');
    const fresh = fakeClient('fresh');
    const tagError = new Error('tag failed');
    fresh.query.mockImplementationOnce(async () => { throw tagError; });
    const { handle, revoke } = createRequestClientHandle(original, ORG_A, fakeSource(fresh) as unknown as Pool);
    revoke();
    await expect(handle.query('INSERT INTO t VALUES (1)')).rejects.toBe(tagError);
    expect(fresh.query).toHaveBeenCalledTimes(1);
    expect(fresh.release).toHaveBeenCalledTimes(1);
    expect(fresh.release).toHaveBeenCalledWith(tagError);
    expect(original.query).not.toHaveBeenCalled();
  });

  it('a query failure propagates the original error and still releases the fresh connection once (normal release, so the tag is reset)', async () => {
    const original = fakeClient('original');
    const fresh = fakeClient('fresh');
    const queryError = new Error('duplicate key');
    fresh.query.mockImplementation(async (text: string) => {
      if (TAG_SQL_PATTERN.test(text)) return { rows: [] };
      throw queryError;
    });
    const { handle, revoke } = createRequestClientHandle(original, ORG_A, fakeSource(fresh) as unknown as Pool);
    revoke();
    await expect(handle.query('INSERT INTO t VALUES (1)')).rejects.toBe(queryError);
    expect(fresh.release).toHaveBeenCalledTimes(1);
    expect(fresh.release).toHaveBeenCalledWith();
  });

  it('callback form after revoke: (null, result) on success, (err) on failure, returns undefined', async () => {
    const original = fakeClient('original');
    const fresh1 = fakeClient('fresh1');
    const fresh2 = fakeClient('fresh2');
    const queryError = new Error('bad');
    fresh2.query.mockImplementation(async (text: string) => {
      if (TAG_SQL_PATTERN.test(text)) return { rows: [] };
      throw queryError;
    });
    const { handle, revoke } = createRequestClientHandle(original, ORG_A, fakeSource(fresh1, fresh2) as unknown as Pool);
    revoke();
    const query = handle.query as unknown as (...args: unknown[]) => unknown;

    const ok = await new Promise<unknown[]>((resolve) => {
      expect(query('SELECT $1', [1], (...cbArgs: unknown[]) => resolve(cbArgs))).toBeUndefined();
    });
    expect(ok).toEqual([null, { rows: [{ via: 'fresh1' }] }]);
    expect(fresh1.query.mock.calls[1]).toEqual(['SELECT $1', [1]]);

    const failed = await new Promise<unknown[]>((resolve) => {
      query('SELECT 2', (...cbArgs: unknown[]) => resolve(cbArgs));
    });
    expect(failed).toEqual([queryError]);
    expect(fresh1.release).toHaveBeenCalledTimes(1);
    expect(fresh2.release).toHaveBeenCalledTimes(1);
  });

  it.each(SESSION_BOUND)('after revoke, a session-bound statement is rejected without any checkout: %s', async (sql) => {
    const original = fakeClient('original');
    const source = fakeSource(fakeClient('fresh'));
    const { handle, revoke } = createRequestClientHandle(original, ORG_A, source as unknown as Pool);
    revoke();
    await expect(handle.query(sql)).rejects.toBeInstanceOf(RequestContextReleasedError);
    await expect(handle.query({ text: sql, values: [] })).rejects.toBeInstanceOf(RequestContextReleasedError);
    expect(source.connect).not.toHaveBeenCalled();
    expect(original.query).not.toHaveBeenCalled();
  });

  it.each(SESSION_OBJECTS)('after revoke, pg_settings / temporary-schema SQL is rejected with no checkout and no query: %s', async (sql) => {
    const original = fakeClient('original');
    const fresh = fakeClient('fresh');
    const source = fakeSource(fresh);
    const { handle, revoke } = createRequestClientHandle(original, ORG_A, source as unknown as Pool);
    revoke();
    await expect(handle.query(sql)).rejects.toBeInstanceOf(RequestContextReleasedError);
    await expect(handle.query(sql, [])).rejects.toBeInstanceOf(RequestContextReleasedError);
    await expect(handle.query({ text: sql, values: [] })).rejects.toBeInstanceOf(RequestContextReleasedError);
    expect(source.connect).not.toHaveBeenCalled();
    expect(fresh.query).not.toHaveBeenCalled();
    expect(original.query).not.toHaveBeenCalled();
  });

  it('after revoke, submittables (cursors/streams) and config-object callbacks are rejected without any checkout', async () => {
    const original = fakeClient('original');
    const source = fakeSource(fakeClient('fresh'));
    const { handle, revoke } = createRequestClientHandle(original, ORG_A, source as unknown as Pool);
    revoke();
    const query = handle.query as unknown as (...args: unknown[]) => Promise<unknown>;
    await expect(query({ text: 'SELECT 1', submit: () => {} })).rejects.toBeInstanceOf(RequestContextReleasedError);
    await expect(query({ text: 'SELECT 1', callback: () => {} })).rejects.toBeInstanceOf(RequestContextReleasedError);
    expect(source.connect).not.toHaveBeenCalled();
  });

  it.each(SINGLE_STATEMENT)('after revoke, an ordinary statement still runs on a fresh connection: %s', async (sql) => {
    const fresh = fakeClient('fresh');
    const { handle, revoke } = createRequestClientHandle(fakeClient('original'), ORG_A, fakeSource(fresh) as unknown as Pool);
    revoke();
    await expect(handle.query(sql)).resolves.toEqual({ rows: [{ via: 'fresh' }] });
    expect(fresh.query.mock.calls[1][0]).toBe(sql);
  });

  it('two concurrent late queries use independent checkouts, each released once', async () => {
    const fresh1 = fakeClient('fresh1');
    const fresh2 = fakeClient('fresh2');
    const source = fakeSource(fresh1, fresh2);
    const { handle, revoke } = createRequestClientHandle(fakeClient('original'), ORG_A, source as unknown as Pool);
    revoke();
    const results = await Promise.all([handle.query('SELECT 1'), handle.query('SELECT 2')]);
    expect(results.map((r: any) => r.rows[0].via).sort()).toEqual(['fresh1', 'fresh2']);
    expect(source.connect).toHaveBeenCalledTimes(2);
    for (const fresh of [fresh1, fresh2]) {
      expect(fresh.query.mock.calls[0]).toEqual([SET_TAG_SQL, [ORG_A]]);
      expect(fresh.release).toHaveBeenCalledTimes(1);
    }
  });

  it.each([[''], [undefined], [null]])('there is no default organization: %p is refused at creation', (org) => {
    expect(() => createRequestClientHandle(fakeClient('original'), org as unknown as string)).toThrow(
      'A request client handle requires the verified organization'
    );
  });
});

describe('leaseRequestClient', () => {
  function fakeResponse() {
    return new EventEmitter() as unknown as Response;
  }

  it('finish and close release the client exactly once, revoking the handle first', async () => {
    const original = fakeClient('original');
    const res = fakeResponse();
    const lease = leaseRequestClient(original, res);
    const handle = lease.bindVerifiedOrganization(ORG_A);
    const fresh = fakeClient('fresh');
    const connectSpy = jest.spyOn(appPool, 'connect').mockImplementation((async () => fresh) as unknown as typeof appPool.connect);
    // A query issued from inside client.release() shows whether the handle
    // was already revoked when the client was handed back.
    let queryDuringRelease: Promise<unknown> | null = null;
    original.release.mockImplementation(() => {
      queryDuringRelease = handle.query('SELECT during_release') as unknown as Promise<unknown>;
    });
    try {
      (res as unknown as EventEmitter).emit('finish');
      (res as unknown as EventEmitter).emit('close');
      lease.release();
      await expect(queryDuringRelease).resolves.toEqual({ rows: [{ via: 'fresh' }] });
      expect(original.query).not.toHaveBeenCalled();
      expect(original.release).toHaveBeenCalledTimes(1);
      expect(original.release).toHaveBeenCalledWith(undefined);
      expect(lease.released).toBe(true);
    } finally {
      connectSpy.mockRestore();
    }
  });

  it('release(err) passes the error through (connection destroyed), once', () => {
    const original = fakeClient('original');
    const lease = leaseRequestClient(original, fakeResponse());
    const err = new Error('lookup failed');
    lease.release(err);
    lease.release();
    expect(original.release).toHaveBeenCalledTimes(1);
    expect(original.release).toHaveBeenCalledWith(err);
  });

  it('binding after release yields an already-revoked handle that never reaches the released client', async () => {
    const original = fakeClient('original');
    const res = fakeResponse();
    const lease = leaseRequestClient(original, res);
    (res as unknown as EventEmitter).emit('close');
    const handle = lease.bindVerifiedOrganization(ORG_A);
    // The default source is the application pool: point it at a fake.
    const fresh = fakeClient('fresh');
    const connectSpy = jest.spyOn(appPool, 'connect').mockImplementation((async () => fresh) as unknown as typeof appPool.connect);
    try {
      await expect(handle.query('SELECT 1')).resolves.toEqual({ rows: [{ via: 'fresh' }] });
      expect(original.query).not.toHaveBeenCalled();
      expect(fresh.query.mock.calls[0]).toEqual([SET_TAG_SQL, [ORG_A]]);
    } finally {
      connectSpy.mockRestore();
    }
  });

  it('a lease binds one organization only', () => {
    const lease = leaseRequestClient(fakeClient('original'), fakeResponse());
    lease.bindVerifiedOrganization(ORG_A);
    expect(() => lease.bindVerifiedOrganization(randomUUID())).toThrow('already bound');
  });
});

// ─── Part 2: real authenticate / runWithOrgClient, live Postgres ───────────

describe('live Postgres: released request connections and late queries', () => {
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
  const jwtSecret: string = (authService as any).jwtSecret;
  const createdOrgIds: string[] = [];
  const createdUserIds: string[] = [];
  const WEBHOOK_ORG = randomUUID();
  const PROBE_SQL = "SELECT current_setting('app.current_organization_id', true) AS tag, pg_backend_pid() AS pid";

  type Checkout = { client: PoolClient; statements: Array<{ text: string; params: unknown }>; releases: unknown[] };
  let checkouts: Checkout[];
  let connectAttempts: number;
  let failCheckoutAttempt: number | null;
  let failTagOnCheckout: number | null;
  let delayTagResult: Promise<void> | null;
  let realConnect: () => Promise<PoolClient>;

  let server: http.Server;
  let url: string;
  let handlerGate: ReturnType<typeof gate>;
  let lateWork: (req: Request) => Promise<unknown>;
  let lateOutcome: Promise<{ value?: any; error?: any }>;
  let reportOutcome: (outcome: { value?: any; error?: any }) => void;
  let beforeReleaseResult: any;
  let webhookCallbackRan: boolean;

  function runLate(req: Request) {
    lateWork(req).then((value) => reportOutcome({ value }), (error) => reportOutcome({ error }));
  }

  async function member(): Promise<{ orgId: string; token: string }> {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const org = await admin.query(
      `INSERT INTO organizations (name, slug, display_name, subscription_tier, max_services, max_users)
       VALUES ($1, $2, $3, 'pro', 10, 20) RETURNING id`,
      [`Lease ${suffix}`, `lease-${suffix}`, `Lease ${suffix}`]
    );
    const orgId = org.rows[0].id as string;
    createdOrgIds.push(orgId);
    const user = await admin.query(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, 'Lease User') RETURNING id`,
      [`lease-${suffix}@example.com`, await bcrypt.hash('Sup3rSecret!1', 4)]
    );
    const userId = user.rows[0].id as string;
    createdUserIds.push(userId);
    await admin.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
       VALUES ($1, $2, 'member', NOW(), true)`,
      [orgId, userId]
    );
    const token = jwt.sign(
      { userId, email: 'claimed@example.com', organizationId: orgId, role: 'member', type: 'access' },
      jwtSecret,
      { expiresIn: '1h', jwtid: randomUUID() }
    );
    return { orgId, token };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const isIdle = (client: PoolClient) =>
    ((appPool as any)._idle as Array<{ client: PoolClient }>).some((item) => item.client === client);
  const fresh = () => checkouts.slice(1);

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.get('/before', authenticate, async (_req, res) => {
      beforeReleaseResult = (await appPool.query(PROBE_SQL)).rows[0];
      res.json({ ok: true });
    });
    // Responds, then does more database work: `finish` releases the connection first.
    app.post('/late', authenticate, async (req, res) => {
      res.json({ ok: true });
      await handlerGate.opened;
      runLate(req);
    });
    // Takes a reference to the request handle's query before responding.
    app.post('/late-captured', authenticate, async (req, res) => {
      const captured = requestContext.getStore()!.query as unknown as (text: string) => Promise<unknown>;
      lateWork = () => captured(PROBE_SQL);
      res.json({ ok: true });
      await handlerGate.opened;
      runLate(req);
    });
    // Tries to steer the late query's organization through mutable request state and input.
    app.post('/late-mutated', authenticate, async (req, res) => {
      req.organizationId = req.body.organizationId;
      req.user!.organizationId = req.body.organizationId;
      res.json({ ok: true });
      await handlerGate.opened;
      runLate(req);
    });
    // Never responds before the caller disconnects: `close` releases the connection.
    app.get('/late-close', authenticate, async (req) => {
      await handlerGate.opened;
      runLate(req);
    });
    app.post('/webhook', async (req, res) => {
      await runWithOrgClient(WEBHOOK_ORG, res, (async () => {
        webhookCallbackRan = true;
        runLate(req);
        res.json({ ok: true });
      }) as unknown as NextFunction);
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  beforeEach(() => {
    checkouts = [];
    connectAttempts = 0;
    failCheckoutAttempt = null;
    failTagOnCheckout = null;
    delayTagResult = null;
    handlerGate = gate();
    beforeReleaseResult = null;
    webhookCallbackRan = false;
    lateOutcome = new Promise((resolve) => { reportOutcome = resolve; });
    realConnect = appPool.connect.bind(appPool) as () => Promise<PoolClient>;
    jest.spyOn(appPool, 'connect').mockImplementation((async () => {
      const attempt = connectAttempts++;
      if (attempt === failCheckoutAttempt) throw new Error('simulated checkout failure');
      const client = await realConnect();
      const index = checkouts.length;
      const record: Checkout = { client, statements: [], releases: [] };
      checkouts.push(record);
      const clientQuery = client.query;
      const clientRelease = client.release;
      client.query = ((q: unknown, ...rest: unknown[]) => {
        const text = typeof q === 'string' ? q : (q as { text?: string }).text ?? String(q);
        record.statements.push({ text, params: rest[0] });
        if (index === failTagOnCheckout && TAG_SQL_PATTERN.test(text)) {
          return Promise.reject(new Error('simulated tag failure'));
        }
        const result = (clientQuery as (...args: unknown[]) => Promise<unknown>).call(client, q, ...rest);
        if (index === 0 && delayTagResult && TAG_SQL_PATTERN.test(text)) {
          // Slow round trip: the statement is sent now, its result arrives later.
          const delay = delayTagResult;
          return result.then(async (value) => { await delay; return value; });
        }
        return result;
      }) as typeof client.query;
      client.release = ((err?: Error | boolean) => {
        client.query = clientQuery;
        client.release = clientRelease;
        record.releases.push(err);
        return clientRelease.call(client, err);
      }) as typeof client.release;
      return client;
    }) as unknown as typeof appPool.connect);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await admin.query('DELETE FROM api_usage WHERE organization_id = ANY($1)', [createdOrgIds]);
    await admin.query('DELETE FROM organization_memberships WHERE organization_id = ANY($1)', [createdOrgIds]);
    await admin.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
    await admin.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
    await admin.end();
    await appPool.end();
  });

  async function respondThenRelease(path: string, token: string, body: unknown = {}) {
    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { ...auth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    await res.text();
    await waitFor(() => checkouts[0]?.releases.length === 1, 'request connection release');
  }

  it('before release, request queries run on the request connection, tagged for its organization', async () => {
    const { orgId, token } = await member();
    const res = await fetch(`${url}/before`, { headers: auth(token) });
    expect(res.status).toBe(200);
    await waitFor(() => checkouts[0]?.releases.length === 1, 'release');
    expect(beforeReleaseResult.tag).toBe(orgId);
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0].statements.some((s) => s.text === PROBE_SQL)).toBe(true);
  });

  it('after finish: the late query runs on a fresh checkout tagged with the verified org, released once; the released checkout gets nothing', async () => {
    const { orgId, token } = await member();
    lateWork = () => appPool.query(PROBE_SQL);
    await respondThenRelease('/late', token);
    const releasedStatements = checkouts[0].statements.length;

    handlerGate.open();
    const outcome = await lateOutcome;
    expect(outcome.error).toBeUndefined();
    expect(outcome.value.rows[0].tag).toBe(orgId);
    await waitFor(() => fresh()[0]?.releases.length === 1, 'fresh release');

    expect(checkouts).toHaveLength(2);
    expect(checkouts[0].statements).toHaveLength(releasedStatements);
    expect(checkouts[0].releases).toEqual([undefined]);
    expect(fresh()[0].statements.map((s) => s.text)).toEqual([SET_TAG_SQL, PROBE_SQL]);
    expect(fresh()[0].statements[0].params).toEqual([orgId]);
    expect(fresh()[0].releases).toEqual([undefined]);
  });

  it('the released connection, now held by another organization, is never touched by the late query', async () => {
    const { orgId, token } = await member();
    const otherOrgId = randomUUID();
    lateWork = () => appPool.query(PROBE_SQL);
    await respondThenRelease('/late', token);
    const released = checkouts[0].client;

    await waitFor(() => isIdle(released), 'released connection back in the pool');
    const other = await realConnect();
    try {
      expect(other).toBe(released);
      await other.query(SET_TAG_SQL, [otherOrgId]);
      const otherPid = (await other.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const otherQuery = jest.spyOn(other, 'query');

      handlerGate.open();
      const outcome = await lateOutcome;
      expect(outcome.value.rows[0].tag).toBe(orgId);
      expect(outcome.value.rows[0].pid).not.toBe(otherPid);
      expect(otherQuery).not.toHaveBeenCalled();
      otherQuery.mockRestore();
      expect((await other.query(PROBE_SQL)).rows[0].tag).toBe(otherOrgId);
    } finally {
      await other.query("SELECT set_config('app.current_organization_id', '', false)");
      other.release();
    }
  });

  it('after close (caller disconnected): the late query runs on a fresh checkout tagged with the verified org', async () => {
    const { orgId, token } = await member();
    lateWork = () => appPool.query(PROBE_SQL);
    const abort = new AbortController();
    const request = fetch(`${url}/late-close`, { headers: auth(token), signal: abort.signal }).catch(() => 'aborted');
    await waitFor(() => checkouts[0]?.statements.some((s) => TAG_SQL_PATTERN.test(s.text)) ?? false, 'request tagged');
    await new Promise((resolve) => setTimeout(resolve, 20));
    abort.abort();
    expect(await request).toBe('aborted');
    await waitFor(() => checkouts[0].releases.length === 1, 'release on close');

    handlerGate.open();
    const outcome = await lateOutcome;
    expect(outcome.value.rows[0].tag).toBe(orgId);
    await waitFor(() => fresh()[0]?.releases.length === 1, 'fresh release');
    expect(fresh()[0].statements[0].params).toEqual([orgId]);
  });

  it('a late write succeeds after release (consistency), under the verified org', async () => {
    const { orgId, token } = await member();
    const hour = '2001-01-01T00:00:00Z';
    lateWork = () => appPool.query(
      `INSERT INTO api_usage (organization_id, hour, request_count)
       VALUES (current_setting('app.current_organization_id')::uuid, $1, 1) RETURNING organization_id`,
      [hour]
    );
    await respondThenRelease('/late', token);
    handlerGate.open();
    const outcome = await lateOutcome;
    expect(outcome.error).toBeUndefined();
    expect(outcome.value.rows[0].organization_id).toBe(orgId);
    const { rows } = await admin.query(
      'SELECT organization_id FROM api_usage WHERE organization_id = $1 AND hour = $2',
      [orgId, hour]
    );
    expect(rows).toHaveLength(1);
  });

  it('a query reference captured from the request handle before release runs on a fresh tagged checkout after release', async () => {
    const { orgId, token } = await member();
    await respondThenRelease('/late-captured', token);
    const releasedStatements = checkouts[0].statements.length;
    handlerGate.open();
    const outcome = await lateOutcome;
    expect(outcome.error).toBeUndefined();
    expect(outcome.value.rows[0].tag).toBe(orgId);
    await waitFor(() => fresh()[0]?.releases.length === 1, 'fresh release');
    expect(checkouts[0].statements).toHaveLength(releasedStatements);
    expect(fresh()[0].statements.map((s) => s.text)).toEqual([SET_TAG_SQL, PROBE_SQL]);
    expect(fresh()[0].statements[0].params).toEqual([orgId]);
  });

  it('mutating req.organizationId / req.user and sending an organization in the body cannot change the late-query organization', async () => {
    const { orgId, token } = await member();
    const { orgId: foreignOrgId } = await member();
    let seenReqOrg: string | undefined;
    lateWork = (req) => {
      seenReqOrg = req.organizationId;
      return appPool.query(PROBE_SQL);
    };
    await respondThenRelease('/late-mutated', token, { organizationId: foreignOrgId });
    handlerGate.open();
    const outcome = await lateOutcome;
    expect(seenReqOrg).toBe(foreignOrgId);
    expect(outcome.value.rows[0].tag).toBe(orgId);
    await waitFor(() => fresh()[0]?.releases.length === 1, 'fresh release');
    expect(fresh()[0].statements[0].params).toEqual([orgId]);
  });

  it('checkout failure for a late query fails closed: rejected, nothing runs anywhere', async () => {
    const { token } = await member();
    lateWork = () => appPool.query(PROBE_SQL);
    failCheckoutAttempt = 1;
    await respondThenRelease('/late', token);
    const releasedStatements = checkouts[0].statements.length;
    handlerGate.open();
    const outcome = await lateOutcome;
    expect(outcome.error?.message).toBe('simulated checkout failure');
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0].statements).toHaveLength(releasedStatements);
  });

  it('tag failure for a late query fails closed: the query never runs and the connection is destroyed, once', async () => {
    const { token } = await member();
    lateWork = () => appPool.query(PROBE_SQL);
    failTagOnCheckout = 1;
    await respondThenRelease('/late', token);
    handlerGate.open();
    const outcome = await lateOutcome;
    expect(outcome.error?.message).toBe('simulated tag failure');
    await waitFor(() => fresh()[0]?.releases.length === 1, 'fresh release');
    expect(fresh()[0].statements.map((s) => s.text)).toEqual([SET_TAG_SQL]);
    expect(fresh()[0].releases).toHaveLength(1);
    expect(fresh()[0].releases[0]).toBeInstanceOf(Error);
  });

  it('a failing late query propagates its error, releases once, and leaves no tenant tag on the pooled connection', async () => {
    const { token } = await member();
    lateWork = () => appPool.query('SELECT * FROM no_such_table_for_lease_test');
    await respondThenRelease('/late', token);
    handlerGate.open();
    const outcome = await lateOutcome;
    expect(outcome.error?.code).toBe('42P01');
    await waitFor(() => fresh()[0]?.releases.length === 1, 'fresh release');
    expect(fresh()[0].releases).toEqual([undefined]);

    const used = fresh()[0].client;
    await waitFor(() => isIdle(used), 'fresh connection back in the pool');
    const again = await realConnect();
    try {
      expect(again).toBe(used);
      expect((await again.query(PROBE_SQL)).rows[0].tag).toBe('');
    } finally {
      again.release();
    }
  });

  it.each([
    'BEGIN',
    'COMMIT',
    'ROLLBACK',
    'SET search_path = public',
    'SELECT pg_advisory_lock(7)',
    'LISTEN lease_test',
    'CALL some_procedure()',
    'SELECT 1 INTO TEMP lease_test_tmp',
    'SELECT 1; SET search_path = public',
  ])(
    'session-bound statement after release is rejected with no checkout: %s',
    async (sql) => {
      const { token } = await member();
      lateWork = () => appPool.query(sql);
      await respondThenRelease('/late', token);
      handlerGate.open();
      const outcome = await lateOutcome;
      expect(outcome.error).toBeInstanceOf(RequestContextReleasedError);
      expect(outcome.error.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
      expect(checkouts).toHaveLength(1);
    }
  );

  it('two concurrent late queries use independent checkouts, both tagged with the verified org, each released once', async () => {
    const { orgId, token } = await member();
    const probe = `SELECT pg_sleep(0.05), ${PROBE_SQL.replace('SELECT ', '')}`;
    lateWork = () => Promise.all([appPool.query(probe), appPool.query(probe)]);
    await respondThenRelease('/late', token);
    handlerGate.open();
    const outcome = await lateOutcome;
    const rows = (outcome.value as Array<{ rows: any[] }>).map((r) => r.rows[0]);
    expect(rows.map((r) => r.tag)).toEqual([orgId, orgId]);
    expect(rows[0].pid).not.toBe(rows[1].pid);
    await waitFor(() => fresh().length === 2 && fresh().every((c) => c.releases.length === 1), 'both released');
    expect(fresh()[0].client).not.toBe(fresh()[1].client);
    fresh().forEach((c) => expect(c.statements[0].params).toEqual([orgId]));
  });

  it('runWithOrgClient: a disconnect while tagging means the callback never touches the original connection; its query uses a fresh, correctly tagged one', async () => {
    const tagGate = gate();
    delayTagResult = tagGate.opened;
    lateWork = () => appPool.query(PROBE_SQL);
    const abort = new AbortController();
    const request = fetch(`${url}/webhook`, { method: 'POST', signal: abort.signal }).catch(() => 'aborted');
    await waitFor(() => checkouts[0]?.statements.some((s) => TAG_SQL_PATTERN.test(s.text)) ?? false, 'tag sent');
    abort.abort();
    expect(await request).toBe('aborted');
    await waitFor(() => checkouts[0].releases.length === 1, 'release on close');
    const originalStatements = checkouts[0].statements.length;

    tagGate.open();
    const outcome = await lateOutcome;
    expect(webhookCallbackRan).toBe(true);
    expect(outcome.value.rows[0].tag).toBe(WEBHOOK_ORG);
    expect(checkouts[0].statements).toHaveLength(originalStatements);
    await waitFor(() => fresh()[0]?.releases.length === 1, 'fresh release');
    expect(fresh()[0].statements[0].params).toEqual([WEBHOOK_ORG]);
  });

  it('runWithOrgClient: without a disconnect, the callback runs on the original tagged connection', async () => {
    lateWork = () => appPool.query(PROBE_SQL);
    const res = await fetch(`${url}/webhook`, { method: 'POST' });
    expect(res.status).toBe(200);
    const outcome = await lateOutcome;
    expect(outcome.value.rows[0].tag).toBe(WEBHOOK_ORG);
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0].statements.map((s) => s.text)).toContain(PROBE_SQL);
  });
});
