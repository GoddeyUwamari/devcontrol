/**
 * Phase 3E, Checkpoint C: describeDynamoDBAutoscaling() -- classification is
 * conservative by explicit product decision: ENABLED if either read or
 * write capacity has a registered scalable target, DISABLED only when the
 * call succeeds and returns targets for neither dimension, UNKNOWN on any
 * API error (never collapsed into DISABLED).
 */
import { ApplicationAutoScalingClient } from '@aws-sdk/client-application-auto-scaling';
import { describeDynamoDBAutoscaling } from '../dynamodb-autoscaling.util';

function withMockedSend(send: jest.Mock): ApplicationAutoScalingClient {
  const client = new ApplicationAutoScalingClient({ region: 'us-east-1' });
  (client as any).send = send;
  return client;
}

describe('describeDynamoDBAutoscaling', () => {
  it('reports AUTOSCALING_ENABLED when only the read dimension has a registered scalable target', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      ScalableTargets: [
        { ScalableDimension: 'dynamodb:table:ReadCapacityUnits', ResourceId: 'table/my-table' },
      ],
    });
    const client = withMockedSend(send);

    const result = await describeDynamoDBAutoscaling(client, 'my-table');

    expect(result).toEqual({
      status: 'described',
      config: {
        autoscaling_state: 'AUTOSCALING_ENABLED',
        read_capacity_autoscaled: true,
        write_capacity_autoscaled: false,
      },
    });
  });

  it('reports AUTOSCALING_ENABLED when only the write dimension has a registered scalable target', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      ScalableTargets: [
        { ScalableDimension: 'dynamodb:table:WriteCapacityUnits', ResourceId: 'table/my-table' },
      ],
    });
    const client = withMockedSend(send);

    const result = await describeDynamoDBAutoscaling(client, 'my-table');

    expect(result).toEqual({
      status: 'described',
      config: {
        autoscaling_state: 'AUTOSCALING_ENABLED',
        read_capacity_autoscaled: false,
        write_capacity_autoscaled: true,
      },
    });
  });

  it('reports AUTOSCALING_ENABLED with both flags true when both dimensions have registered scalable targets', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      ScalableTargets: [
        { ScalableDimension: 'dynamodb:table:ReadCapacityUnits', ResourceId: 'table/my-table' },
        { ScalableDimension: 'dynamodb:table:WriteCapacityUnits', ResourceId: 'table/my-table' },
      ],
    });
    const client = withMockedSend(send);

    const result = await describeDynamoDBAutoscaling(client, 'my-table');

    expect(result).toEqual({
      status: 'described',
      config: {
        autoscaling_state: 'AUTOSCALING_ENABLED',
        read_capacity_autoscaled: true,
        write_capacity_autoscaled: true,
      },
    });
  });

  it('reports AUTOSCALING_DISABLED when the call succeeds but returns no scalable targets', async () => {
    const send = jest.fn().mockResolvedValueOnce({ ScalableTargets: [] });
    const client = withMockedSend(send);

    const result = await describeDynamoDBAutoscaling(client, 'unconfigured-table');

    expect(result).toEqual({
      status: 'described',
      config: {
        autoscaling_state: 'AUTOSCALING_DISABLED',
        read_capacity_autoscaled: false,
        write_capacity_autoscaled: false,
      },
    });
  });

  it('reports AUTOSCALING_DISABLED when ScalableTargets is absent from the response entirely', async () => {
    const send = jest.fn().mockResolvedValueOnce({});
    const client = withMockedSend(send);

    const result = await describeDynamoDBAutoscaling(client, 'unconfigured-table');

    expect(result.status).toBe('described');
    if (result.status === 'described') {
      expect(result.config.autoscaling_state).toBe('AUTOSCALING_DISABLED');
    }
  });

  it('reports AUTOSCALING_UNKNOWN -- never DISABLED -- when the API call fails', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('AccessDeniedException'));
    const client = withMockedSend(send);

    const result = await describeDynamoDBAutoscaling(client, 'no-permission-table');

    expect(result).toEqual({
      status: 'unavailable',
      reason: 'AccessDeniedException',
    });
  });

  it('ignores scalable targets for unrelated dimensions (e.g. a GSI) when determining the base table state', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      ScalableTargets: [
        { ScalableDimension: 'dynamodb:index:ReadCapacityUnits', ResourceId: 'table/my-table/index/my-gsi' },
      ],
    });
    const client = withMockedSend(send);

    const result = await describeDynamoDBAutoscaling(client, 'my-table');

    expect(result).toEqual({
      status: 'described',
      config: {
        autoscaling_state: 'AUTOSCALING_DISABLED',
        read_capacity_autoscaled: false,
        write_capacity_autoscaled: false,
      },
    });
  });

  it('scopes the DescribeScalableTargets request to the dynamodb namespace and table/<name> resource id', async () => {
    const send = jest.fn().mockResolvedValueOnce({ ScalableTargets: [] });
    const client = withMockedSend(send);

    await describeDynamoDBAutoscaling(client, 'my-table');

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command.input).toEqual({
      ServiceNamespace: 'dynamodb',
      ResourceIds: ['table/my-table'],
    });
  });
});
