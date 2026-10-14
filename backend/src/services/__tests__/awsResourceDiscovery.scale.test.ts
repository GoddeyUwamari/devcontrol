/**
 * Discovery at the size of a target account: 300 buckets and 200 instances across
 * 4 regions, with some calls throttled, denied or hanging.
 *
 * What is proven:
 *   - the scan completes and returns every resource;
 *   - per-bucket, per-instance and per-region work runs a bounded number at a time;
 *   - a throttled call is retried with backoff, and one that recovers leaves no trace;
 *   - a call that keeps failing (or hangs past its time limit) costs that one resource
 *     that one answer -- recorded as unknown -- and nothing else.
 *
 * Every AWS call is answered here after a simulated 5 ms. The mocked `send` stands in
 * for the SDK, so the SDK's own retries are not in play: each count below is one
 * policy attempt. The policy is the default one (concurrency 8, 2 attempts, real
 * backoff) except for the per-call time limit, which
 * is shortened so the two hanging calls do not hold the test for 15 s each.
 * Set RT2B_SCALE_OUT to a file path to have the measured call counts and timings
 * written there as JSON.
 */
import fs from 'fs';
import { EC2Client } from '@aws-sdk/client-ec2';
import { S3Client } from '@aws-sdk/client-s3';
import { BackupClient } from '@aws-sdk/client-backup';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { createAwsBackupEvidenceCache } from '../aws-backup-evidence.util';
import { DEFAULT_AWS_CALL_POLICY } from '../../utils/awsCallPolicy';

const ORG = '00000000-0000-0000-0000-000000000001';
const ACCOUNT_ID = '111122223333';
const HOME = 'us-east-1';
const REGIONS = [HOME, 'eu-west-1', 'ap-southeast-2', 'us-west-2'];
const LATENCY_MS = 5;
const POLICY = { ...DEFAULT_AWS_CALL_POLICY, timeoutMs: 400 };
const measured: Record<string, unknown> = {};

const awsError = (name: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(name), { name }, extra);
const latency = () => new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
/** A call that never answers. Like a real request, it ends when it is aborted. */
const hang = (signal?: AbortSignal) =>
  new Promise<never>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' })));
  });

/** Counts every call by command (and by region), and tracks how many are in flight at once. */
class CallLog {
  byCommand: Record<string, number> = {};
  byRegion: Record<string, number> = {};
  inFlight = 0;
  peakInFlight = 0;
  private attempts = new Map<string, number>();

  /** Which attempt this is for `key` (1 for the first). */
  attempt(key: string): number {
    const n = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, n);
    return n;
  }

  client<T extends { send: unknown }>(real: T, region: string, answer: (name: string, input: any, signal?: AbortSignal) => unknown): T {
    (real as any).send = async (command: any, options?: { abortSignal?: AbortSignal }) => {
      const name = command.constructor.name;
      this.byCommand[name] = (this.byCommand[name] ?? 0) + 1;
      this.byRegion[region] = (this.byRegion[region] ?? 0) + 1;
      this.peakInFlight = Math.max(this.peakInFlight, ++this.inFlight);
      try {
        await latency();
        return await answer(name, command.input, options?.abortSignal);
      } finally {
        this.inFlight--;
      }
    };
    return real;
  }

  get total(): number {
    return Object.values(this.byCommand).reduce((sum, n) => sum + n, 0);
  }
}

function discoveryService() {
  const service = new AWSResourceDiscoveryService({} as any) as any;
  service.callPolicy = POLICY;
  return service;
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  if (process.env.RT2B_SCALE_OUT) fs.writeFileSync(process.env.RT2B_SCALE_OUT, JSON.stringify(measured, null, 2));
});

describe('300 buckets across 4 regions', () => {
  const COUNT = 300;
  const name = (i: number) => `app-bucket-${String(i).padStart(3, '0')}`;
  const index = (bucket: string) => Number(bucket.slice(-3));
  const regionOf = (i: number) => REGIONS[i % REGIONS.length];
  const pick = (...indexes: number[]) => new Set(indexes);

  // The faults. Everything else answers normally.
  const TAGS_THROTTLED_ONCE = new Set(Array.from({ length: 30 }, (_, k) => k * 10 + 3)); // 3, 13, ... 293: recover on retry
  const TAGS_THROTTLED_ALWAYS = pick(7, 77, 177);
  const TAGS_DENIED = pick(20, 60, 100, 140, 180);
  const ENCRYPTION_THROTTLED_ALWAYS = pick(41, 241);
  const ACL_HANGS = pick(150);
  const LOCATION_THROTTLED_ONCE = pick(9, 109, 209);

  function s3Clients(log: CallLog) {
    const answer = (region: string) => (command: string, input: any, signal?: AbortSignal) => {
      if (command === 'ListBucketsCommand') return { Buckets: Array.from({ length: COUNT }, (_, i) => ({ Name: name(i), CreationDate: new Date('2026-01-01T00:00:00Z') })) };
      const i = index(input.Bucket);
      switch (command) {
        case 'GetBucketLocationCommand':
          if (LOCATION_THROTTLED_ONCE.has(i) && log.attempt(`location:${i}`) === 1) throw awsError('SlowDown');
          return { LocationConstraint: regionOf(i) === HOME ? undefined : regionOf(i) };
        case 'GetBucketEncryptionCommand':
          if (ENCRYPTION_THROTTLED_ALWAYS.has(i)) throw awsError('SlowDown');
          return { ServerSideEncryptionConfiguration: { Rules: [] } };
        case 'GetBucketAclCommand':
          if (ACL_HANGS.has(i)) return hang(signal);
          return { Grants: [] };
        case 'GetBucketLifecycleConfigurationCommand':
          throw awsError('NoSuchLifecycleConfiguration');
        case 'GetBucketTaggingCommand':
          // A bucket's tags are answered only by its own region.
          if (region !== regionOf(i)) throw awsError('PermanentRedirect', { $response: { headers: { 'x-amz-bucket-region': regionOf(i) } } });
          if (TAGS_THROTTLED_ALWAYS.has(i)) throw awsError('SlowDown');
          if (TAGS_THROTTLED_ONCE.has(i) && log.attempt(`tags:${i}`) === 1) throw awsError('SlowDown');
          if (TAGS_DENIED.has(i)) throw awsError('AccessDenied');
          return { TagSet: [{ Key: 'Owner', Value: `team-${i % 7}` }] };
        default:
          throw new Error(`Unexpected command ${command}`);
      }
    };
    const byRegion = new Map(REGIONS.map((region) => [region, log.client(new S3Client({ region }), region, answer(region))]));
    return { home: byRegion.get(HOME)!, forRegion: (region: string) => byRegion.get(region)! };
  }

  it('completes, bounded, and only the buckets whose calls failed are unknown', async () => {
    const log = new CallLog();
    const service = discoveryService();
    const raw = s3Clients(log);
    const clients = service.applyCallPolicy({ s3: raw.home, getS3ClientForRegion: raw.forRegion });

    const started = Date.now();
    const resources: any[] = await service.discoverS3Buckets(ORG, clients.s3, HOME, clients.getS3ClientForRegion);
    const elapsedMs = Date.now() - started;

    // Every bucket is there, once, in ListBuckets order.
    expect(resources.map((r) => r.resource_id)).toEqual(Array.from({ length: COUNT }, (_, i) => name(i)));
    expect(resources.every((r) => r.status === 'not_applicable')).toBe(true);

    const where = (predicate: (r: any) => boolean) => resources.filter(predicate).map((r) => index(r.resource_id)).sort((a, b) => a - b);
    const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);

    // Tags: unknown for exactly the buckets whose read kept being throttled or was denied.
    expect(where((r) => r.metadata.tags_state === 'unavailable')).toEqual(sorted(new Set([...TAGS_THROTTLED_ALWAYS, ...TAGS_DENIED])));
    // The 30 throttled once recovered on retry: observed, with their tags.
    for (const i of TAGS_THROTTLED_ONCE) {
      expect(resources[i].metadata.tags_state).toBe('observed');
      expect(resources[i].tags).toEqual({ Owner: `team-${i % 7}` });
    }
    // Buckets outside the home region were read in their own region, not recorded as unknown.
    const outsideHome = resources.filter((_, i) => regionOf(i) !== HOME);
    expect(outsideHome).toHaveLength(225);
    expect(outsideHome.filter((r) => r.metadata.tags_state === 'observed')).toHaveLength(225 - where((r) => r.metadata.tags_state === 'unavailable').filter((i) => regionOf(i) !== HOME).length);

    // Encryption: unknown for exactly the two whose read kept being throttled.
    expect(where((r) => r.is_encrypted === null)).toEqual(sorted(ENCRYPTION_THROTTLED_ALWAYS));
    expect(where((r) => r.is_encrypted === false)).toEqual([]);
    // Public access: unknown for exactly the one whose ACL read hung past the time limit.
    expect(where((r) => r.is_public === null)).toEqual(sorted(ACL_HANGS));
    // A location read throttled once recovered: the bucket has its own region.
    for (const i of LOCATION_THROTTLED_ONCE) expect(resources[i].region).toBe(regionOf(i));
    // A failure in one read did not cost the bucket its other answers.
    expect(resources[7]).toMatchObject({ is_encrypted: true, is_public: false });
    expect(resources[41].metadata.tags_state).toBe('observed');
    expect(resources[150]).toMatchObject({ is_encrypted: true });
    expect(resources[150].metadata.tags_state).toBe('observed');

    // Bounded: never more than `concurrency` calls in flight, and it did run that many.
    expect(log.peakInFlight).toBe(POLICY.concurrency);

    // Call counts. Retries are visible as the extra calls.
    expect(log.byCommand).toEqual({
      ListBucketsCommand: 1,
      GetBucketLocationCommand: COUNT + LOCATION_THROTTLED_ONCE.size, // 3 retried once
      GetBucketEncryptionCommand: COUNT + ENCRYPTION_THROTTLED_ALWAYS.size * (POLICY.maxAttempts - 1), // 2 tried maxAttempts times
      GetBucketAclCommand: COUNT, // the hanging one is aborted at its time limit and not retried
      GetBucketLifecycleConfigurationCommand: COUNT,
      GetBucketTaggingCommand: COUNT + TAGS_THROTTLED_ONCE.size + TAGS_THROTTLED_ALWAYS.size * (POLICY.maxAttempts - 1),
    });
    // No bucket's tags were asked of the wrong region: the location was known first.
    expect(Object.keys(log.byRegion).sort()).toEqual([...REGIONS].sort());

    measured.s3 = {
      buckets: COUNT, regions: REGIONS.length, concurrency: POLICY.concurrency, maxAttempts: POLICY.maxAttempts, simulatedLatencyMsPerCall: LATENCY_MS,
      totalCalls: log.total, callsByCommand: log.byCommand, callsByRegion: log.byRegion, peakCallsInFlight: log.peakInFlight,
      elapsedMs, sequentialLatencyFloorMs: log.total * LATENCY_MS,
      unknown: { tags: TAGS_THROTTLED_ALWAYS.size + TAGS_DENIED.size, encryption: ENCRYPTION_THROTTLED_ALWAYS.size, publicAccess: ACL_HANGS.size },
    };
    // Generous: the point is that it finishes, well inside a scan's budget.
    expect(elapsedMs).toBeLessThan(30_000);
  }, 60_000);
});

describe('200 instances across 4 regions', () => {
  // Instance inventory is listed one region at a time (multi-region inventory is not
  // built yet), so this runs discovery once per region, 50 instances each, the way a
  // multi-region scan would. An instance's security groups are read in the region it
  // was listed in, by the client that listed it.
  const COUNT = 200;
  const PER_REGION = COUNT / REGIONS.length;
  const pad = (i: number) => String(i).padStart(3, '0');
  const id = (i: number) => `i-test-instance-${pad(i)}`;
  const volumeId = (i: number) => `vol-test-volume-${pad(i)}`;
  const groupId = (i: number) => `sg-test-group-${pad(i)}`;
  const indexOf = (resourceId: string) => Number(resourceId.slice(-3));
  const regionOf = (i: number) => REGIONS[i % REGIONS.length];
  const inRegion = (region: string) => Array.from({ length: COUNT }, (_, i) => i).filter((i) => regionOf(i) === region);

  // The faults.
  const SG_REGION_THROTTLED_ONCE = 'eu-west-1'; // each page recovers on retry
  const SG_REGION_THROTTLED_ALWAYS = 'ap-southeast-2'; // its 50 instances: exposure unknown
  const BACKUP_THROTTLED_ALWAYS = new Set([11, 61, 111, 161]);
  const BACKUP_THROTTLED_ONCE = new Set(Array.from({ length: 10 }, (_, k) => k * 20 + 5));
  // Every tenth instance's group opens SSH to the internet.
  const opensSsh = (i: number) => i % 10 === 0;
  // Some instances sit in a Local Zone: still the region they were listed in.
  const zoneOf = (i: number) => (i % 25 === 3 ? `${regionOf(i)}-lax-1a` : `${regionOf(i)}a`);

  function clients(log: CallLog) {
    const instancesOf = (region: string) => inRegion(region).map((i) => ({
      InstanceId: id(i), InstanceType: 't3.micro', State: { Name: 'running' }, PublicIpAddress: `203.0.113.${i % 250}`,
      Placement: { AvailabilityZone: zoneOf(i) }, SecurityGroups: [{ GroupId: groupId(i) }],
      BlockDeviceMappings: [{ Ebs: { VolumeId: volumeId(i) } }], Tags: [],
    }));
    const groupsOf = (region: string) => inRegion(region).map((i) => ({
      GroupId: groupId(i),
      IpPermissions: [{ IpProtocol: 'tcp', FromPort: opensSsh(i) ? 22 : 443, ToPort: opensSsh(i) ? 22 : 443, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }],
    }));
    const answer = (region: string) => (command: string, input: any) => {
      switch (command) {
        case 'DescribeInstancesCommand': {
          const instances = instancesOf(region);
          // Two pages per region.
          return input.NextToken ? { Reservations: [{ Instances: instances.slice(25) }] } : { Reservations: [{ Instances: instances.slice(0, 25) }], NextToken: 'page-2' };
        }
        case 'DescribeVolumesCommand':
          return { Volumes: (input.VolumeIds as string[]).map((VolumeId) => ({ VolumeId, Encrypted: true })) };
        case 'DescribeSecurityGroupsCommand': {
          if (region === SG_REGION_THROTTLED_ALWAYS) throw awsError('RequestLimitExceeded');
          if (region === SG_REGION_THROTTLED_ONCE && log.attempt(`groups:${region}:${input.NextToken ?? 'first'}`) === 1) throw awsError('RequestLimitExceeded');
          const groups = groupsOf(region);
          // Two pages per region.
          return input.NextToken ? { SecurityGroups: groups.slice(25) } : { SecurityGroups: groups.slice(0, 25), NextToken: 'page-2' };
        }
        default:
          throw new Error(`Unexpected command ${command}`);
      }
    };
    const ec2ByRegion = new Map(REGIONS.map((region) => [region, log.client(new EC2Client({ region }), region, answer(region))]));
    const backup = log.client(new BackupClient({ region: HOME }), 'backup', (_command, input) => {
      const i = indexOf(String(input.ResourceArn));
      if (BACKUP_THROTTLED_ALWAYS.has(i)) throw awsError('ThrottlingException');
      if (BACKUP_THROTTLED_ONCE.has(i) && log.attempt(`backup:${i}`) === 1) throw awsError('ThrottlingException');
      return { RecoveryPoints: [] };
    });
    return { ec2ByRegion, backup };
  }

  it('completes, bounded, and only the instances whose calls failed are unknown', async () => {
    const log = new CallLog();
    const service = discoveryService();
    const raw = clients(log);
    const backup = service.applyCallPolicy({ backup: raw.backup }).backup;

    const started = Date.now();
    const resources: any[] = [];
    for (const region of REGIONS) {
      const ec2 = service.applyCallPolicy({ ec2: raw.ec2ByRegion.get(region) }).ec2;
      resources.push(...await service.discoverEC2Instances(ORG, ec2, region, ACCOUNT_ID, createAwsBackupEvidenceCache(backup)));
    }
    const elapsedMs = Date.now() - started;
    resources.sort((a, b) => indexOf(a.resource_id) - indexOf(b.resource_id));

    expect(resources.map((r) => r.resource_id)).toEqual(Array.from({ length: COUNT }, (_, i) => id(i)));
    const where = (predicate: (r: any) => boolean) => resources.filter(predicate).map((r) => indexOf(r.resource_id));

    // Exposure: unknown for exactly the 50 instances of the region whose groups could not be read.
    expect(where((r) => r.metadata.network_exposure.state === 'unknown')).toEqual(inRegion(SG_REGION_THROTTLED_ALWAYS));
    // Everywhere else it was established either way -- the once-throttled region and the Local Zone instances included.
    const readable = Array.from({ length: COUNT }, (_, i) => i).filter((i) => regionOf(i) !== SG_REGION_THROTTLED_ALWAYS);
    expect(where((r) => r.metadata.network_exposure.state === 'open_admin_port')).toEqual(readable.filter(opensSsh));
    expect(where((r) => r.metadata.network_exposure.state === 'not_established')).toEqual(readable.filter((i) => !opensSsh(i)));
    // Each instance is recorded in the region it was listed in, Local Zone or not.
    expect(resources.every((r) => r.region === regionOf(indexOf(r.resource_id)))).toBe(true);
    expect(resources.filter((r) => r.metadata.availability_zone.includes('-lax-')).length).toBeGreaterThan(0);

    // Backups: unknown for exactly the four whose lookup kept being throttled; the ten throttled once recovered.
    expect(where((r) => r.has_backup === null)).toEqual([...BACKUP_THROTTLED_ALWAYS].sort((a, b) => a - b));
    for (const i of BACKUP_THROTTLED_ONCE) expect(resources[i].has_backup).toBe(false);
    // Nothing else about a failed instance was lost.
    expect(resources.every((r) => r.is_encrypted === true && r.is_public === true && r.status === 'running')).toBe(true);

    expect(log.peakInFlight).toBeLessThanOrEqual(POLICY.concurrency);
    expect(log.peakInFlight).toBeGreaterThan(1);

    expect(log.byCommand).toEqual({
      DescribeInstancesCommand: REGIONS.length * 2, // 2 pages per region
      DescribeVolumesCommand: REGIONS.length, // one batch per region
      // 2 pages per region. eu-west-1: each page retried once (4). ap-southeast-2: the
      // first page tried maxAttempts times, then given up.
      DescribeSecurityGroupsCommand: 2 + 2 + 4 + POLICY.maxAttempts,
      ListRecoveryPointsByResourceCommand: COUNT + BACKUP_THROTTLED_ONCE.size + BACKUP_THROTTLED_ALWAYS.size * (POLICY.maxAttempts - 1),
    });
    // Each region's calls went to that region's client, and to no other.
    for (const region of REGIONS) expect(log.byRegion[region]).toBeGreaterThan(0);

    measured.ec2 = {
      instances: COUNT, regions: REGIONS.length, instancesPerRegion: PER_REGION, concurrency: POLICY.concurrency,
      maxAttempts: POLICY.maxAttempts, simulatedLatencyMsPerCall: LATENCY_MS,
      totalCalls: log.total, callsByCommand: log.byCommand, callsByRegion: log.byRegion, peakCallsInFlight: log.peakInFlight,
      elapsedMs, sequentialLatencyFloorMs: log.total * LATENCY_MS,
      unknown: { exposure: inRegion(SG_REGION_THROTTLED_ALWAYS).length, backup: BACKUP_THROTTLED_ALWAYS.size },
    };
    expect(elapsedMs).toBeLessThan(30_000);
  }, 60_000);
});
