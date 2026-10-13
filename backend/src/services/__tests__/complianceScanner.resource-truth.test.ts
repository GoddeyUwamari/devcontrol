/**
 * Resource truth (2B): a baseline finding is raised only on evidence.
 *
 *   - EC2 public IP: High only with an internet-open rule on an administrative or
 *     database port; otherwise Medium, and "exposure unknown" when the security
 *     groups could not be read.
 *   - "not encrypted": only for a type whose encryption state discovery reads.
 *   - "missing required tags": only when the tags were read.
 */
import { ComplianceScannerService, ENCRYPTION_EVIDENCE_TYPES, tagsObserved } from '../complianceScanner';
import { AWSResource, ComplianceIssue } from '../../types/aws-resources.types';
import { ADMIN_DB_PORTS, evaluateNetworkExposure, IngressRule } from '../../utils/adminPortExposure';
import { GENERIC_RESOURCE_TYPES } from '../resourceExplorer.service';

const TAGGED = { Owner: 'o', Environment: 'e', Team: 't' };

function resource(overrides: Partial<AWSResource>): AWSResource {
  return {
    id: 'r1', organization_id: 'o1', resource_arn: 'arn:aws:ec2:us-east-1:*:instance/i-0abc000000001234', resource_id: 'i-0abc000000001234',
    resource_name: 'r', resource_type: 'ec2', region: 'us-east-1', tags: TAGGED, metadata: {}, status: 'running',
    estimated_monthly_cost: 0, actual_monthly_cost: 0, is_encrypted: true, is_public: false, has_backup: true,
    compliance_issues: [], is_orphaned: false, orphaned_monthly_savings: 0, last_synced_at: null,
    first_discovered_at: new Date(), created_at: new Date(), updated_at: new Date(), ...overrides,
  } as AWSResource;
}
const baseline = (r: AWSResource): ComplianceIssue[] => new ComplianceScannerService().evaluateBaseline(r);
const publicAccess = (r: AWSResource) => baseline(r).filter((i) => i.category === 'public_access');

/** An instance with a public IP whose one security group has the given ingress rules. */
function publicInstance(rules: IngressRule[] | 'unreadable' | 'never-read'): AWSResource {
  const SG = 'sg-0abc000000001234';
  if (rules === 'never-read') return resource({ is_public: true, metadata: {} });
  const groups = rules === 'unreadable' ? null : new Map([[SG, { GroupId: SG, IpPermissions: rules }]]);
  return resource({ is_public: true, metadata: { security_group_ids: [SG], network_exposure: evaluateNetworkExposure([SG], groups) } });
}
const open = (rule: IngressRule): IngressRule => ({ IpRanges: [{ CidrIp: '0.0.0.0/0' }], ...rule });

describe('EC2 public IP severity', () => {
  describe('High: a public IP and an internet-open rule covering an administrative or database port', () => {
    it.each(ADMIN_DB_PORTS.map((port) => [port]))('tcp %i from 0.0.0.0/0', (port) => {
      const [finding] = publicAccess(publicInstance([open({ IpProtocol: 'tcp', FromPort: port, ToPort: port })]));
      expect(finding.severity).toBe('high');
      expect(finding.network_exposure?.rules[0].admin_ports).toEqual([port]);
    });

    it('a port range that covers one: tcp 0-65535 covers 22', () => {
      const [finding] = publicAccess(publicInstance([open({ IpProtocol: 'tcp', FromPort: 0, ToPort: 65535 })]));
      expect(finding.severity).toBe('high');
      expect(finding.network_exposure?.rules[0].admin_ports).toContain(22);
    });

    it('an IPv6 source: ::/0', () => {
      const [finding] = publicAccess(publicInstance([{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, Ipv6Ranges: [{ CidrIpv6: '::/0' }] }]));
      expect(finding.severity).toBe('high');
      expect(finding.issue).toContain('from ::/0');
    });

    it('protocol -1 (all protocols)', () => {
      const [finding] = publicAccess(publicInstance([open({ IpProtocol: '-1' })]));
      expect(finding.severity).toBe('high');
      expect(finding.issue).toContain('all protocols and ports from 0.0.0.0/0');
    });

    it('the finding names the rule: group, protocol, ports, source, and the ports it covers', () => {
      const [finding] = publicAccess(publicInstance([open({ IpProtocol: 'tcp', FromPort: 20, ToPort: 25 })]));
      expect(finding).toMatchObject({
        severity: 'high',
        category: 'public_access',
        provenance: 'OBSERVED',
        issue: 'EC2 instance has a public IP address and security group sg-0abc000000001234 allows tcp 20-25 from 0.0.0.0/0, which covers port 22',
        network_exposure: {
          schema_version: 1,
          state: 'open_admin_port',
          rules: [{ security_group_id: 'sg-0abc000000001234', protocol: 'tcp', from_port: 20, to_port: 25, cidr: '0.0.0.0/0', admin_ports: [22] }],
        },
      });
    });

    it('says how many more such rules there are', () => {
      const [finding] = publicAccess(publicInstance([
        open({ IpProtocol: 'tcp', FromPort: 22, ToPort: 22 }),
        open({ IpProtocol: 'tcp', FromPort: 3389, ToPort: 3389 }),
        open({ IpProtocol: 'tcp', FromPort: 5432, ToPort: 5432 }),
      ]));
      expect(finding.issue).toContain('(and 2 more such rules)');
      expect(finding.network_exposure?.rules).toHaveLength(3);
    });
  });

  describe('Medium: a public IP, exposure not established', () => {
    it.each([
      ['only 443 open to the internet', [open({ IpProtocol: 'tcp', FromPort: 443, ToPort: 443 })]],
      ['a range that stops below 22', [open({ IpProtocol: 'tcp', FromPort: 1, ToPort: 21 })]],
      ['an admin port open to a private range only', [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '10.0.0.0/8' }] }]],
      ['icmp open to the internet with type/code numbers that look like ports', [open({ IpProtocol: 'icmp', FromPort: 22, ToPort: 22 })]],
      ['icmp spanning every number', [open({ IpProtocol: 'icmp', FromPort: 0, ToPort: 65535 })]],
      ['a non-port protocol (gre) open to the internet', [open({ IpProtocol: '47', FromPort: 0, ToPort: 65535 })]],
      ['no ingress rules at all', []],
    ])('%s', (_name, rules) => {
      const findings = publicAccess(publicInstance(rules as IngressRule[]));
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: 'medium',
        issue: 'EC2 instance has a public IP address; no attached security group opens an administrative or database port to the internet',
        network_exposure: { state: 'not_established', rules: [] },
      });
    });
  });

  describe('Medium at most when the security groups could not be read', () => {
    it.each([['the read was denied or failed', 'unreadable' as const], ['discovery recorded nothing for the instance', 'never-read' as const]])(
      '%s: exposure unknown, never confirmed',
      (_name, state) => {
        const findings = publicAccess(publicInstance(state));
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
          severity: 'medium',
          issue: 'EC2 instance has a public IP address; exposure unknown: its security groups could not be read',
          network_exposure: { state: 'unknown', rules: [] },
        });
        expect(findings[0].recommendation).toContain('ec2:DescribeSecurityGroups');
      }
    );

    it('a recorded open_admin_port with no rule behind it is not taken as confirmed', () => {
      const instance = resource({ is_public: true, metadata: { network_exposure: { state: 'open_admin_port', rules: [] } } });
      expect(publicAccess(instance)[0].severity).toBe('medium');
    });
  });

  it('no finding text ever claims the instance was reached or compromised', () => {
    const texts = [
      publicInstance([open({ IpProtocol: '-1' })]),
      publicInstance([open({ IpProtocol: 'tcp', FromPort: 443, ToPort: 443 })]),
      publicInstance('unreadable'),
    ].flatMap((r) => publicAccess(r)).flatMap((f) => [f.issue, f.recommendation, f.network_exposure?.summary ?? '']);
    for (const text of texts) {
      expect(text).not.toMatch(/compromis|breach|attack|exploit|hacked|was accessed|unauthorized access|confirmed exposure/i);
    }
  });

  it('an instance with no public IP has no public-access finding, whatever its security groups allow', () => {
    const SG = 'sg-0abc000000001234';
    const exposure = evaluateNetworkExposure([SG], new Map([[SG, { GroupId: SG, IpPermissions: [open({ IpProtocol: '-1' })] }]]));
    expect(publicAccess(resource({ is_public: false, metadata: { network_exposure: exposure } }))).toEqual([]);
    expect(publicAccess(resource({ is_public: null, metadata: { network_exposure: exposure } }))).toEqual([]);
  });

  it('other public resource types keep their own finding', () => {
    expect(publicAccess(resource({ resource_type: 'rds', is_public: true }))[0]).toMatchObject({ severity: 'critical', issue: 'RDS database is publicly accessible' });
  });
});

describe('"not encrypted" needs an encryption state that was read', () => {
  it('is read for EC2, EBS, RDS and S3', () => {
    expect([...ENCRYPTION_EVIDENCE_TYPES].sort()).toEqual(['ebs', 'ec2', 'rds', 's3']);
  });

  it.each(ENCRYPTION_EVIDENCE_TYPES.map((t) => [t]))('%s with is_encrypted=false: a finding', (type) => {
    expect(baseline(resource({ resource_type: type as any, is_encrypted: false })).filter((i) => i.category === 'encryption')).toHaveLength(1);
  });

  // Rows an earlier release wrote carry is_encrypted=false for these types: a default, never an observation.
  it.each([...GENERIC_RESOURCE_TYPES, 'lambda', 'load-balancer', 'cloudfront'].map((t) => [t]))('%s with a stored is_encrypted=false: no finding', (type) => {
    const issues = baseline(resource({ resource_type: type as any, is_encrypted: false, metadata: { tags_state: 'observed' } }));
    expect(issues.filter((i) => i.category === 'encryption')).toEqual([]);
  });

  it.each([['ebs'], ['ec2'], ['rds'], ['s3'], ['vpc'], ['sns']])('%s with is_encrypted=null (unknown): no finding', (type) => {
    expect(baseline(resource({ resource_type: type as any, is_encrypted: null })).filter((i) => i.category === 'encryption')).toEqual([]);
  });

  it('a VPC and an SNS topic stored the way an earlier release left them now have no finding at all', () => {
    for (const type of ['vpc', 'sns'] as const) {
      const legacy = resource({ resource_type: type, status: type === 'vpc' ? 'available' : 'active', tags: {}, metadata: {}, is_encrypted: false, is_public: false, has_backup: false });
      expect(baseline(legacy)).toEqual([]);
    }
  });
});

describe('"missing required tags" needs tags that were read', () => {
  const untagged = (type: string, metadata: Record<string, unknown>) => resource({ resource_type: type as any, tags: {}, metadata });
  const tagFindings = (r: AWSResource) => baseline(r).filter((i) => i.category === 'tagging');

  it.each([['s3'], ['cloudfront'], ['lambda'], ['load-balancer'], ['vpc'], ['sns'], ['dynamodb']])('%s, tags observed and empty: a finding', (type) => {
    const findings = tagFindings(untagged(type, { tags_state: 'observed' }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'low', issue: 'Resource is missing required tags: Owner, Environment, Team' });
  });

  it.each([['s3'], ['cloudfront'], ['lambda'], ['load-balancer'], ['vpc'], ['sns'], ['dynamodb']])('%s, tags unavailable: no finding', (type) => {
    expect(tagFindings(untagged(type, { tags_state: 'unavailable' }))).toEqual([]);
  });

  it.each([['s3'], ['cloudfront'], ['lambda'], ['load-balancer'], ['vpc'], ['sns']])('%s, with no recorded tag state (a row not rediscovered yet): no finding', (type) => {
    expect(tagFindings(untagged(type, {}))).toEqual([]);
  });

  it('an S3 bucket whose observed tags are partly missing: the finding lists only what is missing', () => {
    const bucket = resource({ resource_type: 's3', tags: { Owner: 'o' }, metadata: { tags_state: 'observed' } });
    expect(tagFindings(bucket)[0].issue).toBe('Resource is missing required tags: Environment, Team');
  });

  it('an S3 bucket whose observed tags are complete: no finding', () => {
    expect(tagFindings(resource({ resource_type: 's3', tags: TAGGED, metadata: { tags_state: 'observed' } }))).toEqual([]);
  });

  it.each([['ec2'], ['ebs'], ['rds']])('%s tags arrive with the resource, so an untagged one is a finding with no recorded state', (type) => {
    expect(tagsObserved(untagged(type, {}))).toBe(true);
    expect(tagFindings(untagged(type, {}))).toHaveLength(1);
  });
});
