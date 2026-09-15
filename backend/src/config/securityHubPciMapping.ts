/**
 * Authoritative, versioned Security Hub -> PCI DSS v4.0.1 mapping. A distinct structure
 * from securityHubCisMapping.ts, not a renamed copy: PCI's relationship between a
 * Security Hub control and a PCI requirement is genuinely many-to-many (one Security
 * Hub control can satisfy several PCI requirements, and several Security Hub controls
 * can each independently support the same PCI requirement), so each entry here
 * represents exactly one (Security Hub control, PCI requirement) PAIR, not one entry
 * per control. Compare CIS_V5_CONTROL_MAPPINGS, where that 1:1 shape is sufficient
 * because CIS's own crosswalk happens to be one Security Hub control per CIS control
 * number -- PCI's is not, and forcing PCI into that shape would silently drop real
 * relationships (see IAM.3 below, which alone satisfies two distinct PCI requirements).
 *
 * PCI DSS v4.0.1 ONLY -- v3.2.1 is out of scope for this implementation and is
 * deliberately absent from both this file and any AWS documentation citation below,
 * even where a control's AWS-documented "Related requirements" line also lists a
 * v3.2.1 entry alongside the v4.0.1 one used here.
 *
 * Standard ARN, empirically verified (NOT inferred from the CIS ARN naming pattern) via
 * a live, read-only `securityhub describe-standards` call against the assumed
 * DevControlRole-Test role in two regions:
 *   us-east-1: arn:aws:securityhub:us-east-1::standards/pci-dss/v/4.0.1
 *   eu-west-1: arn:aws:securityhub:eu-west-1::standards/pci-dss/v/4.0.1
 * confirming the ARN is region-parameterized (only the region segment changes) and not
 * account-specific (the account-ID ARN segment is empty -- this is an AWS-owned catalog
 * resource). Security Hub was NOT enabled/subscribed to make this determination --
 * DescribeStandards is a read-only catalog call.
 *
 * Every entry below is individually verified against AWS's own current Security Hub
 * control documentation (docs.aws.amazon.com/securityhub/latest/userguide/, each
 * control's own "Related requirements" section, fetched at the time this was written --
 * not scraped/parsed at runtime, and never inferred from a control's name alone). PCI
 * DSS v4.0.1 maps ~140 Security Hub controls in total; this file deliberately covers
 * only the subset individually verified here. A PCI requirement absent from this file
 * is NOT claimed to be established by DevControl -- it is simply outside this file's
 * currently-verified scope, per the product's "do not fabricate coverage" principle.
 * Widening this set is a real follow-up, not a one-line addition: each new entry needs
 * the same individual verification this batch received.
 */

export const PCI_DSS_FRAMEWORK = 'pci' as const;
export const PCI_DSS_VERSION = '4.0.1' as const;

export function pciStandardsArnForRegion(region: string): string {
  return `arn:aws:securityhub:${region}::standards/pci-dss/v/4.0.1`;
}

export type FrameworkMappingType = 'DIRECT' | 'ADDITIONAL_EVIDENCE';

export interface PciControlMapping {
  framework: typeof PCI_DSS_FRAMEWORK;
  frameworkVersion: typeof PCI_DSS_VERSION;
  /** PCI DSS's own requirement number, e.g. "8.4.2". This is the join key exposed to the
   *  UI/API as `controlId` -- NOT the Security Hub control ID. */
  pciRequirementId: string;
  /** Short, human-readable description of what the PCI requirement asks for -- not the
   *  full PCI DSS requirement text (which DevControl does not reproduce/license here),
   *  just enough context for the UI to explain the row without the user opening the
   *  PCI DSS specification. */
  title: string;
  /** Security Hub's short control identifier, e.g. "IAM.5". Join key against
   *  SecurityHubFindingEvidence.securityControlId -- identical role to CIS's mapping. */
  securityHubControlId: string;
  /**
   * DIRECT: the Security Hub technical check IS what this specific PCI requirement
   * asks for, within the scope of AWS-technical evidence DevControl currently
   * evaluates (see module docblock -- this does not mean the requirement is fully
   * satisfied end-to-end across the whole cardholder data environment; PCI scope
   * covers policy, personnel, and non-AWS infrastructure this product cannot see).
   * ADDITIONAL_EVIDENCE: the Security Hub check is real, meaningful supporting
   * evidence, but does not by itself establish the requirement even within DevControl's
   * own AWS-evidence scope (e.g. a narrower/adjacent technical control, or one where
   * AWS's own documented relationship is more indirect than a same-control match).
   */
  mappingType: FrameworkMappingType;
}

/**
 * 22 individually-verified (Security Hub control, PCI v4.0.1 requirement) pairs, spanning
 * PCI Requirements 1, 2, 3, 4, 6, 8, 10, and 12. Requirements 5, 7, 9, and 11 have no
 * entry here -- not because they're claimed NOT_ESTABLISHABLE as a blanket rule, but
 * because no Security Hub control relevant to them was verified for this v1 batch. A
 * future batch may add DIRECT/ADDITIONAL_EVIDENCE entries for those, or may find none
 * exist worth mapping (some, like Requirement 9 physical access, are unlikely to ever
 * have an AWS Security Hub technical control -- see the PCI readiness audit).
 */
export const PCI_V4_CONTROL_MAPPINGS: PciControlMapping[] = [
  // Requirement 1 -- Network security controls
  { pciRequirementId: '1.3.1', title: 'Inbound traffic to the CDE is restricted to only necessary traffic', securityHubControlId: 'EC2.14', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },
  { pciRequirementId: '1.3.1', title: 'Inbound traffic to the CDE is restricted to only necessary traffic', securityHubControlId: 'EC2.21', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },
  { pciRequirementId: '1.4.4', title: 'System components that store cardholder data are not directly accessible from untrusted networks', securityHubControlId: 'S3.1', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },
  { pciRequirementId: '1.4.4', title: 'System components that store cardholder data are not directly accessible from untrusted networks', securityHubControlId: 'S3.8', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },
  { pciRequirementId: '1.4.4', title: 'System components that store cardholder data are not directly accessible from untrusted networks', securityHubControlId: 'RDS.2', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },

  // Requirement 2 -- Secure configurations
  { pciRequirementId: '2.2.6', title: 'System security parameters are configured to prevent misuse', securityHubControlId: 'EC2.8', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },

  // Requirement 3 -- Protect stored account data
  { pciRequirementId: '3.5.1', title: 'Primary account number (PAN) is rendered unreadable using strong cryptography', securityHubControlId: 'S3.17', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },
  { pciRequirementId: '3.7.4', title: 'Key-management procedures require cryptographic keys to be changed/rotated at the end of their defined lifecycle', securityHubControlId: 'KMS.4', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },

  // Requirement 4 -- Encrypt transmission of cardholder data over open, public networks
  { pciRequirementId: '4.2.1', title: 'Strong cryptography and security protocols are used to safeguard PAN during transmission', securityHubControlId: 'S3.5', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },

  // Requirement 6 -- Develop and maintain secure systems and software
  { pciRequirementId: '6.3.3', title: 'System components are protected from known vulnerabilities via timely security patch installation', securityHubControlId: 'RDS.13', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },

  // Requirement 8 -- Identify users and authenticate access to system components
  { pciRequirementId: '8.3.9', title: "IAM users' access keys/credentials are rotated periodically", securityHubControlId: 'IAM.3', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },
  { pciRequirementId: '8.6.3', title: 'Passwords/credentials for application and system accounts are protected and rotated periodically', securityHubControlId: 'IAM.3', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },
  { pciRequirementId: '8.4.2', title: 'Multi-factor authentication is implemented for all access into the CDE', securityHubControlId: 'IAM.5', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },
  { pciRequirementId: '8.4.2', title: 'Multi-factor authentication is implemented for all access into the CDE', securityHubControlId: 'IAM.6', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },
  { pciRequirementId: '8.4.2', title: 'Multi-factor authentication is implemented for all access into the CDE', securityHubControlId: 'IAM.9', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },
  { pciRequirementId: '8.4.2', title: 'Multi-factor authentication is implemented for all access into the CDE', securityHubControlId: 'IAM.19', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },

  // Requirement 10 -- Log and monitor all access to system components and cardholder data
  { pciRequirementId: '10.2.1', title: 'Audit logs capture all individual user access to system components and cardholder data', securityHubControlId: 'S3.22', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },
  { pciRequirementId: '10.2.1', title: 'Audit logs capture all individual user access to system components and cardholder data', securityHubControlId: 'S3.23', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },
  { pciRequirementId: '10.2.1', title: 'Audit logs capture all individual user access to system components and cardholder data', securityHubControlId: 'CloudTrail.7', mappingType: 'ADDITIONAL_EVIDENCE', framework: 'pci', frameworkVersion: '4.0.1' },
  { pciRequirementId: '10.3.2', title: 'Audit log files are protected from unauthorized modification', securityHubControlId: 'CloudTrail.2', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },
  { pciRequirementId: '10.3.2', title: 'Audit log files are protected from unauthorized modification', securityHubControlId: 'CloudTrail.4', mappingType: 'DIRECT', framework: 'pci', frameworkVersion: '4.0.1' },

  // Requirement 12 -- Support information security with organizational policies and programs
  { pciRequirementId: '12.10.3', title: 'Specific personnel are designated to be available on a 24/7 basis to respond to security incidents', securityHubControlId: 'IAM.18', mappingType: 'ADDITIONAL_EVIDENCE', framework: 'pci', frameworkVersion: '4.0.1' },
];

export function getPciMappingsForSecurityControlId(securityHubControlId: string): PciControlMapping[] {
  return PCI_V4_CONTROL_MAPPINGS.filter((m) => m.securityHubControlId === securityHubControlId);
}

/**
 * A small, deliberately curated set of PCI DSS v4.0.1 requirements DevControl has
 * explicitly evaluated and determined CANNOT be established from any Security Hub/AWS
 * technical evidence -- structurally distinct from PCI_V4_CONTROL_MAPPINGS above, which
 * only ever contains requirements a Security Hub control DOES back.
 *
 * This is not, and must never become, an enumeration of "every PCI v4.0.1 requirement
 * DevControl doesn't currently map" -- per the product's "do not create mapping rows for
 * every PCI DSS requirement merely to label unsupported requirements NOT_ESTABLISHABLE"
 * principle, the vast majority of unmapped v4.0.1 sub-requirements are simply absent
 * from both this file and PCI_V4_CONTROL_MAPPINGS, communicated to the UI as "outside
 * current evidence scope" rather than as individual fabricated rows. The two entries
 * below exist only because their NOT_ESTABLISHABLE status is itself a meaningful,
 * durable, and genuinely justified product fact (not merely "not yet mapped") --
 * Requirement 9 concerns physical facility access, which is AWS's own responsibility
 * under the AWS shared-responsibility model and can never have an AWS API-observable
 * technical control; Requirement 12.1 concerns a published organizational security
 * policy document, which is process/documentation evidence no AWS technical API
 * evaluates. Their status is NOT_ESTABLISHABLE unconditionally, independent of Security
 * Hub capability or sync state -- see security-hub-compliance.service.ts.
 */
export interface PciNotEstablishableRequirement {
  framework: typeof PCI_DSS_FRAMEWORK;
  frameworkVersion: typeof PCI_DSS_VERSION;
  pciRequirementId: string;
  title: string;
  reason: string;
}

export const PCI_V4_NOT_ESTABLISHABLE_REQUIREMENTS: PciNotEstablishableRequirement[] = [
  {
    pciRequirementId: '9',
    title: 'Restrict physical access to cardholder data',
    reason:
      'Physical facility access controls are AWS’s own responsibility under the AWS shared-responsibility model; no Security Hub or AWS API can observe or establish this requirement.',
    framework: 'pci',
    frameworkVersion: '4.0.1',
  },
  {
    pciRequirementId: '12.1',
    title: 'A comprehensive information security policy is defined, documented, and published',
    reason:
      'This requirement concerns an organizational policy document and its publication/maintenance process, which no AWS technical evidence source evaluates.',
    framework: 'pci',
    frameworkVersion: '4.0.1',
  },
];
