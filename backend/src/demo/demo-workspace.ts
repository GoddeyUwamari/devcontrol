/**
 * The demo organization in scheduled jobs and platform metrics (demo
 * workspace PR-1a).
 *
 * The demo is one ordinary organization row with organizations.is_demo = true
 * (admin migration 202611141200_demo_workspace_foundation). Background jobs
 * and platform-wide aggregates must never act on it or count it: no AWS
 * calls, emails, reports, snapshots or detections for it, and no sample data
 * in admin metrics. Every org-selecting job and aggregate uses THIS module,
 * and backend/src/__tests__/job-demo-exclusion.static.test.ts fails when a
 * scheduled job neither does nor is a reviewed exception.
 *
 * Scope is deliberately narrow: job and metric eligibility only. It is not an
 * authorization framework. Request handling, tenant predicates and row level
 * security are unchanged by it. The source of truth is the database row only;
 * nothing here accepts a client, token or request value as the answer.
 *
 * Both forms fail closed: before the migration is applied, a query using the
 * predicates errors (unknown column) instead of silently including the demo,
 * and isDemoOrganization() throws rather than answering "not demo" when it
 * cannot read the row.
 */
import type { Pool, PoolClient } from 'pg';

/**
 * SQL predicate that excludes the demo organization from a query that reads
 * `organizations` under the alias `o`:
 *
 *   SELECT o.id FROM organizations o WHERE o.is_active = true AND ${DEMO_EXCLUSION_SQL}
 */
export const DEMO_EXCLUSION_SQL = 'o.is_demo = false';

/** A column reference: `column` or `table.column`, plain lowercase identifiers only. */
const COLUMN_REFERENCE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

/**
 * SQL predicate that excludes rows belonging to the demo organization, for a
 * query on a table keyed by an organization id column (not `organizations`
 * itself; use DEMO_EXCLUSION_SQL there). A NULL organization id (platform
 * rows such as Prometheus alerts) is kept.
 *
 * `organizationIdColumn` is interpolated into SQL, so it must be a literal
 * column reference written in code: anything but `column` or `table.column`
 * throws.
 */
export function excludeDemoOrganizationSql(organizationIdColumn: string): string {
  if (!COLUMN_REFERENCE.test(organizationIdColumn)) {
    throw new Error(`excludeDemoOrganizationSql: not a column reference: ${JSON.stringify(organizationIdColumn)}`);
  }
  return `NOT EXISTS (SELECT 1 FROM organizations demo_org WHERE demo_org.id = ${organizationIdColumn} AND demo_org.is_demo)`;
}

/** The demo status of an organization could not be read; the caller must not treat it as "not demo". */
export class DemoOrganizationLookupError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'DemoOrganizationLookupError';
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether `organizationId` is the demo organization, read from its row.
 * Throws DemoOrganizationLookupError when the id is malformed, the row does
 * not exist (deleted rows still answer: is_demo is fixed at insert), the
 * query fails, or the value is not a boolean. It never answers "not demo"
 * because it could not tell.
 */
export async function isDemoOrganization(executor: Pool | PoolClient, organizationId: string): Promise<boolean> {
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) {
    throw new DemoOrganizationLookupError('isDemoOrganization: organization id is not a UUID');
  }
  let rows: Array<{ is_demo: unknown }>;
  try {
    ({ rows } = await executor.query<{ is_demo: unknown }>('SELECT is_demo FROM organizations WHERE id = $1', [organizationId]));
  } catch (error) {
    throw new DemoOrganizationLookupError('isDemoOrganization: the organization could not be read', { cause: error });
  }
  if (rows.length !== 1) {
    throw new DemoOrganizationLookupError('isDemoOrganization: no such organization');
  }
  const value = rows[0].is_demo;
  if (typeof value !== 'boolean') {
    throw new DemoOrganizationLookupError('isDemoOrganization: is_demo is not a boolean');
  }
  return value;
}
