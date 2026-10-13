import {
  NO_LIFECYCLE_RESOURCE_TYPES,
  NOT_APPLICABLE_STATUS,
  hasLifecycleStatus,
  lifecycleStateFor,
  storedStatusFor,
} from '../resourceLifecycle';

describe('resource types with no lifecycle status', () => {
  it('are S3, SNS and VPC', () => {
    expect([...NO_LIFECYCLE_RESOURCE_TYPES].sort()).toEqual(['s3', 'sns', 'vpc']);
  });

  it.each(['s3', 'sns', 'vpc'])('%s is stored as not_applicable, whatever state is offered', (type) => {
    expect(hasLifecycleStatus(type)).toBe(false);
    expect(storedStatusFor(type, 'active')).toBe(NOT_APPLICABLE_STATUS);
    expect(storedStatusFor(type, 'unknown')).toBe(NOT_APPLICABLE_STATUS);
  });

  it.each(['ec2', 'ebs', 'rds', 'lambda', 'load-balancer', 'cloudfront', 'dynamodb', 'sqs'])('%s keeps the state AWS reported', (type) => {
    expect(hasLifecycleStatus(type)).toBe(true);
    expect(storedStatusFor(type, 'running')).toBe('running');
  });
});

describe('lifecycleStateFor', () => {
  // Rows an earlier release wrote still carry 'active' / 'available' / 'running'.
  it.each([
    ['s3', 'active'], ['s3', 'running'], ['s3', NOT_APPLICABLE_STATUS], ['s3', null],
    ['sns', 'active'], ['sns', NOT_APPLICABLE_STATUS],
    ['vpc', 'available'], ['vpc', 'pending'], ['vpc', NOT_APPLICABLE_STATUS],
  ])('%s stored as %p has no lifecycle state', (type, stored) => {
    expect(lifecycleStateFor(type, stored)).toBeNull();
  });

  it.each([[null], [undefined], [''], ['unknown'], ['UNKNOWN'], [NOT_APPLICABLE_STATUS]])('an EC2 row stored as %p has none either: it was not read', (stored) => {
    expect(lifecycleStateFor('ec2', stored)).toBeNull();
  });

  it.each([['ec2', 'running'], ['ec2', 'stopped'], ['ebs', 'in-use'], ['rds', 'available'], ['lambda', 'Active']])('%s %s is reported as stored', (type, stored) => {
    expect(lifecycleStateFor(type, stored)).toBe(stored);
  });
});
