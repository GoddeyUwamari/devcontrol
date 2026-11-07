/**
 * Helpers shared by the evidence providers.
 */
import type { PoolClient } from 'pg';
import { pool } from '../../../../config/database';
import type { UntrustedText } from '../../../ai-context-contract';
import type { ProviderDefinition } from '../types';
import { MAX_LEASE_AGE_SECONDS } from '../../../scan-lease';

/**
 * Two scheduled scans (every 6 hours) plus the longest a scan may run: the
 * staleness rule of the security evaluation and of the region list (the
 * Services coverage page's STALE_AFTER_SECONDS; a test pins the two).
 */
export const TWO_SCANS_SECONDS = 2 * 6 * 60 * 60 + MAX_LEASE_AGE_SECONDS;

/**
 * A dedicated connection tagged for the organization (session-scoped), the
 * pattern the RLS-gated repositories use (AccountSecurityFindingsRepository).
 * installTenantTagReset() clears the tag when the connection is released.
 * Every statement run on it must still name the organization explicitly.
 */
export async function withOrgClient<T>(organizationId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.current_organization_id', $1, false)", [organizationId]);
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Identity function that type-checks a provider definition. */
export function defineProvider<T>(definition: ProviderDefinition<T>): ProviderDefinition<T> {
  return definition;
}

/** A list item's reference: lets untrusted text point at its item without carrying the text in data. */
export function ref(prefix: string, index: number): string {
  return `${prefix}${index + 1}`;
}

/**
 * Untrusted text for one item's field, skipped when there is none. The field
 * is the item's ref, a space, then what the text is in words ("a1 alarm
 * name"), so it names no code identifier.
 */
export function untrustedFor(itemRef: string, field: string, text: unknown): UntrustedText[] {
  return typeof text === 'string' && text.trim().length > 0 ? [{ field: `${itemRef} ${field}`, text }] : [];
}

/**
 * summarize() for data with an `items` list whose entries have `ref`: keeps
 * the first maxItems (providers order items by importance) and every count
 * and total; returns null when nothing would be cut.
 */
export function summarizeItems<T extends { items: Array<{ ref: string }> }>(data: T, maxItems: number): { data: T; kept: number; total: number } | null {
  const total = data.items.length;
  if (total <= maxItems) return null;
  return { data: { ...data, items: data.items.slice(0, maxItems) }, kept: maxItems, total };
}

export function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];
