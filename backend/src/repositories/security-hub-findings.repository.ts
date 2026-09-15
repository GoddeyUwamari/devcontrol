import { PoolClient } from 'pg';
import { pool } from '../config/database';
import { SecurityHubFindingEvidence } from '../types/security-hub-foundation.types';

async function withOrgClient<T>(organizationId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.current_organization_id', $1, false)", [organizationId]);
    return await fn(client);
  } finally {
    client.release();
  }
}

function mapRow(row: any): SecurityHubFindingEvidence {
  return {
    findingId: row.finding_id,
    productArn: row.product_arn,
    region: row.region,
    title: row.title,
    severity: row.severity,
    complianceStatus: row.compliance_status,
    recordState: row.record_state,
    workflowStatus: row.workflow_status,
    securityControlId: row.security_control_id,
    associatedStandardIds: row.associated_standard_ids ?? [],
    relatedRequirements: row.related_requirements ?? [],
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    securityHubCreatedAt: row.security_hub_created_at,
    securityHubUpdatedAt: row.security_hub_updated_at,
    lastSeenAt: row.last_seen_at,
  };
}

export class SecurityHubFindingsRepository {
  /**
   * Pure upsert -- no resolve-on-absence step. See migration
   * 202609141500_create_security_hub_foundation_tables.sql's header for why: Security
   * Hub's own record_state/workflow_status are the only trusted resolution signals, and
   * a page/region that fails to fetch must never cause a previously-stored finding to be
   * treated as gone. Each page is upserted independently and immediately -- a caller
   * ingesting page 1 successfully and failing on page 2 keeps page 1's findings
   * persisted and fresh (last_seen_at updated), which is exactly the partial-failure
   * safety this repository needs to provide.
   */
  async upsertFindings(organizationId: string, findings: SecurityHubFindingEvidence[]): Promise<number> {
    if (findings.length === 0) return 0;

    return withOrgClient(organizationId, async (client) => {
      await client.query('BEGIN');
      try {
        for (const f of findings) {
          await client.query(
            `INSERT INTO security_hub_findings
              (organization_id, finding_id, product_arn, title, severity, compliance_status,
               record_state, workflow_status, security_control_id, associated_standard_ids,
               related_requirements, region, resource_type, resource_id, security_hub_created_at,
               security_hub_updated_at, last_seen_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
             ON CONFLICT (organization_id, finding_id) DO UPDATE SET
               title = EXCLUDED.title,
               severity = EXCLUDED.severity,
               compliance_status = EXCLUDED.compliance_status,
               record_state = EXCLUDED.record_state,
               workflow_status = EXCLUDED.workflow_status,
               security_control_id = EXCLUDED.security_control_id,
               associated_standard_ids = EXCLUDED.associated_standard_ids,
               related_requirements = EXCLUDED.related_requirements,
               region = EXCLUDED.region,
               resource_type = EXCLUDED.resource_type,
               resource_id = EXCLUDED.resource_id,
               security_hub_created_at = EXCLUDED.security_hub_created_at,
               security_hub_updated_at = EXCLUDED.security_hub_updated_at,
               last_seen_at = NOW(),
               updated_at = NOW()`,
            [
              organizationId,
              f.findingId,
              f.productArn,
              f.title,
              f.severity,
              f.complianceStatus,
              f.recordState,
              f.workflowStatus,
              f.securityControlId,
              JSON.stringify(f.associatedStandardIds),
              JSON.stringify(f.relatedRequirements),
              f.region,
              f.resourceType,
              f.resourceId,
              f.securityHubCreatedAt,
              f.securityHubUpdatedAt,
            ]
          );
        }
        await client.query('COMMIT');
        return findings.length;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  /**
   * Fresh (last_seen_at >= freshSince), ACTIVE findings for a given Security Hub
   * control. "Fresh" is the freshness gate that makes partial-sync-safety correct at
   * evaluation time: a finding not refreshed by the most recent successful/partial sync
   * is excluded rather than trusted, so evaluation degrades to UNKNOWN instead of using
   * stale data as if it were current. See security-hub-compliance.service.ts.
   */
  async getFreshActiveFindingsForControl(
    organizationId: string,
    securityControlId: string,
    freshSince: Date
  ): Promise<SecurityHubFindingEvidence[]> {
    return withOrgClient(organizationId, async (client) => {
      const result = await client.query(
        `SELECT * FROM security_hub_findings
         WHERE organization_id = $1 AND security_control_id = $2
           AND record_state = 'ACTIVE' AND last_seen_at >= $3`,
        [organizationId, securityControlId, freshSince]
      );
      return result.rows.map(mapRow);
    });
  }

  /**
   * Same freshness semantics as getFreshActiveFindingsForControl, but for every mapped
   * control in one query -- used by SecurityHubComplianceService.evaluateCis to avoid
   * one DB round-trip per control (40 controls) on every readiness read. Grouped by
   * security_control_id for the caller to index into.
   */
  async getAllFreshActiveFindingsGroupedByControl(
    organizationId: string,
    freshSince: Date
  ): Promise<Map<string, SecurityHubFindingEvidence[]>> {
    return withOrgClient(organizationId, async (client) => {
      const result = await client.query(
        `SELECT * FROM security_hub_findings
         WHERE organization_id = $1 AND record_state = 'ACTIVE' AND last_seen_at >= $2
           AND security_control_id IS NOT NULL`,
        [organizationId, freshSince]
      );
      const grouped = new Map<string, SecurityHubFindingEvidence[]>();
      for (const row of result.rows) {
        const evidence = mapRow(row);
        const key = evidence.securityControlId as string;
        const list = grouped.get(key) ?? [];
        list.push(evidence);
        grouped.set(key, list);
      }
      return grouped;
    });
  }
}
