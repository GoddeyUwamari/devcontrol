/**
 * Resource truth (2B): the operational status behind the Services at-risk count.
 *
 * A resource with no lifecycle state to judge -- its type has none (S3, SNS, VPC)
 * or it was not read -- is 'unknown': no status reason, and not at risk on status
 * alone. An attached EBS volume ('in-use') is a normal state, not a warning.
 */
import { deriveAttention, derivePrioritySeverity, mapStatus } from '../services.routes';

describe('mapStatus', () => {
  it.each([
    ['s3', 'not_applicable'], ['sns', 'not_applicable'], ['vpc', 'not_applicable'],
    // As an earlier release stored them, before discovery rewrites the row.
    ['s3', 'active'], ['sns', 'active'], ['vpc', 'available'],
    // A status the type could never have had means nothing either.
    ['s3', 'running'], ['s3', 'stopped'], ['vpc', 'pending'], ['sns', null],
  ])('%s stored as %p has no status: unknown', (type, stored) => {
    expect(mapStatus(type, stored)).toBe('unknown');
  });

  it.each([['ec2'], ['ebs'], ['rds'], ['dynamodb'], ['ecs'], ['sqs'], ['lambda'], ['load-balancer']])('%s whose state was not read is unknown, not a warning', (type) => {
    expect(mapStatus(type, 'unknown')).toBe('unknown');
    expect(mapStatus(type, 'UNKNOWN')).toBe('unknown');
    expect(mapStatus(type, null)).toBe('unknown');
  });

  it.each([
    ['in-use', 'healthy'], ['available', 'healthy'], ['error', 'critical'], ['creating', 'warning'], ['deleting', 'warning'],
  ])('an EBS volume that is %s is %s', (state, expected) => {
    expect(mapStatus('ebs', state)).toBe(expected);
  });

  it.each([['active', 'healthy'], ['in-progress', 'healthy'], ['unknown', 'unknown'], [null, 'unknown']])(
    'a CloudFront distribution stored as %p is %s: a change still propagating is not "stopped or degraded"',
    (stored, expected) => {
      expect(mapStatus('cloudfront', stored)).toBe(expected);
    }
  );

  it('known states of the other types are unchanged', () => {
    expect(mapStatus('ec2', 'running')).toBe('healthy');
    expect(mapStatus('ec2', 'stopped')).toBe('warning');
    expect(mapStatus('ec2', 'pending')).toBe('warning');
    expect(mapStatus('rds', 'available')).toBe('healthy');
    expect(mapStatus('rds', 'stopped')).toBe('critical');
    expect(mapStatus('ecs', 'inactive')).toBe('critical');
    expect(mapStatus('dynamodb', 'active')).toBe('healthy');
    expect(mapStatus('lambda', 'Active')).toBe('healthy');
  });
});

describe('derivePrioritySeverity', () => {
  const NOTHING = { priority_severity: null, reason: null, needs_attention: false };
  const high = { severity: 'high', category: 'encryption', issue: 'S3 bucket does not enforce HTTPS-only access', recommendation: 'r', provenance: 'OBSERVED' };
  const medium = { severity: 'medium', category: 'public_access', issue: 'EC2 instance has a public IP address. Exposure unknown: its security groups could not be read.', recommendation: 'r', provenance: 'OBSERVED' };

  it('an unknown status raises nothing on its own', () => {
    expect(derivePrioritySeverity('unknown', [], [])).toEqual(NOTHING);
  });

  it.each([['s3', 'not_applicable'], ['vpc', 'available'], ['sns', 'active'], ['dynamodb', 'unknown'], ['ebs', 'in-use']])(
    'a %s stored as %s with no findings is not at risk and has no "stopped or degraded" reason',
    (type, stored) => {
      expect(derivePrioritySeverity(mapStatus(type, stored), [], [])).toEqual(NOTHING);
    }
  );

  it('a real finding still counts on a resource with no status: nothing is hidden', () => {
    expect(derivePrioritySeverity(mapStatus('s3', 'not_applicable'), [high], [])).toEqual({
      priority_severity: 'high', reason: high.issue, needs_attention: true,
    });
  });

  it('a Medium public-IP finding is reported but does not put the instance at risk', () => {
    expect(derivePrioritySeverity(mapStatus('ec2', 'running'), [medium], [])).toEqual({
      priority_severity: 'medium', reason: medium.issue, needs_attention: false,
    });
  });

  it('a stopped instance is still at risk on its status', () => {
    expect(derivePrioritySeverity(mapStatus('ec2', 'stopped'), [], [])).toEqual({
      priority_severity: 'medium', reason: 'Resource is stopped or degraded', needs_attention: true,
    });
  });
});

describe('deriveAttention: why a resource needs attention', () => {
  const high = { severity: 'high', category: 'encryption', issue: 'S3 bucket does not enforce HTTPS-only access', recommendation: 'r', provenance: 'OBSERVED' };
  const low = { severity: 'low', category: 'tagging', issue: 'Resource is missing required tags: Owner', recommendation: 'r' };
  const costHigh = { severity: 'HIGH', issue: 'Idle Instance', potential_savings: 10 };
  const NONE = { finding: false, cost_recommendation: false, status: null };

  it.each([
    ['a High finding', 'healthy', [high], [], { ...NONE, finding: true }],
    ['a HIGH cost recommendation and no finding', 'healthy', [], [costHigh], { ...NONE, cost_recommendation: true }],
    ['a cost recommendation beside a Low finding: the finding takes precedence, and Low is under the floor', 'healthy', [low], [costHigh], NONE],
    ['a stopped resource', 'warning', [], [], { ...NONE, status: 'warning' }],
    ['a failed resource', 'critical', [], [], { ...NONE, status: 'critical' }],
    ['a stopped resource with a High finding: both', 'warning', [high], [], { finding: true, cost_recommendation: false, status: 'warning' }],
    ['no status to judge and nothing flagged', 'unknown', [low], [], NONE],
  ])('%s', (_name, status, issues, recommendations, causes) => {
    const result = deriveAttention(status as any, issues, recommendations);
    expect(result.causes).toEqual(causes);
    expect(result.needs_attention).toBe(causes.finding || causes.cost_recommendation || causes.status !== null);
  });

  it('agrees with derivePrioritySeverity on everything they share', () => {
    for (const [status, issues, recommendations] of [['healthy', [high], []], ['warning', [], [costHigh]], ['unknown', [low], []]] as const) {
      const { causes, ...shared } = deriveAttention(status, [...issues], [...recommendations]);
      expect(causes).toBeDefined();
      expect(derivePrioritySeverity(status, [...issues], [...recommendations])).toEqual(shared);
    }
  });
});
