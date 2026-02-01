import cron from 'node-cron';
import { Pool } from 'pg';
import { AnomalyDetectionService } from '../services/anomaly-detection.service';
import { AnomalyAIService } from '../services/anomaly-ai.service';
import { AnomalyRepository } from '../repositories/anomaly.repository';
import { AnomalyDetection } from '../types/anomaly.types';

export class AnomalyDetectionJob {
  private task: ReturnType<typeof cron.schedule> | null = null;
  private detectionService: AnomalyDetectionService;
  private aiService: AnomalyAIService;
  private repository: AnomalyRepository;
  private isRunning: boolean = false;

  constructor(private pool: Pool) {
    this.detectionService = new AnomalyDetectionService(pool);
    this.aiService = new AnomalyAIService();
    this.repository = new AnomalyRepository(pool);

    console.log('[Anomaly Detection Job] Initialized - runs every 15 minutes');
  }

  start() {
    // Run every 15 minutes
    this.task = cron.schedule('*/15 * * * *', () => this.runDetection());
    console.log('[Anomaly Detection Job] Started');
  }

  stop() {
    if (this.task) {
      this.task.stop();
    }
    console.log('[Anomaly Detection Job] Stopped');
  }

  /**
   * Run anomaly detection for all organizations
   */
  private async runDetection() {
    // Prevent concurrent runs
    if (this.isRunning) {
      console.log('[Anomaly Detection Job] Skipping - previous run still in progress');
      return;
    }

    this.isRunning = true;

    try {
      console.log('[Anomaly Detection Job] Running detection scan...');

      // Get all active organizations
      const orgsQuery = `
        SELECT id FROM organizations WHERE is_active = true
      `;
      const orgsResult = await this.pool.query(orgsQuery);

      let totalAnomalies = 0;

      for (const org of orgsResult.rows) {
        try {
          // Auto-resolve old anomalies before scanning
          await this.autoResolveOldAnomalies(org.id);

          // Detect anomalies
          let anomalies = await this.detectionService.scanForAnomalies(org.id);

          // Filter out duplicates (anomalies we've already detected recently)
          anomalies = await this.filterDuplicates(anomalies);

          if (anomalies.length > 0) {
            // Enrich with AI explanations
            anomalies = await this.aiService.explainAnomalies(anomalies);

            // Save to database
            await this.repository.saveAnomalies(anomalies);

            totalAnomalies += anomalies.length;

            console.log(`[Anomaly Detection Job] Org ${org.id}: Found ${anomalies.length} new anomalies`);
          }
        } catch (error) {
          console.error(`[Anomaly Detection Job] Error for org ${org.id}:`, error);
        }
      }

      console.log(`[Anomaly Detection Job] Complete: ${totalAnomalies} total new anomalies detected`);
    } catch (error) {
      console.error('[Anomaly Detection Job] Error:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Auto-resolve old anomalies (older than 24 hours)
   */
  private async autoResolveOldAnomalies(organizationId: string): Promise<void> {
    try {
      const result = await this.pool.query(
        `
        UPDATE anomaly_detections
        SET
          status = 'resolved',
          resolved_at = NOW(),
          notes = 'Auto-resolved after 24 hours',
          updated_at = NOW()
        WHERE organization_id = $1
          AND status = 'active'
          AND detected_at < NOW() - INTERVAL '24 hours'
        `,
        [organizationId]
      );

      if (result.rowCount && result.rowCount > 0) {
        console.log(`[Anomaly Detection Job] Auto-resolved ${result.rowCount} old anomalies for org ${organizationId}`);
      }
    } catch (error) {
      console.error('[Anomaly Detection Job] Error auto-resolving anomalies:', error);
    }
  }

  /**
   * Filter out anomalies that have been detected recently (deduplication)
   */
  private async filterDuplicates(anomalies: AnomalyDetection[]): Promise<AnomalyDetection[]> {
    const uniqueAnomalies: AnomalyDetection[] = [];

    for (const anomaly of anomalies) {
      const hasSimilar = await this.repository.hasRecentSimilar(
        anomaly.organizationId,
        anomaly.type,
        anomaly.resourceId || null,
        anomaly.metric,
        60 // 60 minute cooldown
      );

      if (!hasSimilar) {
        uniqueAnomalies.push(anomaly);
      }
    }

    return uniqueAnomalies;
  }

  /**
   * Manual trigger for testing
   */
  async triggerManual(organizationId: string): Promise<AnomalyDetection[]> {
    console.log(`[Anomaly Detection Job] Manual trigger for org ${organizationId}...`);

    // Auto-resolve old anomalies (older than 24 hours)
    await this.autoResolveOldAnomalies(organizationId);

    // Detect new anomalies
    let anomalies = await this.detectionService.scanForAnomalies(organizationId);

    // Filter out duplicates (same as scheduled job)
    anomalies = await this.filterDuplicates(anomalies);

    if (anomalies.length > 0) {
      // Enrich with AI explanations
      anomalies = await this.aiService.explainAnomalies(anomalies);

      // Save to database
      await this.repository.saveAnomalies(anomalies);
    }

    console.log(`[Anomaly Detection Job] Manual trigger complete: ${anomalies.length} new anomalies`);
    return anomalies;
  }

  /**
   * Get detection service for external use
   */
  getDetectionService(): AnomalyDetectionService {
    return this.detectionService;
  }

  /**
   * Get repository for external use
   */
  getRepository(): AnomalyRepository {
    return this.repository;
  }
}
