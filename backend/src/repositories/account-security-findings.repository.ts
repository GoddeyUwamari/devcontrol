import crypto from 'crypto';
import { PoolClient } from 'pg';
import { pool } from '../config/database';
import { ComplianceIssue, ComplianceSeverity, SecurityGroupEvidence } from '../types/aws-resources.types';
import { getFrameworkMapping, FrameworkMapping } from '../config/securityFrameworkMappings';
import { securityAuditService } from '../services/securityAudit.service';

export type AccountFindingCategory = 'networking' | 'iam';
export type AccountFindingStatus = 'active' | 'resolved';
export type AccountFindingDisposition = 'acknowledged' | 'dismissed' | 'accepted_risk';
export type DerivedFindingStatus = 'active' | 'resolved' | AccountFindingDisposition;

export interface AccountSecurityFinding {
  id: string;
  organization_id: string;
  finding_key: string;
  category: AccountFindingCategory;
  severity: ComplianceSeverity;
  title: string;
  recommendation: string;
  resource_identifier: string;
  region: string | null;
  status: AccountFindingStatus;
  detected_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  disposition: AccountFindingDisposition | null;
  disposition_actor_id: string | null;
  disposition_at: string | null;
  disposition_note: string | null;
  evidence: SecurityGroupEvidence | null;
  created_at: string;
  updated_at: string;
  /** Read-time projection — never stored. See deriveFindingStatus. */
  derived_status: DerivedFindingStatus;
  /** The one verified framework mapping for this finding, or null if none applies. */
  framework_mapping: FrameworkMapping | null;
}

export interface NewAccountFinding {
  findingKey: string;
  category: AccountFindingCategory;
  severity: ComplianceSeverity;
  title: string;
  recommendation: string;
  resourceIdentifier: string;
  region?: string;
  evidence?: SecurityGroupEvidence;
}

export interface AccountFindingFilters {
  category?: AccountFindingCategory;
  severity?: ComplianceSeverity;
  limit?: number;
}

export interface AccountFindingStats {
  total: number;
  bySeverity: Record<ComplianceSeverity, number>;
  byCategory: Record<AccountFindingCategory, number>;
}

export type DispositionOutcome =
  | { outcome: 'applied'; finding: AccountSecurityFinding }
  | { outcome: 'not_found' }
  | { outcome: 'resolved' };

const SEVERITY_ORDER: Record<ComplianceSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Derives the user-facing status from the system-owned `status` column and the
 * user-owned `disposition` column, without persisting a redundant column.
 * Verified absence (status = resolved) always wins over any prior disposition.
 */
export function deriveFindingStatus(
  status: AccountFindingStatus,
  disposition: AccountFindingDisposition | null
): DerivedFindingStatus {
  if (status === 'resolved') return 'resolved';
  if (disposition === 'acknowledged' || disposition === 'dismissed' || disposition === 'accepted_risk') {
    return disposition;
  }
  return 'active';
}

export class AccountSecurityFindingsRepository {
  /**
   * Hold a single client for the whole call and set org context session-scoped
   * (is_local = false) so it survives across multiple statements / an explicit
   * transaction on that connection — matches the pattern used across the rest
   * of the backend for RLS-gated tables (see CostRecommendationsRepository).
   */
  private async withOrgClient<T>(
    organizationId: string,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query(
        "SELECT set_config('app.current_organization_id', $1, false)",
        [organizationId]
      );
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private mapRow(row: any): AccountSecurityFinding {
    const evidence: SecurityGroupEvidence | null = row.evidence ?? null;
    return {
      ...row,
      evidence,
      derived_status: deriveFindingStatus(row.status, row.disposition),
      framework_mapping: getFrameworkMapping(evidence),
    };
  }

  /**
   * Converts ComplianceIssue[] (what ComplianceScannerService.checkSecurityGroups /
   * checkIAMSecurity already return) into NewAccountFinding[], computing a stable
   * finding_key so re-scans upsert instead of duplicating. IAM issues have no region
   * (IAM is global); networking issues get the org's configured region.
   *
   * When a detector already computed a stable identity (currently only
   * checkSecurityGroups, via issue.findingKey), that's used as-is instead of the
   * generic resource_arn|category|issue hash below, which is unstable whenever
   * `issue` embeds a mutable human-readable name (e.g. a security group's name).
   */
  static fromComplianceIssues(issues: ComplianceIssue[], region: string): NewAccountFinding[] {
    return issues
      .filter((issue): issue is ComplianceIssue & { category: AccountFindingCategory } =>
        issue.category === 'networking' || issue.category === 'iam'
      )
      .map((issue) => {
        const resourceIdentifier = issue.resource_arn ?? 'unknown';
        const findingKey =
          issue.findingKey ??
          crypto
            .createHash('sha256')
            .update(`${resourceIdentifier}|${issue.category}|${issue.issue}`)
            .digest('hex');

        return {
          findingKey,
          category: issue.category,
          severity: issue.severity,
          title: issue.issue,
          recommendation: issue.recommendation,
          resourceIdentifier,
          region: issue.category === 'iam' ? undefined : region,
          evidence: issue.evidence,
        };
      });
  }

  /**
   * Upserts every finding from the current scan, then marks anything not touched by
   * this scan (still `active` with a stale `last_seen_at`) as `resolved` — but ONLY
   * within `completeCategories`. A category whose scan was partial/failed must never
   * have its absent findings treated as resolved; its detected findings are still
   * upserted (real evidence is real evidence, even from a partial scan) via the loop
   * below, which runs regardless of completeness.
   *
   * Disposition handling on upsert: if the pre-existing row was already `active`,
   * its disposition is preserved (a rescan that still sees an acknowledged/dismissed/
   * accepted-risk finding must not silently clear that decision). If the pre-existing
   * row was `resolved`, disposition is reset to NULL — a genuinely recurring issue
   * requires a fresh user decision, per the recurrence semantics this repository
   * implements.
   *
   * Runs in a single transaction on the org-tagged client so a mid-scan failure
   * doesn't leave findings half-reconciled.
   */
  async reconcileScan(
    organizationId: string,
    scanStartedAt: Date,
    findings: NewAccountFinding[],
    completeCategories: AccountFindingCategory[] = ['networking', 'iam']
  ): Promise<{ active: number; resolved: number }> {
    const { resolvedIds, detectedIds } = await this.withOrgClient(organizationId, async (client) => {
      try {
        await client.query('BEGIN');

        const detectedIds: string[] = [];

        for (const finding of findings) {
          const result = await client.query(
            `INSERT INTO account_security_findings
              (organization_id, finding_key, category, severity, title, recommendation, resource_identifier, region, evidence)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (organization_id, finding_key) DO UPDATE SET
               severity = EXCLUDED.severity,
               title = EXCLUDED.title,
               recommendation = EXCLUDED.recommendation,
               resource_identifier = EXCLUDED.resource_identifier,
               region = EXCLUDED.region,
               evidence = EXCLUDED.evidence,
               status = 'active',
               resolved_at = NULL,
               last_seen_at = NOW(),
               updated_at = NOW(),
               disposition = CASE WHEN account_security_findings.status = 'resolved' THEN NULL ELSE account_security_findings.disposition END,
               disposition_actor_id = CASE WHEN account_security_findings.status = 'resolved' THEN NULL ELSE account_security_findings.disposition_actor_id END,
               disposition_at = CASE WHEN account_security_findings.status = 'resolved' THEN NULL ELSE account_security_findings.disposition_at END,
               disposition_note = CASE WHEN account_security_findings.status = 'resolved' THEN NULL ELSE account_security_findings.disposition_note END
             RETURNING id, (xmax = 0) AS inserted`,
            [
              organizationId,
              finding.findingKey,
              finding.category,
              finding.severity,
              finding.title,
              finding.recommendation,
              finding.resourceIdentifier,
              finding.region ?? null,
              finding.evidence ? JSON.stringify(finding.evidence) : null,
            ]
          );

          const row = result.rows[0];
          if (row?.inserted) {
            detectedIds.push(row.id);
          }
        }

        let resolvedIds: string[] = [];
        if (completeCategories.length > 0) {
          const resolvedResult = await client.query(
            `UPDATE account_security_findings
             SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
             WHERE organization_id = $1 AND status = 'active' AND last_seen_at < $2 AND category = ANY($3::text[])
             RETURNING id`,
            [organizationId, scanStartedAt, completeCategories]
          );
          resolvedIds = resolvedResult.rows.map((r) => r.id as string);
        }

        await client.query('COMMIT');

        return { resolvedIds, detectedIds };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });

    // Best-effort and outside the transaction (already committed) — a failure to
    // write an audit event must never roll back or block the scan itself.
    for (const id of detectedIds) {
      securityAuditService
        .record({ organizationId, action: 'security.finding.detected', resourceId: id })
        .catch(() => {});
    }
    for (const id of resolvedIds) {
      securityAuditService
        .record({ organizationId, action: 'security.finding.resolved', resourceId: id })
        .catch(() => {});
    }

    return { active: findings.length, resolved: resolvedIds.length };
  }

  /**
   * Active findings, severity-sorted (critical first), for the Security page.
   * "Active" here means status = 'active' — which includes ACKNOWLEDGED/DISMISSED/
   * ACCEPTED_RISK findings (disposition is a separate axis; see derived_status).
   */
  async getActive(
    organizationId: string,
    filters?: AccountFindingFilters
  ): Promise<AccountSecurityFinding[]> {
    return this.withOrgClient(organizationId, async (client) => {
      let query = `
        SELECT * FROM account_security_findings
        WHERE organization_id = $1 AND status = 'active'
      `;
      const params: unknown[] = [organizationId];

      if (filters?.category) {
        params.push(filters.category);
        query += ` AND category = $${params.length}`;
      }

      if (filters?.severity) {
        params.push(filters.severity);
        query += ` AND severity = $${params.length}`;
      }

      query += ` ORDER BY detected_at DESC`;

      if (filters?.limit) {
        params.push(filters.limit);
        query += ` LIMIT $${params.length}`;
      }

      const result = await client.query(query, params);
      const rows = result.rows.map((row) => this.mapRow(row));
      return rows.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    });
  }

  async getById(organizationId: string, findingId: string): Promise<AccountSecurityFinding | null> {
    return this.withOrgClient(organizationId, async (client) => {
      const result = await client.query(
        `SELECT * FROM account_security_findings WHERE id = $1 AND organization_id = $2`,
        [findingId, organizationId]
      );
      return result.rows[0] ? this.mapRow(result.rows[0]) : null;
    });
  }

  /**
   * Applies a user disposition to an ACTIVE finding. Uses a conditional UPDATE
   * (`WHERE status = 'active'`) rather than a read-then-write so a scan that
   * resolves this exact finding concurrently can't be raced: whichever of the
   * scan's resolve-UPDATE and this disposition-UPDATE commits first determines
   * whether this row is still `active` when the other runs, and a `resolved`
   * row is never a valid target for this UPDATE regardless of ordering — a
   * verified resolution can never be turned back into a user-dispositioned
   * active state by a stale disposition request.
   */
  async setDisposition(
    organizationId: string,
    findingId: string,
    disposition: AccountFindingDisposition,
    actorId: string,
    note: string | null
  ): Promise<DispositionOutcome> {
    const result = await this.withOrgClient(organizationId, async (client) => {
      const updated = await client.query(
        `UPDATE account_security_findings
         SET disposition = $1, disposition_actor_id = $2, disposition_at = NOW(), disposition_note = $3, updated_at = NOW()
         WHERE id = $4 AND organization_id = $5 AND status = 'active'
         RETURNING *`,
        [disposition, actorId, note, findingId, organizationId]
      );

      if (updated.rows.length > 0) {
        return { outcome: 'applied' as const, finding: this.mapRow(updated.rows[0]) };
      }

      const existing = await client.query(
        `SELECT id FROM account_security_findings WHERE id = $1 AND organization_id = $2`,
        [findingId, organizationId]
      );
      return existing.rows.length === 0
        ? { outcome: 'not_found' as const }
        : { outcome: 'resolved' as const };
    });

    if (result.outcome === 'applied') {
      securityAuditService
        .record({
          organizationId,
          actorId,
          action: `security.finding.${disposition}`,
          resourceId: findingId,
          metadata: note ? { note } : undefined,
        })
        .catch(() => {});
    }

    return result;
  }

  /**
   * Active-finding counts by severity and category. Accepts an already org-tagged
   * `client` (e.g. from RiskTrackingService's scoring chain) to run on that same
   * connection instead of opening a second one; falls back to its own tagged
   * connection when called standalone (e.g. from the stats endpoint).
   */
  async getStats(organizationId: string, client?: PoolClient): Promise<AccountFindingStats> {
    const run = async (client: PoolClient) => {
      const result = await client.query(
        `SELECT severity, category, COUNT(*) as count
         FROM account_security_findings
         WHERE organization_id = $1 AND status = 'active'
         GROUP BY severity, category`,
        [organizationId]
      );

      const bySeverity: Record<ComplianceSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
      const byCategory: Record<AccountFindingCategory, number> = { networking: 0, iam: 0 };
      let total = 0;

      for (const row of result.rows) {
        const count = parseInt(row.count, 10);
        bySeverity[row.severity as ComplianceSeverity] += count;
        byCategory[row.category as AccountFindingCategory] += count;
        total += count;
      }

      return { total, bySeverity, byCategory };
    };

    return client ? run(client) : this.withOrgClient(organizationId, run);
  }
}
