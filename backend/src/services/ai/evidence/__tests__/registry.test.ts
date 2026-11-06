/**
 * The evidence registry (AI truth PR 2, step1 §4 "the registry"): registration,
 * ordering, duplicates, versions, the per-provider wrapper (plan gate before
 * collect, timeout, safe failure codes, freshness), isolation of one failed
 * provider, selection, the size budget and its truncation records, and the
 * content-free selection log. Fakes only: no database, AWS or model.
 */
import {
  collectSection,
  CONTEXT_DATA_STATES,
  evidenceFingerprint,
  type ContextSection,
} from '../../../ai-context-contract';
import { collectEvidence, collectProvider, EvidenceRegistry, fingerprintSections, sectionOf } from '../registry';
import { createEvidenceBasis, type BasisSources, type EvidenceBasis } from '../basis';
import { renderEvidence } from '../render';
import { summarizeItems } from '../providers/shared';
import type { ProviderDefinition } from '../types';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const NOW = new Date('2026-11-06T12:00:00.000Z');

/** A basis whose reads all throw: these providers must not need one unless they ask. */
function inertBasis(organizationId = ORG): EvidenceBasis {
  const fail = async () => { throw new Error('not used in this test'); };
  const sources = {
    context: { gatherInventoryBasis: fail, collectCosts: fail, getServices: fail, getResourceData: fail, getDORAMetrics: fail },
    resources: { getStats: fail },
    accountFindings: { getActive: fail },
    costRecommendations: { findAll: fail },
    coverage: fail,
  } as unknown as BasisSources;
  return createEvidenceBasis(organizationId, sources);
}

function provider(overrides: Partial<ProviderDefinition<{ items: Array<{ ref: string; n: number }> }>> = {}): ProviderDefinition<{ items: Array<{ ref: string; n: number }> }> {
  return {
    id: 'test.alpha',
    version: 1,
    title: 'Alpha',
    source: 'Alpha source',
    dataSourceIds: ['S1'],
    topics: ['cost'],
    priority: 1,
    maxTokens: 10_000,
    async collect() {
      return collectSection({ source: 'Alpha source', classification: 'measured' }, async () => ({
        state: 'available', asOf: NOW.toISOString(), data: { items: [{ ref: 'i1', n: 1 }] },
      }));
    },
    ...overrides,
  };
}

const ctx = () => ({ organizationId: ORG, now: NOW, period: { from: '2026-10-07', to: '2026-11-07' }, basis: inertBasis() });

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('registration', () => {
  it('keeps registration order and refuses a duplicate id', () => {
    const r = new EvidenceRegistry().register(provider({ id: 'test.b' })).register(provider({ id: 'test.a' }));
    expect(r.list().map((p) => p.id)).toEqual(['test.b', 'test.a']);
    expect(() => r.register(provider({ id: 'test.a' }))).toThrow(/already registered/);
  });

  it.each([
    ['a bad id', { id: 'NoDot' }, /must look like/],
    ['version 0', { version: 0 }, /positive integer version/],
    ['a fractional version', { version: 1.5 }, /positive integer version/],
    ['no data sources', { dataSourceIds: [] }, /data sources/],
    ['no topics', { topics: [] }, /topic/],
    ['no budget cap', { maxTokens: 0 }, /maxTokens/],
    ['an unknown plan key', { entitlementKey: 'notAPlanKey' as never }, /not in PLAN_ENTITLEMENTS/],
  ])('refuses %s', (_label, overrides, message) => {
    expect(() => new EvidenceRegistry().register(provider(overrides as Partial<ProviderDefinition<never>>))).toThrow(message);
  });
});

describe('collectProvider (the per-provider wrapper)', () => {
  it('below the plan: not_entitled, and collect() is never called', async () => {
    const collect = jest.fn();
    const section = await collectProvider(provider({ entitlementKey: 'riskScore', collect }), ctx(), async () => false);
    expect(collect).not.toHaveBeenCalled();
    expect(section).toMatchObject({ state: 'not_entitled', data: null, failure: null });
    expect(section.reason).toMatch(/not included in this organization's current plan/);
  });

  it('a plan that cannot be read fails closed: error, nothing read', async () => {
    const collect = jest.fn();
    const section = await collectProvider(provider({ entitlementKey: 'doraMetrics', collect }), ctx(), async () => { throw new Error('plan lookup failed: secret detail'); });
    expect(collect).not.toHaveBeenCalled();
    expect(section.state).toBe('error');
    expect(JSON.stringify(section)).not.toMatch(/secret detail/);
  });

  it('entitled: collect() runs and its data is kept', async () => {
    const section = await collectProvider(provider({ entitlementKey: 'doraMetrics' }), ctx(), async () => true);
    expect(section).toMatchObject({ state: 'available', data: { items: [{ ref: 'i1', n: 1 }] } });
  });

  it('a throw is error with a safe failure code -- never the raw text, never data', async () => {
    const pgLike = Object.assign(new Error('relation "secret_table" does not exist'), { code: '42P01' });
    const section = await collectProvider(provider({ async collect() { throw pgLike; } }), ctx());
    expect(section).toMatchObject({ state: 'error', data: null, failure: { code: 'db_error', retryable: true } });
    expect(JSON.stringify(section)).not.toMatch(/secret_table/);
  });

  it('a provider that never answers is error / timeout once its time limit passes', async () => {
    jest.useFakeTimers();
    try {
      const pending = collectProvider(provider({ timeoutMs: 1_000, collect: () => new Promise(() => undefined) }), ctx());
      await jest.advanceTimersByTimeAsync(1_000);
      expect(await pending).toMatchObject({ state: 'error', failure: { code: 'timeout' } });
    } finally {
      jest.useRealTimers();
    }
  });

  it('data older than the freshness rule is stale -- kept, labelled, never current', async () => {
    const old = provider({
      freshness: { maxAgeSeconds: 600, rule: 'ten minutes' },
      async collect() {
        return collectSection({ source: 'Alpha source' }, async () => ({ state: 'available', asOf: '2026-11-06T11:00:00.000Z', data: { items: [] } }));
      },
    });
    const section = await collectProvider(old, ctx());
    expect(section.state).toBe('stale');
    expect(section.data).toEqual({ items: [] });
    expect(section.freshness).toEqual({ maxAgeSeconds: 600, ageSeconds: 3600, rule: 'ten minutes' });
    expect(section.reason).toMatch(/older than ten minutes/);
  });

  it('data within the rule stays available, and every contract field is set', async () => {
    const section = await collectProvider(provider({ freshness: { maxAgeSeconds: 600, rule: 'ten minutes' } }), ctx());
    expect(section.state).toBe('available');
    expect(section.retrievedAt).toBe(NOW.toISOString());
    expect(section.classification).toBe('measured');
    expect(section.untrusted).toEqual([]);
    expect(section.failure).toBeNull();
    expect(section.truncation).toBeNull();
    expect(section.freshness).toMatchObject({ maxAgeSeconds: 600, ageSeconds: 0 });
  });

  it('a state outside the contract is refused as an error', async () => {
    const bad = provider({ async collect() { return { state: 'empty' } as unknown as ContextSection<never>; } });
    expect((await collectProvider(bad, ctx())).state).toBe('error');
  });
});

describe('collectEvidence', () => {
  const failing = provider({ id: 'test.broken', async collect() { throw new Error('boom'); } });
  const registry = () => new EvidenceRegistry()
    .register(provider({ id: 'test.alpha', priority: 1 }))
    .register(failing)
    .register(provider({ id: 'test.beta', topics: ['security'], priority: 2 }))
    .register(provider({ id: 'test.gamma', topics: ['ops'], priority: 3 }));

  it('one failed provider does not affect the others, and every provider is present', async () => {
    const bundle = await collectEvidence(registry(), { organizationId: ORG, consumer: 'test', budgetTokens: 10_000, now: NOW, basis: inertBasis() });
    expect(bundle.results.map((r) => [r.id, r.section.state])).toEqual([
      ['test.alpha', 'available'], ['test.broken', 'error'], ['test.beta', 'available'], ['test.gamma', 'available'],
    ]);
  });

  it('no topics: priority-1 providers are loaded; the rest are listed', async () => {
    const bundle = await collectEvidence(registry(), { organizationId: ORG, consumer: 'test', budgetTokens: 10_000, now: NOW, basis: inertBasis() });
    expect(bundle.results.filter((r) => r.mode !== 'header').map((r) => r.id)).toEqual(['test.alpha', 'test.broken']);
  });

  it('topics and ids select providers', async () => {
    const bundle = await collectEvidence(registry(), {
      organizationId: ORG, consumer: 'test', budgetTokens: 10_000, now: NOW, basis: inertBasis(),
      select: { topics: ['security'], providerIds: ['test.gamma'] },
    });
    expect(bundle.results.filter((r) => r.selected).map((r) => r.id)).toEqual(['test.beta', 'test.gamma']);
  });

  it('refuses a basis built for another organization', async () => {
    await expect(collectEvidence(registry(), { organizationId: ORG, consumer: 'test', budgetTokens: 1_000, basis: inertBasis('00000000-0000-4000-8000-0000000000b2') }))
      .rejects.toThrow(/different organization/);
  });

  it('refuses a missing organization', async () => {
    await expect(collectEvidence(registry(), { organizationId: '', consumer: 'test', budgetTokens: 1_000 })).rejects.toThrow(/organizationId is required/);
  });

  it('logs ids, states and load modes only -- never data or reasons', async () => {
    const log = console.log as jest.Mock;
    await collectEvidence(registry(), { organizationId: ORG, consumer: 'test', budgetTokens: 10_000, now: NOW, basis: inertBasis() });
    const line = log.mock.calls.find((c) => c[0] === '[AI Evidence]');
    expect(line).toBeDefined();
    expect(line![1]).toContain('"id":"test.alpha"');
    expect(line![1]).not.toMatch(/Alpha source|boom|items|ref/);
    expect(line![1]).not.toContain(ORG);
  });
});

describe('budget and truncation', () => {
  const many = (id: string, count: number, priority: 1 | 2 | 3 = 1, maxTokens = 10_000) => provider({
    id,
    priority,
    maxTokens,
    async collect() {
      return collectSection({ source: `${id} source` }, async () => ({
        state: 'available',
        data: { items: Array.from({ length: count }, (_, i) => ({ ref: `i${i + 1}`, n: i })) },
        untrusted: Array.from({ length: count }, (_, i) => ({ field: `i${i + 1} name`, text: `name ${i + 1}` })),
      }));
    },
    summarize: summarizeItems,
  });

  it('a provider over its cap is summarised: counts kept, truncation recorded, untrusted text of cut items dropped', async () => {
    const r = new EvidenceRegistry().register(many('test.big', 200, 1, 600));
    const bundle = await collectEvidence(r, { organizationId: ORG, consumer: 'test', budgetTokens: 50_000, now: NOW, basis: inertBasis() });
    const big = bundle.results[0];
    expect(big.mode).toBe('summarised');
    expect(big.section.truncation).toMatchObject({ total: 200, by: 'provider_cap' });
    const kept = (big.section.data as { items: unknown[] }).items.length;
    expect(big.section.truncation!.kept).toBe(kept);
    expect(kept).toBeLessThan(200);
    expect(big.section.untrusted).toHaveLength(kept);
    expect(renderEvidence(bundle)).toMatch(new RegExp(`summarised: ${kept} of 200 items kept`));
  });

  it('once the total budget is reached, later providers keep their line and say why -- none disappears', async () => {
    const r = new EvidenceRegistry()
      .register(many('test.first', 120, 1))
      .register(many('test.second', 120, 2))
      .register(many('test.third', 120, 3));
    const bundle = await collectEvidence(r, {
      organizationId: ORG, consumer: 'test', budgetTokens: 2_600, now: NOW, basis: inertBasis(),
      select: { providerIds: ['test.first', 'test.second', 'test.third'] },
    });
    expect(bundle.results.map((x) => x.mode)).toEqual(['loaded', 'header', 'header']);
    expect(bundle.results[1].section.truncation).toEqual({ kept: 0, total: 120, by: 'total_budget' });
    const text = renderEvidence(bundle);
    for (const id of ['test.first', 'test.second', 'test.third']) expect(text).toContain(`[${id}]`);
    expect(text).toMatch(/\[test\.second\].*evidence size limit was reached/);
  });

  it('is deterministic: the same input gives the same plan', async () => {
    const r = new EvidenceRegistry().register(many('test.x', 80, 2)).register(many('test.y', 80, 1));
    const plan = async () => (await collectEvidence(r, {
      organizationId: ORG, consumer: 'test', budgetTokens: 2_000, now: NOW, basis: inertBasis(),
      select: { providerIds: ['test.x', 'test.y'] },
    })).results.map((x) => [x.id, x.mode, x.section.truncation]);
    expect(await plan()).toEqual(await plan());
    expect((await plan())[1][1]).toBe('loaded'); // priority 1 is filled first
  });
});

describe('fingerprints', () => {
  it('ignore retrievedAt; a state_and_data provider also ignores asOf, but never its state or data', async () => {
    const live = provider({ id: 'test.live', fingerprint: 'state_and_data' });
    const at = (now: Date, asOf: string, n = 1) => collectEvidence(new EvidenceRegistry().register({
      ...live,
      async collect() {
        return collectSection({ source: 'live' }, async () => ({ state: 'available', asOf, data: { items: [{ ref: 'i1', n }] } }));
      },
    }), { organizationId: ORG, consumer: 'test', budgetTokens: 10_000, now, basis: inertBasis() });
    const fp = async (b: Promise<Awaited<ReturnType<typeof at>>>) => evidenceFingerprint({ organizationId: ORG, sections: fingerprintSections(await b) });

    const base = await fp(at(NOW, '2026-11-06T11:59:00.000Z'));
    expect(await fp(at(new Date('2026-11-06T12:00:30.000Z'), '2026-11-06T12:00:20.000Z'))).toBe(base);
    expect(await fp(at(NOW, '2026-11-06T11:59:00.000Z', 2))).not.toBe(base);
  });

  it('sectionOf throws for an unregistered id', async () => {
    const bundle = await collectEvidence(new EvidenceRegistry().register(provider()), { organizationId: ORG, consumer: 'test', budgetTokens: 1_000, now: NOW, basis: inertBasis() });
    expect(() => sectionOf(bundle, 'test.missing')).toThrow(/no provider/);
  });
});

it('every state the contract defines is accepted by the wrapper', () => {
  expect([...CONTEXT_DATA_STATES].sort()).toEqual(
    ['available', 'error', 'not_built', 'not_connected', 'not_entitled', 'not_supported', 'partial', 'stale', 'unavailable']
  );
});
