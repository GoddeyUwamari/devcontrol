/**
 * aggregateEstimatedSavings(): the same instance's cost must not be counted
 * twice when an idle-instance finding (full cost) and a Reserved Instance
 * opportunity (a discount on that type's uncovered instances) both draw on it.
 */
import { EC2Client } from '@aws-sdk/client-ec2';
import costOptimizationService from '../cost-optimization.service';
import { aggregateEstimatedSavings, SavingsRecommendation } from '../estimated-savings';

function idle(instanceId: string, savings: number): SavingsRecommendation {
  return {
    resource_type: 'EC2',
    potential_savings: savings,
    metadata: { savings_claim: { kind: 'full_resource_cost', resource_ids: [instanceId] } },
  };
}

function ri(instanceIds: string[], uncovered: number, perInstance: number): SavingsRecommendation {
  return {
    resource_type: 'EC2',
    potential_savings: perInstance * uncovered,
    metadata: {
      savings_claim: { kind: 'fleet_discount', resource_ids: instanceIds, per_resource_savings: perInstance, counted_resources: uncovered },
    },
  };
}

describe('aggregateEstimatedSavings', () => {
  it('the same EC2 instance with idle + RI findings is not double-counted', () => {
    // 2 uncovered m5.large ($70 each, $24.50 RI saving each); i-a is also idle.
    const result = aggregateEstimatedSavings([idle('i-a', 70), ri(['i-a', 'i-b'], 2, 24.5)]);

    // i-a's whole $70 estimate is already claimed; only i-b's $24.50 remains for the RI -- not $70 + $49.
    expect(result.total).toBe(94.5);
    expect(result.byResourceType).toEqual({ EC2: 94.5 });
  });

  it('an RI discount whose whole pool is idle contributes nothing further', () => {
    const result = aggregateEstimatedSavings([idle('i-a', 70), idle('i-b', 70), ri(['i-a', 'i-b'], 2, 24.5)]);

    expect(result.total).toBe(140);
  });

  it('reserved instances already covering part of the pool reduce only the uncovered count', () => {
    // 3 running, 1 reserved -> 2 uncovered; 1 idle -> 1 left to reserve.
    const result = aggregateEstimatedSavings([idle('i-a', 70), ri(['i-a', 'i-b', 'i-c'], 2, 24.5)]);

    expect(result.total).toBe(94.5);
  });

  it('distinct resources and categories still aggregate normally', () => {
    const result = aggregateEstimatedSavings([
      idle('i-a', 70),
      ri(['i-x', 'i-y'], 2, 24.5), // different instances -- no overlap
      { resource_type: 'EBS', potential_savings: '12.40', metadata: {} },
      { resource_type: 'S3', potential_savings: 3.1, metadata: null },
    ]);

    expect(result.total).toBe(134.5);
    expect(result.byResourceType).toEqual({ EC2: 119, EBS: 12.4, S3: 3.1 });
  });

  it('recommendations without a savings claim are summed unchanged -- no overlap is assumed', () => {
    const result = aggregateEstimatedSavings([
      { resource_type: 'EC2', potential_savings: 50, metadata: {} },
      { resource_type: 'EC2', potential_savings: 30, metadata: {} },
    ]);

    expect(result.total).toBe(80);
  });

  it('a missing or non-numeric savings figure contributes nothing -- never a fabricated amount', () => {
    const result = aggregateEstimatedSavings([
      { resource_type: 'EC2', potential_savings: null },
      { resource_type: 'EBS', potential_savings: 'not-a-number' },
    ]);

    expect(result.total).toBe(0);
    expect(result.byResourceType).toEqual({});
  });

  it('a malformed claim is ignored rather than trusted', () => {
    const malformed: SavingsRecommendation = {
      resource_type: 'EC2',
      potential_savings: 49,
      metadata: { savings_claim: { kind: 'fleet_discount', resource_ids: ['i-a'] } as any },
    };
    const result = aggregateEstimatedSavings([idle('i-a', 70), malformed]);

    expect(result.total).toBe(119);
  });

  it('no active recommendations aggregate to 0 with no per-type entries', () => {
    expect(aggregateEstimatedSavings([])).toEqual({ total: 0, byResourceType: {} });
  });
});

describe('detectReservedInstanceOpportunities declares the instance pool its estimate draws on', () => {
  it('names every running instance of the type and the uncovered count', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({
        Reservations: [{ Instances: [
          { InstanceId: 'i-a', InstanceType: 'm5.large' },
          { InstanceId: 'i-b', InstanceType: 'm5.large' },
          { InstanceId: 'i-c', InstanceType: 'm5.large' },
        ] }],
      })
      .mockResolvedValueOnce({ ReservedInstances: [{ InstanceType: 'm5.large', InstanceCount: 1 }] });
    const ec2Client = new EC2Client({ region: 'us-east-1' });
    (ec2Client as any).send = send;

    const issues = await (costOptimizationService as any).detectReservedInstanceOpportunities(ec2Client);

    expect(issues).toHaveLength(1);
    const claim = issues[0].metadata.savings_claim;
    expect(claim.kind).toBe('fleet_discount');
    expect(claim.resource_ids).toEqual(['i-a', 'i-b', 'i-c']);
    expect(claim.counted_resources).toBe(2);
    expect(claim.per_resource_savings * claim.counted_resources).toBeCloseTo(issues[0].potentialSavings);
  });
});
