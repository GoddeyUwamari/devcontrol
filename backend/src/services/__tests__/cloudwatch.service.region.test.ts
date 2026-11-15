/**
 * Multi-region PR 1b (review RR-M1): the Monitoring page's metric paths read every
 * resource in its OWN region. With the multi-region flag on, aws_resources holds rows of
 * other regions; before this, computeMetrics() and the SLO path queried all of them
 * through the primary (home) region's clients, so a non-home resource got no
 * datapoints and read as unmonitored.
 *
 * Every type the Monitoring inventory reads (getResourceInventory):
 *
 *   type            source of its state                       region rule
 *   ec2             CloudWatch GetMetricData (batched)        the resource's region
 *   rds             CloudWatch GetMetricData (batched)        the resource's region
 *   lambda          CloudWatch GetMetricData (batched)        the resource's region
 *   dynamodb        CloudWatch GetMetricData (batched)        the resource's region
 *   load-balancer   CloudWatch GetMetricData (ALB, 2 windows) the resource's region
 *   aurora          RDS DescribeDBClusters + CloudWatch       the cluster's region (both)
 *   ebs             EC2 DescribeVolumeStatus (control plane)  the volume's region
 *   ecs             ECS DescribeServices (control plane)      the service's region
 *   eks             EKS DescribeCluster (control plane)       the cluster's region
 *   cloudfront      CloudWatch in us-east-1                   unchanged: always us-east-1
 *   s3, api-gateway not measured (no AWS call)                unchanged
 *
 * For each affected type: a non-home row is read through its region's client and never
 * the home client; a home row goes through the existing path (the primary region's
 * client, exactly as before, no regional client built). No database: the account and
 * inventory reads are stubbed. Placeholders only.
 */
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { EC2Client } from '@aws-sdk/client-ec2';
import { RDSClient } from '@aws-sdk/client-rds';
import { ECSClient } from '@aws-sdk/client-ecs';
import { EKSClient } from '@aws-sdk/client-eks';
import { CloudWatchService, splitByRegion } from '../cloudwatch.service';
import { AWSClientFactory } from '../aws-client-factory.service';
import awsCostService from '../aws-cost.service';

const HOME = 'us-east-1';
const EU = 'eu-west-1';
const ACCOUNT = '123456789012';

interface Sent {
  kind: string;
  region: string;
  command: string;
  /** Dimension values of every GetMetricData query, or the resource names of a control-plane call. */
  targets: string[];
}

/** GetMetricData answered with one datapoint per query (Id echoed back). */
function metricDataEcho(command: any) {
  const queries = command?.input?.MetricDataQueries ?? [];
  return { MetricDataResults: queries.map((q: any) => ({ Id: q.Id, StatusCode: 'Complete', Timestamps: [new Date()], Values: [1] })) };
}

function targetsOf(command: any): string[] {
  const input = command?.input ?? {};
  // GetMetricStatistics (the SLO path): its own dimensions.
  if (Array.isArray(input.Dimensions)) return input.Dimensions.map((d: any) => d.Value);
  if (Array.isArray(input.MetricDataQueries)) {
    return input.MetricDataQueries.flatMap((q: any) => (q.MetricStat?.Metric?.Dimensions ?? []).map((d: any) => d.Value));
  }
  return [...(input.services ?? []), ...(input.VolumeIds ?? []), ...(input.name ? [input.name] : [])];
}

function fleet() {
  const sent: Sent[] = [];
  const built: string[] = [];
  const record = <T extends { send: any }>(client: T, kind: string, region: string, answer: (command: any) => any): T => {
    (client as any).send = jest.fn(async (command: any) => {
      sent.push({ kind, region, command: command.constructor.name, targets: targetsOf(command) });
      return answer(command);
    });
    return client;
  };
  const cloudWatch = (region: string) => record(new CloudWatchClient({ region }), 'cloudwatch', region, metricDataEcho);
  const ec2 = (region: string) => record(new EC2Client({ region }), 'ec2', region, () => ({ VolumeStatuses: [] }));
  const rds = (region: string) =>
    record(new RDSClient({ region }), 'rds', region, () => ({
      DBClusters: [{ DBClusterIdentifier: `aurora-${region}`, Engine: 'aurora-postgresql', Status: 'available', DBClusterMembers: [] }],
    }));
  const ecs = (region: string) => record(new ECSClient({ region }), 'ecs', region, () => ({ services: [], failures: [] }));
  const eks = (region: string) => record(new EKSClient({ region }), 'eks', region, () => ({ cluster: undefined }));
  const factory = <T>(kind: string, make: (region: string) => T) => (region: string) => {
    built.push(`${kind}:${region}`);
    return make(region);
  };
  const clients = {
    enabled: true,
    region: HOME,
    accountId: ACCOUNT,
    cloudWatch: cloudWatch(HOME),
    ec2: ec2(HOME),
    rds: rds(HOME),
    ecs: ecs(HOME),
    eks: eks(HOME),
    getCloudWatchClientForRegion: factory('cloudwatch', cloudWatch),
    getEC2ClientForRegion: factory('ec2', ec2),
    getRDSClientForRegion: factory('rds', rds),
    getECSClientForRegion: factory('ecs', ecs),
    getEKSClientForRegion: factory('eks', eks),
  };
  jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(clients as any);
  return { sent, built, clients };
}

let n = 0;
function row(type: string, region: string | null, name: string, arn: string, metadata: Record<string, unknown> | null = null) {
  n++;
  return { id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, resource_id: name, resource_name: name, resource_type: type, resource_arn: arn, region, status: 'running', metadata };
}

/** One row of the type in the home region and one in eu-west-1 (the same shape). */
function pair(type: string, make: (region: string) => ReturnType<typeof row>) {
  return [make(HOME), make(EU)];
}

const ROWS = {
  ec2: (region: string) => row('ec2', region, `i-0${region === HOME ? 'a' : 'b'}${'0'.repeat(15)}`, `arn:aws:ec2:${region}:${ACCOUNT}:instance/i-0${region === HOME ? 'a' : 'b'}${'0'.repeat(15)}`),
  rds: (region: string) => row('rds', region, `db-${region}`, `arn:aws:rds:${region}:${ACCOUNT}:db:db-${region}`),
  lambda: (region: string) => row('lambda', region, `fn-${region}`, `arn:aws:lambda:${region}:${ACCOUNT}:function:fn-${region}`),
  dynamodb: (region: string) => row('dynamodb', region, `table-${region}`, `arn:aws:dynamodb:${region}:${ACCOUNT}:table/table-${region}`),
  'load-balancer': (region: string) =>
    row('load-balancer', region, `alb-${region}`, `arn:aws:elasticloadbalancing:${region}:${ACCOUNT}:loadbalancer/app/alb-${region}/0123456789abcdef`, { type: 'application' }),
  aurora: (region: string) => row('aurora', region, `aurora-${region}`, `arn:aws:rds:${region}:${ACCOUNT}:cluster:aurora-${region}`),
  ebs: (region: string) => row('ebs', region, `vol-0${region === HOME ? 'a' : 'b'}${'0'.repeat(15)}`, `arn:aws:ec2:${region}:${ACCOUNT}:volume/vol-0${region === HOME ? 'a' : 'b'}${'0'.repeat(15)}`),
  ecs: (region: string) => row('ecs', region, `svc-${region}`, `arn:aws:ecs:${region}:${ACCOUNT}:service/cluster-${region}/svc-${region}`),
  eks: (region: string) => row('eks', region, `cluster-${region}`, `arn:aws:eks:${region}:${ACCOUNT}:cluster/cluster-${region}`),
};

/** What each type's call names for its row in `region` (a dimension value or a control-plane target). */
const TARGET: Record<keyof typeof ROWS, { kind: string; target: (r: ReturnType<typeof row>) => string }> = {
  ec2: { kind: 'cloudwatch', target: (r) => r.resource_id },
  rds: { kind: 'cloudwatch', target: (r) => r.resource_id },
  lambda: { kind: 'cloudwatch', target: (r) => r.resource_id },
  dynamodb: { kind: 'cloudwatch', target: (r) => r.resource_id },
  'load-balancer': { kind: 'cloudwatch', target: (r) => `app/${r.resource_id}/0123456789abcdef` },
  aurora: { kind: 'cloudwatch', target: (r) => r.resource_id },
  ebs: { kind: 'ec2', target: (r) => r.resource_id },
  ecs: { kind: 'ecs', target: (r) => r.resource_id },
  eks: { kind: 'eks', target: (r) => r.resource_id },
};

async function sweep(rows: ReturnType<typeof row>[]) {
  const service = new CloudWatchService();
  jest.spyOn(service as any, 'getAccount').mockResolvedValue({ account_id: ACCOUNT, nickname: null });
  jest.spyOn(service as any, 'getResourceInventory').mockResolvedValue(rows);
  jest.spyOn(service as any, 'buildObservabilitySnapshot').mockResolvedValue(null);
  const batch = jest.spyOn(service as any, 'evaluateCapabilityBatch');
  return { result: await (service as any).computeMetrics('00000000-0000-4000-8000-00000000000f', '1h'), batch };
}

beforeEach(() => {
  jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({ total: 0, byService: [], period: { start: '', end: '' } } as any);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('RR-M1: each Monitoring type reads a non-home resource in its own region', () => {
  it.each(Object.keys(ROWS) as Array<keyof typeof ROWS>)('%s: the eu-west-1 row through eu-west-1\'s client, the home row through the home client', async (type) => {
    const { sent } = fleet();
    const [home, eu] = pair(type, ROWS[type]);
    const { kind, target } = TARGET[type];

    const { result } = await sweep([home, eu]);

    const callsFor = (r: ReturnType<typeof row>) => sent.filter((call) => call.kind === kind && call.targets.includes(target(r)));
    expect(callsFor(eu).length).toBeGreaterThan(0);
    expect(callsFor(eu).every((call) => call.region === EU)).toBe(true);
    expect(callsFor(home).length).toBeGreaterThan(0);
    expect(callsFor(home).every((call) => call.region === HOME)).toBe(true);
    // Both rows are in the response, in inventory order.
    const ids = result.services.filter((s: any) => s.resourceDbId === home.id || s.resourceDbId === eu.id).map((s: any) => s.resourceDbId);
    expect(ids).toEqual([home.id, eu.id]);
  });

  it('aurora: the cluster is confirmed by its own region\'s DescribeDBClusters, never the home one', async () => {
    const { sent } = fleet();
    const eu = ROWS.aurora(EU);
    await sweep([eu]);
    const describes = sent.filter((call) => call.kind === 'rds' && call.command === 'DescribeDBClustersCommand');
    expect(describes.map((call) => call.region)).toEqual([EU]);
  });

  it('ALB: both windows (current and previous) of an eu-west-1 load balancer go to eu-west-1', async () => {
    const { sent } = fleet();
    const eu = ROWS['load-balancer'](EU);
    await sweep([eu]);
    const albCalls = sent.filter((call) => call.kind === 'cloudwatch' && call.targets.includes(`app/${eu.resource_id}/0123456789abcdef`));
    expect(albCalls).toHaveLength(2);
    expect(new Set(albCalls.map((call) => call.region))).toEqual(new Set([EU]));
  });

  it('mixed regions keep the inventory order (pagination depends on it)', async () => {
    fleet();
    const rows = [ROWS.ec2(EU), ROWS.ec2(HOME), row('ec2', 'ap-south-1', 'i-0c000000000000000', `arn:aws:ec2:ap-south-1:${ACCOUNT}:instance/i-0c000000000000000`)];
    const { result } = await sweep(rows);
    expect(result.services.filter((s: any) => s.resourceType === 'ec2').map((s: any) => s.resourceDbId)).toEqual(rows.map((r) => r.id));
  });
});

describe('RR-M1: home resources keep the existing path; type-specific rules are unchanged', () => {
  it('only home rows (and rows with no region): one batch per type over the whole list with the home client; no regional client built except CloudFront\'s us-east-1', async () => {
    const { sent, built, clients } = fleet();
    const rows = [
      ...(Object.keys(ROWS) as Array<keyof typeof ROWS>).map((type) => ROWS[type](HOME)),
      { ...ROWS.ec2(HOME), id: '00000000-0000-4000-8000-0000000000aa', resource_id: 'i-0d000000000000000', region: null },
      row('cloudfront', 'global', 'EPLACEHOLDER', `arn:aws:cloudfront::${ACCOUNT}:distribution/EPLACEHOLDER`),
      row('s3', HOME, 'placeholder-bucket', 'arn:aws:s3:::placeholder-bucket'),
      row('api-gateway', HOME, 'placeholder-api', `arn:aws:apigateway:${HOME}::/restapis/placeholder-api`),
    ];

    const { batch } = await sweep(rows);

    expect(sent.every((call) => call.region === HOME)).toBe(true);
    // CloudFront's rule: its metrics only exist in us-east-1, through the regional factory, as before.
    expect(built).toEqual(['cloudwatch:us-east-1']);
    // Each batched type: exactly one evaluateCapabilityBatch call, with the home client and every row of the type.
    for (const [type, prefix] of [['ec2', 'ec2'], ['rds', 'rds'], ['lambda', 'lambda'], ['dynamodb', 'dynamodb'], ['load-balancer', 'alb']] as const) {
      const calls = batch.mock.calls.filter((call) => call[3] === prefix);
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe(clients.cloudWatch);
      expect((calls[0][2] as any[]).map((r) => r.id)).toEqual(rows.filter((r) => r.resource_type === type).map((r) => r.id));
    }
  });

  it('CloudFront is read in us-east-1 whatever the home region; s3 and api-gateway make no call', async () => {
    const { sent } = fleet();
    const rows = [
      row('cloudfront', 'global', 'EPLACEHOLDER', `arn:aws:cloudfront::${ACCOUNT}:distribution/EPLACEHOLDER`),
      row('s3', EU, 'placeholder-bucket', 'arn:aws:s3:::placeholder-bucket'),
      row('api-gateway', EU, 'placeholder-api', `arn:aws:apigateway:${EU}::/restapis/placeholder-api`),
    ];
    await sweep(rows);
    expect(sent.filter((call) => call.targets.includes('EPLACEHOLDER')).map((call) => call.region)).toEqual(['us-east-1']);
    expect(sent.filter((call) => call.targets.includes('placeholder-bucket') || call.targets.includes('placeholder-api'))).toEqual([]);
  });

  it('splitByRegion: no region and the home region are home; every other region its own group, in the order first seen', () => {
    const rows = [ROWS.ec2(EU), ROWS.ec2(HOME), { ...ROWS.ec2(HOME), region: null }, row('ec2', 'ap-south-1', 'x', 'x'), ROWS.rds(EU)];
    const split = splitByRegion(rows as any, HOME);
    expect(split.home.map((r) => r.id)).toEqual([rows[1].id, rows[2].id]);
    expect([...split.others.keys()]).toEqual([EU, 'ap-south-1']);
    expect(split.others.get(EU)!.map((r) => r.id)).toEqual([rows[0].id, rows[4].id]);
  });
});

describe('RR-M1: the SLO path reads its resource in the resource\'s own region (real Postgres for the row)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require('pg');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { pool: appPool } = require('../../config/database');
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });
  let orgId: string;

  beforeAll(async () => {
    const slug = `rrm1-slo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    orgId = (await pool.query(`INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, $1) RETURNING id`, [slug])).rows[0].id;
    for (const [id, region] of [['i-0e000000000000000', EU], ['i-0f000000000000000', HOME]]) {
      await pool.query(
        `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status)
         VALUES ($1, $2, $3, $3, 'ec2', $4, 'running')`,
        [orgId, `arn:aws:ec2:${region}:${ACCOUNT}:instance/${id}`, id, region]
      );
    }
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM aws_resources WHERE organization_id = $1`, [orgId]);
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await pool.end();
    await appPool.end();
  });

  it.each([
    ['an eu-west-1 instance', 'i-0e000000000000000', EU, ['cloudwatch:eu-west-1']],
    ['a home instance (the existing path: the home client, no regional client)', 'i-0f000000000000000', HOME, []],
  ])('%s', async (_label, instanceId, region, builtClients) => {
    const { sent, built } = fleet();
    await new CloudWatchService().evaluateResourceForSlo(orgId, 'ec2', instanceId, '24h');
    const calls = sent.filter((call) => call.kind === 'cloudwatch' && call.targets.includes(instanceId));
    expect(calls.length).toBeGreaterThan(0);
    expect(new Set(calls.map((call) => call.region))).toEqual(new Set([region]));
    expect(built).toEqual(builtClients);
  });
});
