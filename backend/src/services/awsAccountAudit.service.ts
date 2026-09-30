import { pool } from '../config/database';

export type AwsAccountAuditAction = 'aws_account.connected';

export interface AwsAccountAuditEvent {
  organizationId: string;
  action: AwsAccountAuditAction;
  /** The authenticated user who performed the action. */
  actorId?: string;
  /** Identifying context only (the 12-digit AWS account ID) -- never the role's
   * ExternalId, temporary credentials, or any other secret. */
  metadata?: Record<string, unknown>;
}

/**
 * Small, explicit writer for AWS-account audit events into the existing
 * audit_logs table -- follows securityAuditService's exact pattern (same file:
 * backend/src/services/securityAudit.service.ts), not the generic HTTP
 * auditLogger middleware, whose req.path/method pattern-matching doesn't
 * recognize these routes. resource_id stays null: it is a UUID column and
 * aws_accounts ids are not UUIDs; the AWS account ID is in metadata.
 */
export const awsAccountAuditService = {
  async record(event: AwsAccountAuditEvent): Promise<void> {
    const client = await pool.connect();
    try {
      // audit_logs has an org-isolation RLS insert policy, so this connection needs the
      // same org-context tag every other RLS-gated write in this codebase uses.
      await client.query(
        "SELECT set_config('app.current_organization_id', $1, false)",
        [event.organizationId]
      );
      await client.query(
        `INSERT INTO audit_logs (organization_id, user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          event.organizationId,
          event.actorId ?? null,
          event.action,
          'aws_account',
          null,
          JSON.stringify(event.metadata ?? {}),
        ]
      );
    } catch (error) {
      // Matches securityAuditService: a failure to audit-log must never fail the
      // underlying AWS account connection itself.
      console.error(`[AwsAccountAudit] Failed to record ${event.action}:`, error);
    } finally {
      client.release();
    }
  },
};
