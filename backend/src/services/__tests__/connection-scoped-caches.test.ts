/**
 * AWS connect PR B: every cache and in-flight entry of AWS-derived data is
 * keyed by organization AND connection identity (awsConnectionIdentity: row
 * id, AWS account, role ARN, home region), read BEFORE the lookup, and the
 * fetch uses that same row. So:
 *   - a connection change misses the old entry, even within its TTL;
 *   - an old in-flight refresh that completes after the change never fills
 *     what the new connection reads (empty results included);
 *   - errors are never stored.
 * No database or AWS: the account read and the Cost Explorer / CloudWatch
 * calls are stubbed. Placeholders only.
 */
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import * as accounts from '../../repositories/aws-accounts.repository';
import { AWSCostService } from '../aws-cost.service';
import { getLambdaUsageOverWindow } from '../lambda-usage.util';
import { getDynamoDBCapacityUsage } from '../dynamodb-usage.util';

const ORG = '00000000-0000-4000-8000-0000000000c1';
const row = (id: string): accounts.AwsAccountRow => ({
  id, org_id: ORG, account_id: '123456789012', role_arn: 'arn:aws:iam::123456789012:role/devcontrol-readonly',
  external_id: 'placeholder-external-id', region: 'us-east-1', nickname: null, status: 'active', connected_at: null,
});
const ROW_A = row('00000000-0000-4000-8000-00000000000a');
const ROW_B = row('00000000-0000-4000-8000-00000000000b');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

const monthly = (total: number) => ({ total, byService: [], period: { start: '2026-11-01', end: '2026-11-04' }, fetchedAt: '' });

describe('Cost Explorer caches (monthly cost, trend, fetchedAt)', () => {
  let current: accounts.AwsAccountRow | null;
  let createdWith: Array<accounts.AwsAccountRow | undefined>;
  let answers: Array<() => Promise<unknown>>;

  beforeEach(() => {
    current = ROW_A;
    createdWith = [];
    answers = [];
    jest.spyOn(accounts, 'requireEligibleAwsAccount').mockImplementation(async (_db, org) => {
      if (!current) throw new accounts.AwsAccountNotConnectedError(org);
      return current;
    });
    jest.spyOn(AWSCostService, 'createForOrg').mockImplementation(async (_org, _db, account) => {
      createdWith.push(account);
      const next = answers.shift()!;
      return { queryMonthlyCosts: next, queryCostTrend: next } as unknown as AWSCostService;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('the fetch uses the very row the cache key was read from', async () => {
    const service = new AWSCostService();
    answers.push(async () => monthly(10));
    await service.fetchMonthlyCosts(ORG);
    expect(createdWith).toEqual([ROW_A]);
  });

  it('a connection change misses the old entry, even within the 4 h TTL', async () => {
    const service = new AWSCostService();
    answers.push(async () => monthly(10), async () => monthly(20));
    expect((await service.fetchMonthlyCosts(ORG)).total).toBe(10);
    expect((await service.fetchMonthlyCosts(ORG)).total).toBe(10); // A's hit
    current = ROW_B;
    expect((await service.fetchMonthlyCosts(ORG)).total).toBe(20);
    expect(createdWith).toEqual([ROW_A, ROW_B]);
  });

  it('an old in-flight refresh that completes after the change never fills what the new connection reads', async () => {
    const service = new AWSCostService();
    const slowA = deferred<unknown>();
    answers.push(() => slowA.promise, async () => monthly(20));
    const old = service.fetchMonthlyCosts(ORG);
    await new Promise((r) => setImmediate(r));
    current = ROW_B;
    const fresh = await service.fetchMonthlyCosts(ORG); // never joins A's in-flight fetch
    slowA.resolve(monthly(10));
    expect((await old).total).toBe(10);
    expect(fresh.total).toBe(20);
    expect((await service.fetchMonthlyCosts(ORG)).total).toBe(20);
    expect(createdWith).toEqual([ROW_A, ROW_B]);
  });

  it('an empty result ($0) cached for A is never served to B', async () => {
    const service = new AWSCostService();
    answers.push(async () => monthly(0), async () => monthly(42));
    expect((await service.fetchMonthlyCosts(ORG)).total).toBe(0);
    current = ROW_B;
    expect((await service.fetchMonthlyCosts(ORG)).total).toBe(42);
  });

  it('errors are never stored: the next call is a real attempt', async () => {
    const service = new AWSCostService();
    answers.push(async () => { throw new Error('throttled'); }, async () => monthly(5));
    await expect(service.fetchMonthlyCosts(ORG)).rejects.toThrow('throttled');
    expect((await service.fetchMonthlyCosts(ORG)).total).toBe(5);
  });

  it('no eligible connection: AWS_NOT_CONNECTED, as before, and nothing is fetched', async () => {
    const service = new AWSCostService();
    current = null;
    await expect(service.fetchMonthlyCosts(ORG)).rejects.toThrow(/^AWS_NOT_CONNECTED/);
    expect(createdWith).toEqual([]);
  });

  it('the trend and its fetchedAt follow the same rule; an old in-flight trend (empty) never fills B', async () => {
    const service = new AWSCostService();
    const slowA = deferred<unknown>();
    answers.push(() => slowA.promise, async () => [{ date: '2026-11-01', total: 7 }]);
    const old = service.fetchCostTrend(ORG, '30d');
    await new Promise((r) => setImmediate(r));
    current = ROW_B;
    expect(await service.getCostTrendFetchedAt(ORG, '30d')).toBeNull();
    const fresh = await service.fetchCostTrend(ORG, '30d');
    slowA.resolve([]);
    expect(await old).toEqual([]);
    expect(fresh).toEqual([{ date: '2026-11-01', total: 7 }]);
    expect(await service.fetchCostTrend(ORG, '30d')).toEqual([{ date: '2026-11-01', total: 7 }]);
    expect(await service.getCostTrendFetchedAt(ORG, '30d')).not.toBeNull();
    current = ROW_A;
    expect(await service.getCostTrendFetchedAt(ORG, '30d')).not.toBeNull(); // A's own (empty) entry, A's only
    current = null;
    expect(await service.getCostTrendFetchedAt(ORG, '30d')).toBeNull();
  });
});

describe('Lambda and DynamoDB usage caches', () => {
  const IDENTITY_A = accounts.awsConnectionIdentity(ROW_A);
  const IDENTITY_B = accounts.awsConnectionIdentity(ROW_B);
  const client = (send: jest.Mock) => Object.assign(new CloudWatchClient({ region: 'us-east-1' }), { send }) as CloudWatchClient;

  it('Lambda: the same function under another connection is a miss; an empty (zero) result is scoped too', async () => {
    const send = jest.fn().mockResolvedValue({ Datapoints: [] });
    const cw = client(send);
    const fn = `fn-${Date.now()}`;
    expect(await getLambdaUsageOverWindow(cw, ORG, IDENTITY_A, fn)).toEqual({ invocations: 0, avgDurationMs: 0 });
    await getLambdaUsageOverWindow(cw, ORG, IDENTITY_A, fn);
    expect(send).toHaveBeenCalledTimes(1);
    await getLambdaUsageOverWindow(cw, ORG, IDENTITY_B, fn);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('Lambda: with no known connection nothing is read from or written to the cache', async () => {
    const send = jest.fn().mockResolvedValue({ Datapoints: [] });
    const cw = client(send);
    const fn = `fn-null-${Date.now()}`;
    await getLambdaUsageOverWindow(cw, ORG, null, fn);
    await getLambdaUsageOverWindow(cw, ORG, null, fn);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('DynamoDB: the same table under another connection is a miss', async () => {
    const send = jest.fn().mockResolvedValue({ Datapoints: [] });
    const cw = client(send);
    const table = `t-${Date.now()}`;
    await getDynamoDBCapacityUsage(cw, ORG, IDENTITY_A, table, 1, 86400);
    const afterA = send.mock.calls.length;
    await getDynamoDBCapacityUsage(cw, ORG, IDENTITY_A, table, 1, 86400);
    expect(send.mock.calls.length).toBe(afterA);
    await getDynamoDBCapacityUsage(cw, ORG, IDENTITY_B, table, 1, 86400);
    expect(send.mock.calls.length).toBe(afterA * 2);
  });
});
