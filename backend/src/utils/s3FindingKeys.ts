/**
 * Stable identities for the S3 bucket security findings (see
 * services/s3-security-evaluation.ts). Consumers match on these keys, never on the
 * issue text, so a finding's wording can change without orphaning it.
 */
export const S3_FINDING_KEYS = {
  publicPolicy: 's3.public_access.policy',
  publicAcl: 's3.public_access.acl',
  httpsOnly: 's3.https_only',
} as const;

export type S3FindingKey = (typeof S3_FINDING_KEYS)[keyof typeof S3_FINDING_KEYS];
