/**
 * Compliance evidence: DevControl's framework evaluations with their
 * applicability and staleness (S10), and customer-defined compliance
 * framework scans (S9, plan-gated). Customer-written framework names are
 * untrusted text.
 */
import { collectSection } from '../../../ai-context-contract';
import {
  frameworkEvaluationStorageAvailable,
  FRAMEWORK_STALE_AFTER_HOURS,
  readFrameworkEvaluations,
} from '../../../../repositories/framework-evaluations.repository';
import { defineProvider, iso, ref, summarizeItems, untrustedFor, withOrgClient } from './shared';

export interface FrameworkEvaluationsEvidence {
  outcome: 'found' | 'none_found';
  items: Array<{
    ref: string;
    framework: string;
    /** Whether the framework applies to this organization (enabled, disabled, not_configured, unavailable, invalid). */
    applicability: string;
    runStatus: 'complete' | 'partial';
    finishedAt: string | null;
    /** The latest finished run is older than the staleness rule. */
    aged: boolean;
    running: boolean;
    lastAttemptFailed: boolean;
    /** Current checks by evaluation state (failed, passed, unable_to_evaluate, ...); stale checks are counted apart. */
    checksByState: Record<string, number>;
    failedBySeverity: Record<string, number>;
    staleChecks: number;
  }>;
}

export const frameworkEvaluationsProvider = defineProvider<FrameworkEvaluationsEvidence>({
  id: 'compliance.framework_evaluations',
  version: 1,
  title: 'Compliance framework evaluations',
  source: 'DevControl framework evaluations',
  dataSourceIds: ['S10'],
  topics: ['compliance', 'security'],
  priority: 2,
  maxTokens: 1500,
  freshness: { maxAgeSeconds: FRAMEWORK_STALE_AFTER_HOURS * 3600, rule: `${FRAMEWORK_STALE_AFTER_HOURS} hours since the latest finished evaluation` },
  async collect({ organizationId, basis }) {
    const inventoryScope = await basis.inventoryScope();
    return collectSection<FrameworkEvaluationsEvidence>(
      {
        source: 'DevControl framework evaluations',
        classification: 'calculated',
        scope: inventoryScope,
        period: { kind: 'point_in_time' },
        coverage: "DevControl's framework checks on discovered resources, per framework and its applicability; a readiness view, not an audit or certification",
      },
      async () => withOrgClient(organizationId, async (client) => {
        if (!(await frameworkEvaluationStorageAvailable(client))) {
          return { state: 'unavailable', reason: 'framework evaluations are not set up on this database yet' };
        }
        const rows = await readFrameworkEvaluations(client, organizationId);
        if (rows.latestRuns.length === 0) {
          return { state: 'unavailable', reason: 'no framework evaluation has finished for this organization yet' };
        }
        const items = rows.latestRuns.map((run, i) => {
          const checks = rows.checks.filter((c) => c.framework === run.framework);
          const checksByState: Record<string, number> = {};
          const failedBySeverity: Record<string, number> = {};
          let staleChecks = 0;
          for (const c of checks) {
            if (c.stale) { staleChecks += 1; continue; }
            checksByState[c.evaluation_state] = (checksByState[c.evaluation_state] ?? 0) + 1;
            if (c.evaluation_state === 'failed' && c.severity) failedBySeverity[c.severity] = (failedBySeverity[c.severity] ?? 0) + 1;
          }
          const activity = rows.activity.find((a) => a.framework === run.framework);
          return {
            ref: ref('w', i),
            framework: run.framework,
            applicability: run.applicability,
            runStatus: run.status,
            finishedAt: iso(run.finished_at),
            aged: run.aged,
            running: activity?.running ?? false,
            lastAttemptFailed: activity?.last_attempt_failed ?? false,
            checksByState,
            failedBySeverity,
            staleChecks,
          };
        });
        const newest = items.reduce<string | null>((latest, i) => (i.finishedAt && (!latest || i.finishedAt > latest) ? i.finishedAt : latest), null);
        const anyFailed = items.some((i) => (i.checksByState.failed ?? 0) > 0);
        return {
          state: items.some((i) => i.runStatus === 'partial') ? 'partial' : 'available',
          reason: items.some((i) => i.runStatus === 'partial') ? 'at least one framework evaluation finished partially' : null,
          asOf: newest,
          data: { outcome: anyFailed ? 'found' : 'none_found', items },
        };
      })
    );
  },
  summarize: summarizeItems,
});

export interface CustomFrameworkScansEvidence {
  outcome: 'found' | 'none_found';
  items: Array<{
    ref: string;
    frameworkId: string;
    status: string;
    completedAt: string | null;
    complianceScorePercent: number | null;
    resourcesScanned: number;
    nonCompliantResources: number;
    issuesBySeverity: { critical: number; high: number; medium: number; low: number };
  }>;
}

export const customFrameworkScansProvider = defineProvider<CustomFrameworkScansEvidence>({
  id: 'compliance.custom_scans',
  version: 1,
  title: 'Custom compliance framework scans',
  source: 'DevControl custom compliance framework scans',
  dataSourceIds: ['S9'],
  topics: ['compliance'],
  priority: 3,
  maxTokens: 1200,
  entitlementKey: 'complianceFrameworks',
  async collect({ organizationId }) {
    return collectSection<CustomFrameworkScansEvidence>(
      {
        source: 'DevControl custom compliance framework scans',
        classification: 'calculated',
        period: { kind: 'point_in_time' },
        coverage: 'the latest completed scan of each customer-defined framework; rules are written by the customer',
      },
      async () => withOrgClient(organizationId, async (client) => {
        const { rows } = await client.query(
          `SELECT DISTINCT ON (s.framework_id)
                  s.framework_id, f.name, s.status, s.completed_at, s.compliance_score,
                  s.resources_scanned, s.non_compliant_resources,
                  s.critical_issues, s.high_issues, s.medium_issues, s.low_issues
             FROM compliance_scans s
             JOIN compliance_frameworks f ON f.id = s.framework_id AND f.organization_id = $1
            WHERE s.organization_id = $1 AND s.status = 'completed'
            ORDER BY s.framework_id, s.completed_at DESC NULLS LAST`,
          [organizationId]
        );
        if (rows.length === 0) return { state: 'unavailable', reason: 'no custom compliance framework scan has completed for this organization' };
        const items = rows.map((r, i) => ({
          ref: ref('s', i),
          frameworkId: String(r.framework_id),
          status: String(r.status),
          completedAt: iso(r.completed_at),
          complianceScorePercent: r.compliance_score === null ? null : Number(r.compliance_score),
          resourcesScanned: Number(r.resources_scanned ?? 0),
          nonCompliantResources: Number(r.non_compliant_resources ?? 0),
          issuesBySeverity: {
            critical: Number(r.critical_issues ?? 0),
            high: Number(r.high_issues ?? 0),
            medium: Number(r.medium_issues ?? 0),
            low: Number(r.low_issues ?? 0),
          },
        }));
        return {
          state: 'available',
          asOf: items.reduce<string | null>((latest, i) => (i.completedAt && (!latest || i.completedAt > latest) ? i.completedAt : latest), null),
          data: { outcome: items.some((i) => i.nonCompliantResources > 0) ? 'found' : 'none_found', items },
          untrusted: rows.flatMap((r, i) => untrustedFor(ref('s', i), 'framework name', r.name)),
        };
      })
    );
  },
  summarize: summarizeItems,
});
