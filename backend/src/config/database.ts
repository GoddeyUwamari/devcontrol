import { Pool, PoolClient } from 'pg';
import { AsyncLocalStorage } from 'async_hooks';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Clears app.current_organization_id on a connection that actually carries a
 * non-empty value, and is a no-op otherwise. The WHERE guard matters: once a
 * session has ever set this placeholder GUC it can never read back as NULL
 * again (RESET/'' is the closest), and the onboarding_progress /
 * analytics_events policies cast it with ::uuid, which raises on ''. Leaving
 * never-tagged connections untouched keeps them in the NULL state they have
 * today instead of converting every pooled connection to ''.
 */
const TENANT_TAG_RESET_SQL =
  "SELECT set_config('app.current_organization_id', '', false) " +
  "WHERE COALESCE(current_setting('app.current_organization_id', true), '') <> ''";

const TENANT_TAG_NAME = 'app.current_organization_id';

/**
 * Connections that may carry a tenant tag, keyed by the underlying pg Client
 * (pg-pool reuses the same object across checkouts). Every tag in this
 * codebase is set by client-issued SQL naming the GUC -- no database function
 * sets it server-side -- so watching query text is enough to know whether a
 * release needs the reset round trip. Untagged connections then go back to
 * the pool exactly as pg-pool alone would return them, with no added latency.
 */
type RawQuery = (...args: unknown[]) => unknown;
const mayCarryTenantTag = new WeakMap<PoolClient, { tagged: boolean; query: RawQuery }>();

function queryText(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  const text = (arg as { text?: unknown } | null)?.text;
  return typeof text === 'string' ? text : '';
}

function trackTenantTagging(client: PoolClient) {
  let state = mayCarryTenantTag.get(client);
  if (!state) {
    const query = client.query as unknown as RawQuery;
    const tracked = { tagged: false, query };
    client.query = function (this: PoolClient, ...args: unknown[]) {
      // Conservative: any statement naming the GUC -- set_config, SET, even a
      // read -- marks the connection for reset; a needless reset is harmless.
      if (queryText(args[0]).includes(TENANT_TAG_NAME)) tracked.tagged = true;
      return query.apply(this, args);
    } as unknown as PoolClient['query'];
    mayCarryTenantTag.set(client, tracked);
    state = tracked;
  }
  return state;
}

/**
 * Replaces a checked-out client's release() so the tenant tag is cleared
 * before the connection goes back to the pool: acquire -> (tag) -> use ->
 * reset -> release. release(err) keeps pg-pool's meaning (destroy, no
 * reset), and a connection that never saw tag SQL is released untouched. If
 * the reset itself fails -- e.g. the connection was released inside an
 * aborted transaction, or is broken -- the connection is destroyed via
 * release(err) rather than returned still carrying another org's tag. The
 * actual return to the pool happens once the reset completes, so no other
 * checkout can receive the connection in between.
 */
function resetTenantTagOnRelease(client: PoolClient): void {
  const state = trackTenantTagging(client);
  const releaseToPool = client.release;
  let released = false;
  client.release = ((err?: Error | boolean) => {
    if (released) {
      // Same error pg-pool's own _releaseOnce throws.
      throw new Error('Release called on client which has already been released to the pool.');
    }
    released = true;
    if (err || !state.tagged) {
      releaseToPool(err);
      return;
    }
    (state.query.call(client, TENANT_TAG_RESET_SQL) as Promise<unknown>).then(
      () => {
        state.tagged = false;
        releaseToPool();
      },
      (resetError: Error) => {
        console.error('[DB] Failed to clear tenant tag on release; destroying connection:', resetError.message);
        releaseToPool(resetError);
      }
    );
  }) as PoolClient['release'];
}

/**
 * Installs resetTenantTagOnRelease on every checkout from `target`, for both
 * connect() forms: the promise form used by application code and the
 * callback form pg-pool's own Pool.query() uses internally (it calls
 * this.connect(cb) and then client.release(err)). Exported so tests can
 * apply the same lifecycle to a pool connecting as a non-superuser role.
 */
export function installTenantTagReset(target: Pool): Pool {
  const connectWithoutReset = target.connect.bind(target) as (
    cb?: (err: Error | undefined, client: PoolClient | undefined, done: (release?: Error | boolean) => void) => void
  ) => Promise<PoolClient> | void;

  target.connect = ((callback?: (err: Error | undefined, client: PoolClient | undefined, done: (release?: Error | boolean) => void) => void) => {
    if (callback) {
      return connectWithoutReset((err, client, done) => {
        if (err || !client) {
          callback(err, client, done);
          return;
        }
        resetTenantTagOnRelease(client);
        callback(undefined, client, client.release);
      });
    }
    return (connectWithoutReset() as Promise<PoolClient>).then((client) => {
      resetTenantTagOnRelease(client);
      return client;
    });
  }) as Pool['connect'];

  return target;
}

/**
 * Throws unless `executor`'s connection is tagged for exactly
 * `organizationId`. For background work on RLS-protected tables, where an
 * untagged or differently-tagged connection doesn't error -- it silently
 * returns zero rows. The message deliberately never echoes the tag actually
 * found, which could be another tenant's id.
 */
export async function assertTenantContext(
  executor: Pool | PoolClient,
  organizationId: string
): Promise<void> {
  const { rows } = await executor.query(
    "SELECT current_setting('app.current_organization_id', true) AS organization_id"
  );
  if (rows[0]?.organization_id !== organizationId) {
    throw new Error(`TENANT_CONTEXT_MISSING: database connection is not tagged for organization ${organizationId}`);
  }
}

/**
 * Raised by a request client handle for any use other than `query`, and,
 * after the request's connection has been released, for a statement that is
 * not permitted on a fresh connection (see permittedAfterRelease). The
 * message names no organization and no connection detail; error-handler maps
 * it to a generic 500 like any other unexpected error.
 */
export class RequestContextReleasedError extends Error {
  readonly code = 'REQUEST_CONTEXT_RELEASED';

  constructor() {
    super('Request database context has already been released');
    this.name = 'RequestContextReleasedError';
  }
}

const SET_TENANT_TAG_SQL = "SELECT set_config('app.current_organization_id', $1, false)";

/**
 * After release, the only statements allowed through a request handle are
 * single SELECT / INSERT / UPDATE / DELETE / WITH / VALUES statements that do
 * not touch session state. Everything else -- transaction control, SET,
 * cursors, LISTEN, locks, CALL, DO, temp tables, any unfamiliar statement --
 * is rejected before a connection is checked out. This is a fail-closed
 * filter, not a parser: unusual but harmless SQL may be rejected; session
 * state must never be allowed.
 */
const PERMITTED_AFTER_RELEASE = /^(SELECT|INSERT|UPDATE|DELETE|WITH|VALUES)\b/i;
/** A further statement after a `;` (anything but trailing whitespace). */
const ANOTHER_STATEMENT = /;\s*\S/;
/**
 * Session-scoped functions (also quoted or schema-qualified), SELECT ... INTO
 * TEMP, the pg_settings view (writing it is a session-level SET) and the
 * session's temporary schema (pg_temp, pg_temp_N).
 */
const SESSION_STATE =
  /\b(set_config|pg_advisory_\w+|pg_try_advisory_\w+)"?\s*\(|\bINTO\s+(TEMP|TEMPORARY)\b|\bpg_settings\b|\bpg_temp(_\d+)?\b/i;
const COMMENTS = /--[^\n]*|\/\*[\s\S]*?\*\//g;

/**
 * Text after any leading whitespace and comments, honouring nested block
 * comments as PostgreSQL does. Null for an unterminated block comment.
 */
function afterLeadingComments(text: string): string | null {
  let i = 0;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text.startsWith('--', i)) {
      const lineEnd = text.indexOf('\n', i);
      if (lineEnd === -1) return '';
      i = lineEnd + 1;
    } else if (text.startsWith('/*', i)) {
      let depth = 0;
      do {
        if (text.startsWith('/*', i)) {
          depth += 1;
          i += 2;
        } else if (text.startsWith('*/', i)) {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      } while (depth > 0 && i < text.length);
      if (depth > 0) return null;
    } else {
      return text.slice(i);
    }
  }
}

function permittedAfterRelease(args: unknown[]): boolean {
  const first = args[0] as { submit?: unknown; callback?: unknown } | null;
  // Submittables (cursors, streams) and config-object callbacks hold or
  // address the connection beyond one round trip.
  if (first && typeof first === 'object' && (typeof first.submit === 'function' || typeof first.callback === 'function')) {
    return false;
  }
  const text = queryText(first);
  const statement = afterLeadingComments(text);
  if (!statement || !PERMITTED_AFTER_RELEASE.test(statement) || ANOTHER_STATEMENT.test(statement)) {
    return false;
  }
  // Checked with and without comments, so neither a comment inside the call
  // nor comment-like text inside a string literal hides it.
  return !SESSION_STATE.test(text) && !SESSION_STATE.test(text.replace(COMMENTS, ' '));
}

/**
 * One query, after release, on its own fresh connection: checkout -> tag
 * with the request's verified organization -> query -> release. Fails closed
 * at every step: a checkout or tag failure rejects and nothing runs; a
 * failed tag destroys the connection (release(err)) rather than return one
 * with an uncertain tag; a failed query still releases normally, which
 * clears the tag (installTenantTagReset) before the connection is reused.
 */
async function queryOnFreshConnection(
  source: Pick<Pool, 'connect'>,
  organizationId: string,
  args: unknown[]
): Promise<unknown> {
  if (!permittedAfterRelease(args)) throw new RequestContextReleasedError();
  const client = await source.connect();
  try {
    await client.query(SET_TENANT_TAG_SQL, [organizationId]);
  } catch (tagError) {
    client.release(tagError instanceof Error ? tagError : new Error(String(tagError)));
    throw tagError;
  }
  try {
    return await (client.query as unknown as RawQuery).apply(client, args);
  } finally {
    client.release();
  }
}

/**
 * The requestContext store for a request: a per-checkout handle in front of
 * the request's client, bound to the organization verified for the request.
 * pg-pool hands the same client object to later checkouts, so "released" is
 * recorded on the handle, never on the client.
 *
 * The handle exposes `query` and nothing else: any other client property
 * access, and any assignment, throws (implicit `then` / `toJSON` / symbol
 * lookups read as absent). The client is held only in the closure of that one
 * `query` function, which checks the revoked state on every call -- so even a
 * reference to `handle.query` taken before release follows the rules below.
 *
 * Before `revoke()`: every query runs on the request's own client, exactly as
 * before.
 *
 * After `revoke()` (the request's connection is being released): the
 * released client is never reached again. Each query instead runs on a fresh
 * connection tagged with `organizationId` (queryOnFreshConnection), so late
 * work on behalf of the request -- e.g. recording an external action after
 * the caller disconnected -- still completes under its own organization.
 * Work that needs one session across statements must check out and hold its
 * own client; through the handle it is rejected with
 * RequestContextReleasedError rather than silently split across connections.
 *
 * `organizationId` must be the organization authorized for this request
 * (authenticate's membership-checked claim, or runWithOrgClient's
 * caller-authorized argument) -- never request input, never a default.
 */
export function createRequestClientHandle(
  client: PoolClient,
  organizationId: string,
  source: Pick<Pool, 'connect'> = rawPool
): { handle: PoolClient; revoke: () => void } {
  if (typeof organizationId !== 'string' || organizationId === '') {
    throw new Error('A request client handle requires the verified organization');
  }
  let revoked = false;
  const lateQuery = (...args: unknown[]) => {
    const callback = args[args.length - 1];
    if (typeof callback !== 'function') return queryOnFreshConnection(source, organizationId, args);
    // Callback form: same contract as pg's client.query(text, [values], cb).
    queryOnFreshConnection(source, organizationId, args.slice(0, -1)).then(
      (result) => process.nextTick(callback as (err: Error | null, result?: unknown) => void, null, result),
      (error: Error) => process.nextTick(callback as (err: Error) => void, error)
    );
    return undefined;
  };
  const query = (...args: unknown[]) =>
    revoked ? lateQuery(...args) : (client.query as unknown as RawQuery).apply(client, args);
  const refuse = (): never => {
    throw new RequestContextReleasedError();
  };
  // An empty target: nothing about `client` is reachable through the handle.
  // Lookups the runtime makes implicitly -- `then` (await / Promise.resolve),
  // `toJSON`, symbol keys (inspection, coercion) -- read as absent instead of
  // throwing; every other property throws.
  const handle = new Proxy(Object.create(null) as PoolClient, {
    get: (_target, prop) => {
      if (prop === 'query') return query;
      if (prop === 'then' || prop === 'toJSON' || typeof prop === 'symbol') return undefined;
      return refuse();
    },
    set: refuse,
    defineProperty: refuse,
    deleteProperty: refuse,
  });
  return {
    handle,
    revoke: () => {
      revoked = true;
    },
  };
}

const rawPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  // Every authenticated request now holds one connection for its full duration
  // (see requestContext below) instead of borrowing one per query, so max needs
  // headroom for concurrent in-flight requests, not just concurrent queries.
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Covers runWithOrgClient and every helper that tags a dedicated client with
// set_config(..., false) -- no per-helper cleanup needed.
installTenantTagReset(rawPool);

rawPool.on('error', (err) => {
  console.error('Unexpected database error:', err);
  process.exit(-1);
});

/**
 * Holds the per-request, RLS-context-tagged client set by auth.middleware.ts.
 * See the `pool` Proxy below — it's what makes plain `pool.query(...)` calls
 * throughout the codebase automatically use that connection instead of a
 * fresh/unset one from the pool. Request middleware binds a
 * createRequestClientHandle() handle here, so a query issued after the
 * request's connection is released never reaches that connection.
 */
export const requestContext = new AsyncLocalStorage<import('pg').PoolClient>();

/**
 * Same object as rawPool for everything except `.query()`: when called inside
 * requestContext.run(client, ...) (i.e. during an authenticated request), it
 * delegates to that request's RLS-tagged client instead of transparently
 * borrowing/releasing an arbitrary — and possibly differently-tagged, or
 * untagged — connection from the pool. `pool.connect()` is untouched, so
 * code that checks out and threads its own dedicated client (computeSecurityScore,
 * anomaly-detection job, etc.) is unaffected.
 */
export const pool: Pool = new Proxy(rawPool, {
  get(target, prop, receiver) {
    if (prop === 'query') {
      return (...args: unknown[]) => {
        const client = requestContext.getStore();
        const queryTarget = client ?? target;
        return (queryTarget.query as (...a: unknown[]) => unknown)(...args);
      };
    }
    return Reflect.get(target, prop, receiver);
  },
});

// Test the connection on startup
export const testConnection = async (): Promise<void> => {
  try {
    const client = await pool.connect();
    console.log('✅ Database connected successfully');
    client.release();
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
};
