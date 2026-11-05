import { Request, Response } from 'express';
import { CostDecisionActor, CostRecommendationsRepository } from '../repositories/cost-recommendations.repository';
import { auditRequestContext } from '../services/auditEvents.service';
import { CostAnalysisRun, CostAnalysisRunDetail, CostAnalysisRunSource, CostAnalysisRunsRepository } from '../repositories/cost-analysis-runs.repository';
import { AWS_ACCOUNT_AMBIGUOUS_MESSAGE, isAwsAccountAmbiguous } from '../repositories/aws-accounts.repository';
import costOptimizationService from '../services/cost-optimization.service';
import { RemediationService, REGION_MISMATCH_PREFIX, SELF_PROTECTION_PUBLIC_MESSAGE } from '../services/remediation.service';
import { STOP_NOT_ELIGIBLE_PUBLIC_MESSAGE, isStopRefusal } from '../services/stop-instance-eligibility';
import { logRemediationError, publicRemediationMessage } from '../services/remediation-public-message';
import { isPlatformAwsCredentialsUnavailable, PLATFORM_AWS_CREDENTIALS_UNAVAILABLE, PLATFORM_AWS_UNAVAILABLE_MESSAGE } from '../services/platform-sts';
import { pool } from '../config/database';
import { RecommendationFilters, ApiResponse, RecommendationStatus } from '../types';
import { trackFunnelEventOnce } from '../services/analyticsEvents';
import { aggregateEstimatedSavings, describeCeilings } from '../services/estimated-savings';
import {
  getOptimizationRules,
  getOptimizationRuleSummary,
  OPTIMIZATION_RULE_PARAMETERS,
  getOptimizationRuleParameterDefinition,
} from '../config/optimization-rules';
import { OptimizationRuleConfigService, OptimizationRuleConfigValidationError } from '../services/optimization-rule-config.service';
import { isLeaseLost } from '../services/scan-lease';
import { isConnectionChanged } from '../services/aws-connection-fence';
import {
  CostChecksFailedError,
  CostResultsNotSavedError,
  LeaseSession,
  LeaseTiming,
  SCAN_BUSY_MESSAGE,
  isScanBusy,
  leaseTargetFor,
  waitForScanSession,
} from '../services/scan-session';
import { EMPTY_RECONCILE_COUNTS, ReconcileCounts, addReconcileCounts, summarizeDetectors } from '../services/cost-analysis-outcome';

const repository = new CostRecommendationsRepository();
const analysisRunsRepository = new CostAnalysisRunsRepository();
const remediationService = new RemediationService(pool);
const optimizationRuleConfigService = new OptimizationRuleConfigService(pool);

const UNEXPECTED_FAILURE_MESSAGE = 'The analysis did not complete due to an unexpected error.';
// execute-remediation's fixed failure text. RESOLVE_FAILED: the instance was
// stopped but marking the recommendation resolved failed (founder-approved, PR 4 M1).
export const EXECUTE_REMEDIATION_FAILED = 'Failed to execute remediation';
export const EXECUTE_REMEDIATION_RESOLVE_FAILED =
  "The instance was stopped, but this recommendation couldn't be marked resolved. Refresh to check its status.";

function errorMessage(err: unknown): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : '';
}
const COST_RESULTS_NOT_SAVED_MESSAGE = "The analysis ran, but its results couldn't be saved. Try again.";
const COST_CHECKS_FAILED_MESSAGE = 'None of the cost checks could complete. Try again.';
const PARTIAL_RUN_MESSAGE = "Some cost checks didn't complete, so these results may be incomplete.";
const INTERRUPTED_RUN_MESSAGE = 'The analysis was interrupted before it finished. Run it again.';
// Reopen answers (approved copy C14-C16, pr3-step1.md).
const REOPENED_ACTIVE_MESSAGE = "Reopened. It's back in your active recommendations.";
const REOPENED_PENDING_MESSAGE = "Reopened. It will appear after the next analysis if it's still detected.";
const ALREADY_REOPENED_MESSAGE = 'This finding was already reopened.';

/** The caller of a decision, for its audit event; null when the request names no user. */
function decisionActor(req: Request, source: CostDecisionActor['source']): CostDecisionActor | null {
  const userId = (req as any).user?.userId || (req as any).user?.id;
  return userId ? { userId, request: auditRequestContext(req), source } : null;
}

/**
 * Maps a raw analyzeAllResources() failure into a safe, non-leaking message
 * for GET /api/cost-recommendations/analysis-runs -- mirrors the same three
 * cases CostRecommendationsController.analyze()'s own catch block already
 * classifies for its HTTP error response, kept as a separate small helper
 * (rather than a refactor of that already-working catch block) to avoid
 * touching its tested, existing behavior. Never returns the raw error --
 * see cost_analysis_runs.error_message's column comment in
 * 202609060900_create_cost_analysis_runs.sql.
 */
function classifyRunFailureMessage(rawMessage: string | null): string | null {
  if (!rawMessage) return null;
  if (rawMessage.includes('COST_RESULTS_NOT_SAVED')) return COST_RESULTS_NOT_SAVED_MESSAGE;
  if (rawMessage.includes('COST_CHECKS_FAILED')) return COST_CHECKS_FAILED_MESSAGE;
  if (rawMessage.includes(PLATFORM_AWS_CREDENTIALS_UNAVAILABLE)) {
    return PLATFORM_AWS_UNAVAILABLE_MESSAGE;
  }
  if (rawMessage.includes('AWS_NOT_CONNECTED')) {
    return 'No AWS account connected for this organization.';
  }
  if (rawMessage.includes('not enabled')) {
    return 'AWS Cost Explorer or CloudWatch is not enabled for this account.';
  }
  return UNEXPECTED_FAILURE_MESSAGE;
}

/**
 * status keeps its three original values, so every existing reader of this
 * endpoint shows a partial or interrupted run as one that did not complete,
 * never as a success. run_state carries the exact state.
 */
function legacyRunStatus(run: CostAnalysisRun): 'running' | 'completed' | 'failed' {
  return run.run_state === 'running' || run.run_state === 'completed' ? run.run_state : 'failed';
}

function runMessage(run: CostAnalysisRun): string | null {
  if (run.run_state === 'partial') return PARTIAL_RUN_MESSAGE;
  if (run.run_state === 'interrupted') return INTERRUPTED_RUN_MESSAGE;
  return run.run_state === 'failed' ? classifyRunFailureMessage(run.error_message) : null;
}

export class CostRecommendationsController {
  // How Analyze waits for the scan lease (scan-session.ts). The defaults are production's; tests shorten them.
  private leaseTiming: LeaseTiming = {};

  /**
   * GET /api/cost-recommendations
   * Get all recommendations with optional filters
   */
  async getAll(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const filters: RecommendationFilters = {
        severity: req.query.severity as any,
        status: req.query.status as any,
        resource_type: req.query.resource_type as string,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
      };

      const recommendations = await repository.findAll(organizationId, filters);

      // first_value_viewed: the real customer-facing recommendation read
      // path (this endpoint, filtered to ACTIVE, is what the Cost
      // Optimization page and Dashboard both actually call). Gated on the
      // request being scoped to ACTIVE recommendations with a real dollar
      // amount to see, so an unfiltered/historical read or an empty result
      // doesn't count as "value seen." Guarded once-per-org by
      // trackFunnelEventOnce, so every refresh after the first is a no-op.
      if (filters.status === 'ACTIVE') {
        // Supported estimates only, like getStats(): a ceiling or a figure
        // with no savings_basis is not "value seen".
        const totalActiveSavings = aggregateEstimatedSavings(recommendations).total;
        if (totalActiveSavings > 0) {
          await trackFunnelEventOnce({
            organizationId,
            userId: (req as any).user?.userId ?? null,
            eventName: 'first_value_viewed',
            properties: { totalMonthlySavings: totalActiveSavings },
          });
        }
      }

      const response: ApiResponse = {
        success: true,
        data: recommendations,
        total: recommendations.length,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching cost recommendations:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch cost recommendations',
      };
      res.status(500).json(response);
    }
  }

  /**
   * GET /api/cost-recommendations/stats
   * Get recommendation statistics
   */
  async getStats(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const stats = await repository.getStats(organizationId);

      const response: ApiResponse = {
        success: true,
        data: stats,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching recommendation stats:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch recommendation statistics',
      };
      res.status(500).json(response);
    }
  }

  /**
   * GET /api/cost-recommendations/optimization-rules
   * The Optimization Rule Registry's catalog + summary counts (see
   * config/optimization-rules.ts). Not org-scoped -- the registry is static,
   * code-defined metadata, not data derived from any organization's AWS
   * account -- so this never queries the database. Requires authentication
   * only, consistent with every other route on this router.
   *
   * This is the single source the frontend now reads to know which checks
   * are actually implemented vs merely registered/planned -- see
   * app/(app)/cost-optimization/page.tsx, which previously hardcoded its own
   * SCAN_CHECKS list and could silently drift from what analyzeAllResources()
   * actually runs.
   *
   * Enterprise Workstream 3B, Phase E: each rule entry additionally carries
   * `configurable` and `parameters` -- static parameter DEFINITIONS only
   * (type/default/min/max/unit), never any organization's actual effective
   * value or override. This is why extending this existing, non-Enterprise-
   * gated catalog is safe: "ec2_idle supports a tunable CPU threshold" is
   * product metadata available to every tier (drives upsell messaging); an
   * organization's actual configured value is a separate, Enterprise-gated
   * concern -- see getOptimizationRulesConfiguration() below, never
   * accidentally exposed here.
   */
  async getOptimizationRules(req: Request, res: Response): Promise<void> {
    try {
      const rules = getOptimizationRules().map((rule) => {
        const parameters = OPTIMIZATION_RULE_PARAMETERS.filter((p) => p.ruleId === rule.id).map((p) => ({
          parameterId: p.parameterId,
          type: p.type,
          default: p.default,
          min: p.min,
          max: p.max,
          unit: p.unit,
        }));
        return { ...rule, configurable: parameters.length > 0, parameters };
      });

      const response: ApiResponse = {
        success: true,
        data: {
          rules,
          summary: getOptimizationRuleSummary(),
        },
      };
      res.json(response);
    } catch (error) {
      console.error('Error fetching optimization rule catalog:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch optimization rule catalog',
      };
      res.status(500).json(response);
    }
  }

  /**
   * GET /api/cost-recommendations/optimization-rules/configuration
   * Enterprise Workstream 3B, Phase E. This organization's actual effective
   * configuration (default or override, plus provenance) for every
   * configurable rule/parameter -- the org-specific data deliberately kept
   * out of the public catalog above. Enterprise-gated at the route level
   * (see cost-recommendations.routes.ts); this method itself still scopes
   * every resolution to the authenticated caller's own organizationId, never
   * a client-supplied one.
   */
  async getOptimizationRulesConfiguration(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const data = await Promise.all(
        OPTIMIZATION_RULE_PARAMETERS.map(async (definition) => {
          const effective = await optimizationRuleConfigService.resolveEffectiveConfig(
            organizationId,
            definition.ruleId,
            definition.parameterId
          );
          return {
            ruleId: definition.ruleId,
            parameterId: definition.parameterId,
            value: effective.value,
            source: effective.source,
            default: definition.default,
            min: definition.min,
            max: definition.max,
            unit: definition.unit,
            type: definition.type,
          };
        })
      );

      const response: ApiResponse = { success: true, data };
      res.json(response);
    } catch (error) {
      console.error('Error fetching optimization rule configuration:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch optimization rule configuration',
      };
      res.status(500).json(response);
    }
  }

  /**
   * PUT /api/cost-recommendations/optimization-rules/configuration/:ruleId/:parameterId
   * Enterprise Workstream 3B, Phase E. Sets (upserts) this organization's
   * override for one parameter. Enterprise-gated at the route level.
   * organizationId always comes from the authenticated request context,
   * never from the URL or body -- :ruleId/:parameterId identify WHICH
   * parameter, not WHOSE organization.
   */
  async updateOptimizationRuleConfiguration(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { ruleId, parameterId } = req.params;
      const rawValue = req.body?.value;
      const value = typeof rawValue === 'string' ? parseFloat(rawValue) : rawValue;

      const updated = await optimizationRuleConfigService.upsertOverride(organizationId, ruleId, parameterId, value);

      const response: ApiResponse = {
        success: true,
        data: {
          ruleId: updated.ruleId,
          parameterId: updated.parameterId,
          value: updated.value,
          source: 'organization_override',
        },
        message: 'Configuration updated',
      };
      res.json(response);
    } catch (error: any) {
      console.error('Error updating optimization rule configuration:', error);
      const status = error instanceof OptimizationRuleConfigValidationError ? 400 : 500;
      const response: ApiResponse = {
        success: false,
        error: error?.message || 'Failed to update optimization rule configuration',
      };
      res.status(status).json(response);
    }
  }

  /**
   * DELETE /api/cost-recommendations/optimization-rules/configuration/:ruleId/:parameterId
   * Enterprise Workstream 3B, Phase E. Resets this organization's parameter
   * to the registry default by deleting its override row -- never by storing
   * the default value (see optimization-rule-config.service.ts). Enterprise-
   * gated at the route level. Rejects an unsupported rule/parameter pair
   * with 400 rather than silently no-op'ing, so a client can't mistake a
   * garbage combination for a successful reset.
   */
  async resetOptimizationRuleConfiguration(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { ruleId, parameterId } = req.params;
      if (!getOptimizationRuleParameterDefinition(ruleId, parameterId)) {
        res.status(400).json({ success: false, error: `Unsupported rule/parameter combination: ${ruleId}/${parameterId}` });
        return;
      }

      await optimizationRuleConfigService.deleteOverride(organizationId, ruleId, parameterId);

      const response: ApiResponse = { success: true, message: 'Configuration reset to default' };
      res.json(response);
    } catch (error) {
      console.error('Error resetting optimization rule configuration:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to reset optimization rule configuration',
      };
      res.status(500).json(response);
    }
  }

  /**
   * GET /api/cost-recommendations/:id
   * Get a single recommendation by ID
   */
  async getById(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const recommendation = await repository.findById(id, organizationId);

      if (!recommendation) {
        const response: ApiResponse = {
          success: false,
          error: 'Recommendation not found',
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse = {
        success: true,
        data: recommendation,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching recommendation:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch recommendation',
      };
      res.status(500).json(response);
    }
  }

  /**
   * POST /api/cost-recommendations/analyze
   * Analyze AWS resources and generate recommendations
   */
  async analyze(req: Request, res: Response): Promise<void> {
    // Tracks this manual invocation in cost_analysis_runs, separately from
    // resource_discovery_jobs (which only the scheduled discovery cron
    // writes to -- see 202609060900_create_cost_analysis_runs.sql for why
    // the two are not merged). Bookkeeping failures here are logged and
    // swallowed, never allowed to block or alter the real analysis behavior
    // below, which is unchanged from before this run-tracking was added.
    let organizationIdForRun: string | undefined;
    let runId: string | undefined;
    let session: LeaseSession | undefined;
    let failureDetail: CostAnalysisRunDetail | undefined;

    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      organizationIdForRun = organizationId;

      try {
        const run = await analysisRunsRepository.create(organizationId);
        runId = run.id;
      } catch (trackingErr) {
        console.error('Failed to create cost_analysis_runs row (non-fatal, analysis proceeds):', trackingErr);
      }

      console.log(`Starting cost optimization analysis for org ${organizationId}...`);

      // The scan lease discovery uses (multi-region plan M4b, §4.6): Analyze changes the
      // same rows, so it waits for a running scan (every SCAN_WAIT_POLL_MS, up to
      // SCAN_WAIT_CAP_MS, then 409), then holds the lease while it runs. With no
      // eligible account there is no lease to take: the analysis below then fails
      // exactly as it does without one, before it writes anything.
      //
      // AWS connect PR B: the lease target (AWS account + connection identity) is ONE
      // read of the eligible row, and the analysis's clients must come from that same
      // row (expectedConnection), or it stops before any AWS call: a lease taken for
      // one connection never guards results fetched with another's credentials.
      const leaseTarget = await leaseTargetFor(pool, organizationId);
      if (leaseTarget) {
        session = await waitForScanSession(pool, organizationId, leaseTarget, this.leaseTiming);
        await this.recordLeaseAcquired(session.lease.acquiredAt, organizationId, runId);
      }

      // Run the analysis against this org's connected AWS account
      const { observations, riRecommendations, riSucceeded, homeRegion } = await costOptimizationService.analyzeAllResources(
        organizationId,
        undefined,
        leaseTarget ? { expectedConnection: leaseTarget.connection } : {}
      );
      // Without the lease nothing below is written, so this run has no result to report.
      if (!session) throw new CostResultsNotSavedError();
      // The home-listed detectors' rows are reconciled in the region they listed
      // (no region when AWS is not connected: there is then nothing to reconcile).
      const costScope = homeRegion && session ? { homeRegion } : undefined;
      const lease = session;

      // Occurrence-lifecycle reconciliation for the 3 resource-level detectors
      // (idle EC2, unused EIPs, EBS, S3, Lambda, DynamoDB; the retired oversized-RDS
      // category always reports an empty observation): suppresses an unchanged
      // Resolve/Dismiss'd finding instead of resurrecting it every scan, and
      // only ends that suppression once a detector successfully, completely
      // observes the condition is genuinely gone.
      // F12: fenced with the lease, after the detectors' AWS calls.
      let nonRIInsertedCount = 0;
      let counts: ReconcileCounts | undefined = { ...EMPTY_RECONCILE_COUNTS };
      if (lease) {
        lease.checkpoint();
        const reconciled = await lease.watch(() =>
          repository.reconcileActiveRecommendations(organizationId, observations, costScope, lease.lease, runId ?? null)
        );
        nonRIInsertedCount = reconciled.insertedCount;
        counts = reconciled.counts;
      }

      // Reserved Instance Opportunities are excluded from the occurrence
      // lifecycle -- synthetic, fleet-level aggregate identity, not a
      // discrete resource -- and keep delete+recreate, but only when the RI
      // check completed: a failed check leaves the stored RI rows as they are.
      // Delete and insert share one transaction.
      let riInsertedCount = 0;
      if (riSucceeded && costScope && lease) {
        // F13: fenced with the lease.
        const replaced = await lease.watch(() =>
          repository.replaceReservedInstanceRecommendations(organizationId, costScope, riRecommendations, lease.lease)
        );
        riInsertedCount = replaced.insertedCount;
        counts = counts && replaced.counts ? addReconcileCounts(counts, replaced.counts) : undefined;
      }

      const insertedCount = nonRIInsertedCount + riInsertedCount;
      const detail: CostAnalysisRunDetail = {
        summary: summarizeDetectors(observations, riSucceeded, riRecommendations),
        counts: counts ?? null,
      };

      // No detector completed: this is a failure, never "found nothing".
      if (detail.summary.state === 'failed') {
        failureDetail = detail;
        throw new CostChecksFailedError();
      }

      // Get updated stats
      const stats = await repository.getStats(organizationId);

      // first_insight_generated: any persisted recommendation existing for
      // this org after a real scan, regardless of dollar amount -- mirrors
      // the funnel's original intent, now against the authoritative table.
      // Guarded once-per-org so repeated/retried scans never re-fire it.
      if (insertedCount > 0) {
        await trackFunnelEventOnce({
          organizationId,
          userId: (req as any).user?.userId ?? null,
          eventName: 'first_insight_generated',
          properties: {
            recommendationCount: insertedCount,
            totalMonthlySavings: stats.total_potential_savings,
          },
        });
      }

      // Only ever finished here, after analyzeAllResources() and reconciliation
      // have both actually succeeded -- never speculatively.
      // Fenced with the lease (AWS connect PR B): a lost lease or a changed connection
      // is rethrown, so the catch below closes this run's own row as interrupted.
      if (runId) {
        try {
          await lease.watch(() =>
            analysisRunsRepository.markFinished(runId!, organizationId, {
              recommendationsFound: insertedCount,
              totalPotentialSavings: stats.total_potential_savings,
              ...detail,
            }, lease.lease)
          );
        } catch (trackingErr) {
          if (isLeaseLost(trackingErr)) throw trackingErr;
          console.error('Failed to record the finished cost_analysis_runs row (non-fatal):', trackingErr);
        }
      }

      const response: ApiResponse = {
        success: true,
        data: {
          recommendationsFound: insertedCount,
          totalPotentialSavings: stats.total_potential_savings,
          totalPotentialSavingsCeiling: stats.potential_savings_ceiling,
          bySeverity: stats.by_severity,
          timestamp: new Date().toISOString(),
          runState: detail.summary.state,
          failedDetectorCount: detail.summary.failedDetectorCount,
          unknownResourceCount: detail.summary.unknownResourceCount,
          counts: detail.counts,
        },
        message:
          `Analysis complete. Found ${insertedCount} optimization opportunities with estimated potential savings of $${stats.total_potential_savings.toFixed(2)}/month.` +
          describeCeilings(stats.potential_savings_ceiling_by_resource_type, (amount) => `$${amount.toFixed(2)}`, 'month')
            .map((line) => ` ${line}.`)
            .join(''),
      };

      // The success path's one outcome line: run ID and counts only, no organization, account or resource ID.
      const outcomeCounts = detail.counts;
      console.log(
        `[CostAnalysis] Manual run ${runId ?? 'untracked'} ${detail.summary.state}: ` +
        `detected ${outcomeCounts?.detected ?? 'unrecorded'}, persisted ${outcomeCounts?.persisted ?? 'unrecorded'}, ` +
        `suppressed ${outcomeCounts ? outcomeCounts.suppressedResolved + outcomeCounts.suppressedDismissed : 'unrecorded'}, ` +
        `failed checks ${detail.summary.failedDetectorCount}, unknown resources ${detail.summary.unknownResourceCount}`
      );
      res.json(response);
    } catch (error: any) {
      console.error('Error analyzing AWS resources:', error);

      // Real error preserved server-side for diagnostics; never marked
      // completed. A lost lease is an interruption, anything else a failure.
      if (runId && organizationIdForRun) {
        try {
          if (isLeaseLost(error) || isConnectionChanged(error)) {
            await analysisRunsRepository.markInterrupted(runId, organizationIdForRun);
          } else {
            await analysisRunsRepository.markFailed(runId, organizationIdForRun, error?.message || 'Unknown error', failureDetail);
          }
        } catch (trackingErr) {
          console.error('Failed to mark cost_analysis_runs failed (non-fatal):', trackingErr);
        }
      }

      // Another scan took the lease over while Analyze held it: the run is recorded
      // interrupted, so the answer says so (approved text), never error.message
      // (a lease error names the organization and the AWS account).
      if (isLeaseLost(error) || isConnectionChanged(error)) {
        const response: ApiResponse = { success: false, error: INTERRUPTED_RUN_MESSAGE };
        res.status(409).json(response);
        return;
      }

      // A scan was still running after the wait cap: the approved fixed text.
      if (isScanBusy(error)) {
        const response: ApiResponse = { success: false, error: SCAN_BUSY_MESSAGE };
        res.status(409).json(response);
        return;
      }

      if (error instanceof CostResultsNotSavedError) {
        res.status(503).json({ success: false, error: COST_RESULTS_NOT_SAVED_MESSAGE } as ApiResponse);
        return;
      }

      if (error instanceof CostChecksFailedError) {
        res.status(503).json({ success: false, error: COST_CHECKS_FAILED_MESSAGE } as ApiResponse);
        return;
      }

      // Check for specific AWS errors
      if (isAwsAccountAmbiguous(error)) {
        const response: ApiResponse = { success: false, error: AWS_ACCOUNT_AMBIGUOUS_MESSAGE };
        res.status(409).json(response);
        return;
      }

      if (isPlatformAwsCredentialsUnavailable(error)) {
        const response: ApiResponse = { success: false, error: PLATFORM_AWS_UNAVAILABLE_MESSAGE };
        res.status(503).json(response);
        return;
      }

      if (error.message && error.message.includes('AWS_NOT_CONNECTED')) {
        const response: ApiResponse = {
          success: false,
          error: 'No AWS account connected for this organization. Connect one to run cost analysis.',
        };
        res.status(400).json(response);
        return;
      }

      if (error.message && error.message.includes('not enabled')) {
        const response: ApiResponse = {
          success: false,
          error: 'AWS Cost Explorer or CloudWatch is not enabled. Please enable it in your AWS account.',
        };
        res.status(503).json(response);
        return;
      }

      const response: ApiResponse = {
        success: false,
        // The page shows this text: never error.message, which can hold ARNs or raw AWS text.
        error: UNEXPECTED_FAILURE_MESSAGE,
      };
      res.status(500).json(response);
    } finally {
      // Every path: the heartbeat stops and the lease is released (or expires).
      await session?.end();
    }
  }

  /**
   * This Analyze now holds the scan lease: closes any run whose worker is gone,
   * then records that this run took the lease. Bookkeeping: it never stops the analysis.
   */
  private async recordLeaseAcquired(acquiredAt: Date, organizationId: string, runId: string | undefined): Promise<void> {
    try {
      await analysisRunsRepository.recoverInterrupted(organizationId, acquiredAt);
      if (runId) await analysisRunsRepository.markLeaseAcquired(runId, organizationId, acquiredAt);
    } catch (trackingErr) {
      console.error('Failed to record the scan lease on cost_analysis_runs (non-fatal):', trackingErr);
    }
  }

  /**
   * GET /api/cost-recommendations/analysis-runs
   * Cost analysis history for this org, latest first. Manual runs by default,
   * which is what every existing reader expects; ?source=all adds the cost step
   * of discovery scans. See cost-analysis-runs.repository.ts.
   *
   * Deliberately does not return the raw error_message column -- see
   * classifyRunFailureMessage() above.
   */
  async getAnalysisRuns(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string) : 5;
      const source: CostAnalysisRunSource | null = req.query.source === 'all' ? null : 'manual';
      const runs = await analysisRunsRepository.getLatest(organizationId, limit, source);

      const data = runs.map((run) => ({
        id: run.id,
        status: legacyRunStatus(run),
        recommendations_found: run.recommendations_found,
        total_potential_savings: run.total_potential_savings,
        started_at: run.started_at,
        completed_at: run.completed_at,
        created_at: run.created_at,
        error_message: runMessage(run),
        run_state: run.run_state,
        source: run.source,
        detected_count: run.detected_count,
        new_count: run.new_count,
        refreshed_count: run.refreshed_count,
        suppressed_resolved_count: run.suppressed_resolved_count,
        suppressed_dismissed_count: run.suppressed_dismissed_count,
        duplicate_count: run.duplicate_count,
        persisted_count: run.persisted_count,
        failed_detector_count: run.failed_detector_count,
        unknown_resource_count: run.unknown_resource_count,
        checks: run.checks,
      }));

      const response: ApiResponse = { success: true, data };
      res.json(response);
    } catch (error) {
      console.error('Error fetching cost analysis runs:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch cost analysis runs',
      };
      res.status(500).json(response);
    }
  }

  /**
   * GET /api/cost-recommendations/hidden
   * Every finding a Resolved or Dismissed decision hides, one item per finding,
   * each judged still detected or not confirmed by its own latest observation,
   * plus the resolved/dismissed split and the still-detected group's count and
   * estimated savings (the same estimate and ceiling rules as /stats). None of
   * it is in /stats or any other ACTIVE total. Any role: read-only, like /stats.
   */
  async getHidden(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const hidden = await repository.getHiddenFindings(organizationId);
      const response: ApiResponse = { success: true, data: hidden };
      res.json(response);
    } catch (error) {
      console.error('Error fetching hidden cost recommendations:', error);
      const response: ApiResponse = { success: false, error: 'Failed to fetch hidden recommendations' };
      res.status(500).json(response);
    }
  }

  /**
   * POST /api/cost-recommendations/:id/reopen
   * Reopens the finding `id` belongs to (any of its rows). Member or above
   * (route). Idempotent: a finding nothing hides any more answers
   * reopened: false and changes nothing.
   */
  async reopen(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      const actor = decisionActor(req, 'button');
      if (!organizationId || !actor) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const result = await repository.reopen(req.params.id, organizationId, actor);

      if (result.outcome === 'not_found') {
        res.status(404).json({ success: false, error: 'Recommendation not found' } as ApiResponse);
        return;
      }
      if (result.outcome === 'not_applicable') {
        res.status(400).json({ success: false, error: 'This type of recommendation is never hidden, so it cannot be reopened.' } as ApiResponse);
        return;
      }
      if (result.outcome === 'already_open') {
        res.json({ success: true, data: { reopened: false, reason: 'already_open' }, message: ALREADY_REOPENED_MESSAGE } as ApiResponse);
        return;
      }

      const response: ApiResponse = {
        success: true,
        data: {
          reopened: true,
          rowsEnded: result.rowsEnded,
          activeNow: result.activeNow,
          recommendation: result.recommendation,
        },
        message: result.activeNow ? REOPENED_ACTIVE_MESSAGE : REOPENED_PENDING_MESSAGE,
      };
      res.json(response);
    } catch (error) {
      console.error('Error reopening recommendation:', error);
      const response: ApiResponse = { success: false, error: 'Failed to reopen recommendation' };
      res.status(500).json(response);
    }
  }

  /**
   * PATCH /api/cost-recommendations/:id/resolve
   * Mark a recommendation as resolved
   */
  async resolve(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const actor = decisionActor(req, 'button');
      if (!actor) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      const updated = await repository.updateStatus(id, 'RESOLVED', organizationId, actor);

      if (!updated) {
        const response: ApiResponse = {
          success: false,
          error: 'Recommendation not found',
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse = {
        success: true,
        data: updated,
        message: 'Recommendation marked as resolved',
      };

      res.json(response);
    } catch (error) {
      console.error('Error resolving recommendation:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to resolve recommendation',
      };
      res.status(500).json(response);
    }
  }

  /**
   * POST /api/cost-recommendations/:id/execute-remediation
   * Idle EC2 recommendations only. Creates, approves, and executes a real
   * stop_instance remediation workflow via RemediationService, then marks the
   * recommendation resolved. Route-level middleware restricts this to
   * enterprise-tier orgs with an admin/owner user — see cost-recommendations.routes.ts.
   * Deliberately a separate endpoint from PATCH /:id/resolve so execution is
   * never a side effect of a routine status update; the frontend calls this
   * only after the user confirms an explicit "this will stop instance X" dialog.
   */
  async executeRemediation(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    let workflowId: string | undefined;

    try {
      const organizationId = (req as any).user?.organizationId;
      const userId = (req as any).user?.userId || (req as any).user?.id;
      if (!organizationId || !userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const recommendation = await repository.findById(id, organizationId);

      if (!recommendation) {
        res.status(404).json({ success: false, error: 'Recommendation not found' });
        return;
      }

      if (recommendation.resource_type !== 'EC2' || recommendation.issue !== 'Idle Instance') {
        res.status(400).json({
          success: false,
          error: 'Automated execution is only available for Idle EC2 recommendations.',
        });
        return;
      }

      if (recommendation.status !== 'ACTIVE') {
        res.status(400).json({
          success: false,
          error: `Cannot execute — recommendation is already ${recommendation.status}.`,
        });
        return;
      }

      // For the audit record if the stop is refused at any stage.
      const context = { path: 'execute_remediation' as const, request: auditRequestContext(req) };

      // Refused here (nothing created) unless the finding is eligible for a stop.
      const workflow = await remediationService.createWorkflow(
        organizationId,
        {
          recommendationId: recommendation.id,
          resourceId: recommendation.resource_id,
          resourceType: 'EC2',
          actionType: 'stop_instance',
          actionParams: {
            resource_id: recommendation.resource_id,
            region: recommendation.aws_region,
          },
          estimatedSavings: Number(recommendation.potential_savings) || 0,
          riskLevel: 'low',
        },
        userId,
        context
      );
      workflowId = workflow.id;

      await remediationService.approve(workflow.id, organizationId, userId, req.ip, context);

      // Every failure below answers with fixed text (or a known fixed
      // refusal). AWS SDK and database errors -- which can quote ARNs, SQL or
      // row values -- are logged server-side through safeErrorFields only.
      let executed: Awaited<ReturnType<RemediationService['execute']>>;
      try {
        executed = await remediationService.execute(workflow.id, organizationId, userId, req.ip, context);
      } catch (execErr: unknown) {
        const message = errorMessage(execErr);
        logRemediationError('execute-remediation execute', workflow.id, execErr);
        if (message.startsWith('DRY_RUN_MODE')) {
          // Kill-switch is off, so nothing ran. Leave the recommendation
          // ACTIVE and close the workflow this request approved, so it is
          // neither reported as done nor left behind as executable.
          await remediationService.closeUnexecuted(workflow.id, organizationId, userId, message, req.ip);
          res.status(400).json({ success: false, error: publicRemediationMessage(execErr, EXECUTE_REMEDIATION_FAILED), data: { workflowId: workflow.id } });
          return;
        }

        if (isStopRefusal(message)) {
          // The finding stopped being eligible after this request created the
          // workflow: nothing was changed in AWS, and the recommendation is left as it is.
          res.status(403).json({ success: false, error: STOP_NOT_ELIGIBLE_PUBLIC_MESSAGE, data: { workflowId: workflow.id } });
          return;
        }

        if (message.startsWith('REMEDIATION_BLOCKED')) {
          // Safety guard tripped — leave the recommendation ACTIVE so the
          // block is visible, do not silently mark it resolved.
          res.status(403).json({ success: false, error: publicRemediationMessage(execErr, SELF_PROTECTION_PUBLIC_MESSAGE), data: { workflowId: workflow.id } });
          return;
        }

        // Execution failed (or its bookkeeping did) — leave the recommendation
        // ACTIVE so it can be retried or investigated via the Remediation
        // page's audit trail.
        res.status(500).json({ success: false, error: EXECUTE_REMEDIATION_FAILED, data: { workflowId: workflow.id } });
        return;
      }

      let resolved: Awaited<ReturnType<CostRecommendationsRepository['updateStatus']>>;
      try {
        resolved = await repository.updateStatus(id, 'RESOLVED', organizationId, {
          userId,
          request: auditRequestContext(req),
          source: 'execute_remediation',
        });
      } catch (resolveErr: unknown) {
        // The instance was stopped; only marking the recommendation resolved
        // (its row update or audit write) failed.
        logRemediationError('execute-remediation resolve', workflow.id, resolveErr);
        res.status(500).json({ success: false, error: EXECUTE_REMEDIATION_RESOLVE_FAILED, data: { workflowId: workflow.id } });
        return;
      }

      res.json({
        success: true,
        data: { recommendation: resolved, workflow: executed },
        message: `Instance ${recommendation.resource_id} stopped successfully.`,
      });
    } catch (error: unknown) {
      logRemediationError('execute-remediation', workflowId, error);
      if (isStopRefusal(errorMessage(error))) {
        // Not eligible for a stop: refused before any AWS call.
        res.status(403).json({
          success: false,
          error: STOP_NOT_ELIGIBLE_PUBLIC_MESSAGE,
          ...(workflowId ? { data: { workflowId } } : {}),
        });
        return;
      }
      if (errorMessage(error).startsWith(REGION_MISMATCH_PREFIX)) {
        // The recommendation's region contradicts the inventory: nothing was created.
        res.status(400).json({ success: false, error: publicRemediationMessage(error, EXECUTE_REMEDIATION_FAILED) });
        return;
      }
      res.status(500).json({
        success: false,
        error: EXECUTE_REMEDIATION_FAILED,
        data: workflowId ? { workflowId } : undefined,
      });
    }
  }

  /**
   * PATCH /api/cost-recommendations/:id/dismiss
   * Mark a recommendation as dismissed
   */
  async dismiss(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const actor = decisionActor(req, 'button');
      if (!actor) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      const updated = await repository.updateStatus(id, 'DISMISSED', organizationId, actor);

      if (!updated) {
        const response: ApiResponse = {
          success: false,
          error: 'Recommendation not found',
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse = {
        success: true,
        data: updated,
        message: 'Recommendation dismissed',
      };

      res.json(response);
    } catch (error) {
      console.error('Error dismissing recommendation:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to dismiss recommendation',
      };
      res.status(500).json(response);
    }
  }

  /**
   * DELETE /api/cost-recommendations/:id
   * Delete a recommendation
   */
  async delete(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const actor = decisionActor(req, 'button');
      if (!actor) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const deleted = await repository.delete(id, organizationId, actor);

      if (!deleted) {
        const response: ApiResponse = {
          success: false,
          error: 'Recommendation not found',
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse = {
        success: true,
        message: 'Recommendation deleted successfully',
      };

      res.json(response);
    } catch (error) {
      console.error('Error deleting recommendation:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to delete recommendation',
      };
      res.status(500).json(response);
    }
  }
}
