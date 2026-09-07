/**
 * Phase 3E, Checkpoint A: describeDynamoDBTable() -- the sole source of
 * DynamoDB per-table configuration. Critical properties: billing mode is
 * never inferred from ProvisionedThroughput's presence/absence, only from
 * AWS's own BillingModeSummary.BillingMode; any API failure returns
 * `{status: 'unavailable'}`, never a fabricated config.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { describeDynamoDBTable } from '../dynamodb-table.util';

function withMockedSend(send: jest.Mock): DynamoDBClient {
  const client = new DynamoDBClient({ region: 'us-east-1' });
  (client as any).send = send;
  return client;
}

describe('describeDynamoDBTable', () => {
  it('describes a provisioned table with real RCU/WCU', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Table: {
        TableStatus: 'ACTIVE',
        CreationDateTime: new Date('2026-01-01T00:00:00.000Z'),
        BillingModeSummary: { BillingMode: 'PROVISIONED' },
        ProvisionedThroughput: { ReadCapacityUnits: 50, WriteCapacityUnits: 25 },
      },
    });
    const client = withMockedSend(send);

    const result = await describeDynamoDBTable(client, 'my-table');

    expect(result).toEqual({
      status: 'described',
      config: {
        billing_mode: 'PROVISIONED',
        table_status: 'ACTIVE',
        creation_date_time: '2026-01-01T00:00:00.000Z',
        table_class: undefined,
        provisioned_read_capacity: 50,
        provisioned_write_capacity: 25,
        autoscaling_state: 'AUTOSCALING_UNKNOWN',
      },
    });
  });

  it('describes an on-demand (PAY_PER_REQUEST) table without provisioned capacity', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Table: {
        TableStatus: 'ACTIVE',
        BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' },
      },
    });
    const client = withMockedSend(send);

    const result = await describeDynamoDBTable(client, 'on-demand-table');

    expect(result.status).toBe('described');
    if (result.status === 'described') {
      expect(result.config.billing_mode).toBe('PAY_PER_REQUEST');
      expect(result.config.provisioned_read_capacity).toBeUndefined();
      expect(result.config.provisioned_write_capacity).toBeUndefined();
    }
  });

  it('never infers PROVISIONED from ProvisionedThroughput alone -- billing mode is UNKNOWN when BillingModeSummary is absent', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Table: {
        TableStatus: 'ACTIVE',
        // No BillingModeSummary at all, but ProvisionedThroughput is present --
        // must not be read as proof of PROVISIONED.
        ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 10 },
      },
    });
    const client = withMockedSend(send);

    const result = await describeDynamoDBTable(client, 'ambiguous-table');

    expect(result.status).toBe('described');
    if (result.status === 'described') {
      expect(result.config.billing_mode).toBe('UNKNOWN');
      // The real numbers AWS returned are still preserved -- capturing them
      // is not the same as using them to infer billing mode.
      expect(result.config.provisioned_read_capacity).toBe(10);
      expect(result.config.provisioned_write_capacity).toBe(10);
    }
  });

  it('never infers PAY_PER_REQUEST from a missing ProvisionedThroughput alone', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Table: {
        TableStatus: 'ACTIVE',
        // No BillingModeSummary, no ProvisionedThroughput either.
      },
    });
    const client = withMockedSend(send);

    const result = await describeDynamoDBTable(client, 'no-signal-table');

    expect(result.status).toBe('described');
    if (result.status === 'described') {
      expect(result.config.billing_mode).toBe('UNKNOWN');
    }
  });

  it('treats an unrecognized BillingMode value as UNKNOWN rather than guessing', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Table: {
        TableStatus: 'ACTIVE',
        BillingModeSummary: { BillingMode: 'SOME_FUTURE_MODE' as any },
      },
    });
    const client = withMockedSend(send);

    const result = await describeDynamoDBTable(client, 'future-mode-table');

    expect(result.status).toBe('described');
    if (result.status === 'described') {
      expect(result.config.billing_mode).toBe('UNKNOWN');
    }
  });

  it('captures table class when present', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Table: {
        TableStatus: 'ACTIVE',
        BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' },
        TableClassSummary: { TableClass: 'STANDARD_INFREQUENT_ACCESS' },
      },
    });
    const client = withMockedSend(send);

    const result = await describeDynamoDBTable(client, 'ia-table');

    expect(result.status).toBe('described');
    if (result.status === 'described') {
      expect(result.config.table_class).toBe('STANDARD_INFREQUENT_ACCESS');
    }
  });

  it('captures GSI configuration when present', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Table: {
        TableStatus: 'ACTIVE',
        BillingModeSummary: { BillingMode: 'PROVISIONED' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        GlobalSecondaryIndexes: [
          { IndexName: 'gsi-1', ProvisionedThroughput: { ReadCapacityUnits: 3, WriteCapacityUnits: 2 } },
          { IndexName: 'gsi-2', ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 } },
        ],
      },
    });
    const client = withMockedSend(send);

    const result = await describeDynamoDBTable(client, 'table-with-gsi');

    expect(result.status).toBe('described');
    if (result.status === 'described') {
      expect(result.config.global_secondary_indexes).toEqual([
        { index_name: 'gsi-1', provisioned_read_capacity: 3, provisioned_write_capacity: 2 },
        { index_name: 'gsi-2', provisioned_read_capacity: 1, provisioned_write_capacity: 1 },
      ]);
    }
  });

  it('captures Global Table replica regions when present', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Table: {
        TableStatus: 'ACTIVE',
        BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' },
        Replicas: [{ RegionName: 'eu-west-1' }, { RegionName: 'ap-southeast-2' }],
      },
    });
    const client = withMockedSend(send);

    const result = await describeDynamoDBTable(client, 'global-table');

    expect(result.status).toBe('described');
    if (result.status === 'described') {
      expect(result.config.replica_regions).toEqual(['eu-west-1', 'ap-southeast-2']);
    }
  });

  it('omits replica_regions entirely for a non-global table (no Replicas field)', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Table: { TableStatus: 'ACTIVE', BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' } },
    });
    const client = withMockedSend(send);

    const result = await describeDynamoDBTable(client, 'regular-table');

    expect(result.status).toBe('described');
    if (result.status === 'described') {
      expect(result.config.replica_regions).toBeUndefined();
    }
  });

  it('always reports autoscaling_state as AUTOSCALING_UNKNOWN -- no Application Auto Scaling integration exists to determine it', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Table: {
        TableStatus: 'ACTIVE',
        BillingModeSummary: { BillingMode: 'PROVISIONED' },
        ProvisionedThroughput: { ReadCapacityUnits: 100, WriteCapacityUnits: 100 },
      },
    });
    const client = withMockedSend(send);

    const result = await describeDynamoDBTable(client, 'autoscaled-looking-table');

    expect(result.status).toBe('described');
    if (result.status === 'described') {
      expect(result.config.autoscaling_state).toBe('AUTOSCALING_UNKNOWN');
    }
  });

  it('returns unavailable, never a fabricated config, when DescribeTable throws', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('AccessDeniedException'));
    const client = withMockedSend(send);

    const result = await describeDynamoDBTable(client, 'no-permission-table');

    expect(result).toEqual({ status: 'unavailable', reason: 'AccessDeniedException' });
  });

  it('returns unavailable when the response has no Table at all', async () => {
    const send = jest.fn().mockResolvedValueOnce({});
    const client = withMockedSend(send);

    const result = await describeDynamoDBTable(client, 'weird-response-table');

    expect(result.status).toBe('unavailable');
  });
});
