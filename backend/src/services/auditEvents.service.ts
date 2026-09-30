import type { Request } from 'express';
import type { Pool, PoolClient } from 'pg';
import { pool } from '../config/database';

/**
 * Explicit audit events for security-sensitive business actions, written to
 * the existing audit_logs table.
 *
 * Each event is recorded only after its business action has succeeded (after
 * COMMIT, where there is a transaction), on its own dedicated connection with
 * app.current_organization_id set for that one organization -- audit_logs'
 * RLS insert policy requires it, and the ambient request connection is never
 * relied on. One organization per INSERT, never a batch.
 *
 * Follows the pattern of securityAudit.service.ts. A failure to record is
 * logged and swallowed: it never fails the business action it describes.
 *
 * Never put credential material in an event: passwords, tokens, raw API keys
 * or their hashes, AWS keys or session credentials, ExternalIds, SAML
 * assertions or certificates, invitation tokens.
 */

export type AuditEventAction =
  | 'organization_invitation.created'
  | 'organization_invitation.accepted'
  | 'organization_membership.role_changed'
  | 'organization_membership.removed'
  | 'sso_configuration.set'
  | 'sso_configuration.deleted'
  | 'api_key.created'
  | 'api_key.revoked'
  | 'aws_account.connected';

export type AuditEventResourceType =
  | 'organization_invitation'
  | 'organization_membership'
  | 'sso_configuration'
  | 'api_key'
  | 'aws_account';

/** Where an event came from, when it came from an HTTP request. */
export interface AuditRequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuditEvent {
  organizationId: string;
  /** The user who performed the action. */
  actorId: string | null;
  action: AuditEventAction;
  resourceType: AuditEventResourceType;
  /** audit_logs.resource_id is a UUID column: only a real UUID, else null. */
  resourceId?: string | null;
  /** A persisted state transition, e.g. { from: 'member', to: 'admin' }. */
  changes?: Record<string, unknown> | null;
  /** Safe identifiers and business state only. */
  metadata?: Record<string, unknown>;
  request?: AuditRequestContext | null;
}

/** Request IP (req.ip, behind the app's trust-proxy setting) and user agent. */
export function auditRequestContext(req: Request): AuditRequestContext {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

export function createAuditEventWriter(source: Pick<Pool, 'connect'>) {
  return {
    async record(event: AuditEvent): Promise<void> {
      let client: PoolClient | undefined;
      try {
        client = await source.connect();
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_organization_id', $1, true)", [
          event.organizationId,
        ]);
        await client.query(
          `INSERT INTO audit_logs
             (organization_id, user_id, action, resource_type, resource_id,
              ip_address, user_agent, changes, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            event.organizationId,
            event.actorId,
            event.action,
            event.resourceType,
            event.resourceId ?? null,
            event.request?.ipAddress ?? null,
            event.request?.userAgent ?? null,
            event.changes ? JSON.stringify(event.changes) : null,
            JSON.stringify(event.metadata ?? {}),
          ]
        );
        await client.query('COMMIT');
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error(`[AuditEvents] Failed to record ${event.action}:`, error);
      } finally {
        client?.release();
      }
    },
  };
}

export const auditEvents = createAuditEventWriter(pool);
