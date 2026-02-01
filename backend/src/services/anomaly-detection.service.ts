import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { AnomalyDetection, AnomalyType, AnomalySeverity, TimeSeriesDataPoint } from '../types/anomaly.types';
import { AnomalyStatsService } from './anomaly-stats.service';

export class AnomalyDetectionService {
  private statsService: AnomalyStatsService;

  constructor(private pool: Pool) {
    this.statsService = new AnomalyStatsService();
  }

  /**
   * Scan for all anomalies across organization
   */
  async scanForAnomalies(organizationId: string): Promise<AnomalyDetection[]> {
    console.log(`[Anomaly Detection] Scanning org ${organizationId}...`);

    const anomalies: AnomalyDetection[] = [];

    // Run all detectors in parallel
    const [
      costAnomalies,
      cpuAnomalies,
      invocationAnomalies,
      errorRateAnomalies,
    ] = await Promise.all([
      this.detectCostAnomalies(organizationId),
      this.detectCpuAnomalies(organizationId),
      this.detectInvocationAnomalies(organizationId),
      this.detectErrorRateAnomalies(organizationId),
    ]);

    anomalies.push(
      ...costAnomalies,
      ...cpuAnomalies,
      ...invocationAnomalies,
      ...errorRateAnomalies
    );

    console.log(`[Anomaly Detection] Found ${anomalies.length} anomalies`);
    return anomalies;
  }

  /**
   * Detect cost anomalies (spikes or drops)
   */
  private async detectCostAnomalies(organizationId: string): Promise<AnomalyDetection[]> {
    // Get current total cost
    const currentCostQuery = `
      SELECT
        SUM((tags->>'estimated_monthly_cost')::numeric) as total_cost
      FROM aws_resources
      WHERE organization_id = $1
    `;

    // Get historical costs (last 30 days)
    const historicalQuery = `
      SELECT
        DATE(created_at) as date,
        SUM((tags->>'estimated_monthly_cost')::numeric) as total_cost
      FROM aws_resources
      WHERE organization_id = $1
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `;

    try {
      const [currentResult, historicalResult] = await Promise.all([
        this.pool.query(currentCostQuery, [organizationId]),
        this.pool.query(historicalQuery, [organizationId]),
      ]);

      const currentCost = parseFloat(currentResult.rows[0]?.total_cost || 0);

      if (currentCost === 0 || historicalResult.rows.length < 7) {
        return []; // Not enough data
      }

      const historicalData: TimeSeriesDataPoint[] = historicalResult.rows.map(row => ({
        timestamp: new Date(row.date),
        value: parseFloat(row.total_cost || 0),
      }));

      const analysis = this.statsService.isAnomaly(currentCost, historicalData, 'medium');

      if (analysis.isAnomaly) {
        const type: AnomalyType = currentCost > analysis.mean ? 'cost_spike' : 'cost_drop';
        const severity: AnomalySeverity = analysis.zScore > 3 ? 'critical' : 'warning';

        return [{
          id: uuidv4(),
          organizationId,
          type,
          severity,
          metric: 'total_cost',
          currentValue: currentCost,
          expectedValue: analysis.mean,
          deviation: analysis.deviation,
          historicalAverage: analysis.mean,
          historicalStdDev: analysis.stdDev,
          detectedAt: new Date(),
          timeWindow: '24h',
          title: type === 'cost_spike'
            ? `AWS Cost Spike Detected: ${Math.abs(analysis.deviation).toFixed(1)}% increase`
            : `AWS Cost Drop Detected: ${Math.abs(analysis.deviation).toFixed(1)}% decrease`,
          description: `Total AWS costs ${type === 'cost_spike' ? 'increased' : 'decreased'} from $${analysis.mean.toFixed(2)} to $${currentCost.toFixed(2)}`,
          aiExplanation: '', // Will be filled by AI service
          impact: '', // Will be filled by AI service
          recommendation: '', // Will be filled by AI service
          confidence: Math.min(95, 70 + (analysis.zScore * 5)),
          status: 'active',
        }];
      }

      return [];
    } catch (error) {
      console.error('[Anomaly Detection] Cost anomaly error:', error);
      return [];
    }
  }

  /**
   * Detect CPU utilization anomalies
   */
  private async detectCpuAnomalies(organizationId: string): Promise<AnomalyDetection[]> {
    const query = `
      SELECT
        resource_id,
        resource_name,
        resource_type,
        region,
        (tags->>'cpu_avg')::float as cpu_current,
        tags
      FROM aws_resources
      WHERE organization_id = $1
        AND resource_type = 'ec2'
        AND tags->>'cpu_avg' IS NOT NULL
        AND (tags->>'cpu_avg')::float > 80
    `;

    try {
      const result = await this.pool.query(query, [organizationId]);

      return result.rows.map(row => {
        const cpuCurrent = parseFloat(row.cpu_current);
        const cpuHistorical = parseFloat(row.tags?.cpu_historical_avg || 50);
        const deviation = cpuHistorical !== 0
          ? ((cpuCurrent - cpuHistorical) / cpuHistorical) * 100
          : 0;

        return {
          id: uuidv4(),
          organizationId,
          type: 'cpu_spike' as AnomalyType,
          severity: cpuCurrent > 90 ? 'critical' as AnomalySeverity : 'warning' as AnomalySeverity,
          resourceId: row.resource_id,
          resourceType: row.resource_type,
          resourceName: row.resource_name || row.resource_id,
          region: row.region,
          metric: 'cpu_utilization',
          currentValue: cpuCurrent,
          expectedValue: cpuHistorical,
          deviation,
          historicalAverage: cpuHistorical,
          historicalStdDev: 10, // Simplified
          detectedAt: new Date(),
          timeWindow: '1h',
          title: `High CPU Detected: ${row.resource_name || row.resource_id}`,
          description: `CPU utilization at ${cpuCurrent.toFixed(1)}% (${deviation.toFixed(0)}% above normal)`,
          aiExplanation: '',
          impact: '',
          recommendation: '',
          confidence: 85,
          status: 'active',
        };
      });
    } catch (error) {
      console.error('[Anomaly Detection] CPU anomaly error:', error);
      return [];
    }
  }

  /**
   * Detect Lambda invocation spikes
   */
  private async detectInvocationAnomalies(organizationId: string): Promise<AnomalyDetection[]> {
    const query = `
      SELECT
        resource_id,
        resource_name,
        region,
        (tags->>'invocations')::int as current_invocations,
        (tags->>'invocations_avg')::int as avg_invocations,
        tags
      FROM aws_resources
      WHERE organization_id = $1
        AND resource_type = 'lambda'
        AND tags->>'invocations' IS NOT NULL
    `;

    try {
      const result = await this.pool.query(query, [organizationId]);

      return result.rows
        .filter(row => {
          const current = parseInt(row.current_invocations || 0);
          const avg = parseInt(row.avg_invocations || current);
          const percentChange = avg > 0 ? ((current - avg) / avg) * 100 : 0;
          return Math.abs(percentChange) > 50; // 50% threshold
        })
        .map(row => {
          const current = parseInt(row.current_invocations);
          const avg = parseInt(row.avg_invocations || current);
          const deviation = avg !== 0 ? ((current - avg) / avg) * 100 : 0;

          return {
            id: uuidv4(),
            organizationId,
            type: 'invocation_spike' as AnomalyType,
            severity: Math.abs(deviation) > 100 ? 'critical' as AnomalySeverity : 'warning' as AnomalySeverity,
            resourceId: row.resource_id,
            resourceType: 'Lambda',
            resourceName: row.resource_name || row.resource_id,
            region: row.region,
            metric: 'invocations',
            currentValue: current,
            expectedValue: avg,
            deviation,
            historicalAverage: avg,
            historicalStdDev: avg * 0.2, // 20% simplified
            detectedAt: new Date(),
            timeWindow: '1h',
            title: `Lambda Invocation Spike: ${row.resource_name || row.resource_id}`,
            description: `Invocations increased ${deviation.toFixed(0)}% (${current.toLocaleString()} vs avg ${avg.toLocaleString()})`,
            aiExplanation: '',
            impact: '',
            recommendation: '',
            confidence: 80,
            status: 'active',
          };
        });
    } catch (error) {
      console.error('[Anomaly Detection] Invocation anomaly error:', error);
      return [];
    }
  }

  /**
   * Detect error rate anomalies
   */
  private async detectErrorRateAnomalies(organizationId: string): Promise<AnomalyDetection[]> {
    // Simplified - would integrate with CloudWatch metrics in production
    // For now, check if error_rate tag exists and is high
    const query = `
      SELECT
        resource_id,
        resource_name,
        resource_type,
        region,
        (tags->>'error_rate')::float as error_rate,
        tags
      FROM aws_resources
      WHERE organization_id = $1
        AND tags->>'error_rate' IS NOT NULL
        AND (tags->>'error_rate')::float > 5
    `;

    try {
      const result = await this.pool.query(query, [organizationId]);

      return result.rows.map(row => {
        const errorRate = parseFloat(row.error_rate);

        return {
          id: uuidv4(),
          organizationId,
          type: 'error_rate_spike' as AnomalyType,
          severity: errorRate > 10 ? 'critical' as AnomalySeverity : 'warning' as AnomalySeverity,
          resourceId: row.resource_id,
          resourceType: row.resource_type,
          resourceName: row.resource_name || row.resource_id,
          region: row.region,
          metric: 'error_rate',
          currentValue: errorRate,
          expectedValue: 1, // Assume 1% is normal
          deviation: errorRate - 1,
          historicalAverage: 1,
          historicalStdDev: 0.5,
          detectedAt: new Date(),
          timeWindow: '1h',
          title: `High Error Rate: ${row.resource_name || row.resource_id}`,
          description: `Error rate at ${errorRate.toFixed(1)}% (normal: <2%)`,
          aiExplanation: '',
          impact: '',
          recommendation: '',
          confidence: 90,
          status: 'active',
        };
      });
    } catch (error) {
      console.error('[Anomaly Detection] Error rate anomaly error:', error);
      return [];
    }
  }
}
