/**
 * The tagging compliance report only judges resources whose tags were read. One
 * whose tags are unknown is counted as unknown: no "Missing required tag" issue,
 * and no place in the compliance rate.
 */
import { TaggingComplianceService } from '../taggingCompliance.service';

const COMPLETE = { Environment: 'production', Owner: 'o', Team: 't', CostCenter: 'CC-1234' };

function serviceOver(rows: any[]) {
  const client = { query: jest.fn(async () => ({ rows })), release: jest.fn() };
  const pool = { connect: jest.fn(async () => client) };
  return new TaggingComplianceService(pool as any);
}
const row = (resource_id: string, resource_type: string, tags: Record<string, string>, metadata: Record<string, unknown>) => ({
  id: resource_id, resource_id, resource_arn: `arn:aws:${resource_type}:::${resource_id}`, resource_type, tags, metadata, compliance_issues: [],
});

describe('TaggingComplianceService.auditAllResources', () => {
  it('a bucket whose tags could not be read is unknown: no issue, and outside the rate', async () => {
    const report = await serviceOver([
      row('app-prod-backups', 's3', {}, { tags_state: 'unavailable' }),
      row('app-deploy-artifacts', 's3', COMPLETE, { tags_state: 'observed' }),
    ]).auditAllResources('org-1');

    expect(report).toMatchObject({ total_resources: 2, compliant_resources: 1, non_compliant_resources: 0, unknown_resources: 1, compliance_rate: 100 });
    expect(report.issues).toEqual([]);
  });

  it('a bucket observed to have no tags is non-compliant, with one issue per required tag', async () => {
    const report = await serviceOver([row('marketing-site', 's3', {}, { tags_state: 'observed' })]).auditAllResources('org-1');

    expect(report).toMatchObject({ compliant_resources: 0, non_compliant_resources: 1, unknown_resources: 0, compliance_rate: 0 });
    expect(report.issues.map((i) => i.issue)).toEqual([
      'Missing required tag: Environment', 'Missing required tag: Owner', 'Missing required tag: Team', 'Missing required tag: CostCenter',
    ]);
  });

  it.each([
    ['an S3 bucket not rediscovered since tags were first read', 's3', {}],
    ['a CloudFront distribution (tags are not read)', 'cloudfront', { tags_state: 'unavailable' }],
    ['a Lambda function whose ListTags was denied', 'lambda', { tags_state: 'unavailable' }],
    ['a load balancer whose DescribeTags was denied', 'load-balancer', { tags_state: 'unavailable' }],
    ['a VPC whose Resource Explorer result carried no tags', 'vpc', { tags_state: 'unavailable' }],
    ['a reclassified RDS cluster recorded as unavailable', 'rds', { tags_state: 'unavailable', source: 'resource-explorer' }],
  ])('%s raises no "Missing required tag"', async (_name, type, metadata) => {
    const report = await serviceOver([row('thing', type, {}, metadata)]).auditAllResources('org-1');
    expect(report.issues).toEqual([]);
    expect(report).toMatchObject({ unknown_resources: 1, non_compliant_resources: 0, compliance_rate: 0 });
    expect(report.summary).toEqual({ missing_owner: 0, missing_environment: 0, missing_team: 0, missing_cost_center: 0 });
  });

  it('an untagged EC2 instance (tags arrive inline) is still reported', async () => {
    const report = await serviceOver([row('i-1234567890abcdef0', 'ec2', {}, {})]).auditAllResources('org-1');
    expect(report).toMatchObject({ non_compliant_resources: 1, unknown_resources: 0 });
    expect(report.issues).toHaveLength(4);
  });

  it('the rate is over the resources that were judged, not over all of them', async () => {
    const report = await serviceOver([
      row('known-good', 's3', COMPLETE, { tags_state: 'observed' }),
      row('known-bad', 's3', {}, { tags_state: 'observed' }),
      row('unknown-1', 's3', {}, { tags_state: 'unavailable' }),
      row('unknown-2', 'cloudfront', {}, { tags_state: 'unavailable' }),
    ]).auditAllResources('org-1');
    expect(report).toMatchObject({ total_resources: 4, compliant_resources: 1, non_compliant_resources: 1, unknown_resources: 2, compliance_rate: 50 });
  });
});
