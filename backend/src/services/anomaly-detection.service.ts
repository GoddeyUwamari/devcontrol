import { Pool, PoolClient } from 'pg';
import { AnomalyDetection } from '../types/anomaly.types';

export class AnomalyDetectionService {
  // Pool kept in the signature: existing callers construct it with one.
  constructor(_pool: Pool) {}

  /**
   * Scan for all anomalies across organization.
   *
   * No statistical detectors run: every former one (CPU, cost, Lambda
   * invocations, error rate) read aws_resources.tags -- the resource's own AWS
   * tags, customer-set text that no DevControl process writes a measurement
   * into -- and persisted/displayed it as measured data against invented
   * baselines. A detector returns only once backed by real measured data.
   */
  async scanForAnomalies(organizationId: string, _client?: PoolClient): Promise<AnomalyDetection[]> {
    console.log(`[Anomaly Detection] Scanning org ${organizationId}: no measured-data detectors are active`);
    return [];
  }
}
