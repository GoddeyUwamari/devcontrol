/**
 * Ask AI (NL query) executor: runs one validated intent against this
 * organization's data and says exactly what the answer is based on.
 *
 * Every target is gathered as a shared ContextSection (ai-context-contract.ts),
 * and the result's `outcome` comes from that section's state, so the UI can
 * tell "we checked and found nothing" (no_results) from "we could not answer"
 * (unavailable / not_supported / error):
 *   answered      = evidence obtained (including an actual $0 spend)
 *   no_results    = the query ran over available data and matched nothing
 *   unavailable   = the data source has nothing to query (e.g. no AWS connection)
 *   not_supported = DevControl has no evidence for this kind of question
 *   error         = the query failed; never reported as an empty result
 *
 * Costs come from the PR #135 evidence-aware cost path
 * (AIChatContextRepository.gatherCostContext() -> spendSection()), not from
 * getMonthlySpendWithFallback() and not from aws_resources: actual Cost
 * Explorer spend (including $0 and net-negative) stays actual, the inventory
 * estimate is labeled an estimate, and missing data is never $0.
 *
 * Every query is scoped to the organizationId passed in, which the route
 * takes from the authenticated request -- never from the question or the
 * parser. All values are bound parameters.
 */

import { Pool } from 'pg';
import {
  collectSection,
  hasEvidence,
  notSupported,
  type ContextDataState,
  type ContextSection,
  type EvidencePeriod,
  type EvidenceProvenance,
} from './ai-context-contract';
import { AIChatContextRepository } from '../repositories/ai-chat-context.repository';
import { spendSection, type SpendEvidence } from './cost-context-sections';
import { lastIncludedDay } from './ai-chat.service';
import { describeIntent, validateIntent, type ValidatedIntent } from './nl-query-guard';
import type { NLQueryIntent } from './nl-query.service';

export type NLQueryOutcome = 'answered' | 'no_results' | 'unavailable' | 'not_supported' | 'error';

/** The evidence behind an answer -- a subset of the section it came from. */
export interface NLQueryEvidence {
  state: ContextDataState;
  source: string;
  provenance: EvidenceProvenance | null;
  period: EvidencePeriod | null;
  asOf: string | null;
  reason: string | null;
}

export interface NLQueryResultData {
  type: 'resources' | 'costs' | 'deployments' | 'services' | 'none';
  outcome: NLQueryOutcome;
  rows: any[];
  summary: string;
  columns: string[];
  evidence: NLQueryEvidence;
}

export interface NLQueryResult {
  /** The validated intent, with a deterministic explanation (never model-written text). */
  intent: { target: string; filters: Record<string, unknown>; explanation: string };
  data: NLQueryResultData;
  executedAt: Date;
  rowCount: number;
  executionMs: number;
}

const INVENTORY_SOURCE = 'DevControl resource inventory';
const RESULT_LIMIT = 25;

type Rows = Record<string, unknown>[];

function money(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `-$${abs}` : `$${abs}`;
}

function evidenceOf(section: ContextSection<unknown>): NLQueryEvidence {
  return {
    state: section.state,
    source: section.source,
    provenance: hasEvidence(section) ? section.provenance : null,
    period: section.period,
    asOf: section.asOf,
    reason: section.reason,
  };
}

/** Bound-parameter builder: every value added returns its own $n, so placeholders always equal bindings. */
class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export class NLQueryExecutorService {
  private costContext: AIChatContextRepository;

  constructor(private pool: Pool) {
    this.costContext = new AIChatContextRepository(pool);
  }

  /** A question rejected before execution (unsupported kind or invalid intent). */
  notSupportedResult(message: string, _intent?: NLQueryIntent | null): NLQueryResult {
    const section = notSupported<never>({ source: 'Ask AI' }, message);
    return {
      intent: { target: 'none', filters: {}, explanation: 'Not something Ask AI can answer' },
      data: { type: 'none', outcome: 'not_supported', rows: [], summary: message, columns: [], evidence: evidenceOf(section) },
      executedAt: new Date(),
      rowCount: 0,
      executionMs: 0,
    };
  }

  async execute(parsed: NLQueryIntent, organizationId: string): Promise<NLQueryResult> {
    const start = Date.now();
    const validation = validateIntent(parsed);
    if (!validation.ok) return this.notSupportedResult(validation.reason, parsed);

    const intent = validation.intent;
    const data = await this.run(intent, organizationId);
    return {
      intent: { target: intent.target, filters: { ...intent.filters }, explanation: describeIntent(intent) },
      data,
      executedAt: new Date(),
      rowCount: data.rows.length,
      executionMs: Date.now() - start,
    };
  }

  private async run(intent: ValidatedIntent, organizationId: string): Promise<NLQueryResultData> {
    switch (intent.target) {
      case 'infrastructure': return this.queryResources(intent, organizationId);
      case 'services':       return this.queryServices(intent, organizationId);
      case 'deployments':    return this.queryDeployments(intent, organizationId);
      case 'costs':          return this.queryCosts(organizationId);
    }
  }

  /** Map a row section to a result: evidence with rows -> answered, evidence without -> no_results. */
  private rowResult(
    type: NLQueryResultData['type'],
    section: ContextSection<Rows>,
    columns: string[],
    summarize: (rows: Rows) => string,
    empty: string
  ): NLQueryResultData {
    const evidence = evidenceOf(section);
    if (!hasEvidence(section)) {
      const outcome: NLQueryOutcome = section.state === 'error' ? 'error' : section.state === 'not_supported' ? 'not_supported' : 'unavailable';
      const summary = section.state === 'error'
        ? `${section.source} could not be retrieved. Please try again.`
        : `${section.source} is not available: ${section.reason ?? 'no data source'}.`;
      return { type, outcome, rows: [], summary, columns, evidence };
    }
    const rows = section.data;
    return rows.length === 0
      ? { type, outcome: 'no_results', rows: [], summary: empty, columns, evidence }
      : { type, outcome: 'answered', rows, summary: summarize(rows), columns, evidence };
  }

  // ── RESOURCES ──────────────────────────────────────────────────────────────

  private async queryResources(intent: ValidatedIntent, organizationId: string): Promise<NLQueryResultData> {
    const f = intent.filters;
    const p = new Params();
    const conditions: string[] = [`organization_id = ${p.add(organizationId)}`];

    if (f.resourceType !== undefined) conditions.push(`resource_type::text ILIKE ${p.add(`%${f.resourceType}%`)}`);
    if (f.status !== undefined) {
      conditions.push(`status::text ILIKE ${p.add(f.status)}`);
    } else {
      // "Show me my resources" means current infrastructure; terminated ones only when asked for.
      conditions.push(`status != 'terminated'`);
    }
    if (f.awsRegion !== undefined) conditions.push(`region::text ILIKE ${p.add(f.awsRegion)}`);
    if (f.costMin !== undefined) conditions.push(`estimated_monthly_cost >= ${p.add(f.costMin)}`);
    if (f.costMax !== undefined) conditions.push(`estimated_monthly_cost <= ${p.add(f.costMax)}`);
    if (f.encrypted !== undefined) conditions.push(`is_encrypted = ${p.add(f.encrypted)}`);
    if (f.hasBackup !== undefined) conditions.push(`has_backup = ${p.add(f.hasBackup)}`);
    if (f.publicAccess !== undefined) conditions.push(`is_public = ${p.add(f.publicAccess)}`);

    const section = await collectSection<Rows>(
      {
        source: INVENTORY_SOURCE,
        provenance: 'actual',
        period: { kind: 'point_in_time' },
        coverage: "resources found by DevControl's discovery of the connected AWS account; monthly costs are DevControl list-price estimates, not AWS billing",
      },
      async () => {
        // Column order matches `columns` below (the UI renders row values in order).
        const result = await this.pool.query(
          `SELECT
             resource_name,
             resource_type,
             region,
             status,
             ROUND(estimated_monthly_cost::numeric, 2) AS estimated_monthly_cost,
             id,
             resource_id,
             tags->>'environment' AS environment,
             COUNT(*) OVER () AS total_matching
           FROM aws_resources
           WHERE ${conditions.join(' AND ')}
           ORDER BY estimated_monthly_cost DESC NULLS LAST
           LIMIT ${RESULT_LIMIT}`,
          p.values
        );
        if (result.rows.length === 0) {
          // No match only means "none" if there is an inventory to search.
          const inventory = await this.pool.query(
            'SELECT COUNT(*) AS count FROM aws_resources WHERE organization_id = $1',
            [organizationId]
          );
          if (parseInt(inventory.rows[0]?.count ?? '0', 10) === 0) {
            return {
              state: 'unavailable',
              reason: 'no resources have been discovered for this organization yet (connect an AWS account or run discovery)',
            };
          }
        }
        return { state: 'available', data: result.rows, asOf: new Date().toISOString() };
      }
    );

    return this.rowResult(
      'resources',
      section,
      ['Resource', 'Type', 'Region', 'Status', 'Est. Monthly Cost'],
      rows => {
        const total = parseInt(String(rows[0].total_matching ?? rows.length), 10);
        const shown = total > rows.length ? `Showing ${rows.length} of ${total} matching resources` : `Found ${rows.length} matching resource${rows.length !== 1 ? 's' : ''}`;
        const priced = rows.filter(r => r.estimated_monthly_cost !== null && r.estimated_monthly_cost !== undefined);
        if (priced.length === 0) return `${shown}. None of these have a cost estimate.`;
        const sum = priced.reduce((acc, r) => acc + parseFloat(String(r.estimated_monthly_cost)), 0);
        const unpriced = rows.length - priced.length;
        return (
          `${shown}. Estimated monthly cost of the resources shown: ${money(sum)}/mo ` +
          `(DevControl list-price estimate, not AWS billing${unpriced > 0 ? `; ${unpriced} shown without an estimate` : ''}).`
        );
      },
      'No resources in your current inventory matched this query.'
    );
  }

  // ── SERVICES ───────────────────────────────────────────────────────────────

  private async queryServices(intent: ValidatedIntent, organizationId: string): Promise<NLQueryResultData> {
    const f = intent.filters;
    const p = new Params();
    const conditions: string[] = [`organization_id = ${p.add(organizationId)}`];
    if (f.status !== undefined) conditions.push(`status = ${p.add(f.status)}`);
    if (f.template !== undefined) conditions.push(`template = ${p.add(f.template)}`);

    const section = await collectSection<Rows>(
      { source: 'DevControl service catalog', provenance: 'actual', period: { kind: 'point_in_time' } },
      async () => {
        const result = await this.pool.query(
          `SELECT name, template, status, owner, created_at, id
           FROM services
           WHERE ${conditions.join(' AND ')}
           ORDER BY name ASC
           LIMIT ${RESULT_LIMIT}`,
          p.values
        );
        return { state: 'available', data: result.rows, asOf: new Date().toISOString() };
      }
    );

    return this.rowResult(
      'services',
      section,
      ['Service', 'Template', 'Status', 'Owner', 'Created'],
      rows => `Found ${rows.length} service${rows.length !== 1 ? 's' : ''}${rows.length === RESULT_LIMIT ? ` (showing the first ${RESULT_LIMIT})` : ''}.`,
      'No services registered in DevControl matched this query.'
    );
  }

  // ── DEPLOYMENTS ────────────────────────────────────────────────────────────

  private async queryDeployments(intent: ValidatedIntent, organizationId: string): Promise<NLQueryResultData> {
    const f = intent.filters;
    const p = new Params();
    const conditions: string[] = [`d.organization_id = ${p.add(organizationId)}`];
    if (f.status !== undefined) conditions.push(`d.status = ${p.add(f.status)}`);
    if (f.environment !== undefined) conditions.push(`d.environment = ${p.add(f.environment)}`);
    if (f.dateRangeDays !== undefined) conditions.push(`d.deployed_at > NOW() - make_interval(days => ${p.add(f.dateRangeDays)})`);

    const section = await collectSection<Rows>(
      { source: 'DevControl deployment records', provenance: 'actual' },
      async () => {
        const result = await this.pool.query(
          `SELECT s.name AS service_name, d.environment, d.status, d.deployed_by, d.deployed_at, d.aws_region, d.id
           FROM deployments d
           JOIN services s ON s.id = d.service_id AND s.organization_id = d.organization_id
           WHERE ${conditions.join(' AND ')}
           ORDER BY d.deployed_at DESC
           LIMIT ${RESULT_LIMIT}`,
          p.values
        );
        return { state: 'available', data: result.rows, asOf: new Date().toISOString() };
      }
    );

    return this.rowResult(
      'deployments',
      section,
      ['Service', 'Environment', 'Status', 'Deployed By', 'Deployed At'],
      rows => `Found ${rows.length} deployment${rows.length !== 1 ? 's' : ''}${rows.length === RESULT_LIMIT ? ` (showing the most recent ${RESULT_LIMIT})` : ''}.`,
      'No deployments recorded in DevControl matched this query.'
    );
  }

  // ── COSTS ──────────────────────────────────────────────────────────────────

  private async queryCosts(organizationId: string): Promise<NLQueryResultData> {
    let section: ContextSection<SpendEvidence>;
    try {
      const { costs } = await this.costContext.gatherCostContext(organizationId);
      section = await spendSection(costs);
    } catch (error: unknown) {
      section = await collectSection<SpendEvidence>({ source: 'AWS Cost Explorer' }, async () => { throw error; });
    }

    const evidence = evidenceOf(section);
    const columns = ['AWS Service', 'Month-to-Date Spend', 'Share'];

    if (!hasEvidence(section)) {
      return section.state === 'error'
        ? { type: 'costs', outcome: 'error', rows: [], columns, evidence, summary: 'Cost data could not be retrieved. Please try again.' }
        : {
            type: 'costs',
            outcome: 'unavailable',
            rows: [],
            columns,
            evidence,
            summary: `Cost data is not available: ${section.reason ?? 'no AWS Cost Explorer result and no inventory estimate'}. This is missing data, not a $0 spend.`,
          };
    }

    const d = section.data;
    if (d.basis === 'estimated_monthly_run_rate') {
      const coverage = section.state === 'partial' && section.completeness
        ? ` Only ${section.completeness.received} of ${section.completeness.expected} discovered resources have a cost estimate.`
        : '';
      return {
        type: 'costs',
        outcome: 'answered',
        rows: [],
        columns: [],
        evidence,
        summary:
          'AWS Cost Explorer billing data is not available for this organization. ' +
          `Inventory-derived estimated monthly run-rate: approximately ${money(d.amount)}/month -- a DevControl list-price estimate for currently discovered resources, not AWS billed spend.${coverage}`,
      };
    }

    const period = section.period?.kind === 'range'
      ? ` (${section.period.start} through ${lastIncludedDay(section.period.endExclusive)})`
      : '';
    const credit = d.amount < 0 ? ' (net negative: credits and refunds exceed charges)' : '';
    const inProgress = d.lastDayInProgress ? ' The current day is still being billed.' : '';
    const rows = (d.topServices ?? []).map(s => ({
      service: s.service,
      month_to_date_spend: money(s.amount),
      share: s.sharePercent === null ? '—' : `${s.sharePercent.toFixed(1)}%`,
    }));
    return {
      type: 'costs',
      outcome: 'answered',
      rows,
      columns,
      evidence,
      summary: `AWS Cost Explorer month-to-date spend${period}: ${money(d.amount)}${credit}.${inProgress}`,
    };
  }
}
