/**
 * Authoritative, versioned Security Hub -> NIST SP 800-53 Revision 5 mapping. Modeled on
 * securityHubPciMapping.ts's many-to-many shape, NOT securityHubCisMapping.ts's 1:1
 * shape -- see that CIS file's own comment (line 55), which already predicted this:
 * "unlike PCI/NIST/SOC2, where most Security Hub controls only partially establish the
 * framework's requirement (ADDITIONAL_EVIDENCE) and would need per-control review before
 * being implemented in a future phase." Each entry here represents exactly one (Security
 * Hub control, NIST control) PAIR, not one entry per Security Hub control.
 *
 * STANDARD IDENTITY -- read this before changing the ARN suffix.
 * Standard: NIST SP 800-53 Revision 5. Version: 5.0.0. StandardsId: nist-800-53/v/5.0.0.
 * Confirmed from official AWS Security Hub documentation (docs.aws.amazon.com/securityhub/
 * latest/userguide/standards-reference.html, which lists "NIST SP 800-53 Revision 5" as a
 * currently-supported standard, and .../asff-top-level-attributes.html, whose own
 * `Compliance.AssociatedStandards` example includes the literal string
 * "standards/nist-800-53/v/5.0.0"). Live, read-only `securityhub describe-standards`
 * verification -- the same empirical check that confirmed the CIS and PCI ARNs in the
 * sibling files below -- was attempted against us-east-1 and eu-west-1 using the only
 * credential available in this environment (arn:aws:iam::815931739526:user/terraform-deploy)
 * and returned a genuine AccessDeniedException for securityhub:DescribeStandards in both
 * regions (an IAM permission gap on that specific credential, not a "standard doesn't
 * exist" or "not subscribed" response -- see backend/src/services/security-hub-client.service.ts's
 * classifyError() for why those are distinguishable). No IAM change, role-assumption
 * workaround, or Security Hub enablement was performed to resolve this. This ARN is
 * therefore DOCUMENTATION-CONFIRMED, not live-API-verified, and should be re-verified via
 * DescribeStandards with an authorized credential before this is treated as equivalent in
 * rigor to the CIS/PCI ARNs.
 *
 * NIST 800-53 Rev. 5 ONLY -- AWS Security Hub also offers a separate "NIST SP 800-171
 * Revision 2" standard (a different framework, for Controlled Unclassified Information);
 * that standard is out of scope here and is deliberately absent from this file, even
 * where a control's AWS-documented "Related requirements" line also lists a
 * NIST.800-171.r2 entry alongside the NIST.800-53.r5 one used here.
 *
 * Every entry below is individually verified against AWS's own current Security Hub
 * control documentation (docs.aws.amazon.com/securityhub/latest/userguide/, each
 * control's own "Related requirements" section, fetched at the time this was written --
 * not scraped/parsed at runtime, and never inferred from a control's name alone, and
 * never inferred merely because a security_hub_findings.related_requirements value
 * happened to contain a NIST.800-53.r5 string -- that column remains provenance-only,
 * see security-hub-foundation.types.ts). AWS's own NIST 800-53 standard page
 * (standards-reference-nist-800-53.md) documents ~297 Security Hub controls as relevant
 * to this standard in total; this file deliberately covers only a small, individually
 * verified v1 subset (<=30 entries, see the product's "do not fabricate coverage"
 * principle already established by the PCI removal in commit 67dbc6b). A NIST control
 * absent from this file is NOT claimed to be established by DevControl -- it is simply
 * outside this file's currently-verified scope. Widening this set is a real follow-up,
 * not a one-line addition: each new entry needs the same individual verification this
 * batch received.
 *
 * CONTROL ID FORMAT: `nistControlId` uses NIST SP 800-53's own bare control identifier
 * (e.g. "SC-7", "IA-2(2)") -- NOT AWS ASFF's "NIST.800-53.r5 SC-7" RelatedRequirements
 * string format, which is a display/provenance convention specific to Security Hub
 * findings, not the identifier NIST's own catalog uses.
 *
 * WHERE A SECURITY HUB CONTROL LISTS MULTIPLE NIST CONTROLS: AWS's own "Related
 * requirements" field typically lists many NIST 800-53 controls per Security Hub
 * control (sometimes a dozen or more) -- this file does not enumerate every one of
 * them per entry. Each entry below cites the single NIST control judged the clearest,
 * most specific technical match for what the Security Hub control actually checks,
 * chosen from AWS's own documented set (never a NIST control AWS did not itself list
 * for that Security Hub control). This keeps the mapping bounded and each row
 * individually meaningful rather than mechanically maximized.
 */

export const NIST_800_53_FRAMEWORK = 'nist' as const;
export const NIST_800_53_VERSION = '5.0.0' as const;

export function nistStandardsArnForRegion(region: string): string {
  return `arn:aws:securityhub:${region}::standards/nist-800-53/v/5.0.0`;
}

export type FrameworkMappingType = 'DIRECT' | 'ADDITIONAL_EVIDENCE';

export interface NistControlMapping {
  framework: typeof NIST_800_53_FRAMEWORK;
  frameworkVersion: typeof NIST_800_53_VERSION;
  /** NIST SP 800-53 Rev. 5's own control identifier, e.g. "SC-7". This is the join key
   *  exposed to the UI/API as `controlId` -- NOT the Security Hub control ID. */
  nistControlId: string;
  /** Short, DevControl-authored description of what the NIST control is about -- not
   *  NIST's own (copyrighted) control text, just enough context for the UI to explain
   *  the row without the user opening the SP 800-53 publication. */
  title: string;
  /** Security Hub's short control identifier, e.g. "IAM.5". Join key against
   *  SecurityHubFindingEvidence.securityControlId -- identical role to CIS's and PCI's
   *  mapping files. */
  securityHubControlId: string;
  /**
   * DIRECT: the Security Hub technical check is a clear, specific technical match for
   * this NIST control, within the scope of AWS-technical evidence DevControl currently
   * evaluates -- not a claim that the full NIST control (which is often organizational/
   * procedural as well as technical) is satisfied end-to-end.
   * ADDITIONAL_EVIDENCE: the Security Hub check is real, meaningful supporting evidence
   * for the NIST control, but is narrower/more indirect than the control's core intent
   * (e.g. one specific hardening mechanism among several the control could be satisfied
   * by).
   */
  mappingType: FrameworkMappingType;
  /** Which AWS documentation page (and its "Related requirements" field) justifies this
   *  entry, plus a one-line note on why the chosen NIST control is the closest technical
   *  match among the several AWS itself lists for this Security Hub control. */
  citation: string;
}

/**
 * 24 individually-verified (Security Hub control, NIST 800-53 Rev. 5 control) pairs, as
 * of the focused post-implementation review documented below. The original submission
 * had 28; 4 were removed and 2 were downgraded from DIRECT to ADDITIONAL_EVIDENCE after
 * a rigorous, control-by-control re-read of the actual NIST SP 800-53 Rev. 5 control
 * text (not just AWS's RelatedRequirements citation, which is necessary but not
 * sufficient evidence -- see the review notes below). Two entries were also re-pointed
 * to a more textually precise NIST control still within AWS's own documented set for
 * that Security Hub control (RDS.5/RDS.15: CP-10 -> SC-36; EC2.8: AC-6 -> AC-3).
 *
 * REMOVED (classification C -- not defensible; RelatedRequirements alone is not proof):
 * - Account.1 -> CM-2: "has security contact info on file" does not establish "a
 *   documented baseline configuration of the system is maintained" (CM-2 is about
 *   system/component configuration baselines, not account contact metadata). AWS's own
 *   listed set for this control (CM-2, CM-2(2) only) offered no better alternative.
 * - IAM.3 -> AC-2(3): "access keys rotated every 90 days" does not establish "accounts
 *   are disabled under specified conditions" (AC-2(3) is about account disablement on
 *   inactivity/expiration, a different account-lifecycle action than key rotation).
 *   AC-2(1) (Automated System Account Management) was considered and also rejected --
 *   it's about automated tooling for account lifecycle generally, not rotation cadence
 *   specifically. No confident match existed in AWS's listed set.
 * - IAM.2 -> AC-6: "uses IAM groups instead of directly-attached policies" evidences
 *   administrative/manageability practice, not the actual privilege level granted --
 *   a grouped user can have MORE privilege than a directly-attached one. Does not
 *   establish least privilege.
 * - S3.20 -> CM-3: "S3 bucket has MFA delete enabled" is a narrow technical
 *   authentication gate on one destructive action, not evidence of a formal
 *   configuration change review/approval process (CM-3's actual subject matter). No
 *   stronger alternative existed in AWS's listed set for this control (CA-9(1), CM-2,
 *   CM-2(2), CM-3, SC-5(2) were all considered and rejected).
 *
 * DOWNGRADED DIRECT -> ADDITIONAL_EVIDENCE (classification B, kept, not removed):
 * - EC2.7 -> SC-28: unlike the other four SC-28 entries (which check the ACTUAL
 *   encryption state of existing resources), EC2.7 only checks an account-level DEFAULT
 *   setting for NEW EBS volumes -- it says nothing about whether existing volumes are
 *   encrypted. Real, meaningful evidence, but narrower than what the other SC-28
 *   entries establish.
 * - IAM.4 -> AC-6: removing root's access key does not reduce root's privilege level
 *   (root remains maximally privileged) -- it reduces standing-credential exposure for
 *   the most powerful identity. Real risk-reduction evidence, but doesn't itself
 *   establish that access is minimized to necessary levels the way IAM.2 was
 *   (incorrectly) claimed to.
 *
 * RE-POINTED to a more precise NIST control (still AWS-documented for that control):
 * - RDS.5, RDS.15 -> SC-36 (was CP-10): CP-10 "System Recovery and Reconstitution" is
 *   about organizational recovery process after a disruption/compromise; SC-36
 *   "Distributed Processing and Storage" ("distribute processing and storage across
 *   multiple physical locations") is a textually precise match for what Multi-AZ
 *   literally does. Both were in AWS's own RelatedRequirements list for these controls;
 *   SC-36 is the better one.
 * - EC2.8 -> AC-3 (was AC-6): IMDSv2 enforces token-based authorization to a specific
 *   local resource (the instance metadata service) -- AC-3 "Access Enforcement" is a
 *   closer match than AC-6 "Least Privilege" (IMDSv2 doesn't change what privileges the
 *   instance's role has, it changes how the metadata endpoint is accessed). AC-3 was
 *   already in AWS's own listed set for EC2.8. Kept as ADDITIONAL_EVIDENCE since this is
 *   still a narrow mechanism relative to AC-3's full breadth.
 *
 * Selection strategy for what remains: started from Security Hub controls DevControl
 * already deeply understands via its existing CIS AWS Foundations Benchmark v5.0.0
 * and/or PCI DSS v4.0.1 mappings (see securityHubCisMapping.ts / securityHubPciMapping.ts)
 * -- but every NIST relationship was independently verified against that control's own
 * AWS documentation page AND against the actual NIST SP 800-53 Rev. 5 control text; a
 * control's presence in the CIS or PCI mapping, or in AWS's RelatedRequirements list
 * alone, was never treated as itself establishing a NIST mapping.
 */
export const NIST_800_53_CONTROL_MAPPINGS: NistControlMapping[] = [
  // Audit logging (AU-12: Audit Record Generation) -- CloudTrail and VPC Flow Logs are
  // independent, legitimately many-to-one technical sources for the same NIST control.
  { nistControlId: 'AU-12', title: 'Audit record generation -- multi-Region CloudTrail management-event logging', securityHubControlId: 'CloudTrail.1', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/cloudtrail-controls.html#cloudtrail-1 -- Related requirements includes "NIST.800-53.r5 AU-12" among AU-2/AU-3/AU-6 variants; AU-12 (Audit Record Generation) is the clearest match for "generates a record of API activity".' },
  { nistControlId: 'AU-12', title: 'Audit record generation -- VPC flow logging enabled', securityHubControlId: 'EC2.6', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/ec2-controls.html#ec2-6 -- Related requirements includes "NIST.800-53.r5 AU-12" among AU-2/AU-3/AU-6 variants; same rationale as CloudTrail.1, independent evidence source (network-layer vs. API-call-layer logging).' },

  // Audit information protection (AU-9)
  { nistControlId: 'AU-9', title: 'Protection of audit information -- CloudTrail log file validation', securityHubControlId: 'CloudTrail.4', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/cloudtrail-controls.html#cloudtrail-4 -- Related requirements: "...NIST.800-53.r5 AU-9, NIST.800-53.r5 SI-4...". AU-9 (Protection of Audit Information) is the direct match for tamper-evidence/integrity validation of log files.' },

  // Encryption at rest (SC-28) -- independent technical enforcement points for the same
  // NIST control, all AWS-documented as such; legitimately many-to-one, mirroring PCI's
  // own precedent (e.g. IAM.6/IAM.9/IAM.19 all independently supporting 8.4.2). EC2.7 was
  // downgraded to ADDITIONAL_EVIDENCE on review (see file-level docblock) and moved to
  // that section below -- it checks a default SETTING, not actual resource state, unlike
  // these four.
  { nistControlId: 'SC-28', title: 'Protection of information at rest -- CloudTrail log encryption', securityHubControlId: 'CloudTrail.2', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/cloudtrail-controls.html#cloudtrail-2 -- Related requirements: "...NIST.800-53.r5 SC-28, NIST.800-53.r5 SC-28(1)...". SC-28 (base control) is the canonical "protection of information at rest" match.' },
  { nistControlId: 'SC-28', title: 'Protection of information at rest -- EFS encryption at rest', securityHubControlId: 'EFS.1', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/efs-controls.html#efs-1 -- Related requirements: "...NIST.800-53.r5 SC-28, NIST.800-53.r5 SC-28(1)...". Same rationale as CloudTrail.2. This control checks the actual per-file-system Encrypted attribute, not a default setting.' },
  { nistControlId: 'SC-28', title: 'Protection of information at rest -- RDS encryption at rest', securityHubControlId: 'RDS.3', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/rds-controls.html#rds-3 -- Related requirements: "...NIST.800-53.r5 SC-28, NIST.800-53.r5 SC-28(1)...". Same rationale as CloudTrail.2. This control checks the actual per-instance StorageEncrypted attribute, not a default setting.' },
  { nistControlId: 'SC-28', title: 'Protection of information at rest -- S3 default KMS encryption', securityHubControlId: 'S3.17', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/s3-controls.html#s3-17 -- Related requirements: "...NIST.800-53.r5 SC-28, NIST.800-53.r5 SC-28(1)...". Same rationale as CloudTrail.2. This control checks the actual per-bucket encryption configuration, not a default setting.' },

  // Boundary protection (SC-7) -- public-access-blocking controls across services,
  // legitimately many-to-one for the same reason as SC-28 above.
  { nistControlId: 'SC-7', title: 'Boundary protection -- default security group denies all traffic', securityHubControlId: 'EC2.2', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/ec2-controls.html#ec2-2 -- Related requirements: "...NIST.800-53.r5 SC-7, NIST.800-53.r5 SC-7(4/5/11/16/21)...". SC-7 (base control, Boundary Protection) chosen as the clearest match.' },
  { nistControlId: 'SC-7', title: 'Boundary protection -- network ACLs block SSH/RDP from the internet', securityHubControlId: 'EC2.21', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/ec2-controls.html#ec2-21 -- Related requirements: "...NIST.800-53.r5 SC-7, NIST.800-53.r5 SC-7(5/21)...". Same rationale as EC2.2.' },
  { nistControlId: 'SC-7', title: 'Boundary protection -- RDS instances not publicly accessible', securityHubControlId: 'RDS.2', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/rds-controls.html#rds-2 -- Related requirements: "...NIST.800-53.r5 SC-7, NIST.800-53.r5 SC-7(4/5/11/16/21)...". Same rationale as EC2.2.' },
  { nistControlId: 'SC-7', title: 'Boundary protection -- S3 account-level block public access', securityHubControlId: 'S3.1', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/s3-controls.html#s3-1 -- Related requirements: "...NIST.800-53.r5 SC-7, NIST.800-53.r5 SC-7(3/4/9/11/16/20/21)...". Same rationale as EC2.2.' },
  { nistControlId: 'SC-7', title: 'Boundary protection -- S3 bucket-level block public access', securityHubControlId: 'S3.8', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/s3-controls.html#s3-8 -- Related requirements: "...NIST.800-53.r5 SC-7, NIST.800-53.r5 SC-7(3/4/9/11/16/20/21)...". Same rationale as EC2.2.' },

  // Identification & authentication -- MFA (IA-2(1) privileged, IA-2(2) non-privileged)
  { nistControlId: 'IA-2(1)', title: 'MFA for privileged accounts -- hardware MFA for the root user', securityHubControlId: 'IAM.6', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/iam-controls.html#iam-6 -- Related requirements: "...NIST.800-53.r5 IA-2(1), NIST.800-53.r5 IA-2(2/6/8)...". IA-2(1) (MFA to privileged accounts) is the direct match; the root user is the most-privileged account in the account.' },
  { nistControlId: 'IA-2(1)', title: 'MFA for privileged accounts -- MFA for the root user', securityHubControlId: 'IAM.9', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/iam-controls.html#iam-9 -- Related requirements: "...NIST.800-53.r5 IA-2(1), NIST.800-53.r5 IA-2(2/6/8)...". Same rationale as IAM.6 (any-factor MFA, not hardware-specific).' },
  { nistControlId: 'IA-2(2)', title: 'MFA for non-privileged accounts -- console-password IAM users', securityHubControlId: 'IAM.5', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/iam-controls.html#iam-5 -- Related requirements: "...NIST.800-53.r5 IA-2(1/2/6/8)...". IA-2(2) (MFA to non-privileged accounts) chosen since this control applies to "all IAM users" with a console password, not specifically privileged ones.' },
  { nistControlId: 'IA-2(2)', title: 'MFA for non-privileged accounts -- all IAM users', securityHubControlId: 'IAM.19', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/iam-controls.html#iam-19 -- Related requirements: "...NIST.800-53.r5 IA-2(1/2/6/8)...". Same rationale as IAM.5, broader scope (all users, not just console-password ones).' },

  // Cryptographic key management (SC-12)
  { nistControlId: 'SC-12', title: 'Cryptographic key establishment and management -- KMS key rotation', securityHubControlId: 'KMS.4', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/kms-controls.html#kms-4 -- Related requirements: "...NIST.800-53.r5 SC-12, NIST.800-53.r5 SC-12(2), NIST.800-53.r5 SC-28(3)...". SC-12 (base control) is the canonical key-management match.' },

  // Transmission confidentiality (SC-8)
  { nistControlId: 'SC-8', title: 'Transmission confidentiality and integrity -- S3 requires TLS', securityHubControlId: 'S3.5', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/s3-controls.html#s3-5 -- Related requirements: "...NIST.800-53.r5 SC-8, NIST.800-53.r5 SC-8(1/2)...". SC-8 (base control) is the canonical "encryption in transit" match.' },

  // Flaw remediation (SI-2)
  { nistControlId: 'SI-2', title: 'Flaw remediation -- RDS automatic minor version upgrades', securityHubControlId: 'RDS.13', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/rds-controls.html#rds-13 -- Related requirements: "...NIST.800-53.r5 SI-2, NIST.800-53.r5 SI-2(2/4/5)...". SI-2 (base control, Flaw Remediation) is the canonical automated-patching match.' },

  // Distributed processing/storage (SC-36) -- Multi-AZ for instances vs. clusters.
  // Re-pointed on review from CP-10 (System Recovery and Reconstitution, about
  // organizational recovery process) to SC-36 (Distributed Processing and Storage,
  // "distribute processing/storage across multiple physical locations") -- a textually
  // precise match for what Multi-AZ literally does. Both were in AWS's own
  // RelatedRequirements list for these controls.
  { nistControlId: 'SC-36', title: 'Distributed processing and storage -- Multi-AZ RDS instances', securityHubControlId: 'RDS.5', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/rds-controls.html#rds-5 -- Related requirements: "...NIST.800-53.r5 CP-10, NIST.800-53.r5 CP-6(2), NIST.800-53.r5 SC-36...". SC-36 (Distributed Processing and Storage) chosen over CP-10 on review: Multi-AZ literally distributes DB storage/processing across multiple physical Availability Zones, which is SC-36\'s specific subject matter; CP-10 is about broader organizational recovery process.' },
  { nistControlId: 'SC-36', title: 'Distributed processing and storage -- Multi-AZ RDS clusters', securityHubControlId: 'RDS.15', mappingType: 'DIRECT', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/rds-controls.html#rds-15 -- Related requirements: "...NIST.800-53.r5 CP-10, NIST.800-53.r5 CP-6(2), NIST.800-53.r5 SC-36...". Same rationale as RDS.5, cluster resource type.' },

  // ADDITIONAL_EVIDENCE entries: real, AWS-documented technical evidence, but each is a
  // narrower/more indirect mechanism than the NIST control's full intent -- see
  // securityHubPciMapping.ts's own docblock for the same DIRECT/ADDITIONAL_EVIDENCE
  // distinction principle. EC2.7 and IAM.4 were downgraded here from DIRECT on review
  // (see file-level docblock); EC2.8 was re-pointed from AC-6 to AC-3 on review.
  { nistControlId: 'SC-28', title: 'Protection of information at rest (supporting evidence) -- EBS default encryption', securityHubControlId: 'EC2.7', mappingType: 'ADDITIONAL_EVIDENCE', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/ec2-controls.html#ec2-7 -- Related requirements: "...NIST.800-53.r5 SC-28, NIST.800-53.r5 SC-28(1)...". Classified ADDITIONAL_EVIDENCE, not DIRECT (downgraded on review): this control only checks the account-level DEFAULT-encryption setting for new volumes -- unlike the other SC-28 entries above, it says nothing about whether existing EBS volumes are actually encrypted.' },
  { nistControlId: 'AC-6', title: 'Least privilege (supporting evidence) -- no persistent root user access key', securityHubControlId: 'IAM.4', mappingType: 'ADDITIONAL_EVIDENCE', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/iam-controls.html#iam-4 -- Related requirements: "...NIST.800-53.r5 AC-6, NIST.800-53.r5 AC-6(2/10)...". Classified ADDITIONAL_EVIDENCE, not DIRECT (downgraded on review): removing root\'s access key does not reduce root\'s privilege level (root remains maximally privileged) -- it reduces standing-credential exposure for the account\'s most powerful identity, real but narrower evidence than establishing least privilege is enforced.' },
  { nistControlId: 'AC-3', title: 'Access enforcement (supporting evidence) -- EC2 instances require IMDSv2', securityHubControlId: 'EC2.8', mappingType: 'ADDITIONAL_EVIDENCE', framework: 'nist', frameworkVersion: '5.0.0', citation: 'docs.aws.amazon.com/securityhub/latest/userguide/ec2-controls.html#ec2-8 -- Related requirements: "...NIST.800-53.r5 AC-3, NIST.800-53.r5 AC-3(7/15), NIST.800-53.r5 AC-6...". Re-pointed on review from AC-6 to AC-3: IMDSv2 enforces token-based authorization to a specific local resource (the instance metadata service), a closer match to "Access Enforcement" (AC-3) than to "Least Privilege" (AC-6, which is about the breadth of privileges granted, not how a specific endpoint is accessed). Kept ADDITIONAL_EVIDENCE: still narrow relative to AC-3\'s full breadth (all information/system resources).' },
];

export function getNistMappingsForSecurityControlId(securityHubControlId: string): NistControlMapping[] {
  return NIST_800_53_CONTROL_MAPPINGS.filter((m) => m.securityHubControlId === securityHubControlId);
}

/**
 * Deliberately no "NOT_ESTABLISHABLE requirements" list lives in this file, for the exact
 * same reason PCI's no longer has one -- see securityHubPciMapping.ts's own docblock and
 * commit 67dbc6b. NIST 800-53 Rev. 5 includes many manual/procedural/organizational
 * requirements Security Hub's control catalog does not represent at all (AWS's own
 * standard page states "the controls don't support NIST SP 800-53 Revision 5
 * requirements that require manual checks"); DevControl does not curate placeholder
 * NOT_ESTABLISHABLE rows for these -- they are simply absent from this file, and
 * therefore not claimed as DevControl NIST coverage. NOT_ESTABLISHABLE remains a real,
 * valid FoundationControlStatus and the shared evaluator
 * (SecurityHubComplianceService.evaluateFramework) still fully supports a
 * `notEstablishableRequirements` list in its config -- NIST_CONFIG simply passes an
 * empty array, identical in shape to CIS's and PCI's.
 */
