/**
 * Resource truth (2B): the operational status behind the Services at-risk count.
 *
 * A resource with no lifecycle state to judge -- its type has none (S3, SNS, VPC)
 * or it was not read -- is 'unknown': no status reason, and not at risk on status
 * alone. An attached EBS volume ('in-use') is a normal state, not a warning.
 */
import { derivePrioritySeverity, mapStatus } from '../services.routes';

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
  const medium = { severity: 'medium', category: 'public_access', issue: 'EC2 instance has a public IP address; exposure unknown: its security groups could not be read', recommendation: 'r', provenance: 'OBSERVED' };

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
