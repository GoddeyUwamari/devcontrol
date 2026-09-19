/**
 * SOC 2 Readiness -- sample/demo dataset.
 *
 * Used only when demo mode is active (see useDemoMode() in
 * components/demo/demo-mode-toggle.tsx), composed into useSoc2Readiness() /
 * useSoc2Evidence() / useCustomerEvidenceList() so the demo experience renders
 * through the exact same components/badges the real SOC 2 UI uses.
 *
 * Deliberately typed against the REAL production SOC2 contract
 * (lib/services/soc2.service.ts) -- never a redefined/duplicate shape, and never the
 * legacy FrameworkScanResult/ControlFramework model (compliance-engine.service.ts),
 * which this file must never import.
 *
 * NO composite score, NO overallScore/complianceScore/controlsPassed/controlsFailed/
 * controlsTotal, NO PASS/FAIL status -- those fields do not exist in the real contract
 * and are not added here. Every value below uses only fields the real API actually
 * returns: evidenceSummary is a {supports, contradicts, unknown} count, never a
 * percentage; result is SUPPORTS/CONTRADICTS/UNKNOWN; disposition is A_OBSERVABLE,
 * matching every criterion's real, current configuration
 * (backend/src/config/soc2CriteriaConfig.ts).
 *
 * Mirrors the real service's own per-resource vs. org-level-aggregate discipline for
 * CC6.2/CC6.3/CC7.1 (see soc2-evidence.service.ts's docblock): a per-resource row is
 * only ever CONTRADICTS, and only the org-level aggregate row (resourceArn: null) can
 * be SUPPORTS -- this sample data never fabricates a per-user/per-key/per-SG SUPPORTS
 * claim, for the same reason the real system never does.
 *
 * All ARNs, account IDs, and identities below are synthetic and clearly sample-shaped
 * (never a real AWS account ID) -- they are additionally labeled as sample data at the
 * page level (see the SOC2 detail page's demo disclosure).
 */
import {
  Soc2CustomerEvidence,
  Soc2Observation,
  Soc2ReadinessCriterion,
} from '@/lib/services/soc2.service';

const DEMO_ACCOUNT_ID = '000000000000';
const DEMO_S3_ENCRYPTED_BUCKET = `arn:aws:s3:::sample-corp-app-assets`;
const DEMO_S3_PUBLIC_BUCKET = `arn:aws:s3:::sample-corp-public-reports`;
const DEMO_EC2_INSTANCE = `arn:aws:ec2:us-east-1:${DEMO_ACCOUNT_ID}:instance/i-0sampleinstance01`;
const DEMO_RDS_INSTANCE = `arn:aws:rds:us-east-1:${DEMO_ACCOUNT_ID}:db:sample-prod-db`;
const DEMO_AURORA_CLUSTER = `arn:aws:rds:us-east-1:${DEMO_ACCOUNT_ID}:cluster:sample-aurora-cluster`;
const DEMO_IAM_USER = `arn:aws:iam::${DEMO_ACCOUNT_ID}:user/sample.user`;
const DEMO_IAM_ACCESS_KEY = `${DEMO_IAM_USER}#access-key#AKIASAMPLEDEMOKEY01`;
const DEMO_SECURITY_GROUP = `arn:aws:ec2:us-east-1:${DEMO_ACCOUNT_ID}:security-group/sg-0sampleopen01`;

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

function observation(overrides: Omit<Soc2Observation, 'provenance' | 'collectedAt' | 'schemaVersion'>): Soc2Observation {
  return {
    provenance: 'OBSERVED',
    collectedAt: hoursAgo(1).toISOString(),
    schemaVersion: 1,
    ...overrides,
  };
}

// ---- CC6.1 — Encryption at rest ------------------------------------------
export const DEMO_SOC2_CC6_1_OBSERVATIONS: Soc2Observation[] = [
  observation({
    criterionId: 'CC6.1',
    resourceArn: DEMO_S3_ENCRYPTED_BUCKET,
    resourceType: 's3',
    result: 'SUPPORTS',
    observedAt: hoursAgo(1).toISOString(),
    source: { source_type: 'aws_resource_field', field: 'is_encrypted', resource_type: 's3' },
    explanation: 'Sample data: AWS discovery reported is_encrypted=true for this s3 resource.',
  }),
  observation({
    criterionId: 'CC6.1',
    resourceArn: DEMO_EC2_INSTANCE,
    resourceType: 'ec2',
    result: 'SUPPORTS',
    observedAt: hoursAgo(1).toISOString(),
    source: { source_type: 'aws_resource_field', field: 'is_encrypted', resource_type: 'ec2' },
    explanation: 'Sample data: AWS discovery reported is_encrypted=true for this ec2 resource.',
  }),
  observation({
    criterionId: 'CC6.1',
    resourceArn: DEMO_RDS_INSTANCE,
    resourceType: 'rds',
    result: 'CONTRADICTS',
    observedAt: hoursAgo(1).toISOString(),
    source: { source_type: 'aws_resource_field', field: 'is_encrypted', resource_type: 'rds' },
    explanation: 'Sample data: AWS discovery reported is_encrypted=false for this rds resource.',
  }),
  observation({
    criterionId: 'CC6.1',
    resourceArn: DEMO_AURORA_CLUSTER,
    resourceType: 'aurora',
    result: 'UNKNOWN',
    observedAt: null,
    source: { source_type: 'aws_resource_field', field: 'is_encrypted', resource_type: 'aurora' },
    explanation: 'Sample data: aurora resources are discovered via the generic inventory path, which does not populate real encryption evidence for this field.',
  }),
];

// ---- CC6.6 — Public network exposure --------------------------------------
export const DEMO_SOC2_CC6_6_OBSERVATIONS: Soc2Observation[] = [
  observation({
    criterionId: 'CC6.6',
    resourceArn: DEMO_EC2_INSTANCE,
    resourceType: 'ec2',
    result: 'SUPPORTS',
    observedAt: hoursAgo(1).toISOString(),
    source: { source_type: 'aws_resource_field', field: 'is_public', resource_type: 'ec2' },
    explanation: 'Sample data: AWS discovery reported is_public=false for this ec2 resource.',
  }),
  observation({
    criterionId: 'CC6.6',
    resourceArn: DEMO_RDS_INSTANCE,
    resourceType: 'rds',
    result: 'SUPPORTS',
    observedAt: hoursAgo(1).toISOString(),
    source: { source_type: 'aws_resource_field', field: 'is_public', resource_type: 'rds' },
    explanation: 'Sample data: AWS discovery reported is_public=false for this rds resource.',
  }),
  observation({
    criterionId: 'CC6.6',
    resourceArn: DEMO_S3_PUBLIC_BUCKET,
    resourceType: 's3',
    result: 'CONTRADICTS',
    observedAt: hoursAgo(2).toISOString(),
    source: { source_type: 'compliance_issue', issue_text: 'S3 bucket ACL allows public read access', resource_type: 's3' },
    explanation: 'Sample data: checkS3PublicAccessEnhanced() recorded: "S3 bucket ACL allows public read access".',
  }),
];

// ---- CC6.2 — IAM console-user MFA ------------------------------------------
export const DEMO_SOC2_CC6_2_OBSERVATIONS: Soc2Observation[] = [
  observation({
    criterionId: 'CC6.2',
    resourceArn: DEMO_IAM_USER,
    resourceType: 'iam_user',
    result: 'CONTRADICTS',
    observedAt: hoursAgo(3).toISOString(),
    source: { source_type: 'account_security_finding', finding_key: 'demo-mfa-not-enabled', resource_identifier: DEMO_IAM_USER, category: 'iam' },
    explanation: 'Sample data: an active account-level finding exists (mfa_not_enabled).',
  }),
  observation({
    criterionId: 'CC6.2',
    resourceArn: null,
    resourceType: 'organization',
    result: 'CONTRADICTS',
    observedAt: hoursAgo(3).toISOString(),
    source: { source_type: 'account_security_finding_aggregate', category: 'iam', finding_type: 'mfa_not_enabled', active_count: 1 },
    explanation: 'Sample data: 1 active finding(s) of this type exist for the organization.',
  }),
];

// ---- CC6.3 — IAM access-key age --------------------------------------------
export const DEMO_SOC2_CC6_3_OBSERVATIONS: Soc2Observation[] = [
  observation({
    criterionId: 'CC6.3',
    resourceArn: DEMO_IAM_ACCESS_KEY,
    resourceType: 'iam_access_key',
    result: 'CONTRADICTS',
    observedAt: hoursAgo(3).toISOString(),
    source: { source_type: 'account_security_finding', finding_key: 'demo-access-key-stale', resource_identifier: DEMO_IAM_USER, category: 'iam' },
    explanation: 'Sample data: an active account-level finding exists (access_key_stale).',
  }),
  observation({
    criterionId: 'CC6.3',
    resourceArn: null,
    resourceType: 'organization',
    result: 'CONTRADICTS',
    observedAt: hoursAgo(3).toISOString(),
    source: { source_type: 'account_security_finding_aggregate', category: 'iam', finding_type: 'access_key_stale', active_count: 1 },
    explanation: 'Sample data: 1 active finding(s) of this type exist for the organization.',
  }),
];

// ---- CC9.1 — AWS Backup recovery-point presence ----------------------------
export const DEMO_SOC2_CC9_1_OBSERVATIONS: Soc2Observation[] = [
  observation({
    criterionId: 'CC9.1',
    resourceArn: DEMO_EC2_INSTANCE,
    resourceType: 'ec2',
    result: 'SUPPORTS',
    observedAt: hoursAgo(1).toISOString(),
    source: { source_type: 'aws_resource_field', field: 'has_backup', resource_type: 'ec2' },
    explanation: 'Sample data: AWS Backup recovery-point evidence reported has_backup=true for this ec2 resource.',
  }),
  observation({
    criterionId: 'CC9.1',
    resourceArn: DEMO_RDS_INSTANCE,
    resourceType: 'rds',
    result: 'CONTRADICTS',
    observedAt: hoursAgo(1).toISOString(),
    source: { source_type: 'aws_resource_field', field: 'has_backup', resource_type: 'rds' },
    explanation: 'Sample data: AWS Backup recovery-point evidence reported has_backup=false for this rds resource.',
  }),
  observation({
    criterionId: 'CC9.1',
    resourceArn: DEMO_AURORA_CLUSTER,
    resourceType: 'aurora',
    result: 'UNKNOWN',
    observedAt: null,
    source: { source_type: 'aws_resource_field', field: 'has_backup', resource_type: 'aurora' },
    explanation: 'Sample data: aurora resources are discovered via the generic inventory path, which does not populate real AWS Backup evidence for this field.',
  }),
];

// ---- CC7.1 — Unrestricted security-group ingress ---------------------------
export const DEMO_SOC2_CC7_1_OBSERVATIONS: Soc2Observation[] = [
  observation({
    criterionId: 'CC7.1',
    resourceArn: DEMO_SECURITY_GROUP,
    resourceType: 'security_group',
    result: 'CONTRADICTS',
    observedAt: hoursAgo(2).toISOString(),
    source: { source_type: 'account_security_finding', finding_key: 'demo-unrestricted-ingress', resource_identifier: DEMO_SECURITY_GROUP, category: 'networking' },
    explanation: 'Sample data: an active account-level finding exists (unrestricted_ingress).',
  }),
  observation({
    criterionId: 'CC7.1',
    resourceArn: null,
    resourceType: 'organization',
    result: 'CONTRADICTS',
    observedAt: hoursAgo(2).toISOString(),
    source: { source_type: 'account_security_finding_aggregate', category: 'networking', finding_type: 'unrestricted_ingress', active_count: 1 },
    explanation: 'Sample data: 1 active finding(s) of this type exist for the organization.',
  }),
];

/** All sample AWS-observed evidence, across all six criteria. */
export const DEMO_SOC2_OBSERVATIONS: Soc2Observation[] = [
  ...DEMO_SOC2_CC6_1_OBSERVATIONS,
  ...DEMO_SOC2_CC6_6_OBSERVATIONS,
  ...DEMO_SOC2_CC6_2_OBSERVATIONS,
  ...DEMO_SOC2_CC6_3_OBSERVATIONS,
  ...DEMO_SOC2_CC9_1_OBSERVATIONS,
  ...DEMO_SOC2_CC7_1_OBSERVATIONS,
];

function summaryFor(observations: Soc2Observation[]) {
  return {
    supports: observations.filter((o) => o.result === 'SUPPORTS').length,
    contradicts: observations.filter((o) => o.result === 'CONTRADICTS').length,
    unknown: observations.filter((o) => o.result === 'UNKNOWN').length,
  };
}

/**
 * All six currently-implemented SOC 2 criteria, evaluated, with sample evidence
 * summaries -- no criterion is invented, and none is added or removed relative to
 * backend/src/config/soc2CriteriaConfig.ts's real SOC2_V1_CRITERIA. name/evidenceClaim/
 * limitation text mirrors that real config verbatim (there is no shared frontend import
 * for it, so the display copy is intentionally kept identical here rather than
 * paraphrased).
 */
export const DEMO_SOC2_READINESS: Soc2ReadinessCriterion[] = [
  {
    criterionId: 'CC6.1',
    name: 'Encryption at rest',
    evidenceClaim: 'Encryption at rest is enabled for this resource, as observed by AWS discovery.',
    limitation: 'Does not establish KMS key-policy adequacy, per-object encryption overrides, or that encryption was continuously enabled over any period.',
    dispositionClass: 'A_OBSERVABLE',
    evaluated: true,
    evidenceSummary: summaryFor(DEMO_SOC2_CC6_1_OBSERVATIONS),
    computedAt: hoursAgo(1).toISOString(),
  },
  {
    criterionId: 'CC6.6',
    name: 'Public network exposure',
    evidenceClaim: 'No public network exposure was detected on this resource, as observed by AWS discovery.',
    limitation: 'Absence of a finding is not proof the resource was never public; the S3 policy check is a simple pattern match, not a full IAM policy evaluator.',
    dispositionClass: 'A_OBSERVABLE',
    evaluated: true,
    evidenceSummary: summaryFor(DEMO_SOC2_CC6_6_OBSERVATIONS),
    computedAt: hoursAgo(2).toISOString(),
  },
  {
    criterionId: 'CC6.2',
    name: 'IAM console-user MFA',
    evidenceClaim: 'MFA is enabled for this IAM user’s console-password access.',
    limitation: 'Covers console-password users only -- not SSO/federated access, API-only principals, or overall authentication-control adequacy.',
    dispositionClass: 'A_OBSERVABLE',
    evaluated: true,
    evidenceSummary: summaryFor(DEMO_SOC2_CC6_2_OBSERVATIONS),
    computedAt: hoursAgo(3).toISOString(),
  },
  {
    criterionId: 'CC6.3',
    name: 'IAM access-key age',
    evidenceClaim: 'This IAM access key has not exceeded DevControl’s stale-key age threshold.',
    limitation: 'Age-based signal only -- does not establish least privilege, policy adequacy, privileged-access review, or root-account governance.',
    dispositionClass: 'A_OBSERVABLE',
    evaluated: true,
    evidenceSummary: summaryFor(DEMO_SOC2_CC6_3_OBSERVATIONS),
    computedAt: hoursAgo(3).toISOString(),
  },
  {
    criterionId: 'CC9.1',
    name: 'AWS Backup recovery-point presence',
    evidenceClaim: 'A completed/available AWS Backup recovery point exists for this resource.',
    limitation: 'Backup presence only -- does not establish that recovery was ever tested, or retention/RTO/RPO adequacy.',
    dispositionClass: 'A_OBSERVABLE',
    evaluated: true,
    evidenceSummary: summaryFor(DEMO_SOC2_CC9_1_OBSERVATIONS),
    computedAt: hoursAgo(1).toISOString(),
  },
  {
    criterionId: 'CC7.1',
    name: 'Unrestricted security-group ingress',
    evidenceClaim: 'No unrestricted (0.0.0.0/0 or ::/0) ingress was detected on this security group.',
    limitation: 'A single, narrow network-exposure observation -- not security monitoring, continuous monitoring, detection/response effectiveness, or CC7.1 compliance generally.',
    dispositionClass: 'A_OBSERVABLE',
    evaluated: true,
    evidenceSummary: summaryFor(DEMO_SOC2_CC7_1_OBSERVATIONS),
    computedAt: hoursAgo(2).toISOString(),
  },
];

/**
 * Sample customer-provided evidence -- always SELF_ATTESTED (the only provenance a
 * customer can ever submit, matching the real CHECK constraint), using only the
 * already-supported lifecycle vocabulary (SUBMITTED/REVIEWED/EXPIRED/SUPERSEDED).
 * submittedBy is deliberately null (no sample identity is fabricated). Never implies
 * auditor acceptance or independent verification -- REVIEWED here means only what it
 * means in the real product: an internal DevControl review event, not certification.
 */
export const DEMO_SOC2_CUSTOMER_EVIDENCE: Soc2CustomerEvidence[] = [
  {
    evidenceId: 'demo-ce-1',
    criterionId: 'CC6.2',
    evidenceType: 'policy',
    title: 'Sample Access Control Policy',
    description: 'Sample corporate access-control policy document, provided for demonstration purposes.',
    externalReference: 'https://example.com/sample-access-control-policy.pdf',
    provenance: 'SELF_ATTESTED',
    status: 'SUBMITTED',
    submittedBy: null,
    submittedAt: hoursAgo(24).toISOString(),
    reviewDate: null,
    createdAt: hoursAgo(24).toISOString(),
    updatedAt: hoursAgo(24).toISOString(),
  },
  {
    evidenceId: 'demo-ce-2',
    criterionId: 'CC6.1',
    evidenceType: 'training',
    title: 'Sample Security Awareness Training Record',
    description: 'Sample record of completed annual security-awareness training, provided for demonstration purposes.',
    externalReference: null,
    provenance: 'SELF_ATTESTED',
    status: 'REVIEWED',
    submittedBy: null,
    submittedAt: hoursAgo(72).toISOString(),
    reviewDate: hoursAgo(48).toISOString(),
    createdAt: hoursAgo(72).toISOString(),
    updatedAt: hoursAgo(48).toISOString(),
  },
];
