/**
 * Placeholder-costs PR 1, AI surfaces (B1-B3):
 *   - cost.top_estimated_resources lists priced resources only, each with its real
 *     basis ("us-east-1 list-price estimate"); a flat placeholder never reaches the
 *     model; the section is partial whenever any resource is unpriced;
 *   - every AI prompt (chat, reports, dashboard summary via EVIDENCE_CLAIM_RULES)
 *     carries the claim rule: estimates are never billed spend, never summed by the
 *     model, and unpriced resources never get a figure or $0.
 */
const mockDb: { answer?: (sql: string, params: unknown[]) => unknown } = {};
jest.mock('../../../../config/database', () => {
  const actual = jest.requireActual('../../../../config/database');
  const run = async (sql: string, params: unknown[] = []) => {
    if (/set_config/.test(sql)) return { rows: [] };
    const answer = mockDb.answer?.(sql, params);
    if (answer === undefined) throw Object.assign(new Error('relation "x" does not exist'), { code: '42P01' });
    return answer;
  };
  return { ...actual, pool: { query: jest.fn(run), connect: jest.fn(async () => ({ query: jest.fn(run), release: jest.fn() })) } };
});

import type { Pool } from 'pg';
import { collectSection, EVIDENCE_CLAIM_RULES } from '../../../ai-context-contract';
import { collectProvider } from '../registry';
import { createEvidenceBasis, type BasisSources } from '../basis';
import { topEstimatedResourcesProvider } from '../providers/cost';
import { INVENTORY_ESTIMATE_RULE } from '../render';
import { AIChatService } from '../../../ai-chat.service';
import { AIReportGeneratorService } from '../../../ai-report-generator.service';
import { LEGACY_ROWS } from '../../../__tests__/inventory-cost-fixtures';

const ORG = '00000000-0000-4000-8000-0000000000c3';
const PLACEHOLDER_AMOUNTS = [9, 73, 3, 3.5, 25, 150, 0.4, 0.5, 5, 50, 75, 74.83, 8.5];

function sources(): BasisSources {
  const fail = async () => { throw new Error('unused'); };
  return {
    context: {
      gatherInventoryBasis: async () => ({
        discovery: await collectSection({ source: 'DevControl resource discovery runs' }, async () => ({ state: 'available' as const, data: { completedAt: '2026-11-28T10:00:00.000Z' }, asOf: '2026-11-28T10:00:00.000Z' })),
        account: await collectSection({ source: 'a' }, async () => ({ state: 'available' as const, data: { accountId: '123456789012', region: 'us-east-1' } })),
        inventoryScope: { kind: 'resource_inventory' as const, connectedAccountId: '123456789012', discoveryRegion: 'us-east-1' },
      }),
      collectCosts: fail, getServices: fail, getResourceData: fail, getDORAMetrics: fail,
    },
    resources: { getStats: fail },
    accountFindings: { getActive: fail },
    costRecommendations: { findAll: fail },
    coverage: fail,
  } as unknown as BasisSources;
}
const ctx = () => ({ organizationId: ORG, now: new Date(), period: { from: '2026-10-28', to: '2026-11-28' }, basis: createEvidenceBasis(ORG, sources()) });

beforeEach(() => {
  mockDb.answer = undefined;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('B1: cost.top_estimated_resources', () => {
  it('lists priced resources only, each with its basis; no placeholder amount reaches the model; partial with K of N', async () => {
    mockDb.answer = (sql) => (/FROM aws_resources/.test(sql) ? { rows: LEGACY_ROWS } : undefined);
    const section = await collectProvider(topEstimatedResourcesProvider, ctx());

    expect(section.state).toBe('partial');
    expect(section.completeness).toEqual({ unit: 'discovered resources with a defensible price', expected: LEGACY_ROWS.length, received: 2, missing: null });
    const data = section.data as any;
    expect(data.pricedResources).toBe(2);
    expect(data.totalResources).toBe(LEGACY_ROWS.length);
    expect(data.items).toEqual([
      { ref: 'e1', resourceId: 'rds-orders-db', resourceType: 'rds', monthlyCost: 122, basis: 'us-east-1 list-price estimate', detail: 'instance hours only; excludes storage, I/O and backups' },
      { ref: 'e2', resourceId: 'ebs-data-vol', resourceType: 'ebs', monthlyCost: 20, basis: 'us-east-1 list-price estimate', detail: 'volume storage only' },
    ]);
    for (const amount of PLACEHOLDER_AMOUNTS) expect(data.items.map((i: any) => i.monthlyCost)).not.toContain(amount);
    expect(section.coverage).toContain('Never add these figures together');
    expect(section.coverage).toContain('not $0');
    expect(section.coverage).not.toMatch(/^list-price/);
  });

  it('every resource priced: available, not partial', async () => {
    mockDb.answer = (sql) => (/FROM aws_resources/.test(sql) ? { rows: LEGACY_ROWS.filter((r) => ['orders-db', 'data-vol'].includes(r.resource_name)) } : undefined);
    expect((await collectProvider(topEstimatedResourcesProvider, ctx())).state).toBe('available');
  });

  it('only placeholders: no item at all (never a placeholder figure), and the section says 0 priced', async () => {
    mockDb.answer = (sql) => (/FROM aws_resources/.test(sql) ? { rows: LEGACY_ROWS.filter((r) => !['orders-db', 'data-vol'].includes(r.resource_name)) } : undefined);
    const section = await collectProvider(topEstimatedResourcesProvider, ctx());
    expect((section.data as any)?.items ?? []).toEqual([]);
    expect(JSON.stringify(section)).not.toMatch(/"monthlyCost"/);
  });
});

describe('B1-B3: the claim rule in every AI prompt', () => {
  it('the rule forbids billed-spend claims, model-made sums and figures for unpriced resources', () => {
    expect(INVENTORY_ESTIMATE_RULE).toMatch(/never AWS billed spend/);
    expect(INVENTORY_ESTIMATE_RULE).toMatch(/Never add per-resource estimates together yourself/);
    expect(INVENTORY_ESTIMATE_RULE).toMatch(/never treat them as \$0/);
    expect(EVIDENCE_CLAIM_RULES).toMatch(/never sum per-resource estimates yourself/);
  });

  it('AI chat system prompt', () => {
    const prompt: string = (new AIChatService({} as Pool) as any).getSystemPrompt();
    expect(prompt).toContain(INVENTORY_ESTIMATE_RULE);
  });

  it('AI reports prompt (EVIDENCE_CLAIM_RULES + its own rules)', () => {
    const prompt = new AIReportGeneratorService({} as Pool).buildUserPrompt({ dateRange: { from: '2026-10-28', to: '2026-11-28' }, sections: {} } as any, 'cost_analysis');
    expect(prompt).toContain(INVENTORY_ESTIMATE_RULE);
    expect(prompt).toContain('never sum per-resource estimates yourself');
  });
});
