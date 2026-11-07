/**
 * Security evidence: account security findings with the customer's
 * dispositions (S7), Top Risk (S11), whether the latest security evaluation is
 * current, configuration checks on discovered resources (S8), the security
 * posture score's counts and the plan-gated score with its daily history
 * (S18), and AWS Security Hub state (S12, plan-gated).
 *
 * Finding titles, recommendations, resource identifiers and Security Hub
 * titles are AWS or DevControl-composed text that can embed customer names,
 * so they are untrusted text, never `data`.
 */
import { collectSection, notConnected, type ContextSection } from '../../../ai-context-contract';
import { AccountSecurityFindingsRepository } from '../../../../repositories/account-security-findings.repository';
import { AWSResourcesRepository } from '../../../../repositories/awsResources.repository';
import { SecurityHubStateRepository } from '../../../../repositories/security-hub-state.repository';
import { RiskTrackingService } from '../../../risk-tracking.service';
import { isReviewedUrgent, selectTopRiskFinding, TOP_RISK_SEVERITIES } from '../../../top-risk-selection';
import { pool } from '../../../../config/database';
import { defineProvider, iso, ref, SEVERITIES, summarizeItems, TWO_SCANS_SECONDS, untrustedFor, withOrgClient, type Severity } from './shared';
import { discoveryGated } from './inventory';

/**
 * A security evaluation older than this is not current: two scheduled scans in a
 * row (every 6 hours) did not refresh it, allowing the second its longest run.
 * The Dashboard summary's SECURITY_EVALUATION_MAX_AGE_SECONDS.
 */
export const SECURITY_EVALUATION_MAX_AGE_SECONDS = TWO_SCANS_SECONDS;

const ACCOUNT_SCOPE_SOURCE = 'DevControl account-level security findings (security groups, IAM)';

/** Account findings and Top Risk share it: no active findings without a current evaluation is not a "none". */
const NO_CURRENT_EVALUATION_REASON = 'no completed, current security evaluation, so no active findings is not a confirmed "none"';

export interface AccountFindingsEvidence {
  outcome: 'found' | 'none_found';
  total: number;
  bySeverity: Record<Severity, number>;
  /** Open = no decision recorded; the rest are the customer's recorded decisions. Every one is still active. */
  byDisposition: { open: number; acknowledged: number; dismissed: number; accepted_risk: number };
  byCategory: Record<string, number>;
  /** Most severe first. */
  items: Array<{
    ref: string;
    findingId: string;
    category: string;
    severity: string;
    region: string | null;
    disposition: string | null;
    detectedAt: string | null;
    lastSeenAt: string | null;
    frameworkControl: string | null;
  }>;
}

export const accountFindingsProvider = defineProvider<AccountFindingsEvidence>({
  id: 'security.account_findings',
  version: 1,
  title: 'Account security findings (security groups, IAM)',
  source: ACCOUNT_SCOPE_SOURCE,
  dataSourceIds: ['S7'],
  topics: ['security', 'compliance'],
  priority: 1,
  maxTokens: 3000,
  async collect({ organizationId, basis }) {
    const account = await basis.account();
    return collectSection<AccountFindingsEvidence>(
      {
        source: ACCOUNT_SCOPE_SOURCE,
        classification: 'measured',
        scope: { kind: 'account_level', connectedAccountId: account.data?.accountId ?? null },
        period: { kind: 'point_in_time' },
        coverage: "DevControl's own account-level checks (open security group rules, IAM MFA and access-key age); not AWS Security Hub. A disposition is the customer's recorded decision; the finding is still active",
      },
      async () => {
        const active = await basis.activeAccountFindings();
        if (active.length === 0) {
          const current = await new AccountSecurityFindingsRepository().isLatestSecurityEvaluationCurrent(organizationId, SECURITY_EVALUATION_MAX_AGE_SECONDS);
          if (!current) {
            return { state: 'unavailable', reason: NO_CURRENT_EVALUATION_REASON };
          }
        }
        const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 } as Record<Severity, number>;
        const byDisposition = { open: 0, acknowledged: 0, dismissed: 0, accepted_risk: 0 };
        const byCategory: Record<string, number> = {};
        for (const f of active) {
          if ((SEVERITIES as readonly string[]).includes(f.severity)) bySeverity[f.severity as Severity] += 1;
          const disposition = (f.disposition ?? 'open') as keyof typeof byDisposition;
          if (disposition in byDisposition) byDisposition[disposition] += 1;
          byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
        }
        return {
          state: 'available',
          asOf: active.reduce<string | null>((latest, f) => {
            const seen = iso(f.last_seen_at);
            return seen && (!latest || seen > latest) ? seen : latest;
          }, null),
          data: {
            outcome: active.length > 0 ? 'found' : 'none_found',
            total: active.length,
            bySeverity,
            byDisposition,
            byCategory,
            items: active.map((f, i) => ({
              ref: ref('f', i),
              findingId: f.id,
              category: f.category,
              severity: f.severity,
              region: f.region,
              disposition: f.disposition,
              detectedAt: iso(f.detected_at),
              lastSeenAt: iso(f.last_seen_at),
              frameworkControl: f.framework_mapping ? `${f.framework_mapping.framework} ${f.framework_mapping.control}`.trim() || null : null,
            })),
          },
          untrusted: active.flatMap((f, i) => [
            ...untrustedFor(ref('f', i), 'title', f.title),
            ...untrustedFor(ref('f', i), 'resource', f.resource_identifier),
          ]),
        };
      }
    );
  },
  summarize: summarizeItems,
});

/** Top Risk as the Dashboard shows it (top-risk-selection.ts): never an accepted or dismissed finding. */
export interface TopRiskEvidence {
  /** Active account findings, whatever their disposition. */
  count: number;
  /** The Top Risk finding's severity; its title is untrusted text (field "top title"). Null when none is eligible. */
  top: { ref: 'top'; severity: string } | null;
  /** Critical/high/medium findings the customer accepted or dismissed. */
  reviewedUrgent: number;
}

export const topRiskProvider = defineProvider<TopRiskEvidence>({
  id: 'security.top_risk',
  version: 1,
  title: 'Top Risk',
  source: 'DevControl account-level security findings (security groups, IAM)',
  dataSourceIds: ['S11', 'S7'],
  topics: ['security'],
  priority: 1,
  maxTokens: 400,
  async collect({ organizationId, basis }) {
    return collectSection<TopRiskEvidence>(
      { source: ACCOUNT_SCOPE_SOURCE, classification: 'calculated' },
      async () => {
        // getActive() returns newest first within each severity; the shared rule
        // skips accepted and dismissed findings and anything below medium.
        const active = await basis.activeAccountFindings();
        // The account-findings rule: no active findings is only a real zero once the
        // latest security evaluation completed and is current.
        if (active.length === 0) {
          const current = await new AccountSecurityFindingsRepository().isLatestSecurityEvaluationCurrent(organizationId, SECURITY_EVALUATION_MAX_AGE_SECONDS);
          if (!current) return { state: 'unavailable', reason: NO_CURRENT_EVALUATION_REASON };
        }
        const top = selectTopRiskFinding(active);
        return {
          state: 'available',
          data: { count: active.length, top: top ? { ref: 'top', severity: top.severity } : null, reviewedUrgent: active.filter(isReviewedUrgent).length },
          untrusted: top ? [{ field: 'top title', text: top.title }] : [],
        };
      }
    );
  },
});

/** The Top Risk title, read back from its untrusted entry (for the deterministic Top Risk field). */
export function topRiskTitle(section: ContextSection<TopRiskEvidence>): string | null {
  return section.untrusted?.find((u) => u.field === 'top title')?.text ?? null;
}

export const securityEvaluationProvider = defineProvider<{ current: true }>({
  id: 'security.evaluation_status',
  version: 1,
  title: 'Latest security evaluation',
  source: 'DevControl security evaluation runs (resource checks, security groups, IAM)',
  dataSourceIds: ['S7', 'S8'],
  topics: ['security', 'compliance'],
  priority: 2,
  maxTokens: 200,
  async collect({ organizationId }) {
    return collectSection<{ current: true }>(
      { source: 'DevControl security evaluation runs (resource checks, security groups, IAM)', classification: 'measured' },
      async () => (await new AccountSecurityFindingsRepository().isLatestSecurityEvaluationCurrent(organizationId, SECURITY_EVALUATION_MAX_AGE_SECONDS))
        ? { state: 'available', data: { current: true } }
        : { state: 'unavailable', reason: 'the latest security evaluation did not complete, or is not current' }
    );
  },
});

export interface ConfigChecksEvidence {
  outcome: 'found' | 'none_found';
  /** Non-terminated discovered resources the checks ran against. */
  resourcesEvaluated: number;
  resourcesWithFindings: number;
  findingsBySeverity: Record<Severity, number>;
  /** Per category, with severities and resource types taken from the findings themselves. */
  byCategory: Array<{ category: string; findings: number; highestSeverity: Severity; resourceTypes: string[] }>;
}

export const CONFIG_CHECKS_COVERAGE =
  "DevControl's configuration checks (encryption, backups, public access, tagging, IAM and other checks) on resources discovered in the connected account's discovery region. Each scan overwrites the previous result, so no earlier result is kept. Account-level findings and AWS Security Hub are separate sources.";

export async function summarizeComplianceFindings(organizationId: string, resourcesEvaluated: number): Promise<ConfigChecksEvidence> {
  const rows = await new AWSResourcesRepository(pool).getComplianceIssues(organizationId);
  const findingsBySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const categories = new Map<string, { findings: number; severities: Set<Severity>; resourceTypes: Set<string> }>();

  for (const row of rows) {
    for (const issue of row.issues ?? []) {
      const severity = issue.severity as Severity;
      if (severity in findingsBySeverity) findingsBySeverity[severity]++;
      const entry = categories.get(issue.category) ?? { findings: 0, severities: new Set<Severity>(), resourceTypes: new Set<string>() };
      entry.findings++;
      entry.severities.add(severity);
      entry.resourceTypes.add(String(row.resource_type));
      categories.set(issue.category, entry);
    }
  }

  const rank = (s: Severity) => SEVERITIES.indexOf(s);
  const byCategory = [...categories.entries()]
    .map(([category, e]) => ({
      category,
      findings: e.findings,
      highestSeverity: [...e.severities].sort((a, b) => rank(a) - rank(b))[0],
      resourceTypes: [...e.resourceTypes].sort(),
    }))
    .sort((a, b) => rank(a.highestSeverity) - rank(b.highestSeverity) || b.findings - a.findings)
    .slice(0, 5);

  const resourcesWithFindings = rows.filter(r => (r.issues ?? []).length > 0).length;
  return {
    outcome: resourcesWithFindings > 0 ? 'found' : 'none_found',
    resourcesEvaluated,
    resourcesWithFindings,
    findingsBySeverity,
    byCategory,
  };
}

export const configChecksProvider = defineProvider<ConfigChecksEvidence>({
  id: 'security.config_checks',
  version: 1,
  title: 'Configuration-check findings on discovered resources',
  source: 'DevControl configuration checks on discovered resources',
  dataSourceIds: ['S8'],
  topics: ['security', 'compliance'],
  priority: 1,
  maxTokens: 1200,
  async collect({ organizationId, basis }) {
    const [discovery, inventoryScope] = await Promise.all([basis.discovery(), basis.inventoryScope()]);
    return discoveryGated<ConfigChecksEvidence>(
      {
        source: 'DevControl configuration checks on discovered resources',
        classification: 'measured',
        scope: inventoryScope,
        period: { kind: 'point_in_time' },
        coverage: CONFIG_CHECKS_COVERAGE,
      },
      discovery,
      (d) => d.resourcesWithFindings === 0,
      async () => ({ data: await summarizeComplianceFindings(organizationId, (await basis.inventoryStats()).total_resources) })
    );
  },
});

/**
 * The posture score's counts, as the all-plans Dashboard summary has always
 * read them (urgent = critical + high + medium across both sources, whatever
 * their disposition). The plan-gated score with its history is security.risk_score.
 */
export interface PostureCountsEvidence {
  score: number;
  combinedFindings: number;
  urgentFindings: number | null;
  accountUrgentFindings: number | null;
}

export const postureCountsProvider = defineProvider<PostureCountsEvidence>({
  id: 'security.posture_counts',
  version: 1,
  title: 'Security posture counts',
  source: 'DevControl security posture score',
  dataSourceIds: ['S18'],
  topics: ['security'],
  priority: 2,
  maxTokens: 400,
  async collect({ organizationId }) {
    return collectSection<PostureCountsEvidence>(
      { source: 'DevControl security posture score', classification: 'calculated' },
      async () => {
        const risk = await new RiskTrackingService(pool).getCurrentRiskScore(organizationId);
        if (risk.isPreliminary) return { state: 'unavailable', reason: 'the security posture score is still preliminary' };
        const c = risk.complianceIssueCounts;
        const a = risk.accountFindingsCounts;
        const r = risk.resourceComplianceCounts;
        // Counted from both sources' own counts, so an accepted or dismissed finding
        // still counts: it is still open.
        const urgentFindings = a && r ? TOP_RISK_SEVERITIES.reduce((sum, s) => sum + a[s] + r[s], 0) : null;
        const accountUrgentFindings = a && r ? TOP_RISK_SEVERITIES.reduce((sum, s) => sum + a[s], 0) : null;
        return { state: 'available', data: { score: risk.score, combinedFindings: c.critical + c.high + c.medium + c.low, urgentFindings, accountUrgentFindings } };
      }
    );
  },
});

export interface RiskScoreEvidence {
  /** 0-100, higher is better. */
  score: number;
  grade: string;
  factors: Record<string, number>;
  /** Over the last 30 days, from the daily history: improving, stable or declining (a change of under 5 points is stable). */
  trend: string;
  trendPoints: number;
  items: Array<{ ref: string; date: string; score: number }>;
}

export const riskScoreProvider = defineProvider<RiskScoreEvidence>({
  id: 'security.risk_score',
  version: 1,
  title: 'DevControl security posture score (calculated) and its daily history',
  source: 'DevControl security posture score',
  dataSourceIds: ['S18'],
  topics: ['security', 'compliance'],
  priority: 2,
  maxTokens: 1200,
  entitlementKey: 'riskScore',
  // The current score is calculated at read time: its asOf is the read itself.
  fingerprint: 'state_and_data',
  async collect({ organizationId, now }) {
    return collectSection<RiskScoreEvidence>(
      {
        source: 'DevControl security posture score',
        classification: 'calculated',
        period: { kind: 'rolling', window: 'last 30 days' },
        coverage: "calculated by DevControl from its own configuration checks and account-level findings (not AWS Security Hub); the history is one daily snapshot",
      },
      async () => {
        const trend = await new RiskTrackingService(pool).getRiskScoreTrend(organizationId, '30d');
        if (trend.current.isPreliminary) return { state: 'unavailable', reason: 'the security posture score is still preliminary' };
        const points = [...trend.history].reverse(); // newest first
        return {
          state: 'available',
          asOf: now.toISOString(),
          data: {
            score: trend.current.score,
            grade: trend.current.grade,
            factors: { ...trend.current.factors } as unknown as Record<string, number>,
            trend: trend.history.length >= 2 ? trend.trend : 'not enough history',
            trendPoints: trend.history.length,
            items: points.map((p, i) => ({ ref: ref('d', i), date: p.date, score: p.score })),
          },
        };
      }
    );
  },
  summarize: summarizeItems,
});

/** Model-facing: the reason while the organization's first Security Hub sync is still running. */
export const SECURITY_HUB_FIRST_SYNC_REASON = 'first sync in progress';
/** Model-facing: the reason while any later Security Hub sync is running. */
export const SECURITY_HUB_SYNC_RUNNING_REASON = 'sync in progress';

export interface SecurityHubEvidence {
  capabilityStatus: string;
  lastSyncStatus: string;
  lastSyncCompletedAt: string | null;
  enabledStandards: number;
  activeFindings: number;
  activeBySeverity: Record<string, number>;
  items: Array<{ ref: string; severity: string; complianceStatus: string | null; controlId: string | null; lastSeenAt: string | null }>;
}

export const securityHubProvider = defineProvider<SecurityHubEvidence>({
  id: 'security.security_hub',
  version: 1,
  title: 'AWS Security Hub',
  source: 'AWS Security Hub (last DevControl sync)',
  dataSourceIds: ['S12'],
  topics: ['security', 'compliance'],
  priority: 2,
  maxTokens: 1500,
  entitlementKey: 'securityHubStatus',
  async collect({ organizationId, basis }) {
    const account = await basis.account();
    const meta = {
      source: 'AWS Security Hub (last DevControl sync)',
      classification: 'measured' as const,
      scope: { kind: 'account_level' as const, connectedAccountId: account.data?.accountId ?? null },
    };
    const state = await new SecurityHubStateRepository().get(organizationId);
    if (!state) return notConnected<SecurityHubEvidence>(meta, 'Security Hub has not been synced for this organization yet');
    return collectSection<SecurityHubEvidence>(meta, async () => {
      // Error text from AWS (capabilityError, lastSyncError) is never read into evidence.
      // A sync still running: not available until it finishes. The row no longer
      // says how the previous attempt ended (a failed one also sets the completed
      // time), so its findings are never shown as current while a sync runs. A
      // first sync has written only a placeholder capability (ERROR) -- never
      // "Security Hub is not available".
      if (state.lastSyncStatus === 'RUNNING') {
        return { state: 'unavailable', reason: state.lastSyncCompletedAt ? SECURITY_HUB_SYNC_RUNNING_REASON : SECURITY_HUB_FIRST_SYNC_REASON };
      }
      // A failed sync is an error (its findings count is not a measurement), never "available, 0".
      if (state.lastSyncStatus === 'FAILED') {
        throw new Error('the last Security Hub sync failed');
      }
      if (state.capabilityStatus !== 'ENABLED') {
        return { state: 'not_connected', reason: `Security Hub is not available to DevControl for this account (status: ${state.capabilityStatus})` };
      }
      const rows = await withOrgClient(organizationId, (client) => client.query(
        `SELECT severity, compliance_status, security_control_id, title, last_seen_at
           FROM security_hub_findings
          WHERE organization_id = $1 AND record_state = 'ACTIVE'
            AND (workflow_status IS NULL OR workflow_status NOT IN ('RESOLVED', 'SUPPRESSED'))
          ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, last_seen_at DESC`,
        [organizationId]
      ));
      const activeBySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, informational: 0 };
      for (const r of rows.rows) activeBySeverity[r.severity] = (activeBySeverity[r.severity] ?? 0) + 1;
      const listed = rows.rows.slice(0, 25);
      return {
        state: state.lastSyncStatus === 'PARTIAL' ? 'partial' : 'available',
        reason: state.lastSyncStatus === 'PARTIAL' ? 'the last sync read only part of the findings' : null,
        asOf: iso(state.lastSyncCompletedAt),
        data: {
          capabilityStatus: state.capabilityStatus,
          lastSyncStatus: state.lastSyncStatus,
          lastSyncCompletedAt: iso(state.lastSyncCompletedAt),
          enabledStandards: state.enabledStandards.length,
          activeFindings: rows.rows.length,
          activeBySeverity,
          items: listed.map((r, i) => ({
            ref: ref('h', i),
            severity: r.severity,
            complianceStatus: r.compliance_status ?? null,
            controlId: r.security_control_id ?? null,
            lastSeenAt: iso(r.last_seen_at),
          })),
        },
        untrusted: listed.flatMap((r, i) => untrustedFor(ref('h', i), 'title', r.title)),
      };
    });
  },
  summarize: summarizeItems,
});
