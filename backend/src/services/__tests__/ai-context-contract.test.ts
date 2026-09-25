/**
 * The AI context state/provenance contract (ai-context-contract.ts): every
 * section carries state, source, asOf, scope, coverage, and reason, and a
 * getter that throws becomes state 'error' with data null -- never [], {},
 * 0, or an apparently valid empty result.
 *
 * No DB needed: collectSection()/notSupported() are pure.
 */
import { collectSection, ContextSection, notSupported } from '../ai-context-contract';

const ENVELOPE_KEYS = ['coverage', 'data', 'reason', 'scope', 'source', 'state', 'asOf'].sort();
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
      state: 'available', source: 'test source', asOf: '2026-09-25T06:00:00.000Z', scope: SCOPE,
      coverage: 'everything', reason: null, data: ['ec2', 's3'],
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
      state: 'not_supported', source: 'DevControl anomaly detection', asOf: null, scope: SCOPE,
      coverage: null, reason: "No anomaly detection is connected to the assistant's context.", data: null,
    });
  });
});
