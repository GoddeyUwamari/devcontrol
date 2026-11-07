/**
 * Cost evidence: spend (S1), the month-over-month comparison (S2), the
 * highest inventory cost estimates (S3), and DevControl's cost findings with
 * their savings basis, lifecycle and customer decisions (S6), including the
 * CPU evidence behind each idle-instance finding (S15).
 */
import { collectSection, type InventoryScope } from '../../../ai-context-contract';
import { monthOverMonthSection, spendSection, type MonthOverMonthEvidence, type SpendEvidence } from '../../../cost-context-sections';
import { aggregateEstimatedSavings, classifySavingsBasis, EC2_PRICE_SOURCE_DEFAULT } from '../../../estimated-savings';
import { pool } from '../../../../config/database';
import { defineProvider, ref, summarizeItems, untrustedFor, withOrgClient } from './shared';
import { discoveryGated } from './inventory';

export const spendProvider = defineProvider<SpendEvidence>({
  id: 'cost.spend',
  version: 1,
  title: 'Cloud spend',
  source: 'AWS Cost Explorer',
  dataSourceIds: ['S1'],
  topics: ['cost', 'savings'],
  priority: 1,
  maxTokens: 1200,
  timeoutMs: 25_000,
  async collect({ basis }) {
    return spendSection(await basis.costs());
  },
});

export const monthOverMonthProvider = defineProvider<MonthOverMonthEvidence>({
  id: 'cost.month_over_month',
  version: 1,
  title: 'Month-over-month cost comparison',
  source: 'DevControl month-over-month comparison',
  dataSourceIds: ['S2'],
  topics: ['cost'],
  priority: 1,
  maxTokens: 800,
  timeoutMs: 25_000,
  async collect({ basis }) {
    return monthOverMonthSection(await basis.costs());
  },
});

export interface TopEstimatedResources {
  items: Array<{ ref: string; resourceId: string; resourceType: string; estimatedMonthlyCost: number }>;
}

export const topEstimatedResourcesProvider = defineProvider<TopEstimatedResources>({
  id: 'cost.top_estimated_resources',
  version: 1,
  title: 'Highest estimated-cost discovered resources',
  source: 'DevControl inventory cost estimates',
  dataSourceIds: ['S3'],
  topics: ['cost', 'inventory'],
  priority: 3,
  maxTokens: 800,
  async collect({ organizationId, basis }) {
    const [discovery, inventoryScope] = await Promise.all([basis.discovery(), basis.inventoryScope()]);
    return discoveryGated<TopEstimatedResources>(
      {
        source: 'DevControl inventory cost estimates',
        classification: 'estimated',
        scope: inventoryScope,
        period: { kind: 'point_in_time' },
        coverage: 'list-price monthly estimates for individual discovered resources -- not AWS billed spend',
      },
      discovery,
      (d) => d.items.length === 0,
      async () => {
        const result = await pool.query(
          `SELECT resource_id, resource_type, estimated_monthly_cost, resource_name
             FROM aws_resources
            WHERE organization_id = $1
              AND estimated_monthly_cost > 0
              AND status != 'terminated'
            ORDER BY estimated_monthly_cost DESC
            LIMIT 5`,
          [organizationId]
        );
        const items = result.rows.map((row, i) => ({
          ref: ref('e', i),
          resourceId: String(row.resource_id),
          resourceType: String(row.resource_type),
          estimatedMonthlyCost: Math.round(parseFloat(row.estimated_monthly_cost) * 100) / 100,
        }));
        return {
          data: { items },
          untrusted: result.rows.flatMap((row, i) => untrustedFor(ref('e', i), 'name', row.resource_name)),
        };
      }
    );
  },
  summarize: summarizeItems,
});

export type SavingsBasis = 'estimate' | 'ceiling' | 'unknown';

export interface CostFindingItem {
  ref: string;
  /** cost_recommendations.id */
  findingId: string;
  resourceId: string;
  resourceType: string;
  /** DevControl's finding type, e.g. "Idle EC2 Instance". */
  issue: string;
  severity: string;
  region: string | null;
  estimatedMonthlySavings: number;
  /** estimate: a DevControl estimate of savings; ceiling: an upper bound, never "savings"; unknown: no basis recorded. */
  savingsBasis: SavingsBasis;
  /** false: the figure is DevControl's default for an EC2 type whose price is unknown, not a price. */
  priceKnown: boolean;
  detectedAt: string | null;
  /** For idle-instance findings: the CloudWatch CPU evidence the finding was made from. */
  cpuEvidence: {
    averageCpuPercent: number;
    daysAnalyzed: number | null;
    datapointsObserved: number | null;
    datapointsExpected: number | null;
    windowEnd: string | null;
  } | null;
}

export interface CostFindingsEvidence {
  outcome: 'found' | 'none_found';
  /** Lifecycle counts: active findings, and the ones customers resolved or dismissed. */
  lifecycle: { active: number; resolved: number; dismissed: number };
  activeBySeverity: Record<'high' | 'medium' | 'low', number>;
  /** DevControl estimates of potential savings, de-duplicated per resource (estimated-savings.ts); never realized savings. */
  totalEstimatedMonthlySavings: number;
  /** Upper bounds that are not savings estimates, kept apart. */
  totalSavingsCeiling: number;
  /**
   * Active findings for idle or unused resources whose figure is a savings
   * estimate (isIdleEstimate), over every active finding -- not only the
   * listed ones.
   */
  activeIdleEstimates: number;
  /** Active findings, highest estimated savings first. */
  items: CostFindingItem[];
}

/** An idle or unused resource, by DevControl's finding type ("Idle EC2 Instance", "Unused Elastic IP"...). */
export function isIdleOrUnusedIssue(issue: string): boolean {
  const i = issue.toLowerCase();
  return i.includes('idle') || i.includes('unused');
}

/** The report's idle-savings figures: an idle or unused resource whose figure is an estimate (never a ceiling). */
export function isIdleEstimate(rec: { issue: string; savingsBasis: SavingsBasis }): boolean {
  return isIdleOrUnusedIssue(rec.issue) && rec.savingsBasis === 'estimate';
}

const COST_FINDING_LIST_CAP = 25;

function numberOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export const costFindingsProvider = defineProvider<CostFindingsEvidence>({
  id: 'cost.findings',
  version: 1,
  title: 'Cost findings (savings opportunities)',
  source: 'DevControl cost findings',
  dataSourceIds: ['S6', 'S15'],
  topics: ['savings', 'cost', 'telemetry'],
  priority: 1,
  maxTokens: 3000,
  async collect({ organizationId, basis }) {
    const [discovery, inventoryScope] = await Promise.all([basis.discovery(), basis.inventoryScope()]);
    const section = await collectSection<CostFindingsEvidence>(
      {
        source: 'DevControl cost findings',
        classification: 'estimated',
        scope: inventoryScope as InventoryScope,
        period: { kind: 'point_in_time' },
        coverage: 'findings from DevControl cost analysis of discovered resources; savings are estimates of potential savings, never realized savings',
      },
      async () => {
        const [active, lifecycleRows] = await Promise.all([
          basis.activeCostRecommendations(),
          withOrgClient(organizationId, (client) => client.query<{ status: string; n: string }>(
            `SELECT status, COUNT(*)::text AS n FROM cost_recommendations WHERE organization_id = $1 GROUP BY status`,
            [organizationId]
          )),
        ]);
        const count = (status: string) => parseInt(lifecycleRows.rows.find((r) => r.status === status)?.n ?? '0', 10);
        const lifecycle = { active: count('ACTIVE'), resolved: count('RESOLVED'), dismissed: count('DISMISSED') };

        if (active.length === 0 && discovery.state !== 'available') {
          return {
            state: 'unavailable',
            reason: 'no completed cost analysis has run yet, so no active findings is not a confirmed "none"',
          };
        }

        const savings = aggregateEstimatedSavings(active as unknown as Parameters<typeof aggregateEstimatedSavings>[0]);
        const bySeverity = { high: 0, medium: 0, low: 0 };
        for (const r of active) {
          const key = String(r.severity).toLowerCase() as keyof typeof bySeverity;
          if (key in bySeverity) bySeverity[key] += 1;
        }
        const listed = active.slice(0, COST_FINDING_LIST_CAP);
        const items: CostFindingItem[] = listed.map((r, i) => {
          const m = (r.metadata ?? {}) as Record<string, any>;
          const avg = numberOrNull(m.average_cpu);
          return {
            ref: ref('c', i),
            findingId: String(r.id),
            resourceId: String(r.resource_id),
            resourceType: String(r.resource_type),
            issue: String(r.issue),
            severity: String(r.severity),
            region: r.aws_region ?? null,
            estimatedMonthlySavings: Math.round(Number(r.potential_savings) * 100) / 100,
            savingsBasis: classifySavingsBasis(m.savings_basis) ?? 'unknown',
            priceKnown: m.price_source !== EC2_PRICE_SOURCE_DEFAULT,
            detectedAt: r.created_at ? new Date(r.created_at).toISOString() : null,
            cpuEvidence: avg === null ? null : {
              averageCpuPercent: Math.round(avg * 100) / 100,
              daysAnalyzed: numberOrNull(m.days_analyzed),
              datapointsObserved: numberOrNull(m.cpu_evidence?.datapoints_observed),
              datapointsExpected: numberOrNull(m.cpu_evidence?.datapoints_expected),
              windowEnd: typeof m.cpu_evidence?.window_end === 'string' ? m.cpu_evidence.window_end : null,
            },
          };
        });
        return {
          state: 'available',
          asOf: discovery.data?.completedAt ?? null,
          data: {
            outcome: active.length > 0 ? 'found' : 'none_found',
            lifecycle,
            activeBySeverity: bySeverity,
            totalEstimatedMonthlySavings: Math.round(savings.total * 100) / 100,
            totalSavingsCeiling: Math.round(savings.ceilingTotal * 100) / 100,
            activeIdleEstimates: active.filter((r) => isIdleEstimate({
              issue: String(r.issue),
              savingsBasis: classifySavingsBasis(((r.metadata ?? {}) as Record<string, any>).savings_basis) ?? 'unknown',
            })).length,
            items,
          },
          reason: active.length > COST_FINDING_LIST_CAP
            ? `the ${COST_FINDING_LIST_CAP} active findings with the highest estimated savings are listed; the counts and totals cover all ${active.length}`
            : null,
          untrusted: listed.flatMap((r, i) => untrustedFor(ref('c', i), 'resource name', r.resource_name)),
        };
      }
    );
    // The list is capped; the counts and totals are not. Recorded, never silent.
    const d = section.data;
    return d && d.items.length < d.lifecycle.active
      ? { ...section, truncation: { kept: d.items.length, total: d.lifecycle.active, by: 'provider_list_cap' } }
      : section;
  },
  summarize: summarizeItems,
});
