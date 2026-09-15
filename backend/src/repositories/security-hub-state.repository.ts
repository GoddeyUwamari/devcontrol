import { PoolClient } from 'pg';
import { pool } from '../config/database';
import {
  SecurityHubCapabilityResult,
  SecurityHubStandardSummary,
  SecurityHubSyncStatus,
} from '../types/security-hub-foundation.types';

export interface OrganizationSecurityHubState {
  organizationId: string;
  capabilityStatus: SecurityHubCapabilityResult['status'];
  capabilityCheckedAt: string;
  capabilityError: string | null;
  enabledStandards: SecurityHubStandardSummary[];
  lastSyncStatus: SecurityHubSyncStatus;
  lastSyncStartedAt: string | null;
  lastSyncCompletedAt: string | null;
  lastSyncError: string | null;
  lastSyncPagesProcessed: number | null;
  lastSyncFindingsCount: number | null;
}

/** Same session-scoped org-context pattern as AccountSecurityFindingsRepository. */
async function withOrgClient<T>(organizationId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.current_organization_id', $1, false)", [organizationId]);
    return await fn(client);
  } finally {
    client.release();
  }
}

function mapRow(row: any): OrganizationSecurityHubState {
  return {
    organizationId: row.organization_id,
    capabilityStatus: row.capability_status,
    capabilityCheckedAt: row.capability_checked_at,
    capabilityError: row.capability_error,
    enabledStandards: row.enabled_standards ?? [],
    lastSyncStatus: row.last_sync_status,
    lastSyncStartedAt: row.last_sync_started_at,
    lastSyncCompletedAt: row.last_sync_completed_at,
    lastSyncError: row.last_sync_error,
    lastSyncPagesProcessed: row.last_sync_pages_processed,
    lastSyncFindingsCount: row.last_sync_findings_count,
  };
}

export class SecurityHubStateRepository {
  async get(organizationId: string): Promise<OrganizationSecurityHubState | null> {
    return withOrgClient(organizationId, async (client) => {
      const result = await client.query(
        `SELECT * FROM organization_security_hub_state WHERE organization_id = $1`,
        [organizationId]
      );
      return result.rows[0] ? mapRow(result.rows[0]) : null;
    });
  }

  async markSyncStarted(organizationId: string): Promise<void> {
    await withOrgClient(organizationId, (client) =>
      client.query(
        `INSERT INTO organization_security_hub_state
           (organization_id, capability_status, last_sync_status, last_sync_started_at)
         VALUES ($1, 'ERROR', 'RUNNING', NOW())
         ON CONFLICT (organization_id) DO UPDATE SET
           last_sync_status = 'RUNNING',
           last_sync_started_at = NOW(),
           last_sync_error = NULL,
           updated_at = NOW()`,
        [organizationId]
      )
    );
  }

  /**
   * Records the outcome of a sync attempt (capability result + standards discovery, if
   * any + final sync status). Called exactly once per sync, after ingestion completes
   * or fails -- never partially, so a reader never observes a state that mixes fields
   * from two different sync attempts.
   */
  async recordSyncResult(
    organizationId: string,
    params: {
      capability: SecurityHubCapabilityResult;
      enabledStandards: SecurityHubStandardSummary[];
      syncStatus: SecurityHubSyncStatus;
      syncError: string | null;
      pagesProcessed: number;
      findingsCount: number;
    }
  ): Promise<void> {
    await withOrgClient(organizationId, (client) =>
      client.query(
        `INSERT INTO organization_security_hub_state
           (organization_id, capability_status, capability_checked_at, capability_error,
            enabled_standards, last_sync_status, last_sync_started_at, last_sync_completed_at,
            last_sync_error, last_sync_pages_processed, last_sync_findings_count)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), $7, $8, $9)
         ON CONFLICT (organization_id) DO UPDATE SET
           capability_status = EXCLUDED.capability_status,
           capability_checked_at = EXCLUDED.capability_checked_at,
           capability_error = EXCLUDED.capability_error,
           enabled_standards = EXCLUDED.enabled_standards,
           last_sync_status = EXCLUDED.last_sync_status,
           last_sync_completed_at = NOW(),
           last_sync_error = EXCLUDED.last_sync_error,
           last_sync_pages_processed = EXCLUDED.last_sync_pages_processed,
           last_sync_findings_count = EXCLUDED.last_sync_findings_count,
           updated_at = NOW()`,
        [
          organizationId,
          params.capability.status,
          params.capability.checkedAt,
          params.capability.error,
          JSON.stringify(params.enabledStandards),
          params.syncStatus,
          params.syncError,
          params.pagesProcessed,
          params.findingsCount,
        ]
      )
    );
  }
}
