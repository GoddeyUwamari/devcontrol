import crypto from 'crypto';
import { PoolClient } from 'pg';
import { pool } from '../config/database';
import { ComplianceIssue, ComplianceSeverity } from '../types/aws-resources.types';

export type AccountFindingCategory = 'networking' | 'iam';
export type AccountFindingStatus = 'active' | 'resolved';

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
  created_at: string;
  updated_at: string;
}

export interface NewAccountFinding {
  findingKey: string;
  category: AccountFindingCategory;
  severity: ComplianceSeverity;
  title: string;
  recommendation: string;
  resourceIdentifier: string;
  region?: string;
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

const SEVERITY_ORDER: Record<ComplianceSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

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

  /**
   * Converts ComplianceIssue[] (what ComplianceScannerService.checkSecurityGroups /
   * checkIAMSecurity already return) into NewAccountFinding[], computing a stable
   * finding_key so re-scans upsert instead of duplicating. IAM issues have no region
   * (IAM is global); networking issues get the org's configured region.
   */
  static fromComplianceIssues(issues: ComplianceIssue[], region: string): NewAccountFinding[] {
    return issues
      .filter((issue): issue is ComplianceIssue & { category: AccountFindingCategory } =>
        issue.category === 'networking' || issue.category === 'iam'
      )
      .map((issue) => {
        const resourceIdentifier = issue.resource_arn ?? 'unknown';
        const findingKey = crypto
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
        };
      });
  }

  /**
   * Upserts every finding from the current scan, then marks anything not touched by
   * this scan (still `active` with a stale `last_seen_at`) as `resolved`. Runs in a
   * single transaction on the org-tagged client so a mid-scan failure doesn't leave
   * findings half-reconciled.
   */
  async reconcileScan(
    organizationId: string,
    scanStartedAt: Date,
    findings: NewAccountFinding[]
  ): Promise<{ active: number; resolved: number }> {
    return this.withOrgClient(organizationId, async (client) => {
      try {
        await client.query('BEGIN');

        for (const finding of findings) {
          await client.query(
            `INSERT INTO account_security_findings
              (organization_id, finding_key, category, severity, title, recommendation, resource_identifier, region)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (organization_id, finding_key) DO UPDATE SET
               severity = EXCLUDED.severity,
               title = EXCLUDED.title,
               recommendation = EXCLUDED.recommendation,
               resource_identifier = EXCLUDED.resource_identifier,
               region = EXCLUDED.region,
               status = 'active',
               resolved_at = NULL,
               last_seen_at = NOW(),
               updated_at = NOW()`,
            [
              organizationId,
              finding.findingKey,
              finding.category,
              finding.severity,
              finding.title,
              finding.recommendation,
              finding.resourceIdentifier,
              finding.region ?? null,
            ]
          );
        }

        const resolvedResult = await client.query(
          `UPDATE account_security_findings
           SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
           WHERE organization_id = $1 AND status = 'active' AND last_seen_at < $2`,
          [organizationId, scanStartedAt]
        );

        await client.query('COMMIT');

        return { active: findings.length, resolved: resolvedResult.rowCount || 0 };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  /**
   * Active findings, severity-sorted (critical first), for the Security page.
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
      const rows = result.rows as AccountSecurityFinding[];
      return rows.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    });
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
