import { Pool } from 'pg';
import { AsyncLocalStorage } from 'async_hooks';
import dotenv from 'dotenv';

dotenv.config();

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
