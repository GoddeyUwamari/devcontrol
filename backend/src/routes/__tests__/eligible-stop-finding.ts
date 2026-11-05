/**
 * Test fixture: a finding a stop_instance workflow may act on (see
 * services/stop-instance-eligibility.ts) -- the organization's ACTIVE EC2
 * "Idle Instance" recommendation for the instance, carrying the allow-listed
 * marker metadata.rule_version = 2.
 *
 * Shared by every test that drives a stop through RemediationService for a
 * reason other than eligibility (region binding, target binding,
 * self-protection, the kill-switch, account resolution), so those tests keep
 * testing what they test. Not a test file itself.
 */
import type { Pool } from 'pg';

/** The marker only the multi-signal low-activity rule sets. */
export const ELIGIBLE_STOP_METADATA: Readonly<Record<string, unknown>> = Object.freeze({ rule_version: 2 });

/** The columns stop-instance-eligibility.ts reads, as a mock Pool would return them. */
export function eligibleStopFindingRow(
  id: string,
  resourceId: string,
  overrides: Partial<{ resource_type: string; issue: string; status: string; metadata: unknown; aws_region: string | null }> = {}
) {
  return {
    id,
    resource_id: resourceId,
    resource_type: 'EC2',
    issue: 'Idle Instance',
    status: 'ACTIVE',
    metadata: { ...ELIGIBLE_STOP_METADATA },
    aws_region: null as string | null,
    ...overrides,
  };
}

/** True for the eligibility read (and not for bindTargetRegion's region read). */
export function isStopFindingRead(sql: string): boolean {
  return /SELECT id, resource_id, resource_type, issue, status, metadata\s+FROM cost_recommendations/.test(sql);
}

/** Inserts an eligible finding for `resourceId` and returns its id. */
export async function insertEligibleStopFinding(
  pool: Pick<Pool, 'query'>,
  orgId: string,
  resourceId: string,
  options: { awsRegion?: string | null; status?: string; metadata?: unknown } = {}
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO cost_recommendations (organization_id, resource_id, resource_type, issue, severity, aws_region, status, metadata)
     VALUES ($1, $2, 'EC2', 'Idle Instance', 'LOW', $3, $4, $5) RETURNING id`,
    [
      orgId,
      resourceId,
      options.awsRegion ?? null,
      options.status ?? 'ACTIVE',
      JSON.stringify(options.metadata === undefined ? ELIGIBLE_STOP_METADATA : options.metadata),
    ]
  );
  return rows[0].id as string;
}
