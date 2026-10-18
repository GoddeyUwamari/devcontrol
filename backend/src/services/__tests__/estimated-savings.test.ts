/**
 * aggregateEstimatedSavings(): the same instance's cost must not be counted
 * twice when an idle-instance finding (full cost) and a Reserved Instance
 * opportunity (a discount on that type's uncovered instances) both draw on it.
 * And a figure only counts as what its savings_basis says it is: estimates in
 * the total, ceilings apart from it, anything without a supported basis nowhere.
 */
import { EC2Client } from '@aws-sdk/client-ec2';
import costOptimizationService from '../cost-optimization.service';
import { aggregateEstimatedSavings, classifySavingsBasis, SavingsRecommendation } from '../estimated-savings';

const ESTIMATED = 'estimated: list price';
const CEILING = 'ceiling: assumes 100% of current Standard storage transitions to Standard-IA';

function idle(instanceId: string, savings: number): SavingsRecommendation {
  return {
    resource_type: 'EC2',
    potential_savings: savings,
    metadata: { savings_basis: ESTIMATED, savings_claim: { kind: 'full_resource_cost', resource_ids: [instanceId] } },
  };
}

function plain(resourceType: string, savings: number | string | null, savingsBasis: unknown = ESTIMATED): SavingsRecommendation {
  return { resource_type: resourceType, potential_savings: savings, metadata: { savings_basis: savingsBasis } };
}

function ri(instanceIds: string[], uncovered: number, perInstance: number): SavingsRecommendation {
  return {
    resource_type: 'EC2',
    potential_savings: perInstance * uncovered,
    metadata: {
      savings_basis: ESTIMATED,
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
      plain('EBS', '12.40'),
      plain('S3', 3.1),
    ]);

    expect(result.total).toBe(134.5);
    expect(result.byResourceType).toEqual({ EC2: 119, EBS: 12.4, S3: 3.1 });
  });

  it('recommendations without a savings claim are summed unchanged -- no overlap is assumed', () => {
    const result = aggregateEstimatedSavings([plain('EC2', 50), plain('EC2', 30)]);

    expect(result.total).toBe(80);
  });

  it('a missing or non-numeric savings figure contributes nothing -- never a fabricated amount', () => {
    const result = aggregateEstimatedSavings([plain('EC2', null), plain('EBS', 'not-a-number'), plain('S3', null, CEILING)]);

    expect(result.total).toBe(0);
    expect(result.byResourceType).toEqual({});
  });

  it('a malformed claim is ignored rather than trusted', () => {
    const malformed: SavingsRecommendation = {
      resource_type: 'EC2',
      potential_savings: 49,
      metadata: { savings_basis: ESTIMATED, savings_claim: { kind: 'fleet_discount', resource_ids: ['i-a'] } as any },
    };
    const result = aggregateEstimatedSavings([idle('i-a', 70), malformed]);

    expect(result.total).toBe(119);
  });

  it('no active recommendations aggregate to 0 with no per-type entries', () => {
    expect(aggregateEstimatedSavings([])).toEqual({ total: 0, byResourceType: {}, ceilingTotal: 0, ceilingByResourceType: {} });
  });
});

describe('aggregateEstimatedSavings: savings provenance', () => {
  it('a ceiling is excluded from total and byResourceType and returned as ceilingTotal', () => {
    const result = aggregateEstimatedSavings([
      plain('EBS', 12.4),
      plain('S3', 41.27, CEILING),
      plain('S3', 8.73, CEILING),
      plain('S3', 2, 'estimated: a hypothetical S3 estimate'),
    ]);

    expect(result.total).toBe(14.4);
    expect(result.byResourceType).toEqual({ EBS: 12.4, S3: 2 });
    expect(result.ceilingTotal).toBe(50);
    expect(result.ceilingByResourceType).toEqual({ S3: 50 });
  });

  it('a missing, empty, non-string or unrecognised savings_basis is neither an estimate nor a ceiling', () => {
    const result = aggregateEstimatedSavings([
      { resource_type: 'RDS', potential_savings: 98, metadata: {} },
      { resource_type: 'RDS', potential_savings: 98, metadata: null },
      { resource_type: 'RDS', potential_savings: 98 },
      plain('EIP', 3.6, ''),
      plain('EIP', 3.6, 42),
      plain('EIP', 3.6, 'Estimated: wrong case'),
      plain('EIP', 3.6, 'ceilinged: not the prefix'),
      plain('EIP', 3.6, ' ceiling: leading space'),
    ]);

    expect(result).toEqual({ total: 0, byResourceType: {}, ceilingTotal: 0, ceilingByResourceType: {} });
  });

  it('only an estimate can claim a resource at full cost -- a ceiling or unsupported row never shrinks a fleet discount', () => {
    const ceilingClaim: SavingsRecommendation = {
      resource_type: 'EC2', potential_savings: 70,
      metadata: { savings_basis: CEILING, savings_claim: { kind: 'full_resource_cost', resource_ids: ['i-a'] } },
    };
    const unsupportedClaim: SavingsRecommendation = {
      resource_type: 'EC2', potential_savings: 70,
      metadata: { savings_claim: { kind: 'full_resource_cost', resource_ids: ['i-b'] } },
    };

    const result = aggregateEstimatedSavings([ceilingClaim, unsupportedClaim, ri(['i-a', 'i-b'], 2, 24.5)]);

    expect(result.total).toBe(49);
    expect(result.ceilingTotal).toBe(70);
  });

  it('classifySavingsBasis recognises exactly the prefixes the detectors write', () => {
    expect(classifySavingsBasis('estimated: x')).toBe('estimate');
    expect(classifySavingsBasis('scenario:highest_observed_hourly_average — x')).toBe('ceiling'); // legacy DynamoDB capacity rows
    expect(classifySavingsBasis('comparison:on_demand_vs_provisioned_observed_workload — x')).toBe('estimate');
    expect(classifySavingsBasis(CEILING)).toBe('ceiling');
    for (const unsupported of [undefined, null, '', 'ceiling', 'estimated', 'guess: x', 7, {}]) {
      expect(classifySavingsBasis(unsupported)).toBeNull();
    }
  });
});

describe('detectReservedInstanceOpportunities: a coverage gap with no dollar figure', () => {
  async function detect(instances: Array<{ InstanceId: string; InstanceType: string }>, reserved: Array<{ InstanceType: string; InstanceCount: number }>) {
    const send = jest.fn()
      .mockResolvedValueOnce({ Reservations: [{ Instances: instances }] })
      .mockResolvedValueOnce({ ReservedInstances: reserved });
    const ec2Client = new EC2Client({ region: 'us-east-1' });
    (ec2Client as any).send = send;
    return (costOptimizationService as any).detectReservedInstanceOpportunities(ec2Client);
  }

  it('reports "N uncovered × type" with no potential savings, no savings basis and no savings claim', async () => {
    const issues = await detect(
      [
        { InstanceId: 'i-a', InstanceType: 'm5.large' },
        { InstanceId: 'i-b', InstanceType: 'm5.large' },
        { InstanceId: 'i-c', InstanceType: 'm5.large' },
      ],
      [{ InstanceType: 'm5.large', InstanceCount: 1 }]
    );

    expect(issues).toHaveLength(1);
    const [issue] = issues;
    expect(issue.resourceName).toBe('2 uncovered × m5.large');
    expect(issue.potentialSavings).toBe(0);
    expect(issue.severity).toBe('LOW');
    expect(issue.metadata.savings_basis).toBeUndefined();
    expect(issue.metadata.savings_claim).toBeUndefined();
    expect(issue.metadata.estimated_discount).toBeUndefined();
    expect(issue.metadata).toMatchObject({ instance_type: 'm5.large', running_count: 3, reserved_count: 1, uncovered_count: 2, instance_ids: ['i-a', 'i-b', 'i-c'] });
    expect(issue.description).toMatch(/does not account for Savings Plans/);
    expect(issue.description).not.toMatch(/\$|%|save/i);
  });

  it('an unlisted instance type gets no default price either', async () => {
    const issues = await detect(
      [{ InstanceId: 'i-a', InstanceType: 'x9.mega' }, { InstanceId: 'i-b', InstanceType: 'x9.mega' }],
      []
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].potentialSavings).toBe(0);
    expect(issues[0].resourceName).toBe('2 uncovered × x9.mega');
  });

  it('contributes nothing to the estimated savings total, even next to an idle finding on the same instances', async () => {
    const [issue] = await detect(
      [{ InstanceId: 'i-a', InstanceType: 'm5.large' }, { InstanceId: 'i-b', InstanceType: 'm5.large' }],
      []
    );
    const result = aggregateEstimatedSavings([
      idle('i-a', 70),
      { resource_type: 'EC2', potential_savings: issue.potentialSavings, metadata: issue.metadata },
    ]);

    expect(result.total).toBe(70);
    expect(result.ceilingTotal).toBe(0);
  });
});
