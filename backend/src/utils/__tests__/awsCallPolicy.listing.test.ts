/**
 * Multi-region plan M4c, AC-3 (G1, G2, G3, G6, G7): every discovery and cost-detector
 * listing reads all its pages through listAllPages, bounded by a page limit that marks
 * the listing incomplete; every client discovery and the detectors send through is
 * under the call policy. The database-backed consequences (an incomplete listing, a
 * timeout or a page error never deletes anything) are in
 * services/__tests__/m4c-partial-scan.test.ts.
 *
 * No AWS call, no database.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  AwsCallTimeoutError,
  DEFAULT_AWS_CALL_POLICY,
  MAX_LISTING_PAGES,
  MAX_LIST_FUNCTIONS_PAGES,
  isAccessDeniedError,
  listAllPages,
  withCallPolicyOnClients,
} from '../awsCallPolicy';
import { authorizesCleanup, failedSourceStatus } from '../../services/source-outcome';

const awsError = (name: string) => Object.assign(new Error(name), { name });

describe('listAllPages', () => {
  it('G1: reads every page, in order, and is complete when the last page has no token', async () => {
    const pages: Record<string, { items: string[]; nextToken?: string }> = {
      first: { items: ['a', 'b'], nextToken: 't2' },
      t2: { items: ['c'], nextToken: 't3' },
      t3: { items: ['d'] },
    };
    const fetchPage = jest.fn(async (token: string | undefined) => pages[token ?? 'first']);

    const listing = await listAllPages('test', fetchPage);

    expect(listing).toEqual({ items: ['a', 'b', 'c', 'd'], pages: 3, complete: true });
    expect(fetchPage.mock.calls.map(([token]) => token)).toEqual([undefined, 't2', 't3']);
  });

  it('G2: stops at the page limit when a token remains, and says the listing is incomplete', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchPage = jest.fn(async (token: string | undefined) => ({ items: [token ?? 'start'], nextToken: 'again' }));

    const listing = await listAllPages('forever', fetchPage, 5);

    expect(listing.complete).toBe(false);
    expect(listing.pages).toBe(5);
    expect(listing.items).toHaveLength(5);
    expect(fetchPage).toHaveBeenCalledTimes(5);
  });

  it('G2: the default limit is MAX_LISTING_PAGES', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchPage = jest.fn(async () => ({ items: [], nextToken: 'again' }));

    const listing = await listAllPages('forever', fetchPage);

    expect(listing.complete).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(MAX_LISTING_PAGES);
  });

  it('a last page exactly at the limit is complete', async () => {
    const fetchPage = jest.fn(async (token: string | undefined) => (token ? { items: [2] } : { items: [1], nextToken: 'last' }));
    expect(await listAllPages('two', fetchPage, 2)).toEqual({ items: [1, 2], pages: 2, complete: true });
  });

  it('G3: a page that fails makes the listing throw: it has no answer at all', async () => {
    const fetchPage = jest.fn(async (token: string | undefined) => {
      if (token) throw awsError('ServiceUnavailable');
      return { items: [1], nextToken: 't2' };
    });
    await expect(listAllPages('broken', fetchPage)).rejects.toThrow('ServiceUnavailable');
  });

  it('the page limits are pinned (a change is a visible diff)', () => {
    expect(MAX_LISTING_PAGES).toBe(100);
    expect(MAX_LIST_FUNCTIONS_PAGES).toBe(200);
  });
});

describe('source outcomes', () => {
  it('a timeout is timed_out, a denial is denied, anything else failed; only complete authorizes cleanup', () => {
    expect(failedSourceStatus(new AwsCallTimeoutError(15_000))).toBe('timed_out');
    for (const name of ['AccessDenied', 'AccessDeniedException', 'UnauthorizedOperation', 'AuthFailure']) {
      expect(failedSourceStatus(awsError(name))).toBe('denied');
      expect(isAccessDeniedError(awsError(name))).toBe(true);
    }
    expect(failedSourceStatus(awsError('ThrottlingException'))).toBe('failed');
    expect(failedSourceStatus(new Error('boom'))).toBe('failed');

    expect(authorizesCleanup({ source: 's', status: 'complete' })).toBe(true);
    for (const status of ['truncated', 'partial', 'failed', 'denied', 'timed_out', 'skipped_tier'] as const) {
      expect(authorizesCleanup({ source: 's', status })).toBe(false);
    }
    expect(authorizesCleanup(undefined)).toBe(false);
  });
});

describe('withCallPolicyOnClients', () => {
  const quickPolicy = { ...DEFAULT_AWS_CALL_POLICY, timeoutMs: 20, maxAttempts: 1 };

  it('puts every client under the time limit, including the ones a regional factory builds, once per region', async () => {
    const hang = (...command: unknown[]) => new Promise(() => void command);
    const built: string[] = [];
    const clients = withCallPolicyOnClients(
      {
        region: 'us-east-1',
        enabled: true,
        ec2: { send: jest.fn(hang) },
        lambda: { send: jest.fn(hang) },
        notAClient: { name: 'kept' },
        getCloudWatchClientForRegion: (region: string) => {
          built.push(region);
          return { send: jest.fn(hang) };
        },
      },
      quickPolicy
    );

    await expect(clients.ec2.send({})).rejects.toBeInstanceOf(AwsCallTimeoutError);
    await expect(clients.lambda.send({})).rejects.toBeInstanceOf(AwsCallTimeoutError);
    const euWest1 = clients.getCloudWatchClientForRegion('eu-west-1');
    await expect(euWest1.send({})).rejects.toBeInstanceOf(AwsCallTimeoutError);
    expect(clients.getCloudWatchClientForRegion('eu-west-1')).toBe(euWest1);
    expect(built).toEqual(['eu-west-1']);
    expect(clients.notAClient).toEqual({ name: 'kept' });
    expect(clients.region).toBe('us-east-1');
    expect(clients.enabled).toBe(true);
  });
});

/** The source of a backend file, with comments removed so prose cannot satisfy a check. */
function source(relative: string): string {
  const text = fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const LISTING_FILES = [
  'services/awsResourceDiscovery.ts',
  'services/cost-optimization.service.ts',
  'services/complianceScanner.ts',
  'services/resourceExplorer.service.ts',
  'services/aurora-cluster.util.ts',
];

// Every command these files list with. A new listing is added here and to listAllPages.
const LISTING_COMMANDS = [
  'DescribeInstancesCommand',
  'DescribeVolumesCommand',
  'DescribeSecurityGroupsCommand',
  'DescribeAddressesCommand',
  'DescribeReservedInstancesCommand',
  'DescribeDBInstancesCommand',
  'DescribeDBClustersCommand',
  'DescribeLoadBalancersCommand',
  'ListDistributionsCommand',
  'ListFunctionsCommand',
  'ListBucketsCommand',
  'ListUsersCommand',
  'SearchCommand',
];

describe('G7: every discovery and detector listing goes through listAllPages', () => {
  it.each(LISTING_FILES)('%s uses no SDK paginator and no hand-written page loop', (file) => {
    const text = source(file);
    expect(text).not.toMatch(/\bpaginate[A-Z]\w*\s*\(/);
    expect(text).not.toMatch(/while\s*\(\s*(nextToken|continuationToken|marker|token)\b/i);
  });

  it.each(LISTING_FILES)('%s sends every listing command from inside a listAllPages page callback', (file) => {
    const lines = source(file).split('\n');
    const offenders: string[] = [];
    lines.forEach((line, index) => {
      for (const command of LISTING_COMMANDS) {
        if (!new RegExp(`new ${command}\\(`).test(line)) continue;
        // Batched by id, not a listing: DescribeVolumes for up to 200 volume ids,
        // which AWS answers without pages (MaxResults cannot be combined with VolumeIds).
        if (command === 'DescribeVolumesCommand' && /VolumeIds:/.test(line)) continue;
        const window = lines.slice(Math.max(0, index - 10), index + 1).join('\n');
        if (!/listAllPages\(/.test(window)) offenders.push(`${file}:${index + 1} ${line.trim()}`);
      }
    });
    expect(offenders).toEqual([]);
  });

  it('the listing command list is not empty for the files that list', () => {
    const all = LISTING_FILES.map(source).join('\n');
    for (const command of LISTING_COMMANDS) expect(all).toContain(`new ${command}(`);
  });
});

describe('G6: every client discovery and the detectors send through is under the call policy', () => {
  it('the cost detectors wrap the clients they are given, and build none themselves', () => {
    const text = source('services/cost-optimization.service.ts');
    expect(text).toMatch(/const clients = withCallPolicyOnClients\(/);
    expect(text).not.toMatch(/new \w+Client\(/);
    expect(text).toMatch(/private callPolicy: AwsCallPolicy = DEFAULT_AWS_CALL_POLICY/);
  });

  it('discovery wraps every client, and builds none itself', () => {
    const text = source('services/awsResourceDiscovery.ts');
    expect(text).toMatch(/private applyCallPolicy\(clients: AWSClients\): AWSClients \{\s*return withCallPolicyOnClients\(clients, this\.callPolicy\);/);
    expect(text).toMatch(/const awsClients = this\.applyCallPolicy\(connectedClients\);/);
    expect(text).not.toMatch(/new \w+Client\(/);
    expect(text).toMatch(/private callPolicy: AwsCallPolicy = DEFAULT_AWS_CALL_POLICY/);
  });
});
