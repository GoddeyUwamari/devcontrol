/**
 * The checks each compliance framework runs against a resource, and the wording
 * of the finding a failed check produces.
 *
 * A check only describes one resource: it makes no AWS call and reads nothing
 * but the row it is given. Whether a framework is evaluated at all is decided
 * by its applicability (utils/frameworkApplicability.ts), not here.
 *
 * Adding a check or a framework is an entry in this file. Nothing in the
 * database enumerates framework keys, check keys or resource types.
 */
import {
  AWSResource,
  ComplianceIssue,
  ComplianceIssueProvenance,
  ComplianceSeverity,
  FindingEvidenceBasis,
} from '../types/aws-resources.types';
import { EvaluationReasonCode } from '../utils/frameworkApplicability';

/** Bumped when a check's logic changes, so a stored outcome can be told apart from one the new logic would give. */
export const FRAMEWORK_EVALUATOR_VERSION = '1';

/** What one framework check found for one resource. Only 'failed' has a severity. */
export type FrameworkCheckOutcome =
  | {
      state: 'failed';
      severity: ComplianceSeverity;
      evidence_basis: Exclude<FindingEvidenceBasis, 'tag' | 'none'>;
      provenance: ComplianceIssueProvenance;
      reason_code: EvaluationReasonCode;
    }
  | {
      state: 'passed';
      evidence_basis: Exclude<FindingEvidenceBasis, 'tag' | 'none'>;
      provenance: ComplianceIssueProvenance;
      reason_code: EvaluationReasonCode;
    }
  | {
      state: 'unable_to_evaluate' | 'not_evaluated';
      evidence_basis: FindingEvidenceBasis;
      provenance: ComplianceIssueProvenance | null;
      reason_code: EvaluationReasonCode;
    };

export interface FrameworkCheck {
  /** Stable key: the finding's findingKey and the stored evaluation's check_key. */
  key: string;
  /** The resource types the check applies to. For any other type it is not applicable. */
  resourceTypes: readonly string[];
  evaluate(resource: AWSResource): FrameworkCheckOutcome;
  /**
   * The finding a failure of this check is reported as. Separate from evaluate()
   * so the finding can be written from a stored 'failed' outcome alone. Required
   * on every check that can fail.
   */
  finding?(resource: Pick<AWSResource, 'resource_type'>): Pick<ComplianceIssue, 'category' | 'issue' | 'recommendation'>;
}

export function checkAppliesTo(check: FrameworkCheck, resourceType: string): boolean {
  return check.resourceTypes.includes(resourceType);
}

/**
 * A control whose only available signal is a resource tag. A tag is the customer's
 * own statement, and its absence says nothing about the resource's configuration,
 * so neither is evidence: the control can be neither passed nor failed on it.
 */
function tagOnlyOutcome(resource: AWSResource, tags: string[]): FrameworkCheckOutcome {
  const documented = tags.some((tag) => resource.tags?.[tag]);
  return documented
    ? { state: 'unable_to_evaluate', evidence_basis: 'tag', provenance: 'SELF_ATTESTED', reason_code: 'tag_only_evidence' }
    : { state: 'unable_to_evaluate', evidence_basis: 'none', provenance: null, reason_code: 'no_evidence_collected' };
}

/**
 * HIPAA checks. They run only for an organization that has explicitly enabled the
 * framework.
 *
 * Only automated backups for EBS rest on an AWS observation (has_backup, from the
 * AWS Backup lookup), so it is the only check that can pass or fail. The others
 * have nothing but tags to go on and report unable_to_evaluate until discovery
 * collects the real configuration.
 */
export const HIPAA_CHECKS: readonly FrameworkCheck[] = [
  {
    // The "not encrypted at all" case belongs to the baseline encryption check, which
    // already reports it for these types; repeating it here would count one problem twice.
    key: 'hipaa.customer_managed_key',
    resourceTypes: ['s3', 'rds', 'ebs', 'ec2'],
    evaluate: (resource) => {
      if (resource.is_encrypted === false) {
        return { state: 'not_evaluated', evidence_basis: 'aws_api', provenance: 'OBSERVED', reason_code: 'covered_by_baseline_encryption_check' };
      }
      if (resource.is_encrypted === null || resource.is_encrypted === undefined) {
        return { state: 'unable_to_evaluate', evidence_basis: 'none', provenance: null, reason_code: 'encryption_state_unknown' };
      }
      return tagOnlyOutcome(resource, ['KMSKey', 'EncryptionKey']);
    },
  },
  {
    // S3 is not checked here: its HTTPS-only enforcement is a baseline check
    // evaluated from the bucket policy (evaluateS3Security).
    key: 'hipaa.encryption_in_transit',
    resourceTypes: ['rds', 'elasticache'],
    evaluate: (resource) => tagOnlyOutcome(resource, ['SSLEnabled', 'TLSEnabled', 'EncryptionInTransit']),
  },
  {
    key: 'hipaa.access_logging',
    resourceTypes: ['s3', 'rds', 'lambda', 'ec2'],
    evaluate: (resource) => tagOnlyOutcome(resource, ['AccessLogging', 'AuditLogging', 'CloudTrailEnabled']),
  },
  {
    // The baseline backup check covers a missing backup for rds/ec2, so this applies
    // to ebs only: the one type it does not cover.
    key: 'hipaa.automated_backups',
    resourceTypes: ['ebs'],
    evaluate: (resource) => {
      // Security Truthfulness #41: verified false only, never null.
      if (resource.has_backup === false) {
        return { state: 'failed', severity: 'critical', evidence_basis: 'aws_api', provenance: 'OBSERVED', reason_code: 'no_backup_reported' };
      }
      if (resource.has_backup === true) {
        return { state: 'passed', evidence_basis: 'aws_api', provenance: 'OBSERVED', reason_code: 'backup_reported' };
      }
      return { state: 'unable_to_evaluate', evidence_basis: 'none', provenance: null, reason_code: 'backup_state_unknown' };
    },
    finding: (resource) => ({
      category: 'backups',
      issue: `HIPAA: ${resource.resource_type.toUpperCase()} storing PHI must have automated backups`,
      recommendation: 'Enable automated backups with minimum 30-day retention. Test backup restoration quarterly. Document backup procedures.',
    }),
  },
  {
    key: 'hipaa.backup_retention_policy',
    resourceTypes: ['rds', 'ec2', 'ebs', 's3'],
    evaluate: (resource) => tagOnlyOutcome(resource, ['BackupRetention', 'BackupPolicy']),
  },
  {
    key: 'hipaa.s3_versioning',
    resourceTypes: ['s3'],
    evaluate: (resource) => tagOnlyOutcome(resource, ['VersioningEnabled']),
  },
];

/**
 * SOC 2 checks. They run only for an organization that has explicitly enabled the
 * framework.
 *
 * Both have nothing but a tag to go on -- neither reads the IAM role attached to
 * the resource nor its monitoring or logging configuration -- so both report
 * unable_to_evaluate, and neither can pass or fail, until discovery collects the
 * real configuration. They used to run for every organization and report a missing
 * tag as a High finding.
 *
 * SOC 2 evidence that does rest on AWS observations (encryption, public access,
 * backups, security groups, IAM) is evaluated by Soc2EvidenceService from the
 * baseline checks' results, not here.
 */
export const SOC2_CHECKS: readonly FrameworkCheck[] = [
  {
    key: 'soc2.iam_role_documented',
    resourceTypes: ['ec2', 'lambda', 'ecs'],
    evaluate: (resource) => tagOnlyOutcome(resource, ['IAMRole', 'Role']),
  },
  {
    key: 'soc2.monitoring_logging_documented',
    resourceTypes: ['ec2', 'rds', 'lambda', 's3'],
    evaluate: (resource) => tagOnlyOutcome(resource, ['MonitoringEnabled', 'LoggingEnabled', 'CloudWatchAlarms']),
  },
];

/** The checks each framework runs, by framework key (REGISTERED_FRAMEWORKS names the same keys). */
export const FRAMEWORK_CHECKS: Readonly<Record<string, readonly FrameworkCheck[]>> = {
  HIPAA: HIPAA_CHECKS,
  SOC2: SOC2_CHECKS,
};
