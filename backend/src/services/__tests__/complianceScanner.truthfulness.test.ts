/**
 * Security Truthfulness #40/#41: regression coverage for ComplianceScannerService's
 * encryption/backup finding generation now that is_encrypted/has_backup can be a genuine
 * `null` (unknown/unavailable evidence), not just true/false. The locked decision: a
 * specific "not encrypted"/"no backup" finding must fire only for a verified `false`,
 * never for `null` -- and existing `true`/`false` behavior (including RDS's real,
 * unmodified backup check) must be unaffected.
 */
import { ComplianceScannerService } from '../complianceScanner';
import { AWSResource } from '../../types/aws-resources.types';

function resource(overrides: Partial<AWSResource>): AWSResource {
  return {
    id: 'id-1',
    organization_id: 'org-1',
    resource_arn: 'arn:aws:ec2:us-east-1:1:instance/i-1',
    resource_id: 'i-1',
    resource_name: 'test-resource',
    resource_type: 'ec2',
    region: 'us-east-1',
    tags: {},
    metadata: {},
    status: 'running',
    estimated_monthly_cost: 10,
    actual_monthly_cost: 10,
    is_encrypted: true,
    is_public: false,
    has_backup: true,
    compliance_issues: [],
    is_orphaned: false,
    orphaned_monthly_savings: 0,
    last_synced_at: new Date(),
    first_discovered_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('ComplianceScannerService — encryption/backup finding generation with unknown (null) evidence', () => {
  const service = new ComplianceScannerService();

  it('is_encrypted === false generates a "not encrypted" finding (unchanged behavior)', () => {
    const issues = (service as any).checkEncryption(resource({ resource_type: 'ec2', is_encrypted: false }));
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe('encryption');
  });

  it('is_encrypted === null (unknown) generates NO "not encrypted" finding -- must not fabricate a negative claim', () => {
    const issues = (service as any).checkEncryption(resource({ resource_type: 'ec2', is_encrypted: null }));
    expect(issues).toHaveLength(0);
  });

  it('is_encrypted === true generates no finding (unchanged behavior)', () => {
    const issues = (service as any).checkEncryption(resource({ resource_type: 'ec2', is_encrypted: true }));
    expect(issues).toHaveLength(0);
  });

  it('has_backup === false on EC2 generates a "does not have regular snapshots" finding (unchanged behavior)', () => {
    const issues = (service as any).checkBackups(resource({ resource_type: 'ec2', has_backup: false }));
    expect(issues).toHaveLength(1);
    expect(issues[0].issue).toMatch(/does not have regular snapshots/i);
  });

  it('has_backup === null on EC2 generates NO backup finding -- must not fabricate "no backup"', () => {
    const issues = (service as any).checkBackups(resource({ resource_type: 'ec2', has_backup: null }));
    expect(issues).toHaveLength(0);
  });

  it('existing RDS backup behavior is unaffected: has_backup === false still generates its own RDS-specific finding text', () => {
    const issues = (service as any).checkBackups(resource({ resource_type: 'rds', has_backup: false }));
    expect(issues).toHaveLength(1);
    expect(issues[0].issue).toMatch(/RDS database does not have automated backups enabled/i);
  });

  it('RDS has_backup === null generates no finding, same principle as EC2', () => {
    const issues = (service as any).checkBackups(resource({ resource_type: 'rds', has_backup: null }));
    expect(issues).toHaveLength(0);
  });

  it('backup check does not apply to unaffected resource types (e.g. lambda) regardless of has_backup value', () => {
    const issuesFalse = (service as any).checkBackups(resource({ resource_type: 'lambda', has_backup: false }));
    const issuesNull = (service as any).checkBackups(resource({ resource_type: 'lambda', has_backup: null }));
    expect(issuesFalse).toHaveLength(0);
    expect(issuesNull).toHaveLength(0);
  });

  it('HIPAA EBS backup check: has_backup === false generates the HIPAA finding (unchanged behavior)', () => {
    const issues = (service as any).checkHIPAACompliance(resource({ resource_type: 'ebs', has_backup: false, is_encrypted: true }));
    expect(issues.some((i: any) => /must have automated backups/i.test(i.issue))).toBe(true);
  });

  it('HIPAA EBS backup check: has_backup === null generates no "must have automated backups" finding', () => {
    const issues = (service as any).checkHIPAACompliance(resource({ resource_type: 'ebs', has_backup: null, is_encrypted: true }));
    expect(issues.some((i: any) => /must have automated backups/i.test(i.issue))).toBe(false);
  });

  it('unaffected resource types/fields: S3 encryption behavior (a type never touched by #40/#41) is unchanged', () => {
    const issues = (service as any).checkEncryption(resource({ resource_type: 's3', is_encrypted: false }));
    expect(issues).toHaveLength(1);
    expect(issues[0].issue).toMatch(/S3 bucket does not have default encryption enabled/i);
  });

  it('is_public compliance behavior is completely unaffected by this change', () => {
    const issues = (service as any).checkPublicAccess(resource({ resource_type: 'ec2', is_public: true }));
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe('public_access');
  });
});
