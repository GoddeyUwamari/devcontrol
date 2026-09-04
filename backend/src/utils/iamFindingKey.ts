import crypto from 'crypto';

export type IamFindingIdentity =
  | { findingType: 'mfa_not_enabled'; userArn: string }
  | { findingType: 'access_key_stale'; userArn: string; accessKeyId: string };

/**
 * Stable identity for an IAM finding — mirrors securityGroupFindingKey.ts's
 * pattern (sha256 of immutable fields only, joined by "|").
 *
 * Deliberately excludes anything that changes without the underlying
 * condition changing: access-key age in days, severity, title text. An
 * earlier version of checkIAMSecurity never set a stable findingKey for
 * access-key issues, so they fell through to AccountSecurityFindingsRepository's
 * generic fallback hash of the mutable issue text (which embeds ageInDays) —
 * meaning the same stale key got a new finding_key every single day,
 * silently "resolving" and recreating itself and losing any user disposition
 * in the process. userArn + accessKeyId are both immutable for the life of
 * that key; a rotated key is a different AccessKeyId entirely.
 *
 * organization_id is not part of the hash: it's already the other half of
 * account_security_findings' (organization_id, finding_key) unique constraint.
 */
export function computeIamFindingKey(identity: IamFindingIdentity): string {
  const parts =
    identity.findingType === 'mfa_not_enabled'
      ? [identity.userArn, identity.findingType]
      : [identity.userArn, identity.findingType, identity.accessKeyId];

  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}
