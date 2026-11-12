/**
 * Synthetic Cost Explorer for the dashboard money tests: a fixed daily ledger
 * answered in the shape GetCostAndUsage returns, for any TimePeriod and either
 * granularity, grouped by SERVICE. Not real data.
 *
 * Every UTC day up to DATA_THROUGH has charges (EC2 $12.63, S3 $0.67); later
 * days have none, as on 2026-11-01T00:37Z, before AWS has reported Nov 1.
 * MONTHLY results are one entry per calendar month inside the period, each
 * the sum of its days; DAILY results are one entry per day. Every entry
 * carries its TimePeriod, as Cost Explorer's do.
 */
export const DATA_THROUGH = '2026-10-31';

export const LEDGER: ReadonlyArray<[service: string, dailyAmount: number]> = [
  ['Amazon Elastic Compute Cloud - Compute', 12.63],
  ['Amazon Simple Storage Service', 0.67],
];

export const ACCOUNT_ROW = {
  id: 'acct-row-1',
  org_id: '00000000-0000-4000-8000-0000000000a1',
  account_id: '123456789012',
  role_arn: 'arn:aws:iam::123456789012:role/devcontrol-readonly',
  external_id: 'external-id-fixture',
  region: 'us-east-1',
  nickname: null,
  status: 'active',
  connected_at: '2026-06-01T00:00:00.000Z',
};

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function nextMonthStart(day: string): string {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

function groupsFor(days: string[], dataThrough: string) {
  const billed = days.filter((d) => d <= dataThrough);
  if (billed.length === 0) return [];
  return LEDGER.map(([service, amount]) => ({
    Keys: [service],
    Metrics: { UnblendedCost: { Amount: (Math.round(amount * billed.length * 1e6) / 1e6).toString(), Unit: 'USD' } },
  }));
}

export interface CeInput {
  TimePeriod: { Start: string; End: string };
  Granularity: 'DAILY' | 'MONTHLY';
  NextPageToken?: string;
}

/** `dataThrough`: the last UTC day with charges (default DATA_THROUGH). */
export function ceLedgerResponse(input: CeInput, dataThrough: string = DATA_THROUGH) {
  const { Start, End } = input.TimePeriod;
  const results: Array<{ TimePeriod: { Start: string; End: string }; Total: Record<string, never>; Groups: ReturnType<typeof groupsFor>; Estimated: boolean }> = [];
  if (input.Granularity === 'DAILY') {
    for (let d = Start; d < End; d = addDays(d, 1)) {
      results.push({ TimePeriod: { Start: d, End: addDays(d, 1) }, Total: {}, Groups: groupsFor([d], dataThrough), Estimated: d >= addDays(dataThrough, -1) });
    }
  } else {
    for (let s = Start; s < End; s = nextMonthStart(s)) {
      const e = nextMonthStart(s) < End ? nextMonthStart(s) : End;
      const days: string[] = [];
      for (let d = s; d < e; d = addDays(d, 1)) days.push(d);
      results.push({ TimePeriod: { Start: s, End: e }, Total: {}, Groups: groupsFor(days, dataThrough), Estimated: e > addDays(dataThrough, -1) });
    }
  }
  return { ResultsByTime: results, DimensionValueAttributes: [], GroupDefinitions: [{ Type: 'DIMENSION', Key: 'SERVICE' }] };
}
