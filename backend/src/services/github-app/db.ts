import { Pool, PoolClient } from 'pg';
import { pool } from '../../config/database';

/**
 * Where GitHub App code gets connections. Production: the application pool
 * (connect() goes to the real pool, whose release clears the tenant tag).
 * Tests pass a pool that connects as the real devcontrol role.
 */
export type ConnectionSource = Pick<Pool, 'connect'>;
export const defaultSource: ConnectionSource = pool;

const SET_TENANT_TAG_SQL = "SELECT set_config('app.current_organization_id', $1, false)";

/**
 * A dedicated connection tagged for `organizationId` (the RLS-gated
 * repository pattern). Every statement run on it still names the
 * organization explicitly.
 */
export async function withOrgClient<T>(
  source: ConnectionSource,
  organizationId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await source.connect();
  try {
    await client.query(SET_TENANT_TAG_SQL, [organizationId]);
    return await fn(client);
  } finally {
    client.release();
  }
}

/** withOrgClient inside BEGIN/COMMIT; any error rolls back and is rethrown. */
export async function withOrgTransaction<T>(
  source: ConnectionSource,
  organizationId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  return withOrgClient(source, organizationId, async (client) => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });
}

/** An untagged dedicated connection, for the SECURITY DEFINER functions only. */
export async function withUntaggedClient<T>(source: ConnectionSource, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await source.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
