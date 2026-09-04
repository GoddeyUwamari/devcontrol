/**
 * Synthetic-mock coverage for ComplianceScannerService.checkSecurityGroups —
 * the Security PR2 detector rewrite (pagination, IPv6, structured evidence,
 * stable finding_key, and partial-result handling on AWS error).
 *
 * Mocked EC2Client.send — no real AWS credentials or network calls. The
 * function calls .send() directly (not a generated SDK paginator), so a
 * plain jest.fn() assigned to .send is sufficient; no instanceof trickery
 * needed (contrast awsResourceDiscovery.pagination.test.ts, which mocks the
 * generated paginateDescribeInstances() paginator instead).
 */

import { EC2Client } from '@aws-sdk/client-ec2';
import { ComplianceScannerService } from '../complianceScanner';
import { computeSecurityGroupFindingKey } from '../../utils/securityGroupFindingKey';
import { SecurityGroupEvidence } from '../../types/aws-resources.types';
import { getFrameworkMapping } from '../../config/securityFrameworkMappings';

function mockEc2(send: jest.Mock): EC2Client {
  return { send } as unknown as EC2Client;
}

describe('ComplianceScannerService.checkSecurityGroups', () => {
  const scanner = new ComplianceScannerService();

  it('flags unrestricted IPv4 SSH (22) as critical', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      SecurityGroups: [
        {
          GroupId: 'sg-ssh',
          GroupName: 'web-sg',
          VpcId: 'vpc-1',
          IpPermissions: [
            { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
          ],
        },
      ],
    });

    const { complete, issues } = await scanner.checkSecurityGroups(mockEc2(send), 'us-east-1', '123456789012');

    expect(complete).toBe(true);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('critical');
    expect(issues[0].category).toBe('networking');
    expect(issues[0].issue).toMatch(/SSH.*0\.0\.0\.0\/0/);
  });

  it('flags unrestricted IPv4 RDP (3389) as critical', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      SecurityGroups: [
        {
          GroupId: 'sg-rdp',
          GroupName: 'win-sg',
          IpPermissions: [
            { IpProtocol: 'tcp', FromPort: 3389, ToPort: 3389, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
          ],
        },
      ],
    });

    const { issues } = await scanner.checkSecurityGroups(mockEc2(send), 'us-east-1');

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('critical');
    expect(issues[0].issue).toMatch(/RDP.*0\.0\.0\.0\/0/);
  });

  it('flags an unrestricted non-admin TCP port as high, not critical', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      SecurityGroups: [
        {
          GroupId: 'sg-http',
          GroupName: 'app-sg',
          IpPermissions: [
            { IpProtocol: 'tcp', FromPort: 8080, ToPort: 8080, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
          ],
        },
      ],
    });

    const { issues } = await scanner.checkSecurityGroups(mockEc2(send), 'us-east-1');

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('high');
  });

  it('does not classify a UDP rule matching port 22 as SSH/critical, and it gets no CIS mapping', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      SecurityGroups: [
        {
          GroupId: 'sg-udp22',
          GroupName: 'udp-sg',
          IpPermissions: [
            { IpProtocol: 'udp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
          ],
        },
      ],
    });

    const { issues } = await scanner.checkSecurityGroups(mockEc2(send), 'us-east-1');

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('high');
    expect(issues[0].issue).not.toMatch(/SSH/);
    expect(getFrameworkMapping(issues[0].evidence)).toBeNull();
  });

  it('still classifies TCP port 22 as SSH/critical and attaches the CIS mapping', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      SecurityGroups: [
        {
          GroupId: 'sg-tcp22',
          GroupName: 'tcp-ssh-sg',
          IpPermissions: [
            { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
          ],
        },
      ],
    });

    const { issues } = await scanner.checkSecurityGroups(mockEc2(send), 'us-east-1');

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('critical');
    expect(issues[0].issue).toMatch(/SSH/);
    expect(getFrameworkMapping(issues[0].evidence)).toMatchObject({
      framework: 'CIS AWS Foundations Benchmark',
      control: '5.3',
      securityHubControlId: 'EC2.53',
    });
  });

  it('still classifies TCP port 3389 as RDP/critical and attaches the CIS mapping', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      SecurityGroups: [
        {
          GroupId: 'sg-tcp3389',
          GroupName: 'tcp-rdp-sg',
          IpPermissions: [
            { IpProtocol: 'tcp', FromPort: 3389, ToPort: 3389, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
          ],
        },
      ],
    });

    const { issues } = await scanner.checkSecurityGroups(mockEc2(send), 'us-east-1');

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('critical');
    expect(issues[0].issue).toMatch(/RDP/);
    expect(getFrameworkMapping(issues[0].evidence)).toMatchObject({
      framework: 'CIS AWS Foundations Benchmark',
      control: '5.3',
      securityHubControlId: 'EC2.53',
    });
  });

  it('treats AWS protocol "-1" (all protocols) matching port 22 as SSH/critical with a CIS mapping — "-1" genuinely includes TCP', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      SecurityGroups: [
        {
          GroupId: 'sg-allproto',
          GroupName: 'all-protocols-sg',
          IpPermissions: [
            { IpProtocol: '-1', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
          ],
        },
      ],
    });

    const { issues } = await scanner.checkSecurityGroups(mockEc2(send), 'us-east-1');

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('critical');
    expect(issues[0].issue).toMatch(/SSH/);
    expect(getFrameworkMapping(issues[0].evidence)).not.toBeNull();
  });

  it('flags unrestricted IPv6 (::/0) ingress and keeps it distinct from IPv4', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      SecurityGroups: [
        {
          GroupId: 'sg-dual',
          GroupName: 'dual-stack-sg',
          IpPermissions: [
            {
              IpProtocol: 'tcp',
              FromPort: 22,
              ToPort: 22,
              IpRanges: [{ CidrIp: '0.0.0.0/0' }],
              Ipv6Ranges: [{ CidrIpv6: '::/0' }],
            },
          ],
        },
      ],
    });

    const { issues } = await scanner.checkSecurityGroups(mockEc2(send), 'us-east-1');

    expect(issues).toHaveLength(2);
    const versions = issues.map((i) => (i.evidence as SecurityGroupEvidence | undefined)?.ip_version).sort();
    expect(versions).toEqual(['v4', 'v6']);
    expect(issues[0].findingKey).not.toBe(issues[1].findingKey);
  });

  it('does not flag a restricted (non-0.0.0.0/0, non-::/0) CIDR', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      SecurityGroups: [
        {
          GroupId: 'sg-restricted',
          GroupName: 'restricted-sg',
          IpPermissions: [
            { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '10.0.0.0/8' }] },
          ],
        },
      ],
    });

    const { issues } = await scanner.checkSecurityGroups(mockEc2(send), 'us-east-1');
    expect(issues).toHaveLength(0);
  });

  it('produces a stable finding_key independent of the security group name', async () => {
    const buildResponse = (groupName: string) => ({
      SecurityGroups: [
        {
          GroupId: 'sg-stable',
          GroupName: groupName,
          IpPermissions: [
            { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
          ],
        },
      ],
    });

    const send1 = jest.fn().mockResolvedValueOnce(buildResponse('web-sg-original-name'));
    const { issues: firstScan } = await scanner.checkSecurityGroups(mockEc2(send1), 'us-east-1');

    const send2 = jest.fn().mockResolvedValueOnce(buildResponse('web-sg-renamed'));
    const { issues: secondScan } = await scanner.checkSecurityGroups(mockEc2(send2), 'us-east-1');

    expect(firstScan[0].findingKey).toBe(secondScan[0].findingKey);
    expect(firstScan[0].findingKey).toBe(
      computeSecurityGroupFindingKey({
        securityGroupId: 'sg-stable',
        region: 'us-east-1',
        direction: 'ingress',
        protocol: 'tcp',
        fromPort: 22,
        toPort: 22,
        ipVersion: 'v4',
      })
    );
  });

  it('produces distinct finding_keys for distinct rules on the same security group', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      SecurityGroups: [
        {
          GroupId: 'sg-multi',
          GroupName: 'multi-rule-sg',
          IpPermissions: [
            { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
            { IpProtocol: 'tcp', FromPort: 3389, ToPort: 3389, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
          ],
        },
      ],
    });

    const { issues } = await scanner.checkSecurityGroups(mockEc2(send), 'us-east-1');
    expect(issues).toHaveLength(2);
    expect(issues[0].findingKey).not.toBe(issues[1].findingKey);
  });

  it('produces a narrow, versioned evidence shape', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      SecurityGroups: [
        {
          GroupId: 'sg-evidence',
          GroupName: 'evidence-sg',
          VpcId: 'vpc-evidence',
          IpPermissions: [
            { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
          ],
        },
      ],
    });

    const { issues } = await scanner.checkSecurityGroups(mockEc2(send), 'us-east-1', '123456789012');
    const evidence = issues[0].evidence as SecurityGroupEvidence;

    expect(evidence).toMatchObject({
      schema_version: 1,
      security_group_id: 'sg-evidence',
      security_group_name: 'evidence-sg',
      vpc_id: 'vpc-evidence',
      region: 'us-east-1',
      direction: 'ingress',
      protocol: 'tcp',
      from_port: 22,
      to_port: 22,
      ip_version: 'v4',
      cidr: '0.0.0.0/0',
    });
    expect(typeof evidence.detected_at).toBe('string');
  });

  it('fully consumes pagination across multiple pages', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        SecurityGroups: [
          {
            GroupId: 'sg-page1',
            GroupName: 'page1-sg',
            IpPermissions: [
              { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
            ],
          },
        ],
        NextToken: 'token-2',
      })
      .mockResolvedValueOnce({
        SecurityGroups: [
          {
            GroupId: 'sg-page2',
            GroupName: 'page2-sg',
            IpPermissions: [
              { IpProtocol: 'tcp', FromPort: 3389, ToPort: 3389, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
            ],
          },
        ],
        // no NextToken -> loop stops here
      });

    const { complete, issues } = await scanner.checkSecurityGroups(mockEc2(send), 'us-east-1');

    expect(send).toHaveBeenCalledTimes(2);
    expect(complete).toBe(true);
    expect(issues.map((i) => (i.evidence as SecurityGroupEvidence | undefined)?.security_group_id).sort()).toEqual(['sg-page1', 'sg-page2']);
  });

  it('marks the observation incomplete (and keeps partial results) when a later page errors', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        SecurityGroups: [
          {
            GroupId: 'sg-page1',
            GroupName: 'page1-sg',
            IpPermissions: [
              { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
            ],
          },
        ],
        NextToken: 'token-2',
      })
      .mockRejectedValueOnce(new Error('AccessDenied on page 2'));

    const { complete, issues } = await scanner.checkSecurityGroups(mockEc2(send), 'us-east-1');

    expect(complete).toBe(false);
    // Page 1's already-observed finding is still returned — a partial result may
    // still be upserted; it just must never be trusted to imply anything's absent.
    expect(issues).toHaveLength(1);
    expect((issues[0].evidence as SecurityGroupEvidence | undefined)?.security_group_id).toBe('sg-page1');
  });

  it('marks the observation incomplete on an immediate AWS error, with no issues observed', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('AccessDenied'));

    const { complete, issues } = await scanner.checkSecurityGroups(mockEc2(send), 'us-east-1');

    expect(complete).toBe(false);
    expect(issues).toHaveLength(0);
  });
});
