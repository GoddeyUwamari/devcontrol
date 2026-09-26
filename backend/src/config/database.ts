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
 * fresh/unset one from the pool.
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
