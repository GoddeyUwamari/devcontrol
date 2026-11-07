/**
 * Delivery evidence (S17): deployment records for a period, and the DORA
 * metrics computed from them (plan-gated: doraMetrics). Lead time and time to
 * restore are not measurable from deployment records and are never estimated.
 */
import { collectSection } from '../../../ai-context-contract';
import { pool } from '../../../../config/database';
import { defineProvider } from './shared';

export interface DeploymentRecordsEvidence {
  total: number;
  successful: number;
  failed: number;
  periodDays: number;
  /** Hours between consecutive successful deployments of the same service. */
  successfulIntervals: { hours: number[]; servicesMeasured: number };
}

function intervals(records: Array<{ serviceId: string; status: string; deployedAt: number }>): { hours: number[]; servicesMeasured: number } {
  const byService = new Map<string, number[]>();
  for (const r of records) {
    if (r.status !== 'success') continue;
    const times = byService.get(r.serviceId) ?? [];
    times.push(r.deployedAt);
    byService.set(r.serviceId, times);
  }
  const hours: number[] = [];
  let servicesMeasured = 0;
  for (const times of byService.values()) {
    if (times.length < 2) continue;
    servicesMeasured++;
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) hours.push((times[i] - times[i - 1]) / 3_600_000);
  }
  return { hours, servicesMeasured };
}

export const deploymentRecordsProvider = defineProvider<DeploymentRecordsEvidence>({
  id: 'delivery.deployments',
  version: 1,
  title: 'Deployments recorded in the period',
  source: 'DevControl deployment records',
  dataSourceIds: ['S17'],
  topics: ['delivery'],
  priority: 2,
  maxTokens: 800,
  // Counted at read time: its asOf is the read itself.
  fingerprint: 'state_and_data',
  async collect({ organizationId, period }) {
    const periodDays = Math.max(1, Math.ceil(Math.abs(Date.parse(period.to) - Date.parse(period.from)) / 86_400_000));
    return collectSection<DeploymentRecordsEvidence>(
      {
        source: 'DevControl deployment records',
        classification: 'measured',
        period: { kind: 'range', start: period.from, endExclusive: period.to },
        scope: { kind: 'organization', window: `${period.from} to ${period.to} (end exclusive)` },
        coverage: 'deployments recorded in DevControl for this organization; deployments made outside DevControl are not included',
      },
      async () => {
        const result = await pool.query(
          `SELECT d.service_id, d.status, d.deployed_at
             FROM deployments d
             JOIN services s ON d.service_id = s.id
            WHERE s.organization_id = $1
              AND d.deployed_at >= $2
              AND d.deployed_at < $3
            ORDER BY d.deployed_at`,
          [organizationId, period.from, period.to]
        );
        const records = result.rows.map((r) => ({ serviceId: String(r.service_id), status: String(r.status), deployedAt: new Date(r.deployed_at).getTime() }));
        return {
          state: 'available',
          asOf: new Date().toISOString(),
          data: {
            total: records.length,
            successful: records.filter((r) => r.status === 'success').length,
            failed: records.filter((r) => r.status === 'failed').length,
            periodDays,
            successfulIntervals: intervals(records),
          },
        };
      }
    );
  },
});

export interface DoraEvidence {
  deploymentFrequency: string;
  changeFailureRate: string;
  leadTime: string;
  mttr: string;
}

export const doraProvider = defineProvider<DoraEvidence>({
  id: 'delivery.dora',
  version: 1,
  title: 'DORA metrics (deployment frequency, change failure rate)',
  source: 'DevControl deployment records',
  dataSourceIds: ['S17'],
  topics: ['delivery'],
  priority: 2,
  maxTokens: 600,
  entitlementKey: 'doraMetrics',
  // Computed at read time: its asOf is the read itself.
  fingerprint: 'state_and_data',
  async collect({ basis }) {
    return basis.dora();
  },
});
