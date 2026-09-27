/**
 * The AI context state/provenance contract (ai-context-contract.ts): every
 * section carries state, source, provenance, asOf, scope, period,
 * completeness, coverage, reason, and derivedFrom, and a
 * getter that throws becomes state 'error' with data null -- never [], {},
 * 0, or an apparently valid empty result.
 *
 * No DB needed: collectSection()/notSupported() are pure.
 */
import {
  AI_CONTEXT_CONTRACT_VERSION,
  canClaimNoCandidate,
  collectSection,
  completedDetection,
  ContextSection,
  CostExplorerScope,
  deriveSection,
  DetectorResult,
  evidenceFingerprint,
  EVIDENCE_CLAIM_RULES,
  hasEvidence,
  inconclusiveDetection,
  InventoryScope,
  isCurrentContractVersion,
  notSupported,
  requireOrganizationId,
  toModelEvidence,
} from '../ai-context-contract';

const ENVELOPE_KEYS = ['completeness', 'coverage', 'data', 'derivedFrom', 'period', 'provenance', 'reason', 'scope', 'source', 'state', 'asOf'].sort();
const SCOPE = { kind: 'organization' as const, window: 'last 30 days' };

function expectEnvelope(section: ContextSection<unknown>) {
  expect(Object.keys(section).sort()).toEqual(ENVELOPE_KEYS);
}

describe('collectSection', () => {
  it('a successful getter is "available" with its actual data and the section\'s provenance', async () => {
    const section = await collectSection(
      { source: 'test source', asOf: '2026-09-25T06:00:00.000Z', scope: SCOPE, coverage: 'everything' },
      async () => ({ state: 'available', data: ['ec2', 's3'] })
    );

    expectEnvelope(section);
    expect(section).toEqual({
      state: 'available', source: 'test source', provenance: null, asOf: '2026-09-25T06:00:00.000Z', scope: SCOPE,
      period: null, completeness: null, coverage: 'everything', reason: null, derivedFrom: null, data: ['ec2', 's3'],
    });
  });

  it('a partial result stays "partial", carrying its data and the stated limitation', async () => {
    const section = await collectSection({ source: 'test source' }, async () => ({
      state: 'partial', data: { count: 2 }, coverage: '2 of 3 functions', reason: 'one function\'s usage is unknown',
    }));

    expect(section.state).toBe('partial');
    expect(section.data).toEqual({ count: 2 });
    expect(section.coverage).toBe('2 of 3 functions');
    expect(section.reason).toBe('one function\'s usage is unknown');
  });

  it('a genuine empty result or zero stays data -- "available" [] / 0 is a measured fact, not an error', async () => {
    const empty = await collectSection({ source: 'test source' }, async () => ({ state: 'available', data: [] as string[] }));
    const zero = await collectSection({ source: 'test source' }, async () => ({ state: 'available', data: 0 }));

    expect(empty).toMatchObject({ state: 'available', data: [] });
    expect(zero).toMatchObject({ state: 'available', data: 0 });
  });

  it('"unavailable" carries its reason and never any data', async () => {
    const section = await collectSection({ source: 'test source', asOf: 'meta-as-of' }, async () => ({
      state: 'unavailable', reason: 'nothing recorded yet', asOf: null,
    }));

    expectEnvelope(section);
    expect(section).toMatchObject({ state: 'unavailable', reason: 'nothing recorded yet', data: null, asOf: null });
  });

  it('a result\'s own asOf/coverage override the meta defaults', async () => {
    const section = await collectSection(
      { source: 'test source', asOf: 'meta-as-of', coverage: 'meta coverage' },
      async () => ({ state: 'available', data: 1, asOf: 'result-as-of', coverage: 'result coverage' })
    );

    expect(section.asOf).toBe('result-as-of');
    expect(section.coverage).toBe('result coverage');
  });

  describe('a getter that throws', () => {
    let consoleError: jest.SpyInstance;
    beforeEach(() => {
      consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => consoleError.mockRestore());

    const throwingGetters: Array<[string, () => Promise<never>]> = [
      ['a list getter', async () => { throw new Error('relation "aws_resources" does not exist'); }],
      ['an object getter', async () => { throw new Error('connection terminated'); }],
      ['a count getter', async () => { throw new Error('timeout'); }],
    ];

    it.each(throwingGetters)('%s becomes "error" with data null -- never [], {}, or 0', async (_label, getter) => {
      const section = await collectSection({ source: 'test source', asOf: 'meta-as-of', scope: SCOPE, coverage: 'meta coverage' }, getter);

      expectEnvelope(section);
      expect(section.state).toBe('error');
      expect(section.data).toBeNull();
      expect(section.data).not.toEqual([]);
      expect(section.data).not.toEqual({});
      expect(section.data).not.toBe(0);
      // No freshness or coverage is claimed for data that was never obtained.
      expect(section.asOf).toBeNull();
      expect(section.coverage).toBeNull();
      // Scope and source still say what was attempted.
      expect(section.scope).toEqual(SCOPE);
      expect(section.source).toBe('test source');
    });

    it('logs the raw failure server-side, and keeps only a safe diagnostic in the section', async () => {
      const section = await collectSection({ source: 'test source' }, async () => {
        throw new Error('relation "aws_accounts" does not exist at character 15');
      });

      // Not swallowed: the raw message reaches the server log...
      expect(consoleError).toHaveBeenCalledWith('[AI Context] test source could not be retrieved:', 'relation "aws_accounts" does not exist at character 15');
      // ...but never the section, which reaches the model and the /context response.
      expect(section.reason).toBe('test source could not be retrieved.');
      expect(JSON.stringify(section)).not.toMatch(/relation|aws_accounts|character 15/);
    });

    it('a non-Error throw still becomes "error"', async () => {
      const section = await collectSection({ source: 'test source' }, async () => { throw 'plain string failure'; });

      expect(section).toMatchObject({ state: 'error', data: null, reason: 'test source could not be retrieved.' });
      expect(JSON.stringify(section)).not.toMatch(/plain string failure/);
    });
  });
});

describe('notSupported', () => {
  it('is "not_supported" with an explicit reason, no data, and no claimed freshness or coverage', () => {
    const section = notSupported({ source: 'DevControl anomaly detection', scope: SCOPE }, "No anomaly detection is connected to the assistant's context.");

    expectEnvelope(section);
    expect(section).toEqual({
      state: 'not_supported', source: 'DevControl anomaly detection', provenance: null, asOf: null, scope: SCOPE,
      period: null, completeness: null, coverage: null, reason: "No anomaly detection is connected to the assistant's context.",
      derivedFrom: null, data: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Truth / provenance foundation
// ---------------------------------------------------------------------------

const CE_SCOPE: CostExplorerScope = {
  kind: 'cost_explorer', connectedAccountId: '111122223333', linkedAccountFilter: 'none', consolidatedBilling: 'unknown', regions: 'all',
};
const INVENTORY_SCOPE: InventoryScope = { kind: 'resource_inventory', connectedAccountId: '111122223333', discoveryRegion: 'us-east-1' };
const MTD = { kind: 'range' as const, start: '2026-09-01', endExclusive: '2026-09-26' };
const CE_META = { source: 'AWS Cost Explorer', provenance: 'actual' as const, scope: CE_SCOPE, period: MTD };
const ESTIMATE_META = { source: 'DevControl inventory estimate', provenance: 'estimated' as const, scope: INVENTORY_SCOPE, period: { kind: 'point_in_time' as const } };

describe('truth/provenance foundation', () => {
  let consoleError: jest.SpyInstance;
  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => consoleError.mockRestore());

  it('A. available: actual evidence keeps its state, data, provenance, scope, and period', async () => {
    const section = await collectSection(CE_META, async () => ({ state: 'available', data: { total: 14.83 }, asOf: '2026-09-26T06:00:00.000Z' }));

    expect(section).toMatchObject({
      state: 'available', provenance: 'actual', source: 'AWS Cost Explorer', scope: CE_SCOPE, period: MTD,
      asOf: '2026-09-26T06:00:00.000Z', data: { total: 14.83 },
    });
    expect(hasEvidence(section)).toBe(true);
  });

  describe('B. partial', () => {
    it('keeps its completeness and data, and names the gap -- missing days are not filled in', async () => {
      const completeness = { unit: 'days', expected: 7, received: 5, missing: ['2026-09-20', '2026-09-21'] };
      const days = [1, 2, 3, 4, 5].map(n => ({ date: `2026-09-${15 + n}`, total: n }));
      const section = await collectSection<typeof days>(CE_META, async () => ({ state: 'partial', data: days, completeness }));

      expect(section.state).toBe('partial');
      expect(section.completeness).toEqual(completeness);
      expect(section.data).toHaveLength(5);
      expect(section.data).toEqual(days);
      expect(section.reason).toBe('5 of 7 days obtained (missing: 2026-09-20, 2026-09-21)');
    });

    it('a result claiming "available" with missing units is recorded as partial -- never silently complete', async () => {
      const section = await collectSection(CE_META, async () => ({
        state: 'available', data: [1, 2, 3], completeness: { unit: 'days', expected: 7, received: 3, missing: null },
      }));

      expect(section.state).toBe('partial');
      expect(section.reason).toBe('3 of 7 days obtained');
      expect(toModelEvidence(section).completeness).toMatchObject({ complete: false });
    });

    it('complete completeness stays available', async () => {
      const section = await collectSection(CE_META, async () => ({
        state: 'available', data: [1], completeness: { unit: 'days', expected: 1, received: 1, missing: null },
      }));
      expect(section.state).toBe('available');
      expect(toModelEvidence(section).completeness).toMatchObject({ complete: true });
    });

    it('invalid completeness (more received than expected) is not vouched for -- it becomes error', async () => {
      const section = await collectSection(CE_META, async () => ({
        state: 'available', data: [1], completeness: { unit: 'days', expected: 2, received: 3, missing: null },
      }));
      expect(section).toMatchObject({ state: 'error', data: null, provenance: null });
    });
  });

  it('C. unavailable: no data, no provenance, and never read as zero or empty', async () => {
    const section = await collectSection(CE_META, async () => ({ state: 'unavailable', reason: 'no AWS account is connected' }));
    const evidence = toModelEvidence(section);

    expect(section).toMatchObject({ state: 'unavailable', data: null, provenance: null, reason: 'no AWS account is connected' });
    expect(hasEvidence(section)).toBe(false);
    expect(evidence.evidencePresent).toBe(false);
    expect(evidence.data).toBeNull();
    expect(evidence.provenanceMeaning).toBeNull();
    expect(evidence.stateMeaning).toMatch(/NOT zero, none, empty, unchanged/);
  });

  it('D. error: data null, provenance dropped, raw internal error kept out of the section and the model evidence', async () => {
    const section = await collectSection(CE_META, async () => {
      throw new Error('AccessDeniedException: User arn:aws:sts::111122223333:assumed-role/DevControl is not authorized to perform ce:GetCostAndUsage');
    });

    expect(section).toMatchObject({ state: 'error', data: null, provenance: null, reason: 'AWS Cost Explorer could not be retrieved.' });
    expect(JSON.stringify(toModelEvidence(section))).not.toMatch(/AccessDenied|arn:aws|ce:GetCostAndUsage/);
    expect(consoleError).toHaveBeenCalled();
  });

  it('E. not_supported: its own state, with no data or provenance', () => {
    const section = notSupported({ source: 'AWS Compute Optimizer', provenance: 'actual' }, 'DevControl does not read Compute Optimizer.');

    expect(section).toMatchObject({ state: 'not_supported', data: null, provenance: null });
    expect(toModelEvidence(section)).toMatchObject({ state: 'not_supported', status: 'Not supported', evidencePresent: false });
  });

  describe('F/G/H. provenance', () => {
    it('F. actual Cost Explorer data stays actual -- including a real $0 and a net-negative credit total', async () => {
      for (const total of [0, -3.21, 14.83]) {
        const section = await collectSection(CE_META, async () => ({ state: 'available', data: { total } }));
        expect(section).toMatchObject({ state: 'available', provenance: 'actual', data: { total } });
        expect(toModelEvidence(section).provenanceMeaning).toBe('Observed directly from the stated source.');
      }
    });

    it('G. an inventory-derived value stays estimated, with inventory scope -- never billing scope or "actual"', async () => {
      const section = await collectSection(ESTIMATE_META, async () => ({ state: 'available', data: { monthlyRunRate: 42.5 } }));

      expect(section.provenance).toBe('estimated');
      expect(section.scope).toEqual(INVENTORY_SCOPE);
      expect(section.period).toEqual({ kind: 'point_in_time' });
      expect(toModelEvidence(section).provenanceMeaning).toMatch(/not an observed or billed value/);
    });

    it('a result can state its own provenance (e.g. one getter that knows which path produced the value)', async () => {
      const section = await collectSection<number>({ source: 'spend' }, async () => ({ state: 'available', data: 1, provenance: 'estimated' }));
      expect(section.provenance).toBe('estimated');
    });

    it('H. a value calculated from actual evidence is derived, not actual, and records its inputs', async () => {
      const current = await collectSection(CE_META, async () => ({ state: 'available', data: { total: 120 } }));
      const previous = await collectSection({ ...CE_META, period: { kind: 'range' as const, start: '2026-08-01', endExclusive: '2026-08-26' } },
        async () => ({ state: 'available', data: { total: 100 } }));

      const change = await deriveSection(
        { source: 'DevControl month-over-month comparison', scope: CE_SCOPE },
        [current, previous] as const,
        ([cur, prev]) => ({ changePercent: ((cur.total - prev.total) / prev.total) * 100 })
      );

      expect(change).toMatchObject({ state: 'available', provenance: 'derived', data: { changePercent: 20 } });
      expect(change.derivedFrom).toEqual([
        expect.objectContaining({ source: 'AWS Cost Explorer', provenance: 'actual', period: MTD }),
        expect.objectContaining({ provenance: 'actual', period: { kind: 'range', start: '2026-08-01', endExclusive: '2026-08-26' } }),
      ]);
    });

    it('a derived value is never computed from an error input -- the result is error, not "0%" or "flat"', async () => {
      const current = await collectSection(CE_META, async () => ({ state: 'available', data: { total: 120 } }));
      const previous = await collectSection(CE_META, async () => { throw new Error('ThrottlingException'); });
      const compute = jest.fn(() => ({ changePercent: 0 }));

      const change = await deriveSection({ source: 'DevControl month-over-month comparison' }, [current, previous] as const, compute);

      expect(compute).not.toHaveBeenCalled();
      expect(change).toMatchObject({ state: 'error', data: null, provenance: null });
      expect(change.reason).toBe('cannot be calculated: AWS Cost Explorer: could not be retrieved');
      expect(JSON.stringify(change)).not.toMatch(/Throttling/);
    });

    it.each([
      ['unavailable', () => collectSection<number>({ source: 'history' }, async () => ({ state: 'unavailable', reason: 'no history yet' })), 'history: not available'],
      ['not_supported', async () => notSupported<number>({ source: 'history' }, 'no source'), 'history: not supported'],
    ] as const)('a derived value from a %s input is unavailable, and compute never runs', async (_label, makeInput, reasonPart) => {
      const input = await makeInput();
      const compute = jest.fn(() => 0);

      const derived = await deriveSection({ source: 'trend' }, [input] as const, compute);

      expect(compute).not.toHaveBeenCalled();
      expect(derived).toMatchObject({ state: 'unavailable', data: null, provenance: null, reason: `cannot be calculated: ${reasonPart}` });
      expect(derived.derivedFrom).toEqual([expect.objectContaining({ source: 'history', state: input.state })]);
    });

    it('mixed missing inputs: error takes precedence over unavailable', async () => {
      const failed = await collectSection<number>({ source: 'A' }, async () => { throw new Error('x'); });
      const missing = await collectSection<number>({ source: 'B' }, async () => ({ state: 'unavailable', reason: 'none' }));

      for (const inputs of [[failed, missing], [missing, failed]] as const) {
        const derived = await deriveSection({ source: 'sum' }, inputs, ([a, b]) => a + b);
        expect(derived).toMatchObject({ state: 'error', data: null, provenance: null });
      }
    });

    it('with zero inputs is unavailable -- a derived value must cite its evidence', async () => {
      const compute = jest.fn(() => 5);
      const derived = await deriveSection({ source: 'orphan' }, [] as const, compute);

      expect(compute).not.toHaveBeenCalled();
      expect(derived).toMatchObject({
        state: 'unavailable', data: null, provenance: null, derivedFrom: [],
        reason: 'cannot be calculated: no input sections were supplied',
      });
    });

    it('a derived value from partial input is partial; a compute failure is a sanitized error', async () => {
      const partial = await collectSection(CE_META, async () => ({ state: 'partial', data: { total: 5 }, reason: 'some days missing' }));
      const derived = await deriveSection({ source: 'share' }, [partial] as const, ([p]) => p.total * 2);
      expect(derived).toMatchObject({ state: 'partial', provenance: 'derived', data: 10 });

      const failed = await deriveSection({ source: 'share' }, [partial] as const, () => { throw new Error('division by zero in pg'); });
      expect(failed).toMatchObject({ state: 'error', data: null, provenance: null, reason: 'share could not be retrieved.' });
      expect(failed.derivedFrom).toHaveLength(1);
    });

    it('a projection from actual data can be labeled estimated, never actual', async () => {
      const history = await collectSection(CE_META, async () => ({ state: 'available', data: [1, 2, 3] }));
      const forecast = await deriveSection({ source: 'DevControl forecast', provenance: 'estimated' }, [history] as const, ([h]) => h.length);
      expect(forecast.provenance).toBe('estimated');
      expect(forecast.derivedFrom?.[0].provenance).toBe('actual');
    });
  });

  it('hasEvidence is false for an available section whose data is null', () => {
    const hollow: ContextSection<number> = { ...notSupported<number>({ source: 'x' }, 'x'), state: 'available', reason: null };
    expect(hollow.data).toBeNull();
    expect(hasEvidence(hollow)).toBe(false);
    expect(toModelEvidence(hollow)).toMatchObject({ evidencePresent: false, data: null, provenance: null });
  });

  it('an unavailable result may carry completeness: kept, validated, never promoted, no data', async () => {
    const completeness = { unit: 'days', expected: 14, received: 3, missing: null };
    const section = await collectSection<number[]>(CE_META, async () => ({ state: 'unavailable', reason: 'not enough history', completeness }));

    expect(section).toMatchObject({ state: 'unavailable', data: null, provenance: null, reason: 'not enough history', completeness });
    expect(toModelEvidence(section)).toMatchObject({ evidencePresent: false, completeness: { ...completeness, complete: false } });

    const invalid = await collectSection<number[]>(CE_META, async () => ({
      state: 'unavailable', reason: 'x', completeness: { unit: 'days', expected: 1, received: 2, missing: null },
    }));
    expect(invalid).toMatchObject({ state: 'error', data: null, completeness: null });
  });

  it('I. available with zero findings is a measured fact, distinct from unavailable', async () => {
    const measuredNone = await collectSection<string[]>({ source: 'security findings' }, async () => ({ state: 'available', data: [] }));
    const unknown = await collectSection<string[]>({ source: 'security findings' }, async () => ({ state: 'unavailable', reason: 'no scan has run' }));

    expect(toModelEvidence(measuredNone)).toMatchObject({ state: 'available', evidencePresent: true, data: [] });
    expect(toModelEvidence(unknown)).toMatchObject({ state: 'unavailable', evidencePresent: false, data: null });
  });

  describe('J. detector outcomes are data, not section state', () => {
    type Candidate = { resourceId: string };
    const available = (data: DetectorResult<Candidate>) =>
      collectSection<DetectorResult<Candidate>>({ source: 'idle detector' }, async () => ({ state: 'available', data }));

    it('the four outcomes stay distinct inside an available section', async () => {
      const outcomes = await Promise.all([
        available(completedDetection([{ resourceId: 'i-1' }])),
        available(completedDetection<Candidate>([])),
        available(inconclusiveDetection('insufficient_data', 'fewer than 14 days of metrics')),
        available(inconclusiveDetection('error', 'metrics for 2 instances could not be read')),
      ]);

      expect(outcomes.map(s => [s.state, s.data?.outcome])).toEqual([
        ['available', 'candidate_identified'],
        ['available', 'no_candidate_identified'],
        ['available', 'insufficient_data'],
        ['available', 'error'],
      ]);
    });

    it('"no candidate identified" may be claimed only for an available section whose detector completed and found none', async () => {
      const none = completedDetection<Candidate>([]);
      const partialSection = await collectSection<DetectorResult<Candidate>>({ source: 'idle detector' }, async () => ({ state: 'partial', data: none }));

      expect(canClaimNoCandidate(await available(none))).toBe(true);
      expect(canClaimNoCandidate(await available(completedDetection([{ resourceId: 'i-1' }])))).toBe(false);
      expect(canClaimNoCandidate(await available(inconclusiveDetection('insufficient_data', 'x')))).toBe(false);
      expect(canClaimNoCandidate(await available(inconclusiveDetection('error', 'x')))).toBe(false);
      expect(canClaimNoCandidate(partialSection)).toBe(false);
      expect(canClaimNoCandidate(notSupported({ source: 'idle detector' }, 'no detector'))).toBe(false);
      expect(canClaimNoCandidate(await collectSection({ source: 'idle detector' }, async () => ({ state: 'unavailable', reason: 'x' })))).toBe(false);
      expect(canClaimNoCandidate(await collectSection({ source: 'idle detector' }, async () => { throw new Error('x'); }))).toBe(false);
    });
  });

  describe('K. tenant identity fails closed', () => {
    it.each([undefined, null, '', '   ', 42])('rejects %p', (organizationId) => {
      expect(() => requireOrganizationId(organizationId, 'AI Reports', 'report context')).toThrow('[AI Reports] organizationId is required for report context');
      expect(() => evidenceFingerprint({ organizationId: organizationId as any, sections: {} })).toThrow(/organizationId is required/);
    });

    it('returns an authenticated id unchanged', () => {
      expect(requireOrganizationId('org-a', 'AI Reports', 'report context')).toBe('org-a');
    });

    it('fingerprints differ per organization for identical evidence', async () => {
      const section = await collectSection(CE_META, async () => ({ state: 'available', data: { total: 1 } }));
      expect(evidenceFingerprint({ organizationId: 'org-a', sections: { cost: section } }))
        .not.toBe(evidenceFingerprint({ organizationId: 'org-b', sections: { cost: section } }));
    });
  });

  describe('L. contract version', () => {
    it('is carried in the model evidence and the fingerprint, so a shape change is detectable', async () => {
      const section = await collectSection(CE_META, async () => ({ state: 'available', data: { total: 1 } }));
      const current = evidenceFingerprint({ organizationId: 'org-a', sections: { cost: section } });
      const next = evidenceFingerprint({ organizationId: 'org-a', sections: { cost: section }, contractVersion: AI_CONTEXT_CONTRACT_VERSION + 1 });

      expect(toModelEvidence(section).contractVersion).toBe(AI_CONTEXT_CONTRACT_VERSION);
      expect(current.startsWith(`v${AI_CONTEXT_CONTRACT_VERSION}:`)).toBe(true);
      expect(next.startsWith(`v${AI_CONTEXT_CONTRACT_VERSION + 1}:`)).toBe(true);
      expect(next).not.toBe(current);
      expect(isCurrentContractVersion(AI_CONTEXT_CONTRACT_VERSION)).toBe(true);
      expect(isCurrentContractVersion(AI_CONTEXT_CONTRACT_VERSION + 1)).toBe(false);
      expect(isCurrentContractVersion(undefined)).toBe(false);
    });

    it('the fingerprint is stable for equal evidence (key order irrelevant) and changes with evidence, prompt version, or freshness', async () => {
      const a = await collectSection(CE_META, async () => ({ state: 'available', data: { total: 1, currency: 'USD' }, asOf: 't1' }));
      const reordered = await collectSection(CE_META, async () => ({ state: 'available', data: { currency: 'USD', total: 1 }, asOf: 't1' }));
      const changed = await collectSection(CE_META, async () => ({ state: 'available', data: { total: 2, currency: 'USD' }, asOf: 't1' }));
      const refetched = await collectSection(CE_META, async () => ({ state: 'available', data: { total: 1, currency: 'USD' }, asOf: 't2' }));
      const fp = (cost: ContextSection<unknown>, promptVersion?: string) => evidenceFingerprint({ organizationId: 'org-a', sections: { cost }, promptVersion });

      expect(fp(reordered)).toBe(fp(a));
      expect(fp(changed)).not.toBe(fp(a));
      expect(fp(refetched)).not.toBe(fp(a));
      expect(fp(a, 'reports-v2')).not.toBe(fp(a, 'reports-v1'));
    });
  });

  describe('M. model serialization', () => {
    it('preserves state, provenance, source, scope, period, freshness, completeness, and data -- with every key always present', async () => {
      const completeness = { unit: 'days', expected: 7, received: 5, missing: null };
      const section = await collectSection(CE_META, async () => ({ state: 'partial', data: { total: 9.99 }, asOf: '2026-09-26T06:00:00.000Z', completeness }));

      expect(toModelEvidence(section)).toEqual({
        contractVersion: AI_CONTEXT_CONTRACT_VERSION,
        state: 'partial',
        status: 'Partial',
        stateMeaning: expect.stringMatching(/Only part of the requested evidence/),
        evidencePresent: true,
        provenance: 'actual',
        provenanceMeaning: 'Observed directly from the stated source.',
        source: 'AWS Cost Explorer',
        scope: CE_SCOPE,
        period: MTD,
        asOf: '2026-09-26T06:00:00.000Z',
        completeness: { ...completeness, complete: false },
        coverage: null,
        reason: '5 of 7 days obtained',
        derivedFrom: null,
        data: { total: 9.99 },
      });
    });

    it('has the same key order for every state, so the representation is deterministic', async () => {
      const keys = (s: ContextSection<unknown>) => Object.keys(toModelEvidence(s));
      const available = await collectSection(CE_META, async () => ({ state: 'available', data: 1 }));
      const error = await collectSection(CE_META, async () => { throw new Error('x'); });
      const unsupported = notSupported(CE_META, 'x');

      expect(keys(error)).toEqual(keys(available));
      expect(keys(unsupported)).toEqual(keys(available));
    });

    it('the shared claim rules cover missing evidence, partial evidence, estimates, and "nothing found"', () => {
      expect(EVIDENCE_CLAIM_RULES).toMatch(/never describe it as zero, none, empty, unchanged, flat, or "no findings"/);
      expect(EVIDENCE_CLAIM_RULES).toMatch(/never present it as complete/);
      expect(EVIDENCE_CLAIM_RULES).toMatch(/"estimated" is an estimate, not billed/);
      expect(EVIDENCE_CLAIM_RULES).toMatch(/only when the section is available and its outcome is no_candidate_identified/);
    });
  });
});
