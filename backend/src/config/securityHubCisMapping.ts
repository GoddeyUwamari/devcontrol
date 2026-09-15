/**
 * Authoritative, versioned framework/control mapping for the Security Hub-backed
 * Compliance Readiness foundation. CIS AWS Foundations Benchmark ONLY — this phase
 * does not implement PCI DSS, NIST 800-53 Rev. 5, or SOC 2. Do not add speculative
 * entries for those here; a real, verified mapping module gets added when that
 * framework is actually implemented.
 *
 * This is a SEPARATE, sibling configuration to
 * backend/src/config/securityFrameworkMappings.ts, not an extension or replacement of
 * it. That file maps DevControl's OWN scanner findings (evidence like
 * mfa_device_count/age_in_days from complianceScanner.ts) to CIS control numbers as
 * reference metadata; it has never called Security Hub. This file maps real AWS
 * Security Hub CIS findings (Compliance.SecurityControlId on an AwsSecurityFinding) to
 * the same CIS control taxonomy for the new Security Hub evidence pipeline. Both are
 * legitimate, distinct evidence sources for the same external framework — see
 * FrameworkMapping.mappingType below and SecurityHubFindingEvidence.source-equivalent
 * provenance in security-hub-findings.repository.ts. Neither replaces the other.
 *
 * Verified against AWS's own current CIS AWS Foundations Benchmark documentation
 * (docs.aws.amazon.com/securityhub/latest/userguide/securityhub-standards-cis.html,
 * fetched at the time this was written): Security Hub CSPM supports v5.0.0, v3.0.0,
 * v1.4.0, and v1.2.0. AWS recommends v5.0.0 as current. This mapping targets v5.0.0
 * only — the 40 controls listed below, and ONLY those 40, are what that page lists as
 * applying to v5.0.0. Do not add a control here without a citation to that same source
 * (or its successor) confirming it applies to v5.0.0; do not invent a mapping.
 *
 * StandardsArn format for v5.0.0, confirmed by the same source:
 *   arn:aws:securityhub:{region}::standards/cis-aws-foundations-benchmark/v/5.0.0
 * (region-templated — Security Hub standards ARNs are regional; region is filled in by
 * the caller from the org's connected region, matching AWSClientFactory's existing
 * single-region-per-org model.)
 */

export const CIS_AWS_FOUNDATIONS_FRAMEWORK = 'cis' as const;
export const CIS_AWS_FOUNDATIONS_VERSION = '5.0.0' as const;

export function cisStandardsArnForRegion(region: string): string {
  return `arn:aws:securityhub:${region}::standards/cis-aws-foundations-benchmark/v/5.0.0`;
}

export type FrameworkMappingType = 'DIRECT' | 'ADDITIONAL_EVIDENCE' | 'NOT_ESTABLISHABLE';

export interface FrameworkControlMapping {
  framework: typeof CIS_AWS_FOUNDATIONS_FRAMEWORK;
  frameworkVersion: typeof CIS_AWS_FOUNDATIONS_VERSION;
  /** CIS's own control number, e.g. "5.3". */
  controlId: string;
  title: string;
  /** Security Hub's short control identifier, e.g. "EC2.53". This is the join key against
   *  SecurityHubFindingEvidence.securityControlId. */
  securityHubControlId: string;
  /**
   * Every entry here is DIRECT: Security Hub's CIS AWS Foundations Benchmark v5.0.0
   * standard controls ARE the CIS requirements (AWS-certified crosswalk), not an
   * approximation of them — unlike PCI/NIST/SOC2, where most Security Hub controls only
   * partially establish the framework's requirement (ADDITIONAL_EVIDENCE) and would
   * need per-control review before being implemented in a future phase.
   */
  mappingType: 'DIRECT';
}

/**
 * The 40 controls AWS's CIS v5.0.0 page lists — verbatim control IDs, titles, and CIS
 * numbers from that page. Ordered as the source lists them.
 */
export const CIS_V5_CONTROL_MAPPINGS: FrameworkControlMapping[] = [
  { controlId: '1.2', title: 'Security contact information should be provided for an AWS account', securityHubControlId: 'Account.1', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '3.1', title: 'CloudTrail should be enabled and configured with at least one multi-Region trail that includes read and write management events', securityHubControlId: 'CloudTrail.1', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '3.5', title: 'CloudTrail should have encryption at-rest enabled', securityHubControlId: 'CloudTrail.2', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '3.2', title: 'CloudTrail log file validation should be enabled', securityHubControlId: 'CloudTrail.4', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '3.4', title: 'Ensure S3 bucket access logging is enabled on the CloudTrail S3 bucket', securityHubControlId: 'CloudTrail.7', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '3.3', title: 'AWS Config should be enabled and use the service-linked role for resource recording', securityHubControlId: 'Config.1', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '5.5', title: 'VPC default security groups should not allow inbound or outbound traffic', securityHubControlId: 'EC2.2', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '3.7', title: 'VPC flow logging should be enabled in all VPCs', securityHubControlId: 'EC2.6', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '5.1.1', title: 'EBS default encryption should be enabled', securityHubControlId: 'EC2.7', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '5.7', title: 'EC2 instances should use Instance Metadata Service Version 2 (IMDSv2)', securityHubControlId: 'EC2.8', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '5.2', title: 'Network ACLs should not allow ingress from 0.0.0.0/0 to port 22 or port 3389', securityHubControlId: 'EC2.21', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '5.3', title: 'EC2 security groups should not allow ingress from 0.0.0.0/0 to remote server administration ports', securityHubControlId: 'EC2.53', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '5.4', title: 'EC2 security groups should not allow ingress from ::/0 to remote server administration ports', securityHubControlId: 'EC2.54', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '2.3.1', title: 'Elastic File System should be configured to encrypt file data at-rest using AWS KMS', securityHubControlId: 'EFS.1', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '2.3.1', title: 'EFS file systems should be encrypted at rest', securityHubControlId: 'EFS.8', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '1.14', title: 'IAM users should not have IAM policies attached', securityHubControlId: 'IAM.2', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '1.13', title: "IAM users' access keys should be rotated every 90 days or less", securityHubControlId: 'IAM.3', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '1.3', title: 'IAM root user access key should not exist', securityHubControlId: 'IAM.4', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '1.9', title: 'MFA should be enabled for all IAM users that have a console password', securityHubControlId: 'IAM.5', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '1.5', title: 'Hardware MFA should be enabled for the root user', securityHubControlId: 'IAM.6', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '1.4', title: 'MFA should be enabled for the root user', securityHubControlId: 'IAM.9', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '1.7', title: 'Ensure IAM password policy requires minimum password length of 14 or greater', securityHubControlId: 'IAM.15', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '1.8', title: 'Ensure IAM password policy prevents password reuse', securityHubControlId: 'IAM.16', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '1.16', title: 'Ensure a support role has been created to manage incidents with AWS Support', securityHubControlId: 'IAM.18', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '1.11', title: 'IAM user credentials unused for 45 days should be removed', securityHubControlId: 'IAM.22', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '1.18', title: 'Expired SSL/TLS certificates managed in IAM should be removed', securityHubControlId: 'IAM.26', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '1.21', title: 'IAM identities should not have the AWSCloudShellFullAccess policy attached', securityHubControlId: 'IAM.27', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '1.19', title: 'IAM Access Analyzer external access analyzer should be enabled', securityHubControlId: 'IAM.28', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '3.6', title: 'AWS KMS key rotation should be enabled', securityHubControlId: 'KMS.4', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '2.2.3', title: 'RDS DB Instances should prohibit public access, as determined by the PubliclyAccessible configuration', securityHubControlId: 'RDS.2', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '2.2.1', title: 'RDS DB instances should have encryption at-rest enabled', securityHubControlId: 'RDS.3', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '2.2.4', title: 'RDS DB instances should be configured with multiple Availability Zones', securityHubControlId: 'RDS.5', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '2.2.2', title: 'RDS automatic minor version upgrades should be enabled', securityHubControlId: 'RDS.13', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '2.2.4', title: 'RDS DB clusters should be configured for multiple Availability Zones', securityHubControlId: 'RDS.15', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '2.1.4', title: 'S3 general purpose buckets should have block public access settings enabled', securityHubControlId: 'S3.1', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '2.1.1', title: 'S3 general purpose buckets should require requests to use TLS', securityHubControlId: 'S3.5', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '2.1.4', title: 'S3 general purpose buckets should block public access', securityHubControlId: 'S3.8', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '2.1.2', title: 'S3 general purpose buckets should have MFA delete enabled', securityHubControlId: 'S3.20', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '3.7', title: 'S3 general purpose buckets should log object-level write events', securityHubControlId: 'S3.22', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
  { controlId: '3.7', title: 'S3 general purpose buckets should log object-level read events', securityHubControlId: 'S3.23', mappingType: 'DIRECT', framework: 'cis', frameworkVersion: '5.0.0' },
];

export function getCisMappingForSecurityControlId(securityHubControlId: string): FrameworkControlMapping | null {
  return CIS_V5_CONTROL_MAPPINGS.find((m) => m.securityHubControlId === securityHubControlId) ?? null;
}
