import crypto from 'crypto';

export type IpVersion = 'v4' | 'v6';
export type RuleDirection = 'ingress' | 'egress';

export interface SecurityGroupRuleIdentity {
  securityGroupId: string;
  region: string;
  direction: RuleDirection;
  protocol: string;
  fromPort: number;
  toPort: number;
  ipVersion: IpVersion;
}

/**
 * Stable identity for a security-group unrestricted-ingress finding.
 *
 * Deliberately excludes the security group's human-readable name (renaming
 * a group must not create a duplicate finding) and the CIDR (this control is
 * specifically about unrestricted ingress, so 0.0.0.0/0 vs ::/0 is already
 * captured by ipVersion — there is no other CIDR this control ever matches).
 * organization_id is not part of the hash: it's already the other half of
 * the table's (organization_id, finding_key) unique constraint.
 */
export function computeSecurityGroupFindingKey(identity: SecurityGroupRuleIdentity): string {
  const { securityGroupId, region, direction, protocol, fromPort, toPort, ipVersion } = identity;
  return crypto
    .createHash('sha256')
    .update(`${securityGroupId}|${region}|${direction}|${protocol}|${fromPort}|${toPort}|${ipVersion}`)
    .digest('hex');
}
