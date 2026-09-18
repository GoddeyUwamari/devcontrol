import { pool } from '../config/database';

export type Soc2CustomerEvidenceAuditAction =
  | 'soc2_customer_evidence.created'
  | 'soc2_customer_evidence.metadata_updated'
  | 'soc2_customer_evidence.reviewed'
  | 'soc2_customer_evidence.expired'
  | 'soc2_customer_evidence.superseded';

export interface Soc2CustomerEvidenceAuditEvent {
  organizationId: string;
  action: Soc2CustomerEvidenceAuditAction;
  /** The authenticated user who performed the action. */
  actorId?: string;
  /** The customer_evidence.id this event is about. */
  resourceId?: string;
  /** Structural context only (criterionId, status transition, evidenceType) -- never
   * evidence description/external_reference content, which may contain sensitive
   * customer-pasted text. See soc2-customer-evidence.service.ts's call sites. */
  metadata?: Record<string, unknown>;
}

/**
 * Small, explicit writer for SOC 2 customer-evidence audit events into the existing
 * audit_logs table -- follows securityAuditService's exact pattern (same file:
 * backend/src/services/securityAudit.service.ts), deliberately NOT an extension of the
 * generic HTTP auditLogger middleware (backend/src/middleware/auditLogger.ts), whose
 * hardcoded req.path/method pattern-matching doesn't recognize these routes and whose
 * broadening this feature is explicitly scoped to avoid (per the Phase 3 audit).
 */
export const soc2CustomerEvidenceAuditService = {
  async record(event: Soc2CustomerEvidenceAuditEvent): Promise<void> {
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
          'soc2_customer_evidence',
          event.resourceId ?? null,
          JSON.stringify(event.metadata ?? {}),
        ]
      );
    } catch (error) {
      // Matches securityAuditService: a failure to audit-log must never fail the
      // underlying customer-evidence operation itself.
      console.error(`[Soc2CustomerEvidenceAudit] Failed to record ${event.action}:`, error);
    } finally {
      client.release();
    }
  },
};
