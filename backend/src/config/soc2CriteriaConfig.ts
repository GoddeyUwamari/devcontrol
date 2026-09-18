/**
 * SOC 2 Readiness v1 criteria configuration -- versioned in code, not editable via the
 * database, mirroring the same choice already made for Security Hub's CIS/PCI/NIST
 * control mappings (securityHubCisMapping.ts / securityHubPciMapping.ts /
 * securityHubNistMapping.ts).
 *
 * SOC 2 is deliberately NOT implemented as an AWS Security Hub framework -- see
 * securityHubCisMapping.ts's own docblock ("does not implement PCI DSS, NIST 800-53
 * Rev. 5, or SOC 2"). This config is independent of, and does not import from, any
 * Security Hub mapping file.
 *
 * Every criterion below is A_OBSERVABLE: DevControl can directly establish the
 * condition from already-collected AWS evidence, with no customer input required. No
 * B/C/D/E-class criterion is configured in Phase 1 -- adding one is a future decision,
 * not implied by this file's shape.
 *
 * CC7.1 is deliberately scoped to a single narrow technical fact (unrestricted
 * security-group ingress) and must never be described, in this config or any consumer
 * of it, as "security monitoring", "continuous monitoring", "detection effectiveness",
 * "incident detection", or CC7.1 compliance generally -- the real CC7.1 criterion is
 * much broader than what DevControl can actually observe.
 */
import { Soc2DispositionClass } from '../types/soc2-evidence.types';

export const SOC2_CRITERIA_CONFIG_VERSION = 1;

export interface Soc2CriterionConfig {
  criterionId: string;
  name: string;
  /** AWSResource.resource_type values (or 'iam_user' / 'iam_access_key' / 'security_group'
   * for account-level evidence) this criterion evaluates. */
  scope: string[];
  dispositionClass: Soc2DispositionClass;
  /** The exact, limited claim DevControl can truthfully make -- shown verbatim in any
   * future UI/API surface. Must never be broadened without updating this string. */
  evidenceClaim: string;
  /** What this criterion's evidence explicitly does NOT establish -- shown verbatim
   * alongside evidenceClaim in any future UI/API surface. */
  limitation: string;
}

export const SOC2_V1_CRITERIA: readonly Soc2CriterionConfig[] = [
  {
    criterionId: 'CC6.1',
    name: 'Encryption at rest',
    scope: ['ec2', 'ebs', 'rds', 'aurora', 's3'],
    dispositionClass: 'A_OBSERVABLE',
    evidenceClaim: 'Encryption at rest is enabled for this resource, as observed by AWS discovery.',
    limitation: 'Does not establish KMS key-policy adequacy, per-object encryption overrides, or that encryption was continuously enabled over any period.',
  },
  {
    criterionId: 'CC6.6',
    name: 'Public network exposure',
    scope: ['ec2', 'rds', 'aurora', 's3'],
    dispositionClass: 'A_OBSERVABLE',
    evidenceClaim: 'No public network exposure was detected on this resource, as observed by AWS discovery.',
    limitation: 'Absence of a finding is not proof the resource was never public; the S3 policy check is a simple pattern match, not a full IAM policy evaluator.',
  },
  {
    criterionId: 'CC6.2',
    name: 'IAM console-user MFA',
    scope: ['iam_user'],
    dispositionClass: 'A_OBSERVABLE',
    evidenceClaim: 'MFA is enabled for this IAM user’s console-password access.',
    limitation: 'Covers console-password users only -- not SSO/federated access, API-only principals, or overall authentication-control adequacy.',
  },
  {
    criterionId: 'CC6.3',
    name: 'IAM access-key age',
    scope: ['iam_access_key'],
    dispositionClass: 'A_OBSERVABLE',
    evidenceClaim: 'This IAM access key has not exceeded DevControl’s stale-key age threshold.',
    limitation: 'Age-based signal only -- does not establish least privilege, policy adequacy, privileged-access review, or root-account governance.',
  },
  {
    criterionId: 'CC9.1',
    name: 'AWS Backup recovery-point presence',
    scope: ['ec2', 'rds', 'aurora'],
    dispositionClass: 'A_OBSERVABLE',
    evidenceClaim: 'A completed/available AWS Backup recovery point exists for this resource.',
    limitation: 'Backup presence only -- does not establish that recovery was ever tested, or retention/RTO/RPO adequacy.',
  },
  {
    criterionId: 'CC7.1',
    name: 'Unrestricted security-group ingress',
    scope: ['security_group'],
    dispositionClass: 'A_OBSERVABLE',
    evidenceClaim: 'No unrestricted (0.0.0.0/0 or ::/0) ingress was detected on this security group.',
    limitation: 'A single, narrow network-exposure observation -- not security monitoring, continuous monitoring, detection/response effectiveness, or CC7.1 compliance generally.',
  },
] as const;

export function getSoc2CriterionConfig(criterionId: string): Soc2CriterionConfig | undefined {
  return SOC2_V1_CRITERIA.find((c) => c.criterionId === criterionId);
}
