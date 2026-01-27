import cron from 'node-cron';
import { Pool } from 'pg';
import { ScheduledReportsService } from '../services/scheduled-reports.service';

/**
 * Scheduled Reports Job
 * Runs every 15 minutes to check for due reports and execute them
 */
export class ScheduledReportsJob {
  private service: ScheduledReportsService;
  private task: ReturnType<typeof cron.schedule> | null = null;

  constructor(pool: Pool) {
    this.service = new ScheduledReportsService(pool);
  }

  /**
   * Start the scheduled reports job
   * Runs every 15 minutes
   */
  start(): void {
    if (this.task) {
      console.log('[Scheduled Reports Job] Already running');
      return;
    }

    // Run every 15 minutes to check for due reports
    this.task = cron.schedule('*/15 * * * *', async () => {
      console.log('[Scheduled Reports Job] Checking for due reports...');
      try {
        await this.service.processScheduledReports();
      } catch (error: any) {
        console.error('[Scheduled Reports Job] Error:', error.message);
      }
    });

    console.log('[Scheduled Reports Job] Started - checking every 15 minutes');
  }

  /**
   * Stop the job
   */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log('[Scheduled Reports Job] Stopped');
    }
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.task !== null;
  }

  /**
   * Manually trigger report processing (for testing or on-demand execution)
   */
  async triggerManual(): Promise<void> {
    console.log('[Scheduled Reports Job] Manual trigger initiated');
    await this.service.processScheduledReports();
  }
}
