/**
 * GET /api/ai-chat/context returns the AI context to any authenticated Pro
 * user of the organization. It must never carry raw database, SQL, or
 * infrastructure error text: a failed getter's section keeps only a safe
 * diagnostic (the raw message goes to the server log), and an unexpected
 * failure of the whole request returns a generic error.
 *
 * No DB needed: the pool and the Cost Explorer calls are stubbed to fail.
 */
import { Pool } from 'pg';
import { Request, Response } from 'express';
import { AIChatController } from '../ai-chat.controller';
import awsCostService from '../../services/aws-cost.service';
import { collectSection } from '../../services/ai-context-contract';
import { collectEvidence, EvidenceRegistry } from '../../services/ai/evidence/registry';
import { collectedSectionOf } from '../../services/ai/evidence/budget';

const RAW_DB_ERROR = 'relation "aws_accounts" does not exist at character 36 (SELECT account_id, region FROM aws_accounts WHERE org_id = $1)';

function mockReqRes() {
  const req = { user: { organizationId: '00000000-0000-0000-0000-000000000001' } } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  return { req, res, json, status };
}

describe('GET /api/ai-chat/context -- no raw error details reach the user', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('failed getters return "error" sections with safe reasons -- raw database text stays in the server log', async () => {
    const throwingPool = { query: jest.fn().mockRejectedValue(new Error(RAW_DB_ERROR)) } as unknown as Pool;
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error(RAW_DB_ERROR));
    const controller = new AIChatController(throwingPool);
    const { req, res, json, status } = mockReqRes();

    await controller.getContext(req, res);

    expect(status).not.toHaveBeenCalled();
    const body = json.mock.calls[0][0];
    expect(body.success).toBe(true);
    // A per-provider summary (re-review 4 M5): the chat's own inventory and DORA providers failed safely.
    for (const id of ['inventory.resource_types', 'inventory.compute_detail', 'delivery.dora']) {
      const p = body.data.providers.find((x: { id: string }) => x.id === id);
      expect({ id, state: p.state }).toEqual({ id, state: 'error' });
      expect(p.reason).toMatch(/could not be retrieved\.$/);
    }
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/relation|does not exist|aws_accounts WHERE|SELECT|character 36/);
    // The raw failure is still logged server-side, not swallowed.
    expect(consoleError.mock.calls.some((call: unknown[]) => call.some(arg => String(arg).includes('does not exist')))).toBe(true);
  });

  it('an unexpected failure of the whole request returns a generic error, not the raw message', async () => {
    const controller = new AIChatController({} as Pool);
    jest.spyOn((controller as any).contextRepo, 'gatherContext').mockRejectedValue(new Error(RAW_DB_ERROR));
    const { req, res, json, status } = mockReqRes();

    await controller.getContext(req, res);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'Failed to load AI context' });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toMatch(/relation|aws_accounts|SELECT/);
    expect(consoleError).toHaveBeenCalledWith('[AI Chat Controller] Context error:', RAW_DB_ERROR);
  });

  it('re-review 4 M5: the body is a per-provider summary -- no evidence items, no untrusted text, no pre-budget copy', async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ ref: `u${i + 1}`, instanceId: `i-0a1b2c3d4${String(i).padStart(8, '0')}` }));
    const registry = new EvidenceRegistry().register({
      id: 'telemetry.fixture', version: 1, title: 'Fixture list', source: 'fixture source', dataSourceIds: ['S14'], topics: ['ops'], priority: 1, maxTokens: 400,
      collect: async () => collectSection({ source: 'fixture source', classification: 'measured' }, async () => ({
        state: 'available' as const, asOf: '2026-11-07T06:00:00.000Z', data: { items },
        untrusted: items.map((i) => ({ field: `${i.ref} name`, text: `customer-name-${i.ref}` })),
      })),
      summarize: (data: { items: typeof items }, maxItems: number) => (data.items.length > maxItems ? { data: { items: data.items.slice(0, maxItems) }, kept: maxItems, total: data.items.length } : null),
    });
    const evidence = await collectEvidence(registry, { organizationId: '00000000-0000-0000-0000-000000000001', consumer: 'test', select: { providerIds: ['telemetry.fixture'] }, budgetTokens: 20_000 });
    const result = evidence.results[0];
    expect(result.mode).toBe('summarised');
    expect((collectedSectionOf<{ items: unknown[] }>(result)!.data!).items).toHaveLength(60); // the copy exists server-side

    const controller = new AIChatController({} as Pool);
    jest.spyOn((controller as any).contextRepo, 'gatherContext').mockResolvedValue({ evidence } as never);
    const { req, res, json, status } = mockReqRes();
    await controller.getContext(req, res);

    expect(status).not.toHaveBeenCalled();
    const body = json.mock.calls[0][0];
    expect(body).toEqual({
      success: true,
      data: {
        retrievedAt: evidence.retrievedAt,
        providers: [{
          id: 'telemetry.fixture', state: 'available', reason: null, source: 'fixture source', asOf: '2026-11-07T06:00:00.000Z',
          counts: { kept: result.section.truncation!.kept, total: 60 },
        }],
      },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/i-0a1b2c3d4|customer-name|"items"|"data":\{"items|collected|untrusted/);
  });
});
