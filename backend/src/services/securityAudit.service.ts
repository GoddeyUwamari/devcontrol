import { pool } from '../config/database';

export type SecurityAuditAction =
  | 'security.scan.started'
  | 'security.scan.completed'
  | 'security.scan.failed'
  | 'security.scan.partial'
  | 'security.finding.detected'
  | 'security.finding.resolved'
  | 'security.finding.acknowledged'
  | 'security.finding.dismissed'
  | 'security.finding.accepted_risk';

export interface SecurityAuditEvent {
  organizationId: string;
  action: SecurityAuditAction;
  /** The authenticated user who triggered the event, if any (absent for scan-lifecycle events). */
  actorId?: string;
  /** The account_security_findings.id this event is about, if any. */
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Small, explicit writer for security-domain audit events into the existing
 * audit_logs table. Deliberately NOT a rewrite of the generic HTTP auditLogger
 * middleware (backend/src/middleware/auditLogger.ts) — that middleware pattern-
 * matches req.path/method and doesn't recognize these routes, and broadening
 * it would be exactly the "rewrite the global audit middleware" this feature
 * is scoped to avoid. Deliberately not a new table either: audit_logs already
 * has organization_id/resource_type/resource_id/metadata, which is all these
 * nine event names need.
 *
 * Disposition/resolution events are called synchronously right after their
 * database mutation commits (see AccountSecurityFindingsRepository); scan-
 * lifecycle events are best-effort/async, per this feature's own spec — a
 * failure to audit-log a scan must never fail the scan itself.
 */
export const securityAuditService = {
  async record(event: SecurityAuditEvent): Promise<void> {
    const client = await pool.connect();
    try {
      // audit_logs has an org-isolation RLS insert policy, so this connection
      // needs the same org-context tag every other RLS-gated write in this
      // codebase uses — see AccountSecurityFindingsRepository.withOrgClient.
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
          'account_security_finding',
          event.resourceId ?? null,
          JSON.stringify(event.metadata ?? {}),
        ]
      );
    } catch (error) {
      console.error(`[SecurityAudit] Failed to record ${event.action}:`, error);
    } finally {
      client.release();
    }
  },
};
