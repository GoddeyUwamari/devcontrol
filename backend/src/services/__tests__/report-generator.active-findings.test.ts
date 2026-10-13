/**
 * The Compliance Status report counts current findings only -- the same rule the
 * score and the at-risk flag use (isActiveComplianceFinding). It used to aggregate
 * aws_resources.compliance_issues in SQL, so an entry carried forward unverified,
 * or written for a framework before frameworks had to be enabled, was reported as
 * an issue for as long as it stayed stored.
 *
 * No database: the service reads through the executor it is given. The same
 * aggregation against real rows is exercised in
 * awsResourceDiscovery.framework-applicability.test.ts (everyCount).
 */
import { Pool, PoolClient } from 'pg';
import { ReportGeneratorService } from '../report-generator.service';

const real = (severity: string, category: string, issue: string) => ({ severity, category, issue, recommendation: 'r' });
const LEGACY_HIPAA = real('critical', 'backups', 'HIPAA: EBS storing PHI must have automated backups');
const LEGACY_SOC2 = real('high', 'tagging', 'Tagging: IAM role/owner not documented');
const UNVERIFIED = { ...real('critical', 'public_access', 'S3 bucket policy allows public access'), findingKey: 's3.public_access.policy', verification: 'unverified', evaluation_state: 'unable_to_evaluate' };
const FAILED_FRAMEWORK = { ...LEGACY_HIPAA, framework: 'HIPAA', findingKey: 'hipaa.automated_backups', applicability: 'enabled', evaluation_state: 'failed' };

type Row = { name: string; type: string; compliance_issues: unknown };

function executorFor(totalResources: number, rows: Row[]) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const executor = {
    query: jest.fn(async (text: string, values: unknown[]) => {
      statements.push({ text, values });
      return /COUNT\(\*\) as total_resources/.test(text) ? { rows: [{ total_resources: String(totalResources) }] } : { rows };
    }),
  } as unknown as PoolClient;
  return { executor, statements };
}

async function report(totalResources: number, rows: Row[], filters?: Record<string, string>) {
  const { executor, statements } = executorFor(totalResources, rows);
  const data = await (new ReportGeneratorService({} as Pool) as any).fetchComplianceStatusData('org-1', filters, executor);
  return { data, statements };
}

describe('ReportGeneratorService compliance status: current findings only', () => {
  it('counts current findings by severity and category, and ranks resources by them', async () => {
    const { data } = await report(4, [
      { name: 'instance-a', type: 'ec2', compliance_issues: [real('high', 'public_access', 'EC2 instance has a public IP address'), real('low', 'tagging', 'Resource is missing required tags: Owner')] },
      { name: 'db-a', type: 'rds', compliance_issues: [real('critical', 'encryption', 'RDS database is not encrypted at rest'), real('high', 'backups', 'RDS database does not have automated backups enabled'), real('low', 'tagging', 'Resource is missing required tags: Team')] },
    ]);

    expect(data).toEqual({
      totalResources: 4,
      totalIssues: 5,
      bySeverity: { critical: 1, high: 2, medium: 0, low: 2 },
      byCategory: [
        { category: 'tagging', count: 2 },
        { category: 'backups', count: 1 },
        { category: 'encryption', count: 1 },
        { category: 'public_access', count: 1 },
      ],
      topNonCompliantResources: [
        { name: 'db-a', type: 'rds', issueCount: 3 },
        { name: 'instance-a', type: 'ec2', issueCount: 2 },
      ],
      complianceScore: 50,
    });
  });

  it('leaves out legacy framework entries and unverified findings, at every severity', async () => {
    const { data } = await report(3, [
      // Nothing current: this resource is compliant as far as the report can say.
      { name: 'volume-a', type: 'ebs', compliance_issues: [LEGACY_HIPAA, { ...LEGACY_HIPAA, issue: 'HIPAA: Resource lacks documented backup retention policy', severity: 'high' }] },
      { name: 'bucket-a', type: 's3', compliance_issues: [UNVERIFIED, { ...UNVERIFIED, verification: 'unverified', evaluation_state: 'error' }] },
      // One current finding among three that are not.
      { name: 'instance-a', type: 'ec2', compliance_issues: [LEGACY_SOC2, real('high', 'public_access', 'EC2 instance has a public IP address'), LEGACY_HIPAA, UNVERIFIED] },
    ]);

    expect(data).toEqual({
      totalResources: 3,
      totalIssues: 1,
      bySeverity: { critical: 0, high: 1, medium: 0, low: 0 },
      byCategory: [{ category: 'public_access', count: 1 }],
      topNonCompliantResources: [{ name: 'instance-a', type: 'ec2', issueCount: 1 }],
      // 2 of 3 resources have no current finding.
      complianceScore: (2 / 3) * 100,
    });
  });

  it('counts a failed check of an enabled framework, and not the same entry once its framework is no longer enabled', async () => {
    const { data } = await report(2, [
      { name: 'volume-a', type: 'ebs', compliance_issues: [FAILED_FRAMEWORK] },
      { name: 'volume-b', type: 'ebs', compliance_issues: [{ ...FAILED_FRAMEWORK, applicability: 'disabled', evaluation_state: 'not_evaluated' }] },
    ]);
    expect(data.totalIssues).toBe(1);
    expect(data.bySeverity).toEqual({ critical: 1, high: 0, medium: 0, low: 0 });
    expect(data.topNonCompliantResources).toEqual([{ name: 'volume-a', type: 'ebs', issueCount: 1 }]);
    expect(data.complianceScore).toBe(50);
  });

  it('an organization whose stored entries are all legacy or unverified is fully compliant in the report', async () => {
    const { data } = await report(2, [
      { name: 'volume-a', type: 'ebs', compliance_issues: [LEGACY_HIPAA] },
      { name: 'bucket-a', type: 's3', compliance_issues: [UNVERIFIED] },
    ]);
    expect(data).toEqual({
      totalResources: 2,
      totalIssues: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      byCategory: [],
      topNonCompliantResources: [],
      complianceScore: 100,
    });
  });

  it('lists at most ten resources, the ten with the most current findings', async () => {
    const rows: Row[] = Array.from({ length: 12 }, (_, i) => ({
      name: `resource-${String(i).padStart(2, '0')}`,
      type: 'ec2',
      // resource-00 has 1 current finding, resource-11 has 12 -- plus legacy entries that must not change the order.
      compliance_issues: [
        ...Array.from({ length: i + 1 }, (_unused, n) => real('low', 'tagging', `finding ${n}`)),
        ...Array.from({ length: 12 - i }, () => LEGACY_HIPAA),
      ],
    }));
    const { data } = await report(12, rows);
    expect(data.topNonCompliantResources.map((r: any) => [r.name, r.issueCount])).toEqual(
      Array.from({ length: 10 }, (_, n) => [`resource-${String(11 - n).padStart(2, '0')}`, 12 - n])
    );
  });

  it('tolerates stored values and entries that are not what the scanner writes', async () => {
    const { data } = await report(3, [
      { name: 'a', type: 'ec2', compliance_issues: null },
      { name: 'b', type: 'ec2', compliance_issues: { severity: 'high' } },
      { name: 'c', type: 'ec2', compliance_issues: [null, 'text', 7, { severity: 'SEVERE', category: 'tagging', issue: 'x' }, { severity: 'High', issue: 'y' }] },
    ]);
    // Two object entries are current; only the one with a known severity is counted by severity.
    expect(data.bySeverity).toEqual({ critical: 0, high: 1, medium: 0, low: 0 });
    expect(data.totalIssues).toBe(1);
    expect(data.byCategory).toEqual([{ category: 'tagging', count: 1 }]);
    expect(data.topNonCompliantResources).toEqual([{ name: 'c', type: 'ec2', issueCount: 2 }]);
  });

  it('reads one organization, on the executor it is given, with the filters applied to both statements', async () => {
    const { statements } = await report(0, [], { resource_type: 's3', region: 'test-region-1' });
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement.text).toContain('r.organization_id = $1');
      expect(statement.text).toContain(`r.status != 'terminated'`);
      expect(statement.text).toContain('r.resource_type = $2');
      expect(statement.text).toContain('r.region = $3');
      expect(statement.values).toEqual(['org-1', 's3', 'test-region-1']);
    }
  });
});
