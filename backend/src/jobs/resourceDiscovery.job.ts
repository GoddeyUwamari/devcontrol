import cron from 'node-cron';
import { Pool } from 'pg';
import { AWSResourceDiscoveryService } from '../services/awsResourceDiscovery';
import { Soc2EvidenceService } from '../services/soc2-evidence.service';

/**
 * Resource Discovery Background Job
 * Runs every 6 hours to discover AWS resources across all active organizations
 *
 * PHASE 5: also the sole production trigger for SOC 2 evidence computation
 * (Soc2EvidenceService.computeAndPersistEvidence) -- see runDiscoveryForAllOrganizations()
 * for the exact per-organization sequencing and failure-isolation reasoning. No other
 * discovery entry point (synchronous /api/services/discover, fire-and-forget
 * /api/aws/accounts connect, or legacy /api/aws-resources/discover) triggers SOC 2
 * computation -- this is deliberate (Option B from the Phase 5 audit), not an oversight.
 */
export class ResourceDiscoveryJob {
  private service: AWSResourceDiscoveryService;
  private soc2EvidenceService: Soc2EvidenceService;
 private task: ReturnType<typeof cron.schedule> | null = null;

  constructor(private pool: Pool) {
    this.service = new AWSResourceDiscoveryService(pool);
    this.soc2EvidenceService = new Soc2EvidenceService(pool);
  }

  /**
   * Start the resource discovery job
   * Runs every 6 hours (at minute 0 of hours 0, 6, 12, 18)
   */
  start(): void {
    if (this.task) {
      console.log('[Resource Discovery Job] Already running');
      return;
    }

    // Run every 6 hours: '0 */6 * * *' (at minute 0 of every 6th hour)
    // For testing, you can use '*/5 * * * *' (every 5 minutes)
    this.task = cron.schedule('0 */6 * * *', async () => {
      console.log('[Resource Discovery Job] Starting scheduled discovery scan...');
      try {
        await this.runDiscoveryForAllOrganizations();
        console.log('[Resource Discovery Job] Scan completed successfully');
      } catch (error: any) {
        console.error('[Resource Discovery Job] Error during scan:', error.message);
      }
    });

    console.log('[Resource Discovery Job] Started - scanning resources every 6 hours');

    // Optionally run immediately on start (commented out to avoid immediate scan)
    // this.runDiscoveryForAllOrganizations()
    //   .then(() => console.log('[Resource Discovery Job] Initial scan completed'))
    //   .catch((error: any) => console.error('[Resource Discovery Job] Initial scan failed:', error.message));
  }

  /**
   * Run discovery for all active organizations
   */
  private async runDiscoveryForAllOrganizations(): Promise<void> {
    const client = await this.pool.connect();
    try {
      // Get all active organizations
      const result = await client.query(
        `SELECT id, name FROM organizations WHERE is_active = true`
      );

      const organizations = result.rows;
      console.log(`[Resource Discovery Job] Found ${organizations.length} active organizations`);

      // Run discovery for each organization sequentially
      for (const org of organizations) {
        try {
          console.log(`[Resource Discovery Job] Scanning organization: ${org.name} (${org.id})`);
          const discoveryResult = await this.service.discoverAllResources(org.id);
          console.log(
            `[Resource Discovery Job] ${org.name}: ` +
            `Discovered ${discoveryResult.resources_discovered}, ` +
            `Updated ${discoveryResult.resources_updated}, ` +
            `Errors: ${discoveryResult.errors.length}`
          );
        } catch (error: any) {
          console.error(`[Resource Discovery Job] Failed for ${org.name}:`, error.message);
          // Continue with next organization even if this one fails -- and skip SOC 2
          // computation for it this cycle (below): discoverAllResources() throwing here
          // means it never reached its own resource_discovery_jobs completion write for
          // this attempt, so there is nothing new for this cycle to compute from.
          continue;
        }

        // PHASE 5 -- SOC 2 evidence computation. Runs strictly after this organization's
        // discovery attempt has finished and persisted its own completion state
        // (resource_discovery_jobs, aws_resources, account_security_findings).
        //
        // Deliberately its own try/catch, entirely separate from discovery's above: a
        // SOC 2 computation failure must never be reported as, or mistaken for, a
        // discovery failure, and must never stop this loop from reaching the next
        // organization -- discovery for this organization already succeeded/was
        // recorded above regardless of what happens next.
        //
        // No separate completeness gate is re-implemented here on purpose:
        // computeAndPersistEvidence() already consults the one structurally-persisted
        // completeness signal (Soc2EvidenceRepository.isLatestDiscoveryComplete(), i.e.
        // resource_discovery_jobs.compliance_scan_completed) internally, per criterion,
        // to decide whether an absence of findings may become SUPPORTS or must stay
        // UNKNOWN. A second, cruder gate here (e.g. skipping computation whenever
        // discoveryResult.errors is non-empty) would be wrong, not just redundant: that
        // errors array also covers cost-analysis and orphaned-resource detection, which
        // have nothing to do with SOC 2's actual evidence sources, and would
        // needlessly withhold evidence for an organization whose aws_resources /
        // account_security_findings are otherwise fine and fresh -- the same
        // whole-job-status pitfall onboarding.service.ts already avoids by checking
        // aws_resources directly instead of resource_discovery_jobs.status.
        try {
          const soc2StartedAt = Date.now();
          await this.soc2EvidenceService.computeAndPersistEvidence(org.id);
          console.log(
            `[Resource Discovery Job] ${org.name}: SOC 2 evidence computed (${Date.now() - soc2StartedAt}ms)`
          );
        } catch (error: any) {
          console.error(
            `[Resource Discovery Job] SOC 2 evidence computation failed for ${org.name}:`,
            error.message
          );
          // Non-fatal: this organization's discovery result above is unaffected, and
          // the loop continues to the next organization regardless.
        }
      }
    } finally {
      client.release();
    }
  }

  /**
   * Stop the resource discovery job
   */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log('[Resource Discovery Job] Stopped');
    }
  }

  /**
   * Check if the job is running
   */
  isRunning(): boolean {
    return this.task !== null;
  }

  /**
   * Manually trigger discovery for all organizations (for testing)
   */
  async triggerManualScan(): Promise<void> {
    console.log('[Resource Discovery Job] Manual scan triggered');
    await this.runDiscoveryForAllOrganizations();
  }
}
