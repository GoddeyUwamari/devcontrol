import cron from 'node-cron';
import { Pool } from 'pg';
import { RiskTrackingService } from '../services/risk-tracking.service';

/**
 * Risk Score Snapshot Job
 * Runs daily at 2 AM UTC to capture risk score snapshots for all organizations
 */
export class RiskScoreSnapshotJob {
  private service: RiskTrackingService;
  private task: ReturnType<typeof cron.schedule> | null = null;

  constructor(pool: Pool) {
    this.service = new RiskTrackingService(pool);
  }

  /**
   * Start the daily snapshot job
   * Runs at 2:00 AM UTC every day
   */
  start(): void {
    if (this.task) {
      console.log('[Risk Score Snapshot Job] Already running');
      return;
    }

    // Run daily at 2:00 AM UTC: '0 2 * * *'
    this.task = cron.schedule('0 2 * * *', async () => {
      console.log('[Risk Score Snapshot Job] Starting daily snapshot...');
      try {
        await this.service.storeAllOrganizationSnapshots();
        console.log('[Risk Score Snapshot Job] Snapshots completed successfully');
      } catch (error: any) {
        console.error('[Risk Score Snapshot Job] Error:', error.message);
      }
    });

    console.log('[Risk Score Snapshot Job] Started - running daily at 2:00 AM UTC');
  }

  /**
   * Stop the job
   */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log('[Risk Score Snapshot Job] Stopped');
    }
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.task !== null;
  }

  /**
   * Manually trigger snapshot (for testing or on-demand execution)
   */
  async triggerManualSnapshot(): Promise<void> {
    console.log('[Risk Score Snapshot Job] Manual snapshot triggered');
    await this.service.storeAllOrganizationSnapshots();
  }
}
