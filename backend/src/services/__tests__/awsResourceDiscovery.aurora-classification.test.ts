/**
 * Aurora Service Health: coverage for enrichAuroraClusters() -- the discovery-time
 * classification correction for AWS::RDS::DBCluster rows, which the generic Resource
 * Explorer path cannot distinguish as Aurora vs. non-Aurora (both surface identically;
 * see resourceExplorer.service.ts and aurora-cluster.util.ts). One unfiltered, paginated
 * DescribeDBClusters call for the whole region -- never one call per candidate. Same
 * withMockedSend convention as awsResourceDiscovery.ebs.test.ts.
 */
import { RDSClient } from '@aws-sdk/client-rds';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { NormalizedResourceEntry } from '../resourceExplorer.service';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

function mockPoolClient() {
  return { query: jest.fn().mockResolvedValue({ rows: [] }) } as any;
}

function auroraEntry(overrides: Partial<NormalizedResourceEntry> = {}): NormalizedResourceEntry {
  return {
    arn: 'arn:aws:rds:us-east-1:123456789012:cluster:my-cluster',
    resourceType: 'aurora',
    region: 'us-east-1',
    service: 'rds',
    tags: {},
    ...overrides,
  };
}

function dbClustersResponse(clusters: Array<{ DBClusterIdentifier: string; Engine?: string; EngineMode?: string; Status?: string }>) {
  return {
    DBClusters: clusters.map((c) => ({
      DBClusterIdentifier: c.DBClusterIdentifier,
      Engine: c.Engine ?? 'aurora-postgresql',
      EngineMode: c.EngineMode ?? 'provisioned',
      Status: c.Status ?? 'available',
      DBClusterMembers: [{ DBInstanceIdentifier: `${c.DBClusterIdentifier}-writer`, IsClusterWriter: true }],
    })),
  };
}

describe('AWSResourceDiscoveryService.enrichAuroraClusters', () => {
  const service = new AWSResourceDiscoveryService({} as any);
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    warnSpy.mockClear();
    errorSpy.mockClear();
  });

  afterAll(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('(1) Aurora MySQL is confirmed, not reclassified, and enriched with real engine metadata', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'my-cluster', Engine: 'aurora-mysql' }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    const client = mockPoolClient();

    const { confirmed, reclassified } = await (service as any).enrichAuroraClusters('org-1', client, rds, [auroraEntry()]);

    expect(confirmed).toBe(1);
    expect(reclassified).toBe(0);
    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).not.toContain('resource_type = ');
    const metadata = JSON.parse(params[0]);
    expect(metadata.engine).toBe('aurora-mysql');
  });

  it('(2) Aurora PostgreSQL is confirmed, not reclassified', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'my-cluster', Engine: 'aurora-postgresql' }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    const client = mockPoolClient();

    const { confirmed, reclassified } = await (service as any).enrichAuroraClusters('org-1', client, rds, [auroraEntry()]);

    expect(confirmed).toBe(1);
    expect(reclassified).toBe(0);
  });

  it('(3) a non-Aurora mysql DBCluster is reclassified out of aurora into the existing rds type', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'my-cluster', Engine: 'mysql' }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    const client = mockPoolClient();

    const { confirmed, reclassified } = await (service as any).enrichAuroraClusters('org-1', client, rds, [auroraEntry()]);

    expect(confirmed).toBe(0);
    expect(reclassified).toBe(1);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain("resource_type = 'rds'");
    const metadata = JSON.parse(params[0]);
    expect(metadata.engine).toBe('mysql');
    expect(metadata.reclassified_from).toBe('aurora');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('(4) a non-Aurora postgres DBCluster is reclassified out of aurora', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'my-cluster', Engine: 'postgres' }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    const client = mockPoolClient();

    const { confirmed, reclassified } = await (service as any).enrichAuroraClusters('org-1', client, rds, [auroraEntry()]);

    expect(confirmed).toBe(0);
    expect(reclassified).toBe(1);
  });

  it('(5) reclassification preserves the resource\'s ARN identity -- only resource_type/metadata change', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'my-cluster', Engine: 'mysql' }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    const client = mockPoolClient();

    await (service as any).enrichAuroraClusters('org-1', client, rds, [auroraEntry()]);

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('WHERE organization_id = $2 AND resource_arn = $3');
    expect(params[1]).toBe('org-1');
    expect(params[2]).toBe('arn:aws:rds:us-east-1:123456789012:cluster:my-cluster');
  });

  it('(6) DescribeDBClusters API failure leaves every candidate untouched -- zero writes, logged for review', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('AccessDeniedException'));
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    const client = mockPoolClient();

    const { confirmed, reclassified } = await (service as any).enrichAuroraClusters('org-1', client, rds, [auroraEntry()]);

    expect(confirmed).toBe(0);
    expect(reclassified).toBe(0);
    expect(client.query).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('(7) a candidate absent from this cycle\'s DescribeDBClusters result is left completely untouched -- never guessed at, never reclassified on absence alone', async () => {
    const send = jest.fn().mockResolvedValueOnce(dbClustersResponse([]));
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    const client = mockPoolClient();

    const { confirmed, reclassified } = await (service as any).enrichAuroraClusters('org-1', client, rds, [auroraEntry()]);

    expect(confirmed).toBe(0);
    expect(reclassified).toBe(0);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('(8) multiple clusters are handled via a single DescribeDBClusters call, never one call per candidate', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([
        { DBClusterIdentifier: 'cluster-a', Engine: 'aurora-mysql' },
        { DBClusterIdentifier: 'cluster-b', Engine: 'mysql' },
        { DBClusterIdentifier: 'cluster-c', Engine: 'aurora-postgresql' },
      ])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    const client = mockPoolClient();

    const entries = [
      auroraEntry({ arn: 'arn:aws:rds:us-east-1:123456789012:cluster:cluster-a' }),
      auroraEntry({ arn: 'arn:aws:rds:us-east-1:123456789012:cluster:cluster-b' }),
      auroraEntry({ arn: 'arn:aws:rds:us-east-1:123456789012:cluster:cluster-c' }),
    ];

    const { confirmed, reclassified } = await (service as any).enrichAuroraClusters('org-1', client, rds, entries);

    expect(send).toHaveBeenCalledTimes(1);
    expect(confirmed).toBe(2);
    expect(reclassified).toBe(1);
  });

  it('(9) cluster identity is correctly extracted from the cluster-colon ARN format and matched against DescribeDBClusters', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'exact-match-id', Engine: 'aurora-mysql' }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    const client = mockPoolClient();

    const { confirmed } = await (service as any).enrichAuroraClusters(
      'org-1', client, rds,
      [auroraEntry({ arn: 'arn:aws:rds:us-east-1:123456789012:cluster:exact-match-id' })]
    );

    expect(confirmed).toBe(1);
  });
});
