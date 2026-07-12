/**
 * Activity Feed Service
 * Reconstructs a chronological "recent activity" feed for an org purely by reading
 * already-existing tables (resource_discovery_jobs, cost_recommendations,
 * account_security_findings, risk_score_history, anomaly_detections) — no new table,
 * no new migration. Each source is queried independently and merged/sorted in JS
 * since the tables have unrelated shapes; a failure reading any one source (missing
 * table, query error) is swallowed so the feed degrades gracefully instead of failing
 * whole.
 */

import { PoolClient } from 'pg';
import { pool } from '../config/database';

export type ActivityEventType = 'sync' | 'optimization' | 'security' | 'score' | 'anomaly';

export interface ActivityEvent {
  type: ActivityEventType;
  message: string;
  timestamp: string;
  severity?: string;
}

const FEED_LIMIT = 15;
const PER_SOURCE_LIMIT = 15;

export class ActivityFeedService {
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
   * Runs one source query and maps its rows to ActivityEvent[]. Any failure (missing
   * table, malformed data) is logged and treated as "this source contributed nothing"
   * rather than failing the whole feed.
   */
  private async runSource(
    label: string,
    fn: () => Promise<ActivityEvent[]>
  ): Promise<ActivityEvent[]> {
    try {
      return await fn();
    } catch (error: any) {
      console.warn(`[Activity Feed] Skipping source "${label}":`, error.message);
      return [];
    }
  }

  async getActivityFeed(organizationId: string): Promise<ActivityEvent[]> {
    return this.withOrgClient(organizationId, async (client) => {
      const [syncs, optimizations, securityFindings, scores, anomalies] = await Promise.all([
        this.runSource('resource_discovery_jobs', () => this.getSyncEvents(client, organizationId)),
        this.runSource('cost_recommendations', () => this.getOptimizationEvents(client, organizationId)),
        this.runSource('account_security_findings', () => this.getSecurityEvents(client, organizationId)),
        this.runSource('risk_score_history', () => this.getScoreEvents(client, organizationId)),
        this.runSource('anomaly_detections', () => this.getAnomalyEvents(client, organizationId)),
      ]);

      return [...syncs, ...optimizations, ...securityFindings, ...scores, ...anomalies]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, FEED_LIMIT);
    });
  }

  private async getSyncEvents(client: PoolClient, organizationId: string): Promise<ActivityEvent[]> {
    const result = await client.query(
      `SELECT completed_at, resources_updated
       FROM resource_discovery_jobs
       WHERE organization_id = $1 AND status = 'completed' AND completed_at IS NOT NULL
       ORDER BY completed_at DESC LIMIT $2`,
      [organizationId, PER_SOURCE_LIMIT]
    );
    return result.rows.map((row) => {
      const updated = row.resources_updated ?? 0;
      return {
        type: 'sync' as const,
        message: `AWS resources synced · ${updated} resource${updated !== 1 ? 's' : ''} updated`,
        timestamp: new Date(row.completed_at).toISOString(),
      };
    });
  }

  private async getOptimizationEvents(client: PoolClient, organizationId: string): Promise<ActivityEvent[]> {
    const result = await client.query(
      `SELECT created_at, potential_savings, issue, severity
       FROM cost_recommendations
       WHERE organization_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [organizationId, PER_SOURCE_LIMIT]
    );
    return result.rows.map((row) => ({
      type: 'optimization' as const,
      message: `Cost optimization found · ${row.issue} — ~$${Math.round(row.potential_savings).toLocaleString()}/month opportunity`,
      timestamp: new Date(row.created_at).toISOString(),
      severity: row.severity ? String(row.severity).toLowerCase() : undefined,
    }));
  }

  private async getSecurityEvents(client: PoolClient, organizationId: string): Promise<ActivityEvent[]> {
    const result = await client.query(
      `SELECT detected_at, severity, category, status
       FROM account_security_findings
       WHERE organization_id = $1
       ORDER BY detected_at DESC LIMIT $2`,
      [organizationId, PER_SOURCE_LIMIT]
    );
    return result.rows.map((row) => ({
      type: 'security' as const,
      message:
        row.status === 'resolved'
          ? `Security finding resolved · ${row.severity} ${row.category} issue`
          : `Security finding detected · ${row.severity} ${row.category} issue`,
      timestamp: new Date(row.detected_at).toISOString(),
      severity: row.severity,
    }));
  }

  private async getScoreEvents(client: PoolClient, organizationId: string): Promise<ActivityEvent[]> {
    const result = await client.query(
      `SELECT created_at, overall_score
       FROM risk_score_history
       WHERE organization_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [organizationId, PER_SOURCE_LIMIT]
    );
    return result.rows.map((row) => ({
      type: 'score' as const,
      message: `Security score updated · ${row.overall_score}/100`,
      timestamp: new Date(row.created_at).toISOString(),
    }));
  }

  private async getAnomalyEvents(client: PoolClient, organizationId: string): Promise<ActivityEvent[]> {
    const result = await client.query(
      `SELECT created_at, description, severity
       FROM anomaly_detections
       WHERE organization_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [organizationId, PER_SOURCE_LIMIT]
    );
    return result.rows.map((row) => ({
      type: 'anomaly' as const,
      message: `Anomaly detected · ${row.description}`,
      timestamp: new Date(row.created_at).toISOString(),
      severity: row.severity,
    }));
  }
}
