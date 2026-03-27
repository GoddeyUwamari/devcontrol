import { pool } from '../config/database'

export interface MonitoringSnapshotData {
  organizationId: string
  uptime: number | null
  responseTimeMs: number | null
  requestsPerMinute: number | null
  monthlyCost: number | null
  services: any[]
  slos: any[]
  systemStatus: string
}

export interface MonitoringSnapshot extends MonitoringSnapshotData {
  id: string
  capturedAt: string
}

export class MonitoringSnapshotService {
  private pool = pool

  async saveSnapshot(data: MonitoringSnapshotData): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO monitoring_snapshots
          (organization_id, uptime, response_time_ms, requests_per_minute,
           monthly_cost, services, slos, system_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          data.organizationId,
          data.uptime,
          data.responseTimeMs,
          data.requestsPerMinute,
          data.monthlyCost,
          JSON.stringify(data.services),
          JSON.stringify(data.slos),
          data.systemStatus,
        ]
      )
    } catch (err) {
      console.error('[Monitoring Snapshot] Error saving snapshot:', err)
    }
  }

  async getLatestSnapshot(organizationId: string): Promise<MonitoringSnapshot | null> {
    try {
      const result = await this.pool.query(
        `SELECT
          id,
          organization_id,
          uptime,
          response_time_ms,
          requests_per_minute,
          monthly_cost,
          services,
          slos,
          system_status,
          captured_at
         FROM monitoring_snapshots
         WHERE organization_id = $1
         ORDER BY captured_at DESC
         LIMIT 1`,
        [organizationId]
      )

      if (result.rows.length === 0) return null

      const row = result.rows[0]
      return {
        id: row.id,
        organizationId: row.organization_id,
        uptime: row.uptime,
        responseTimeMs: row.response_time_ms,
        requestsPerMinute: row.requests_per_minute,
        monthlyCost: row.monthly_cost,
        services: row.services,
        slos: row.slos,
        systemStatus: row.system_status,
        capturedAt: row.captured_at,
      }
    } catch (err) {
      console.error('[Monitoring Snapshot] Error loading snapshot:', err)
      return null
    }
  }

  async pruneOldSnapshots(organizationId: string, keepCount = 48): Promise<void> {
    try {
      await this.pool.query(
        `DELETE FROM monitoring_snapshots
         WHERE organization_id = $1
           AND id NOT IN (
             SELECT id FROM monitoring_snapshots
             WHERE organization_id = $1
             ORDER BY captured_at DESC
             LIMIT $2
           )`,
        [organizationId, keepCount]
      )
    } catch (err) {
      console.error('[Monitoring Snapshot] Error pruning snapshots:', err)
    }
  }
}
