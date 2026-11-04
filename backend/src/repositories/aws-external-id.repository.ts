/**
 * The organization's one AWS External ID (aws_org_external_ids, admin migration
 * 202611031200). The Connect AWS page shows it and every new connection's
 * AssumeRole sends it. It never expires and is never changed: rows are only
 * inserted, the application has no UPDATE or DELETE grant, and a trigger refuses
 * any UPDATE. There is no rotation.
 *
 * An organization with no row yet gets one on first use, chosen in the same
 * order as the migration's backfill, so an organization connected or started by
 * the release before this one keeps the value it already has:
 *   1. connection  its aws_accounts row's well-formed external_id (the value AWS
 *                  already trusts): status 'active' first, then the newest
 *                  connected_at, then id;
 *   2. session     otherwise its aws_connect_sessions value, expired or not;
 *   3. generated   otherwise crypto.randomBytes(24), base64url (32 characters).
 * The insert is ON CONFLICT DO NOTHING followed by a read, so two concurrent
 * first visits agree on one value and an existing value always wins.
 *
 * Existing connections are unaffected: each one's AssumeRole sends its own
 * aws_accounts.external_id (aws-client-factory.service.ts).
 *
 * The value is not a secret in AWS's model, but it is shown to the owner only
 * and never logged.
 */
import { randomBytes } from 'crypto';

export interface ExternalIdQueryable {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>;
}

export type ExternalIdSource = 'connection' | 'session' | 'generated';

/** AWS's ExternalId alphabet, 2 to 64 characters (the width of every column that holds one). Same as the table's CHECK. */
export const WELL_FORMED_EXTERNAL_ID = /^[A-Za-z0-9+=,.@:/_-]{2,64}$/;

export function isWellFormedExternalId(value: unknown): value is string {
  return typeof value === 'string' && WELL_FORMED_EXTERNAL_ID.test(value);
}

/** A new External ID: 24 random bytes from the operating system's CSPRNG, base64url (32 characters). */
export function generateExternalId(): string {
  return randomBytes(24).toString('base64url');
}

/** PostgreSQL's undefined_table: an optional legacy source table that does not exist. */
function isUndefinedTable(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === '42P01';
}

/** The first well-formed value of `rows` (already in precedence order), or null. */
function firstWellFormed(rows: Array<{ external_id: unknown }>): string | null {
  for (const row of rows) if (isWellFormedExternalId(row.external_id)) return row.external_id;
  return null;
}

/**
 * The value an organization with no row yet adopts, by the precedence above.
 * aws_accounts and aws_connect_sessions are defined outside the canonical
 * migrations, so a missing table is skipped, never fatal.
 */
async function adoptableExternalId(db: ExternalIdQueryable, organizationId: string): Promise<{ externalId: string; source: ExternalIdSource }> {
  try {
    const { rows } = await db.query(
      `SELECT external_id FROM aws_accounts
        WHERE org_id = $1
        ORDER BY (status = 'active') DESC NULLS LAST, connected_at DESC NULLS LAST, id::text DESC`,
      [organizationId]
    );
    const fromConnection = firstWellFormed(rows);
    if (fromConnection) return { externalId: fromConnection, source: 'connection' };
  } catch (error: unknown) {
    if (!isUndefinedTable(error)) throw error;
  }
  try {
    const { rows } = await db.query(
      `SELECT external_id FROM aws_connect_sessions WHERE org_id = $1`,
      [organizationId]
    );
    const fromSession = firstWellFormed(rows);
    if (fromSession) return { externalId: fromSession, source: 'session' };
  } catch (error: unknown) {
    if (!isUndefinedTable(error)) throw error;
  }
  return { externalId: generateExternalId(), source: 'generated' };
}

async function readExternalId(db: ExternalIdQueryable, organizationId: string): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT external_id FROM aws_org_external_ids WHERE organization_id = $1`,
    [organizationId]
  );
  return rows.length > 0 ? (rows[0].external_id as string) : null;
}

/**
 * The organization's External ID, recorded on first use. Never changes once
 * recorded. Throws on a database failure (the caller answers a safe 500).
 */
export async function resolveOrganizationExternalId(db: ExternalIdQueryable, organizationId: string): Promise<string> {
  const existing = await readExternalId(db, organizationId);
  if (existing !== null) return existing;

  const { externalId, source } = await adoptableExternalId(db, organizationId);
  await db.query(
    `INSERT INTO aws_org_external_ids (organization_id, external_id, source)
     VALUES ($1, $2, $3)
     ON CONFLICT (organization_id) DO NOTHING`,
    [organizationId, externalId, source]
  );
  const recorded = await readExternalId(db, organizationId);
  if (recorded === null) throw new Error('aws_org_external_ids: the External ID row could not be read back after insert');
  return recorded;
}
