import { computeSecurityGroupFindingKey, SecurityGroupRuleIdentity } from '../securityGroupFindingKey';

function identity(overrides: Partial<SecurityGroupRuleIdentity> = {}): SecurityGroupRuleIdentity {
  return {
    securityGroupId: 'sg-0a1b2c3d',
    region: 'us-east-1',
    direction: 'ingress',
    protocol: 'tcp',
    fromPort: 22,
    toPort: 22,
    ipVersion: 'v4',
    ...overrides,
  };
}

describe('computeSecurityGroupFindingKey', () => {
  it('is deterministic for the same identity', () => {
    expect(computeSecurityGroupFindingKey(identity())).toBe(computeSecurityGroupFindingKey(identity()));
  });

  it('has no security-group-name parameter at all — identity is name-independent by construction', () => {
    // SecurityGroupRuleIdentity intentionally has no `name`/`groupName` field, so a
    // rename can never change a finding's identity. See
    // complianceScanner.security-groups.test.ts for the end-to-end version of this
    // (same GroupId, different GroupName, across two scans -> identical finding_key).
    const identityKeys = Object.keys(identity());
    expect(identityKeys).not.toContain('name');
    expect(identityKeys).not.toContain('groupName');
    expect(identityKeys).not.toContain('securityGroupName');
  });

  it('produces distinct keys for distinct security groups', () => {
    const a = computeSecurityGroupFindingKey(identity({ securityGroupId: 'sg-aaaa' }));
    const b = computeSecurityGroupFindingKey(identity({ securityGroupId: 'sg-bbbb' }));
    expect(a).not.toBe(b);
  });

  it('produces distinct keys for distinct rules on the same security group', () => {
    const ssh = computeSecurityGroupFindingKey(identity({ fromPort: 22, toPort: 22 }));
    const rdp = computeSecurityGroupFindingKey(identity({ fromPort: 3389, toPort: 3389 }));
    const otherPort = computeSecurityGroupFindingKey(identity({ fromPort: 8080, toPort: 8080 }));
    const otherProtocol = computeSecurityGroupFindingKey(identity({ protocol: 'udp' }));
    const otherRegion = computeSecurityGroupFindingKey(identity({ region: 'eu-west-1' }));
    const otherDirection = computeSecurityGroupFindingKey(identity({ direction: 'egress' }));

    const keys = [ssh, rdp, otherPort, otherProtocol, otherRegion, otherDirection];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('produces distinct keys for IPv4 vs IPv6 on an otherwise identical rule', () => {
    const v4 = computeSecurityGroupFindingKey(identity({ ipVersion: 'v4' }));
    const v6 = computeSecurityGroupFindingKey(identity({ ipVersion: 'v6' }));
    expect(v4).not.toBe(v6);
  });
});
