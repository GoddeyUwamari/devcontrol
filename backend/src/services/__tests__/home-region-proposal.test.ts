/**
 * Home region HR-1, the proposal rule (T9; HR-D5) and its one Cost Explorer
 * request (§B.1). Pure: Cost Explorer is a test double, nothing is stored.
 *
 *   rule: ≥ USD 5 regional spend; the leader ≥ 1.25 × the runner-up; not the
 *   current home region and ≥ 2 × its spend; non-region keys and credits ignored.
 *   request: LINKED_ACCOUNT filter, MONTHLY, UnblendedCost, REGION group, the last
 *   30 full UTC days; at most 2 pages; a failure is a reason, never a guess, and
 *   carries the error NAME only.
 *   view: proposed is shown only for an enabled, not excluded region other than
 *   the home region; waiting until the region list exists.
 */
import { GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import {
  PROPOSAL_RULE,
  decideProposal,
  evaluateHomeRegionProposal,
  fetchRegionSpend,
  homeRegionProposalView,
  proposalPeriod,
  proposalRequest,
  reconciledShares,
  type CostExplorerSender,
} from '../home-region-proposal';

const PERIOD = { start: '2026-10-17', end: '2026-11-16' };
const spend = (entries: Record<string, number>) => Object.entries(entries).map(([region, amount]) => ({ region, amount }));
const decide = (entries: Record<string, number>, home = 'us-east-1') => decideProposal(spend(entries), home, PERIOD);

describe('the rule (HR-D5)', () => {
  it.each([
    // [name, spend, current home, state, region, outcome]
    ['a clear leader', { 'us-west-2': 84, 'eu-west-1': 8, 'us-east-1': 3 }, 'us-east-1', 'proposed', 'us-west-2', 'proposed'],
    ['exactly the minimum total (USD 5.00)', { 'us-west-2': 5 }, 'us-east-1', 'proposed', 'us-west-2', 'proposed'],
    ['just under the minimum total', { 'us-west-2': 4.99 }, 'us-east-1', 'no_signal', null, 'below_minimum'],
    ['nothing spent', {}, 'us-east-1', 'no_signal', null, 'below_minimum'],
    ['exactly 1.25 x the runner-up', { 'us-west-2': 125, 'eu-west-1': 100 }, 'us-east-1', 'proposed', 'us-west-2', 'proposed'],
    ['just under 1.25 x the runner-up (near tie): split spend', { 'us-west-2': 124.99, 'eu-west-1': 100 }, 'us-east-1', 'split', null, 'near_tie'],
    ['an exact tie: split spend', { 'us-west-2': 50, 'eu-west-1': 50 }, 'us-east-1', 'split', null, 'near_tie'],
    ['the current home region leads', { 'us-east-1': 90, 'us-west-2': 10 }, 'us-east-1', 'no_signal', null, 'current_home_leads'],
    ['a near tie with the current home region on top: no prompt', { 'us-east-1': 100, 'us-west-2': 90 }, 'us-east-1', 'no_signal', null, 'near_tie'],
    ['a near tie of the current home region with another, the home region second: split spend', { 'us-west-2': 100, 'us-east-1': 90 }, 'us-east-1', 'split', null, 'near_tie'],
    ['exactly 2 x the current home region', { 'us-west-2': 60, 'us-east-1': 30 }, 'us-east-1', 'proposed', 'us-west-2', 'proposed'],
    ['just under 2 x the current home region: split spend', { 'us-west-2': 59.99, 'us-east-1': 30 }, 'us-east-1', 'split', null, 'not_twice_current'],
    ['a near tie under the USD 5 minimum: no prompt', { 'us-west-2': 2, 'eu-west-1': 2 }, 'us-east-1', 'no_signal', null, 'below_minimum'],
    ['the current home region had no spend', { 'eu-central-1': 40 }, 'us-west-2', 'proposed', 'eu-central-1', 'proposed'],
  ] as const)('%s', (_name, entries, home, state, region, outcome) => {
    const { state: s, proposal } = decide(entries as Record<string, number>, home);
    expect(s).toBe(state);
    expect(proposal.region).toBe(region);
    expect(proposal.outcome).toBe(outcome);
    expect(proposal.current).toBe(home);
  });

  it('split spend stores the top regions, the other regions and shares, and selects nothing', () => {
    const { state, proposal } = decide({ 'us-west-2': 30, 'eu-west-1': 28, 'ap-south-1': 20, 'us-east-2': 10, 'sa-east-1': 6, 'ca-central-1': 4, 'us-east-1': 2 });
    expect(state).toBe('split');
    expect(proposal.region).toBeNull();
    expect(proposal.top.map((t) => t.region)).toEqual(['us-west-2', 'eu-west-1', 'ap-south-1', 'us-east-2', 'sa-east-1']);
    expect(proposal.other_regions).toEqual({ count: 2, share: 6, amount: 6 });
    expect(Math.round([...proposal.top.map((t) => t.share), proposal.other_regions!.share].reduce((a, b) => a + b, 0) * 10)).toBe(1000);
  });

  it('keys that are not region codes (global, NoRegion, empty, junk) never count in the rule or the shares: their usage is kept apart', () => {
    const { state, proposal } = decide({ global: 10_000, NoRegion: 5_000, '': 3_000, 'US-WEST-2': 2_000, 'us-west-2': 6, 'us-east-1': 2 });
    expect(state).toBe('proposed');
    expect(proposal.region).toBe('us-west-2');
    expect(proposal.top).toEqual([{ region: 'us-west-2', share: 75, amount: 6 }, { region: 'us-east-1', share: 25, amount: 2 }]);
    expect(proposal).toMatchObject({ total_amount: 8, other_regions: null, non_region_amount: 20_000, current_share: 25, current_amount: 2 });
    expect(decide({ global: 10_000 }).proposal).toMatchObject({ outcome: 'below_minimum', top: [], other_regions: null, non_region_amount: 10_000, total_amount: 0 });
  });

  it('amounts at or below 0 are not spend', () => {
    const { state, proposal } = decide({ 'us-west-2': 10, 'eu-west-1': -500, 'us-east-1': 0 });
    expect(state).toBe('proposed');
    expect(proposal.top).toEqual([{ region: 'us-west-2', share: 100, amount: 10 }]);
    expect(proposal).toMatchObject({ current_share: 0, current_amount: 0, other_regions: null, total_amount: 10 });
  });

  it('7 regions: the top 5, highest first (ties by name), and the rest summed as other regions; the shares add up to exactly 100', () => {
    const { proposal } = decide({ 'us-west-2': 50, 'eu-west-1': 10, 'ap-south-1': 10, 'us-east-2': 10, 'sa-east-1': 10, 'ca-central-1': 10, 'us-east-1': 0.5 });
    expect(proposal.top).toEqual([
      { region: 'us-west-2', share: 49.8, amount: 50 },
      { region: 'ap-south-1', share: 10, amount: 10 },
      { region: 'ca-central-1', share: 10, amount: 10 },
      { region: 'eu-west-1', share: 9.9, amount: 10 },
      { region: 'sa-east-1', share: 9.9, amount: 10 },
    ]);
    expect(proposal.other_regions).toEqual({ count: 2, share: 10.4, amount: 10.5 });
    expect(Math.round([...proposal.top.map((t) => t.share), proposal.other_regions!.share].reduce((a, b) => a + b, 0) * 10)).toBe(1000);
    expect(proposal).toMatchObject({ total_amount: 100.5, current_share: 0.5, current_amount: 0.5, non_region_amount: 0 });
    expect(Object.keys(proposal).sort()).toEqual([
      'basis', 'current', 'current_amount', 'current_share', 'non_region_amount', 'other_regions', 'outcome', 'period', 'region', 'rule_version', 'top', 'total_amount',
    ]);
    expect(proposal).toMatchObject({ basis: 'cost_explorer_30d_usage', rule_version: 2 });
  });

  it('exactly 5 regions: no other regions; 6 regions: one other region', () => {
    const five = decide({ 'us-west-2': 50, 'eu-west-1': 20, 'ap-south-1': 15, 'us-east-2': 10, 'us-east-1': 5 }).proposal;
    expect(five.top).toHaveLength(5);
    expect(five.other_regions).toBeNull();
    const six = decide({ 'us-west-2': 50, 'eu-west-1': 20, 'ap-south-1': 15, 'us-east-2': 10, 'us-east-1': 4, 'sa-east-1': 1 }).proposal;
    expect(six.top.map((t) => t.region)).toEqual(['us-west-2', 'eu-west-1', 'ap-south-1', 'us-east-2', 'us-east-1']);
    expect(six.other_regions).toEqual({ count: 1, share: 1, amount: 1 });
  });

  it('the shares always add up to exactly 100.0 (largest remainder), whatever the split', () => {
    for (const amounts of [[1, 1, 1], [1, 1, 1, 1, 1, 1, 1], [33.33, 33.33, 33.34], [0.01, 999.99], [7, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53]]) {
      const entries = Object.fromEntries(amounts.map((a, i) => [`eu-test-${i + 1}`, a]));
      const { proposal } = decide(entries);
      const shares = [...proposal.top.map((t) => t.share), ...(proposal.other_regions ? [proposal.other_regions.share] : [])];
      expect(Math.round(shares.reduce((a, b) => a + b, 0) * 10)).toBe(1000);
      for (const share of shares) expect(Math.round(share * 10)).toBeCloseTo(share * 10, 9);
    }
    expect(reconciledShares([1, 1, 1], 3)).toEqual([33.4, 33.3, 33.3]);
    expect(reconciledShares([], 0)).toEqual([]);
  });

  it('amounts are rounded to cents', () => {
    const { proposal } = decide({ 'us-west-2': 10.006, 'us-east-1': 1.004, global: 2.346 });
    expect(proposal.top.map((t) => t.amount)).toEqual([10.01, 1]);
    expect(proposal).toMatchObject({ total_amount: 11.01, non_region_amount: 2.35 });
  });

  it('the constants are the approved ones', () => {
    expect(PROPOSAL_RULE).toMatchObject({ windowDays: 30, minTotalUsd: 5, runnerUpRatio: 1.25, currentHomeRatio: 2, maxPages: 2, topRegions: 5 });
  });
});

describe('the request (§B.1)', () => {
  it('the last 30 full UTC days before today, whatever the time of day', () => {
    expect(proposalPeriod(new Date('2026-11-16T00:00:00.000Z'))).toEqual({ start: '2026-10-17', end: '2026-11-16' });
    expect(proposalPeriod(new Date('2026-11-16T23:59:59.999Z'))).toEqual({ start: '2026-10-17', end: '2026-11-16' });
    expect(proposalPeriod(new Date('2026-03-01T12:00:00.000Z'))).toEqual({ start: '2026-01-30', end: '2026-03-01' });
  });

  it('is filtered to the connected account, monthly, unblended, grouped by region', () => {
    expect(proposalRequest('123456789012', PERIOD)).toEqual({
      TimePeriod: { Start: '2026-10-17', End: '2026-11-16' },
      Granularity: 'MONTHLY',
      Metrics: ['UNBLENDED_COST'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'REGION' }],
      Filter: {
        And: [
          { Dimensions: { Key: 'LINKED_ACCOUNT', Values: ['123456789012'] } },
          { Dimensions: { Key: 'RECORD_TYPE', Values: ['Usage'] } },
        ],
      },
    });
    expect(PROPOSAL_RULE.recordType).toBe('Usage');
  });

  const page = (groups: Record<string, string>, token?: string) => ({
    $metadata: {},
    NextPageToken: token,
    ResultsByTime: [{ Groups: Object.entries(groups).map(([k, amount]) => ({ Keys: [k], Metrics: { UnblendedCost: { Amount: amount, Unit: 'USD' } } })) }],
  });
  const ce = (...answers: Array<object | Error>): CostExplorerSender & { send: jest.Mock } => {
    const send = jest.fn();
    for (const answer of answers) send.mockImplementationOnce(async () => { if (answer instanceof Error) throw answer; return answer; });
    return { send } as any;
  };
  const NOW = new Date('2026-11-16T10:00:00Z');

  it('sums one region across months and pages; a second page carries the token', async () => {
    const client = ce(page({ 'us-west-2': '10.5', 'us-east-1': '1' }, 'next-1'), page({ 'us-west-2': '20.25' }));
    const result = await fetchRegionSpend(client, '123456789012', NOW);
    expect(result).toEqual({ ok: true, period: PERIOD, spend: [{ region: 'us-west-2', amount: 30.75 }, { region: 'us-east-1', amount: 1 }] });
    expect(client.send).toHaveBeenCalledTimes(2);
    expect((client.send.mock.calls[0][0] as GetCostAndUsageCommand).input.NextPageToken).toBeUndefined();
    expect((client.send.mock.calls[1][0] as GetCostAndUsageCommand).input.NextPageToken).toBe('next-1');
  });

  it('more than 2 pages: too_many_pages, never a partial answer, and no third request', async () => {
    const client = ce(page({ 'us-west-2': '10' }, 'a'), page({ 'us-west-2': '10' }, 'b'), page({ 'us-west-2': '10' }));
    expect(await fetchRegionSpend(client, '123456789012', NOW)).toEqual({ ok: false, reason: 'too_many_pages' });
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a missing amount', { $metadata: {}, ResultsByTime: [{ Groups: [{ Keys: ['us-west-2'], Metrics: {} }] }] }],
    ['a non-numeric amount', { $metadata: {}, ResultsByTime: [{ Groups: [{ Keys: ['us-west-2'], Metrics: { UnblendedCost: { Amount: 'n/a' } } }] }] }],
    ['a group with no key', { $metadata: {}, ResultsByTime: [{ Groups: [{ Metrics: { UnblendedCost: { Amount: '1' } } }] }] }],
  ])('%s: malformed', async (_name, answer) => {
    expect(await fetchRegionSpend(ce(answer), '123456789012', NOW)).toEqual({ ok: false, reason: 'malformed' });
  });

  it.each([
    ['AccessDeniedException', 'denied'],
    ['UnrecognizedClientException', 'denied'],
    ['DataUnavailableException', 'failed'],
    ['ThrottlingException', 'failed'],
  ])('%s: %s, with the error name and never AWS\'s message', async (name, reason) => {
    const error = Object.assign(new Error('User: arn:aws:sts::111122223333:assumed-role/x/y is not authorized'), { name });
    const result = await fetchRegionSpend(ce(error), '123456789012', NOW);
    expect(result).toEqual({ ok: false, reason, errorName: name });
    expect(JSON.stringify(result)).not.toContain('not authorized');
  });

  it('a request that does not answer in time: timed_out (aborted), never waits longer', async () => {
    const client = { send: jest.fn((_command: unknown, options?: { abortSignal?: AbortSignal }) => new Promise((_resolve, reject) => {
      options?.abortSignal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) } as any;
    expect(await fetchRegionSpend(client, '123456789012', NOW, { timeoutMs: 20 })).toEqual({ ok: false, reason: 'timed_out', errorName: 'AbortError' });
  });

  it('a credit applied in one region does not change the proposal: the request asks for usage only', async () => {
    // A Cost Explorer that answers usage alone when asked for RECORD_TYPE = Usage, and the
    // net of usage and a credit otherwise (a credit of 60 applied in us-west-2).
    const usage = { 'us-west-2': '80', 'eu-west-1': '50', 'us-east-1': '10' };
    const net = { 'us-west-2': '20', 'eu-west-1': '50', 'us-east-1': '10' };
    const client = { send: jest.fn(async (command: GetCostAndUsageCommand) => {
      const filters = (command.input.Filter?.And ?? []).map((f) => f.Dimensions);
      const usageOnly = filters.some((d) => d?.Key === 'RECORD_TYPE' && d.Values?.length === 1 && d.Values[0] === 'Usage');
      return page(usageOnly ? usage : net);
    }) } as any;
    const evaluated = await evaluateHomeRegionProposal(client, '123456789012', 'us-east-1', NOW);
    expect(evaluated).toMatchObject({ state: 'proposed', proposal: { region: 'us-west-2', outcome: 'proposed' } });
    expect(evaluated.proposal!.top.map((t) => [t.region, t.amount])).toEqual([['us-west-2', 80], ['eu-west-1', 50], ['us-east-1', 10]]);
    // The same evidence without the credit gives the same proposal (the credit never reaches the rule).
    expect(decideProposal(spend({ 'us-west-2': 80, 'eu-west-1': 50, 'us-east-1': 10 }), 'us-east-1', PERIOD).proposal).toEqual(evaluated.proposal);
    // A credit that came through as its own negative line in a region would not count either.
    expect(decideProposal(spend({ 'us-west-2': 80, 'eu-west-1': 50, 'us-east-1': 10, 'ap-south-1': -200 }), 'us-east-1', PERIOD).proposal).toEqual(evaluated.proposal);
  });

  it('evaluate: the request, then the rule; unavailable carries no proposal', async () => {
    expect(await evaluateHomeRegionProposal(ce(page({ 'us-west-2': '80', 'us-east-1': '20' })), '123456789012', 'us-east-1', NOW))
      .toMatchObject({ state: 'proposed', proposal: { region: 'us-west-2', period: PERIOD } });
    expect(await evaluateHomeRegionProposal(ce(Object.assign(new Error('x'), { name: 'AccessDeniedException' })), '123456789012', 'us-east-1', NOW))
      .toEqual({ state: 'unavailable', proposal: null, reason: 'denied', errorName: 'AccessDeniedException' });
  });
});

describe('the view (GET /api/aws/accounts)', () => {
  const stored = { state: 'proposed', proposal: decide({ 'us-west-2': 84, 'eu-west-1': 13, 'us-east-1': 3 }).proposal };
  const list = (rows: Array<[string, boolean, boolean]>) => rows.map(([region, enabled, scanEnabled]) => ({ region, enabled, scanEnabled }));
  const evidence = {
    period: PERIOD,
    shares: [{ region: 'us-west-2', share: 84, amount: 84 }, { region: 'eu-west-1', share: 13, amount: 13 }, { region: 'us-east-1', share: 3, amount: 3 }],
    other_regions: null,
    current: { region: 'us-east-1', share: 3, amount: 3 },
    non_region_amount: 0,
  };

  it.each([
    ['enabled, not excluded, not the home region', list([['us-west-2', true, true], ['us-east-1', true, true]]), 'us-east-1', 'proposed'],
    ['no stored list yet', [], 'us-east-1', 'waiting'],
    ['not enabled', list([['us-west-2', false, true]]), 'us-east-1', 'not_applicable'],
    ['excluded', list([['us-west-2', true, false]]), 'us-east-1', 'not_applicable'],
    ['missing from the list', list([['us-east-1', true, true]]), 'us-east-1', 'not_applicable'],
    ['already the home region', list([['us-west-2', true, true]]), 'us-west-2', 'not_applicable'],
  ])('proposed and %s: %s', (_name, regions, home, state) => {
    expect(homeRegionProposalView(stored, home, regions)).toEqual({ state, region: 'us-west-2', ...evidence });
  });

  it('split: shown when the region list exists (split_waiting before), never with a region', () => {
    const split = { state: 'split', proposal: decide({ 'us-west-2': 50, 'eu-west-1': 45, 'us-east-1': 5 }).proposal };
    expect(homeRegionProposalView(split, 'us-east-1', list([['us-west-2', true, true]]))).toMatchObject({ state: 'split', region: null });
    expect(homeRegionProposalView(split, 'us-east-1', [])).toMatchObject({ state: 'split_waiting', region: null });
    expect(homeRegionProposalView(split, 'us-east-1', list([['us-west-2', true, true]]))!.shares.map((s) => s.region)).toEqual(['us-west-2', 'eu-west-1', 'us-east-1']);
  });

  it('never proposed: null; decided states pass through; other regions and the current region come from the stored evidence', () => {
    expect(homeRegionProposalView(null, 'us-east-1', [])).toBeNull();
    expect(homeRegionProposalView({ state: null, proposal: null }, 'us-east-1', [])).toBeNull();
    for (const state of ['accepted', 'dismissed', 'superseded']) {
      expect(homeRegionProposalView({ ...stored, state }, 'us-east-1', [])!.state).toBe(state);
    }
    const many = decide({ 'us-west-2': 50, 'eu-west-1': 10, 'ap-south-1': 10, 'us-east-2': 10, 'sa-east-1': 10, 'ca-central-1': 10, 'us-east-1': 0.5 }).proposal;
    const view = homeRegionProposalView({ state: 'proposed', proposal: many }, 'us-east-1', [])!;
    expect(view.shares).toHaveLength(5);
    expect(view.other_regions).toEqual({ count: 2, share: 10.4, amount: 10.5 });
    expect(view.current).toEqual({ region: 'us-east-1', share: 0.5, amount: 0.5 });
    expect(homeRegionProposalView({ state: 'unavailable', proposal: null }, 'us-east-1', [])).toEqual({
      state: 'unavailable', region: null, period: null, shares: [], other_regions: null, current: null, non_region_amount: null,
    });
  });
});
