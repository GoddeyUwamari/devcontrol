import cron from 'node-cron';
import { Pool } from 'pg';
import { AWSResourceDiscoveryService } from '../services/awsResourceDiscovery';
import { Soc2EvidenceService } from '../services/soc2-evidence.service';
import { isPlatformAwsCredentialsUnavailable, isPlatformCredentialFailure } from '../services/platform-sts';
import { findEligibleAwsAccount, listIneligibleAwsAccountStatuses } from '../repositories/aws-accounts.repository';

/** One scheduled run's outcome per organization. Every organization lands in exactly one count. */
export interface DiscoveryRunSummary {
  /** Discovery ran to completion (its own sub-step errors included). */
  scanned: number;
  /** No aws_accounts row: nothing to discover, no job row, no AWS calls. */
  skipped: number;
  /** aws_accounts rows, none of them eligible (status 'active'): no job row, no AWS calls. */
  inactive: number;
  /** Discovery failed for the organization's own reasons (e.g. its role refused AssumeRole). */
  failed: number;
  /**
   * Discovery failed on the platform's side: its own AWS identity could not
   * be resolved, or its own IAM policies refused the AssumeRole.
   */
  platformFailed: number;
  /**
   * Organizations after the point where the run stopped early, never checked:
   * connected or not, nothing is known about them this run.
   */
  notAttempted: number;
}

/**
 * Consecutive organizations whose discovery failed because the platform's
 * credentials could not be resolved, after which the run stops: every other
 * organization would fail the same way. Two, so that one transient failure
 * (e.g. an instance metadata timeout) does not cost the whole cycle.
 */
const CREDENTIAL_FAILURE_STOP_STREAK = 2;

type AwsConnection = { kind: 'none' } | { kind: 'inactive'; status: string | null } | { kind: 'active' };

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
    // Get all active organizations
    const result = await this.pool.query(
      `SELECT id, name FROM organizations WHERE is_active = true`
    );

    const organizations = result.rows;
    console.log(`[Resource Discovery Job] Found ${organizations.length} active organizations`);

    await this.scanOrganizations(organizations);
  }

  /**
   * Discovery, then SOC 2 evidence, for each organization in turn, and one
   * summary line for the run.
   *
   * An organization with no aws_accounts row is skipped before anything else
   * happens, and one whose row is not active gets a single warning: neither
   * gets a discovery job row or any AWS call. Every other failure stays an
   * error: the organization's own (its role refused AssumeRole) counts as
   * failed, the platform's own (its credentials could not be resolved, or its
   * IAM policies refused the AssumeRole) counts as platform_failed.
   *
   * The run stops early only when the platform's credentials could not be
   * resolved for CREDENTIAL_FAILURE_STOP_STREAK organizations in a row. A
   * platform IAM denial never stops it: the platform's policy may allow some
   * organizations' roles and not others (e.g. a role name outside the
   * allowed pattern). Any other attempted outcome resets the streak;
   * organizations skipped before any AWS call leave it unchanged.
   */
  async scanOrganizations(organizations: Array<{ id: string; name: string }>): Promise<DiscoveryRunSummary> {
    const summary: DiscoveryRunSummary = { scanned: 0, skipped: 0, inactive: 0, failed: 0, platformFailed: 0, notAttempted: 0 };
    let credentialFailureStreak = 0;

    // Run discovery for each organization sequentially
    for (const [index, org] of organizations.entries()) {
      let connection: AwsConnection;
      try {
        connection = await this.getAwsConnection(org.id);
      } catch (error: unknown) {
        const { name, message } = error instanceof Error ? error : { name: 'Error', message: String(error) };
        console.error(`[Resource Discovery Job] Failed for org ${org.id}: could not read its AWS connection (${name}):`, message);
        summary.failed++;
        continue;
      }
      if (connection.kind === 'none') {
        summary.skipped++;
        continue;
      }
      if (connection.kind === 'inactive') {
        console.warn(`[Resource Discovery Job] Skipping org ${org.id}: AWS connection status is ${connection.status ?? 'null'}, not active`);
        summary.inactive++;
        continue;
      }

      try {
        console.log(`[Resource Discovery Job] Scanning organization: ${org.name} (${org.id})`);
        const discoveryResult = await this.service.discoverAllResources(org.id);
        credentialFailureStreak = 0;
        summary.scanned++;
        console.log(
          `[Resource Discovery Job] ${org.name}: ` +
          `Discovered ${discoveryResult.resources_discovered}, ` +
          `Updated ${discoveryResult.resources_updated}, ` +
          `Errors: ${discoveryResult.errors.length}`
        );
      } catch (error: any) {
        if (isPlatformAwsCredentialsUnavailable(error) && isPlatformCredentialFailure(error.cause)) {
          summary.platformFailed++;
          credentialFailureStreak++;
          if (credentialFailureStreak >= CREDENTIAL_FAILURE_STOP_STREAK) {
            summary.notAttempted = organizations.length - index - 1;
            console.error(
              `[Resource Discovery Job] Platform AWS credentials unavailable for ${credentialFailureStreak} organizations in a row (last org ${org.id}); ` +
              `stopping this run, ${summary.notAttempted} remaining organizations not checked`
            );
            break;
          }
          console.error(`[Resource Discovery Job] Failed for org ${org.id}: ${error.name}: platform AWS credentials unavailable`);
        } else if (isPlatformAwsCredentialsUnavailable(error)) {
          credentialFailureStreak = 0;
          summary.platformFailed++;
          console.error(`[Resource Discovery Job] Failed for org ${org.id}: ${error.name}: the platform's IAM policies refused AssumeRole for this organization's role`);
        } else {
          credentialFailureStreak = 0;
          summary.failed++;
          console.error(`[Resource Discovery Job] Failed for org ${org.id} (${error?.name ?? 'Error'}):`, error?.message);
        }
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

    console.log(
      `[Resource Discovery Job] Scanned ${summary.scanned}, skipped ${summary.skipped} (no AWS connection), ` +
      `inactive ${summary.inactive}, failed ${summary.failed}, platform_failed ${summary.platformFailed}` +
      (summary.notAttempted > 0 ? `, ${summary.notAttempted} remaining not checked (stopped early)` : '')
    );
    return summary;
  }

  /**
   * Whether the organization has a connected AWS account: its one eligible
   * account (aws-accounts.repository.ts), or else whether it has rows that are
   * not eligible. More than one eligible account throws, so the organization
   * counts as failed and is never scanned. Read inside a transaction tagged
   * for that organization (the tag ends with it) and filtered by it, so the
   * answer never comes from another organization's row.
   */
  private async getAwsConnection(organizationId: string): Promise<AwsConnection> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
      const account = await findEligibleAwsAccount(client, organizationId);
      const ineligible = account ? [] : await listIneligibleAwsAccountStatuses(client, organizationId);
      await client.query('COMMIT');
      if (account) return { kind: 'active' };
      if (ineligible.length === 0) return { kind: 'none' };
      return { kind: 'inactive', status: ineligible.length === 1 ? ineligible[0] : ineligible.map((status) => status ?? 'null').join(', ') };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
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
