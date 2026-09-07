/**
 * Phase 3E, Checkpoint A: AWSResourceDiscoveryService.enrichDynamoDBTables()
 * -- orchestration correctness. describeDynamoDBTable() itself has its own
 * dedicated test file (dynamodb-table.util.test.ts); this suite mocks it to
 * isolate region-client reuse/caching, per-table independence, and the
 * UPDATE it issues.
 */
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { NormalizedResourceEntry } from '../resourceExplorer.service';
import * as dynamoTableUtil from '../dynamodb-table.util';

jest.mock('../dynamodb-table.util');
const mockedDescribeDynamoDBTable = dynamoTableUtil.describeDynamoDBTable as jest.Mock;

function entry(overrides: Partial<NormalizedResourceEntry> = {}): NormalizedResourceEntry {
  return {
    arn: 'arn:aws:dynamodb:us-east-1:123456789012:table/default-table',
    resourceType: 'dynamodb',
    region: 'us-east-1',
    service: 'dynamodb',
    tags: {},
    ...overrides,
  };
}

describe('AWSResourceDiscoveryService.enrichDynamoDBTables', () => {
  const service = new AWSResourceDiscoveryService({} as any);

  beforeEach(() => {
    mockedDescribeDynamoDBTable.mockReset();
  });

  it('builds one regional client for a table and issues a merge UPDATE with the real config', async () => {
    mockedDescribeDynamoDBTable.mockResolvedValueOnce({
      status: 'described',
      config: { billing_mode: 'PROVISIONED', table_status: 'ACTIVE' },
    });
    const query = jest.fn().mockResolvedValue({});
    const dynamoClient = { fake: 'client-for-us-east-1' };
    const getDynamoDBClientForRegion = jest.fn().mockReturnValue(dynamoClient);

    const enrichedCount = await (service as any).enrichDynamoDBTables(
      'org-1',
      { query },
      { getDynamoDBClientForRegion },
      [entry({ arn: 'arn:aws:dynamodb:us-east-1:123456789012:table/orders' })]
    );

    expect(enrichedCount).toBe(1);
    expect(getDynamoDBClientForRegion).toHaveBeenCalledWith('us-east-1');
    expect(mockedDescribeDynamoDBTable).toHaveBeenCalledWith(dynamoClient, 'orders');
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/metadata = metadata \|\| \$1::jsonb/);
    expect(params[0]).toBe(JSON.stringify({ billing_mode: 'PROVISIONED', table_status: 'ACTIVE' }));
    expect(params[1]).toBe('org-1');
    expect(params[2]).toBe('arn:aws:dynamodb:us-east-1:123456789012:table/orders');
  });

  it('reuses the same regional client for multiple tables in the same region -- one client construction, not one per table', async () => {
    mockedDescribeDynamoDBTable.mockResolvedValue({ status: 'described', config: { billing_mode: 'PAY_PER_REQUEST' } });
    const query = jest.fn().mockResolvedValue({});
    const getDynamoDBClientForRegion = jest.fn().mockReturnValue({ fake: 'client' });

    const enrichedCount = await (service as any).enrichDynamoDBTables(
      'org-1',
      { query },
      { getDynamoDBClientForRegion },
      [
        entry({ arn: 'arn:aws:dynamodb:us-east-1:123456789012:table/a', region: 'us-east-1' }),
        entry({ arn: 'arn:aws:dynamodb:us-east-1:123456789012:table/b', region: 'us-east-1' }),
      ]
    );

    expect(enrichedCount).toBe(2);
    expect(getDynamoDBClientForRegion).toHaveBeenCalledTimes(1);
  });

  it('builds a separate regional client per distinct region', async () => {
    mockedDescribeDynamoDBTable.mockResolvedValue({ status: 'described', config: { billing_mode: 'PAY_PER_REQUEST' } });
    const query = jest.fn().mockResolvedValue({});
    const getDynamoDBClientForRegion = jest.fn((region: string) => ({ fake: `client-for-${region}` }));

    await (service as any).enrichDynamoDBTables(
      'org-1',
      { query },
      { getDynamoDBClientForRegion },
      [
        entry({ arn: 'arn:aws:dynamodb:us-east-1:123456789012:table/a', region: 'us-east-1' }),
        entry({ arn: 'arn:aws:dynamodb:eu-west-1:123456789012:table/b', region: 'eu-west-1' }),
      ]
    );

    expect(getDynamoDBClientForRegion).toHaveBeenCalledTimes(2);
    expect(getDynamoDBClientForRegion).toHaveBeenCalledWith('us-east-1');
    expect(getDynamoDBClientForRegion).toHaveBeenCalledWith('eu-west-1');
  });

  it('a DescribeTable failure for one table does not affect another table\'s (or another region\'s) result', async () => {
    mockedDescribeDynamoDBTable
      .mockResolvedValueOnce({ status: 'unavailable', reason: 'Throttled' }) // us-east-1/table-fails
      .mockResolvedValueOnce({ status: 'described', config: { billing_mode: 'PROVISIONED' } }); // eu-west-1/table-ok
    const query = jest.fn().mockResolvedValue({});
    const getDynamoDBClientForRegion = jest.fn((region: string) => ({ fake: region }));

    const enrichedCount = await (service as any).enrichDynamoDBTables(
      'org-1',
      { query },
      { getDynamoDBClientForRegion },
      [
        entry({ arn: 'arn:aws:dynamodb:us-east-1:123456789012:table/table-fails', region: 'us-east-1' }),
        entry({ arn: 'arn:aws:dynamodb:eu-west-1:123456789012:table/table-ok', region: 'eu-west-1' }),
      ]
    );

    expect(enrichedCount).toBe(1); // only the successful one counted
    expect(query).toHaveBeenCalledTimes(1); // no UPDATE issued for the failed table
    expect(query.mock.calls[0][1][2]).toBe('arn:aws:dynamodb:eu-west-1:123456789012:table/table-ok');
  });

  it('never writes anything for a table whose DescribeTable call fails -- no fabricated metadata', async () => {
    mockedDescribeDynamoDBTable.mockResolvedValueOnce({ status: 'unavailable', reason: 'AccessDenied' });
    const query = jest.fn().mockResolvedValue({});
    const getDynamoDBClientForRegion = jest.fn().mockReturnValue({});

    const enrichedCount = await (service as any).enrichDynamoDBTables(
      'org-1',
      { query },
      { getDynamoDBClientForRegion },
      [entry()]
    );

    expect(enrichedCount).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns 0 and builds no client at all for an empty entries list', async () => {
    const query = jest.fn();
    const getDynamoDBClientForRegion = jest.fn();

    const enrichedCount = await (service as any).enrichDynamoDBTables('org-1', { query }, { getDynamoDBClientForRegion }, []);

    expect(enrichedCount).toBe(0);
    expect(getDynamoDBClientForRegion).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('never leaks one organization\'s query into another -- organizationId is always the exact value passed in', async () => {
    mockedDescribeDynamoDBTable.mockResolvedValueOnce({ status: 'described', config: { billing_mode: 'PROVISIONED' } });
    const query = jest.fn().mockResolvedValue({});
    const getDynamoDBClientForRegion = jest.fn().mockReturnValue({});

    await (service as any).enrichDynamoDBTables('org-specific-id', { query }, { getDynamoDBClientForRegion }, [entry()]);

    expect(query.mock.calls[0][1][1]).toBe('org-specific-id');
  });
});
