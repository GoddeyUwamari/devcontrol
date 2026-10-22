/**
 * How an aws_resources row reads in GET /api/infrastructure:
 *   - an EBS volume shows AWS's own volume state ('available' = unattached,
 *     'in-use' = attached), never 'running' or 'pending';
 *   - every other type keeps the running/stopped/pending reading;
 *   - an S3 bucket's fixed $5 placeholder is reported as not estimated (null),
 *     while a confirmed $0 stays $0.
 */
import { infrastructureCostFor, infrastructureStatusFor } from '../infrastructureRow';

describe('infrastructureStatusFor -- EBS volume state', () => {
  it('reports an EBS volume in its own AWS state, never "running" or "pending"', () => {
    expect(infrastructureStatusFor('ebs', 'available')).toBe('available');
    expect(infrastructureStatusFor('ebs', 'in-use')).toBe('in-use');
    expect(infrastructureStatusFor('ebs', 'error')).toBe('error');
    expect(infrastructureStatusFor('ebs', 'creating')).toBe('creating');
    expect(infrastructureStatusFor('ebs', 'deleting')).toBe('deleting');
  });

  it('recognises an EBS volume whatever the case of its type', () => {
    expect(infrastructureStatusFor('EBS', 'available')).toBe('available');
  });

  it('an EBS volume whose state was not read has none to show', () => {
    expect(infrastructureStatusFor('ebs', 'unknown')).toBeNull();
    expect(infrastructureStatusFor('ebs', null)).toBeNull();
  });
});

describe('infrastructureStatusFor -- every other type is unchanged', () => {
  it('keeps the running/stopped/pending reading', () => {
    expect(infrastructureStatusFor('rds', 'available')).toBe('running');
    expect(infrastructureStatusFor('ec2', 'running')).toBe('running');
    expect(infrastructureStatusFor('ec2', 'stopped')).toBe('stopped');
    expect(infrastructureStatusFor('ec2', 'shutting-down')).toBe('pending');
  });

  it('a type with no lifecycle state has none to show', () => {
    expect(infrastructureStatusFor('s3', 'active')).toBeNull();
  });
});

describe('infrastructureCostFor', () => {
  it("reports an S3 bucket's fixed placeholder as not estimated", () => {
    expect(infrastructureCostFor('s3', '5.00')).toBeNull();
  });

  it('keeps a real estimate, an unknown, and a confirmed $0 as they are', () => {
    expect(infrastructureCostFor('ec2', '30.37')).toBe(30.37);
    expect(infrastructureCostFor('lambda', null)).toBeNull();
    expect(infrastructureCostFor('ebs', '0.00')).toBe(0);
  });
});
