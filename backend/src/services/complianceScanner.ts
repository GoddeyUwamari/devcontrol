import {
  AWSResource,
  ComplianceIssue,
  ComplianceSeverity,
  ComplianceCategory,
  SecurityGroupEvidence,
  IamMfaEvidence,
  IamAccessKeyEvidence,
  FindingEvidenceBasis,
  FrameworkCheckEvaluation,
  NetworkExposureEvidence,
} from '../types/aws-resources.types';
import { describeRulePorts } from '../utils/adminPortExposure';
import { FrameworkApplicability, evaluationReasonText, withRegisteredFrameworks } from '../utils/frameworkApplicability';
import { FRAMEWORK_CHECKS, FrameworkCheck, FrameworkCheckOutcome, checkAppliesTo } from './framework-checks';

export { FrameworkCheck, FrameworkCheckOutcome } from './framework-checks';
import { S3Client, PublicAccessBlockConfiguration } from '@aws-sdk/client-s3';
import { S3ControlClient } from '@aws-sdk/client-s3-control';
import {
  EC2Client,
  DescribeSecurityGroupsCommand,
} from '@aws-sdk/client-ec2';
import {
  IAMClient,
  paginateListUsers,
  ListMFADevicesCommand,
  ListAccessKeysCommand,
  GetLoginProfileCommand,
  NoSuchEntityException,
} from '@aws-sdk/client-iam';
import { computeSecurityGroupFindingKey, IpVersion } from '../utils/securityGroupFindingKey';
import { computeIamFindingKey } from '../utils/iamFindingKey';
import {
  Observed,
  S3SecurityEvaluation,
  collectS3SecurityEvidence,
  fetchAccountPublicAccessBlock,
  evaluateS3Security as evaluateS3Evidence,
  s3FindingsFromEvaluation,
  carryForwardUnverifiedS3Findings,
} from './s3-security-evaluation';

/**
 * The resource types whose is_encrypted discovery reads from AWS. For every other
 * type nothing reads it, so the baseline encryption check does not run: a stored
 * `false` there is a default from an earlier release, not an observation.
 */
export const ENCRYPTION_EVIDENCE_TYPES: readonly string[] = ['ec2', 'ebs', 'rds', 's3'];

/** The resource types whose tags arrive with the Describe call that lists the resource. */
export const INLINE_TAG_TYPES: readonly string[] = ['ec2', 'ebs', 'rds'];

/**
 * Whether a resource's stored tags are what AWS reported. For a type whose tags
 * need their own read (GetBucketTagging, ListTags, a Resource Explorer property)
 * that read must have succeeded and been recorded as metadata.tags_state =
 * 'observed'; a row with no recorded state has not had its tags read.
 */
export function tagsObserved(resource: Pick<AWSResource, 'resource_type' | 'metadata'>): boolean {
  if (INLINE_TAG_TYPES.includes(resource.resource_type)) return true;
  return resource.metadata?.tags_state === 'observed';
}

/**
 * A single category's scan result plus whether it's safe to trust an absence
 * of a previously-seen finding as "resolved." Only checkSecurityGroups produces
 * one today — see its doc comment for why pagination/error-partial-results need it.
 */
export interface CategoryObservation {
  category: 'networking' | 'iam';
  complete: boolean;
  issues: ComplianceIssue[];
}

/** A resource's baseline findings, plus every framework check outcome. */
export interface ResourceComplianceEvaluation {
  /** Findings of the checks that always run. Not part of any framework. */
  baselineIssues: ComplianceIssue[];
  /** Every framework outcome, including the ones that are not findings. */
  frameworkEvaluations: FrameworkCheckEvaluation[];
  /**
   * baselineIssues plus the finding of each framework check that failed in THIS
   * evaluation. Discovery does not persist this: it stores frameworkEvaluations
   * and rebuilds the framework findings from what is stored (see
   * framework-evaluations.repository.ts), so the two can never disagree.
   */
  issues: ComplianceIssue[];
}

/**
 * Compliance Scanner Service
 * Scans AWS resources for security and compliance issues
 */
export class ComplianceScannerService {
  // The checks each framework runs, by framework key. A framework with no entry here
  // is never evaluated. An instance copy, so a test can register a check.
  private readonly frameworkChecks: Record<string, readonly FrameworkCheck[]> = { ...FRAMEWORK_CHECKS };

  // Account-level Block Public Access, fetched once per account for the lifetime of
  // this scanner. Discovery creates one scanner per scan, so this is once per scan
  // rather than once per bucket. A failed lookup is cached too: every bucket in the
  // scan then sees it as unavailable (unknown), never as unprotected.
  private readonly accountPublicAccessBlocks = new Map<string, Promise<Observed<PublicAccessBlockConfiguration>>>();

  /**
   * Scan a single resource and return its findings from this evaluation alone.
   * See evaluateResource.
   */
  async scanResource(
    resource: AWSResource,
    applicability: readonly FrameworkApplicability[] = []
  ): Promise<ComplianceIssue[]> {
    return (await this.evaluateResource(resource, applicability)).issues;
  }

  /** The checks that always run. Not part of any framework. */
  evaluateBaseline(resource: AWSResource): ComplianceIssue[] {
    return [
      ...this.checkEncryption(resource),
      ...this.checkPublicAccess(resource),
      ...this.checkBackups(resource),
      ...this.checkTags(resource),
    ];
  }

  /**
   * Scan a single resource.
   *
   * Baseline checks always run. A framework's checks run only when `applicability`
   * says it is explicitly enabled; a registered framework that `applicability` does
   * not mention is treated as not configured, never as enabled.
   */
  async evaluateResource(
    resource: AWSResource,
    applicability: readonly FrameworkApplicability[] = []
  ): Promise<ResourceComplianceEvaluation> {
    const baselineIssues = this.evaluateBaseline(resource);

    const frameworkEvaluations: FrameworkCheckEvaluation[] = [];
    for (const framework of withRegisteredFrameworks(applicability)) {
      frameworkEvaluations.push(...this.evaluateFramework(resource, framework));
    }

    const frameworkIssues = frameworkEvaluations
      .filter((evaluation) => evaluation.evaluation_state === 'failed' && evaluation.check !== null)
      .map((evaluation) =>
        this.frameworkFinding(resource, evaluation.framework, evaluation.check as string, {
          severity: evaluation.severity as ComplianceSeverity,
          evidence_basis: evaluation.evidence_basis,
          reason_code: evaluation.reason_code,
        })
      );

    return { baselineIssues, frameworkEvaluations, issues: [...baselineIssues, ...frameworkIssues] };
  }

  /** The check keys registered for a framework, whether or not they apply to any given resource. */
  registeredCheckKeys(framework: string): string[] {
    return (this.frameworkChecks[framework] ?? []).map((check) => check.key);
  }

  /**
   * The finding a failed framework check is reported as, built from the stored
   * outcome (severity, evidence basis, reason code) and the check's own wording.
   * This is the only place a framework finding is written, so an entry in
   * aws_resources.compliance_issues always describes a stored 'failed' evaluation.
   */
  frameworkFinding(
    resource: Pick<AWSResource, 'resource_arn' | 'resource_type'>,
    framework: string,
    checkKey: string,
    stored: { severity: ComplianceSeverity; evidence_basis: string; reason_code: string }
  ): ComplianceIssue {
    const check = (this.frameworkChecks[framework] ?? []).find((candidate) => candidate.key === checkKey);
    // A stored failure whose check has no wording any more (it was retired between the
    // scan that stored it and this one) is still reported, by its key.
    const wording = check?.finding?.(resource) ?? {
      category: 'tagging' as const,
      issue: `${framework}: check ${checkKey} failed`,
      recommendation: 'Review this check for the resource.',
    };
    return {
      severity: stored.severity,
      ...wording,
      resource_arn: resource.resource_arn,
      findingKey: checkKey,
      framework,
      applicability: 'enabled',
      evaluation_state: 'failed',
      evidence_basis: stored.evidence_basis as FindingEvidenceBasis,
      evaluation_reason: evaluationReasonText(stored.reason_code),
    };
  }

  private evaluateFramework(resource: AWSResource, framework: FrameworkApplicability): FrameworkCheckEvaluation[] {
    const base = { framework: framework.framework, applicability: framework.state, resource_arn: resource.resource_arn };
    const notRun = (reason_code: string): FrameworkCheckEvaluation => ({
      ...base,
      check: null,
      evaluation_state: 'not_evaluated',
      severity: null,
      evidence_basis: 'none',
      provenance: null,
      reason_code,
      reason: evaluationReasonText(reason_code),
      error_code: null,
    });

    // Not evaluated, for the reason the applicability gives. No check runs, so
    // there is no pass and no finding.
    if (framework.state !== 'enabled') return [notRun(framework.reason_code)];

    const checks = this.frameworkChecks[framework.framework];
    if (!checks) return [notRun('no_checks_registered')];

    const evaluations: FrameworkCheckEvaluation[] = [];
    for (const check of checks) {
      let outcome: FrameworkCheckOutcome;
      try {
        if (!checkAppliesTo(check, resource.resource_type)) continue;
        outcome = check.evaluate(resource);
      } catch (error: any) {
        // An exception is not a result: record it as an error, never as a pass. Only
        // a category is kept; the message goes to the log and nowhere else.
        console.error(`[ComplianceScanner] ${check.key} failed for ${resource.resource_arn}:`, error?.message);
        evaluations.push({
          ...base,
          check: check.key,
          evaluation_state: 'error',
          severity: null,
          evidence_basis: 'none',
          provenance: null,
          reason_code: 'check_exception',
          reason: evaluationReasonText('check_exception'),
          error_code: 'check_exception',
        });
        continue;
      }

      evaluations.push({
        ...base,
        check: check.key,
        evaluation_state: outcome.state,
        severity: outcome.state === 'failed' ? outcome.severity : null,
        evidence_basis: outcome.evidence_basis,
        provenance: outcome.provenance,
        reason_code: outcome.reason_code,
        reason: evaluationReasonText(outcome.reason_code),
        error_code: null,
      });
    }
    return evaluations;
  }

  /**
   * Check encryption compliance
   */
  private checkEncryption(resource: AWSResource): ComplianceIssue[] {
    const issues: ComplianceIssue[] = [];

    // Security Truthfulness #40: a specific "not encrypted" finding requires verified
    // negative evidence. null (unknown/unavailable evidence) must never generate this
    // finding -- that would fabricate a negative claim we can't actually support.
    if (resource.is_encrypted === false && ENCRYPTION_EVIDENCE_TYPES.includes(resource.resource_type)) {
      let severity: ComplianceSeverity = 'medium';
      let issue = '';
      let recommendation = '';

      switch (resource.resource_type) {
        case 'rds':
          severity = 'critical';
          issue = 'RDS database is not encrypted at rest';
          recommendation = 'Enable encryption at rest for the RDS instance. Note: Requires creating a new encrypted instance and migrating data.';
          break;

        case 'ec2':
          severity = 'high';
          issue = 'EC2 instance has unencrypted EBS volumes';
          recommendation = 'Create encrypted snapshots of EBS volumes and launch new instance with encrypted volumes.';
          break;

        case 's3':
          severity = 'high';
          issue = 'S3 bucket does not have default encryption enabled';
          recommendation = 'Enable default encryption for the S3 bucket using AES-256 or AWS KMS.';
          break;

        default:
          severity = 'medium';
          issue = `${resource.resource_type.toUpperCase()} resource is not encrypted`;
          recommendation = 'Enable encryption for this resource following AWS best practices.';
      }

      issues.push({
        severity,
        category: 'encryption',
        issue,
        recommendation,
        resource_arn: resource.resource_arn,
        provenance: 'OBSERVED',
      });
    }

    return issues;
  }

  /**
   * Check public access compliance
   */
  private checkPublicAccess(resource: AWSResource): ComplianceIssue[] {
    const issues: ComplianceIssue[] = [];

    // S3 public access is evaluated by evaluateS3Security from the bucket policy, ACL,
    // Object Ownership and Block Public Access. is_public alone (a raw ACL grant) would
    // duplicate its ACL finding and ignore Block Public Access.
    if (resource.is_public && resource.resource_type !== 's3') {
      let severity: ComplianceSeverity = 'high';
      let issue = '';
      let recommendation = '';

      switch (resource.resource_type) {
        case 'rds':
          severity = 'critical';
          issue = 'RDS database is publicly accessible';
          recommendation = 'Modify the RDS instance to disable public accessibility. Access should be restricted to VPC resources only.';
          break;

        case 'ec2':
          issues.push(this.ec2PublicIpFinding(resource));
          return issues;

        default:
          severity = 'high';
          issue = `${resource.resource_type.toUpperCase()} resource is publicly accessible`;
          recommendation = 'Restrict public access to this resource unless absolutely necessary.';
      }

      issues.push({
        severity,
        category: 'public_access',
        issue,
        recommendation,
        resource_arn: resource.resource_arn,
        provenance: 'OBSERVED',
      });
    }

    return issues;
  }

  /**
   * An EC2 instance with a public IP address, graded by what its security groups show
   * (metadata.network_exposure, read by discovery: utils/adminPortExposure.ts).
   *
   *   High     an attached group has an internet-open rule covering an administrative
   *            or database port. The finding names the rule.
   *   Medium   the groups were read and no such rule was found.
   *   Medium   the groups could not be read: "exposure unknown". A row with nothing
   *            recorded (discovery did not reach it this scan) is the same.
   *
   * The text describes the instance's configuration. It never says the instance was
   * reached or compromised.
   */
  private ec2PublicIpFinding(resource: AWSResource): ComplianceIssue {
    const recorded = resource.metadata?.network_exposure;
    const rules: NetworkExposureEvidence['rules'] = Array.isArray(recorded?.rules) ? recorded.rules : [];
    const base = { category: 'public_access' as const, resource_arn: resource.resource_arn, provenance: 'OBSERVED' as const };

    if (recorded?.state === 'open_admin_port' && rules.length > 0) {
      const first = rules[0];
      const more = rules.length > 1 ? ` (and ${rules.length - 1} more such rule${rules.length > 2 ? 's' : ''})` : '';
      const summary =
        `security group ${first.security_group_id} allows ${describeRulePorts(first)} from ${first.cidr}, ` +
        `which covers port${first.admin_ports.length > 1 ? 's' : ''} ${first.admin_ports.join(', ')}${more}`;
      return {
        ...base,
        severity: 'high',
        issue: `EC2 instance has a public IP address and ${summary}`,
        recommendation: 'Restrict that rule to known source addresses, or remove it and use AWS Systems Manager Session Manager, a bastion host or a VPN.',
        network_exposure: { schema_version: 1, state: 'open_admin_port', summary, rules },
      };
    }

    if (recorded?.state === 'not_established') {
      const summary = 'no attached security group opens an administrative or database port to the internet';
      return {
        ...base,
        severity: 'medium',
        issue: `EC2 instance has a public IP address; ${summary}`,
        recommendation: 'Confirm the instance needs a public IP address. If it does not, place it in a private subnet behind a load balancer or NAT gateway.',
        network_exposure: { schema_version: 1, state: 'not_established', summary, rules: [] },
      };
    }

    const summary = 'exposure unknown: its security groups could not be read';
    return {
      ...base,
      severity: 'medium',
      issue: `EC2 instance has a public IP address; ${summary}`,
      recommendation: 'Allow ec2:DescribeSecurityGroups on the connected role so the rules can be read, then run a scan again.',
      network_exposure: { schema_version: 1, state: 'unknown', summary, rules: [] },
    };
  }

  /**
   * Check backup compliance
   */
  private checkBackups(resource: AWSResource): ComplianceIssue[] {
    const issues: ComplianceIssue[] = [];

    // Only check backups for resources that should have them
    // Security Truthfulness #41: same principle as checkEncryption() -- only verified
    // negative evidence (has_backup === false) generates the finding; null (AWS Backup
    // lookup unavailable/indeterminate) must not.
    if (['rds', 'ec2'].includes(resource.resource_type) && resource.has_backup === false) {
      let severity: ComplianceSeverity = 'high';
      let issue = '';
      let recommendation = '';

      switch (resource.resource_type) {
        case 'rds':
          severity = 'high';
          issue = 'RDS database does not have automated backups enabled';
          recommendation = 'Enable automated backups with a retention period of at least 7 days. Consider enabling automated snapshots.';
          break;

        case 'ec2':
          severity = 'medium';
          issue = 'EC2 instance does not have regular snapshots';
          recommendation = 'Create a snapshot schedule using AWS Backup or Lambda function to automate EBS snapshots.';
          break;
      }

      issues.push({
        severity,
        category: 'backups',
        issue,
        recommendation,
        resource_arn: resource.resource_arn,
        provenance: 'OBSERVED',
      });
    }

    return issues;
  }

  /**
   * Check tagging compliance
   * Required tags: Owner, Environment, Team
   */
  private checkTags(resource: AWSResource): ComplianceIssue[] {
    const issues: ComplianceIssue[] = [];
    // A missing-tag finding needs tags that were read. When they were not (the read
    // was denied or failed, or the type's tags are not read at all) the stored tags
    // are empty and say nothing: no finding.
    if (!tagsObserved(resource)) return issues;
    const requiredTags = ['Owner', 'Environment', 'Team'];
    const missingTags: string[] = [];

    for (const tag of requiredTags) {
      if (!resource.tags[tag]) {
        missingTags.push(tag);
      }
    }

    if (missingTags.length > 0) {
      issues.push({
        severity: 'low',
        category: 'tagging',
        issue: `Resource is missing required tags: ${missingTags.join(', ')}`,
        recommendation: `Add the following tags to this resource: ${missingTags.join(', ')}. Tags are important for cost allocation and resource management.`,
        resource_arn: resource.resource_arn,
        provenance: 'SELF_ATTESTED',
      });
    }

    return issues;
  }

  /**
   * Scan multiple resources and return aggregate compliance data
   */
  async scanMultipleResources(
    resources: AWSResource[],
    applicability: readonly FrameworkApplicability[] = []
  ): Promise<Map<string, ComplianceIssue[]>> {
    const results = new Map<string, ComplianceIssue[]>();

    for (const resource of resources) {
      const issues = await this.scanResource(resource, applicability);
      if (issues.length > 0) {
        results.set(resource.id, issues);
      }
    }

    return results;
  }

  /**
   * Get severity color for UI
   */
  static getSeverityColor(severity: ComplianceSeverity): string {
    const colors: Record<ComplianceSeverity, string> = {
      critical: 'red',
      high: 'orange',
      medium: 'yellow',
      low: 'blue',
    };
    return colors[severity];
  }

  /**
   * Get category display name
   */
  static getCategoryDisplayName(category: ComplianceCategory): string {
    const names: Record<ComplianceCategory, string> = {
      encryption: 'Encryption',
      backups: 'Backups',
      public_access: 'Public Access',
      tagging: 'Tagging',
      iam: 'IAM',
      networking: 'Networking',
      observability: 'Observability',
    };
    return names[category];
  }

  /**
   * S3 public access (bucket policy, ACL) and HTTPS-only enforcement, each evaluated
   * to pass/fail/unknown from AWS evidence -- see s3-security-evaluation.ts. Returns
   * the verified findings plus, for controls that came out 'unknown', the previous
   * snapshot's finding for the same key marked unverified.
   */
  async evaluateS3Security(
    resource: AWSResource,
    s3Client: S3Client,
    options: { s3Control?: S3ControlClient; accountId?: string } = {}
  ): Promise<{ issues: ComplianceIssue[]; evaluation: S3SecurityEvaluation } | null> {
    if (resource.resource_type !== 's3') return null;

    const accountPublicAccessBlock = await this.accountPublicAccessBlock(options.s3Control, options.accountId);
    const evidence = await collectS3SecurityEvidence(resource.resource_id, s3Client, accountPublicAccessBlock);
    const evaluation = evaluateS3Evidence(evidence);
    const issues = [
      ...s3FindingsFromEvaluation(resource.resource_arn, evaluation),
      ...carryForwardUnverifiedS3Findings(resource.compliance_issues, evaluation),
    ];
    return { issues, evaluation };
  }

  private accountPublicAccessBlock(
    s3Control?: S3ControlClient,
    accountId?: string
  ): Promise<Observed<PublicAccessBlockConfiguration>> {
    if (!s3Control || !accountId) return fetchAccountPublicAccessBlock(s3Control, accountId);
    let cached = this.accountPublicAccessBlocks.get(accountId);
    if (!cached) {
      cached = fetchAccountPublicAccessBlock(s3Control, accountId);
      this.accountPublicAccessBlocks.set(accountId, cached);
    }
    return cached;
  }

  /**
   * Check for overly permissive security groups.
   * Identifies security groups with unrestricted (0.0.0.0/0 or ::/0) ingress rules,
   * across every page of DescribeSecurityGroups.
   *
   * Unlike the rest of this service's checks, this one catches its own AWS errors
   * instead of letting them propagate: the caller needs to know not just "did it
   * fail" but "how much did it see before failing," so a previously-active finding
   * that's genuinely still there isn't auto-resolved just because a later page of
   * a paginated scan errored out. `complete: false` (whether from an error or from
   * NextToken remaining unconsumed) tells AccountSecurityFindingsRepository.reconcileScan
   * this observation must never be used to resolve stale findings — only a complete
   * observation may do that. `issues` collected before a failure are still returned
   * and may still be upserted (detecting a real problem is still real evidence, even
   * from a partial scan) — only their *absence* must never be trusted from a partial run.
   */
  async checkSecurityGroups(ec2Client: EC2Client, region: string, accountId?: string): Promise<CategoryObservation> {
    const issues: ComplianceIssue[] = [];
    let nextToken: string | undefined;
    let complete = true;

    try {
      do {
        const { SecurityGroups, NextToken } = await ec2Client.send(
          new DescribeSecurityGroupsCommand({ NextToken: nextToken })
        );

        for (const sg of SecurityGroups || []) {
          if (!sg.GroupId) continue;

          for (const rule of sg.IpPermissions || []) {
            const protocol = rule.IpProtocol || '-1';
            const fromPort = rule.FromPort ?? 0;
            const toPort = rule.ToPort ?? 65535;

            for (const range of rule.IpRanges || []) {
              if (range.CidrIp === '0.0.0.0/0') {
                issues.push(
                  this.buildUnrestrictedIngressIssue(sg.GroupId, sg.GroupName || sg.GroupId, sg.VpcId, region, accountId, protocol, fromPort, toPort, 'v4', '0.0.0.0/0')
                );
              }
            }

            for (const range of rule.Ipv6Ranges || []) {
              if (range.CidrIpv6 === '::/0') {
                issues.push(
                  this.buildUnrestrictedIngressIssue(sg.GroupId, sg.GroupName || sg.GroupId, sg.VpcId, region, accountId, protocol, fromPort, toPort, 'v6', '::/0')
                );
              }
            }
          }
        }

        nextToken = NextToken;
      } while (nextToken);
    } catch (error: any) {
      console.error('[Compliance] checkSecurityGroups failed (partial results may still be usable):', error.message);
      complete = false;
    }

    return { category: 'networking', complete, issues };
  }

  /**
   * Builds one unrestricted-ingress ComplianceIssue with its stable finding_key and
   * narrow evidence. Severity: critical for SSH/RDP (the two ports every currently-
   * supported CIS AWS Foundations Benchmark version explicitly names as "remote server
   * administration ports" — see securityFrameworkMappings.ts), high for anything else.
   */
  private buildUnrestrictedIngressIssue(
    groupId: string,
    groupName: string,
    vpcId: string | undefined,
    region: string,
    accountId: string | undefined,
    protocol: string,
    fromPort: number,
    toPort: number,
    ipVersion: IpVersion,
    cidr: string
  ): ComplianceIssue {
    // SSH/RDP are TCP protocols. A rule's FromPort/ToPort only mean "port number" for
    // TCP/UDP; for ICMP they mean type/code, so a numeric match against 22 or 3389 is
    // coincidental, not an actual SSH/RDP exposure. AWS's protocol "-1" ("all
    // protocols") genuinely does include TCP, so it's treated the same as an explicit
    // "tcp" match; a rule for "udp" or any other specific non-TCP protocol is not.
    const isTcpCapable = protocol === 'tcp' || protocol === '-1';
    const isSSH = isTcpCapable && fromPort <= 22 && toPort >= 22;
    const isRDP = isTcpCapable && fromPort <= 3389 && toPort >= 3389;
    const portLabel = isSSH ? 'SSH (port 22)' : isRDP ? 'RDP (port 3389)' : `port ${fromPort}${fromPort !== toPort ? `-${toPort}` : ''}`;
    const sourceLabel = ipVersion === 'v6' ? '::/0' : '0.0.0.0/0';

    const findingKey = computeSecurityGroupFindingKey({
      securityGroupId: groupId,
      region,
      direction: 'ingress',
      protocol,
      fromPort,
      toPort,
      ipVersion,
    });

    const evidence: SecurityGroupEvidence = {
      schema_version: 1,
      security_group_id: groupId,
      security_group_name: groupName,
      vpc_id: vpcId,
      region,
      direction: 'ingress',
      protocol,
      from_port: fromPort,
      to_port: toPort,
      ip_version: ipVersion,
      cidr,
      detected_at: new Date().toISOString(),
    };

    return {
      severity: isSSH || isRDP ? 'critical' : 'high',
      category: 'networking',
      issue: `Security group "${groupName}" (${groupId}) allows ${portLabel} from anywhere (${sourceLabel})`,
      recommendation: isSSH
        ? 'Restrict SSH access to specific IP addresses or use AWS Systems Manager Session Manager instead.'
        : isRDP
          ? 'Restrict RDP access to specific IP addresses or use a bastion host.'
          : 'Restrict access to known IP ranges or use security group references for inter-resource communication.',
      resource_arn: `arn:aws:ec2:${region}:${accountId || '*'}:security-group/${groupId}`,
      findingKey,
      evidence,
      provenance: 'OBSERVED',
    };
  }

  /**
   * Check IAM security best practices: MFA applicability for console-password
   * users, and access-key rotation — across every page of ListUsers.
   *
   * Mirrors checkSecurityGroups' partial-scan contract: a per-user AWS error
   * is caught here (not propagated) so users already processed before a later
   * failure keep their findings, with `complete: false` telling the caller
   * this observation must never be used to resolve stale findings — only a
   * complete observation may do that. `issues` collected before a failure are
   * still returned and may still be upserted (detecting a real problem is
   * still real evidence, even from a partial scan) — only their *absence*
   * must never be trusted from a partial run.
   */
  async checkIAMSecurity(iamClient: IAMClient): Promise<CategoryObservation> {
    const issues: ComplianceIssue[] = [];
    let complete = true;

    try {
      for await (const page of paginateListUsers({ client: iamClient }, {})) {
        for (const user of page.Users || []) {
          if (!user.UserName || !user.Arn) continue;

          try {
            issues.push(...(await this.checkIamUserSecurity(iamClient, user.UserName, user.Arn)));
          } catch (error: any) {
            console.error(
              `[Compliance] checkIAMSecurity failed for user ${user.UserName} (partial results may still be usable):`,
              error.message
            );
            complete = false;
          }
        }
      }
    } catch (error: any) {
      console.error('[Compliance] checkIAMSecurity failed (partial results may still be usable):', error.message);
      complete = false;
    }

    return { category: 'iam', complete, issues };
  }

  /**
   * MFA + access-key checks for a single IAM user.
   *
   * MFA applicability depends on GetLoginProfile, which has three outcomes:
   *  - success -> user has a console password. If MFA devices == 0, a
   *    confirmed, CIS IAM.5-mapped, HIGH-severity finding.
   *  - NoSuchEntityException -> user has no console password. CIS IAM.5 is
   *    explicitly scoped to "IAM users that have a console password", so
   *    this control does not apply here — no finding, regardless of MFA
   *    device count.
   *  - any other error (e.g. AccessDenied because the assumed role lacks
   *    iam:GetLoginProfile) -> console-access applicability cannot be proven
   *    either way. This is an explicitly ALLOWED unknown state, not a scan
   *    failure: it must never be represented as "this user has console
   *    access and no MFA" (that would overstate what AWS actually proved),
   *    so it gets its own MEDIUM-severity, unmapped finding with
   *    has_login_profile: "unknown" in its evidence, and — critically —
   *    does NOT propagate as an error, so it never degrades this scan's
   *    `complete` signal the way a ListMFADevices/ListAccessKeys failure does.
   *
   * Access-key check always runs independently of MFA/login-profile outcome.
   * Exactly one finding per stale key (never two for the same key at
   * different age thresholds) — severity escalates with age instead.
   */
  private async checkIamUserSecurity(
    iamClient: IAMClient,
    userName: string,
    userArn: string
  ): Promise<ComplianceIssue[]> {
    const issues: ComplianceIssue[] = [];
    const detectedAt = new Date().toISOString();

    const { MFADevices } = await iamClient.send(new ListMFADevicesCommand({ UserName: userName }));
    const mfaDeviceCount = MFADevices?.length ?? 0;

    if (mfaDeviceCount === 0) {
      let hasLoginProfile: boolean | 'unknown';
      try {
        await iamClient.send(new GetLoginProfileCommand({ UserName: userName }));
        hasLoginProfile = true;
      } catch (error) {
        hasLoginProfile = error instanceof NoSuchEntityException ? false : 'unknown';
      }

      if (hasLoginProfile === true) {
        const evidence: IamMfaEvidence = {
          schema_version: 1,
          resource_type: 'iam_user',
          resource_identifier: userArn,
          resource_name: userName,
          finding_type: 'mfa_not_enabled',
          relevant_aws_attributes: { has_login_profile: true, mfa_device_count: mfaDeviceCount },
          detected_at: detectedAt,
        };
        issues.push({
          severity: 'high',
          category: 'iam',
          issue: `IAM user "${userName}" has console access but no MFA device enabled`,
          recommendation:
            'Enable multi-factor authentication (MFA) for this user immediately — console access without MFA is a direct account-takeover risk.',
          resource_arn: userArn,
          findingKey: computeIamFindingKey({ findingType: 'mfa_not_enabled', userArn }),
          evidence,
          provenance: 'OBSERVED',
        });
      } else if (hasLoginProfile === 'unknown') {
        const evidence: IamMfaEvidence = {
          schema_version: 1,
          resource_type: 'iam_user',
          resource_identifier: userArn,
          resource_name: userName,
          finding_type: 'mfa_not_enabled',
          relevant_aws_attributes: { has_login_profile: 'unknown', mfa_device_count: mfaDeviceCount },
          detected_at: detectedAt,
        };
        issues.push({
          severity: 'medium',
          category: 'iam',
          issue: `IAM user "${userName}" has no MFA device, and console access could not be verified`,
          recommendation:
            'Grant iam:GetLoginProfile so DevControl can confirm whether this user has console access. If it does, enable MFA immediately.',
          resource_arn: userArn,
          findingKey: computeIamFindingKey({ findingType: 'mfa_not_enabled', userArn }),
          evidence,
          provenance: 'OBSERVED',
        });
      }
      // hasLoginProfile === false: no console password — CIS IAM.5 doesn't
      // apply to this identity, and neither does our own finding.
    }

    const { AccessKeyMetadata } = await iamClient.send(new ListAccessKeysCommand({ UserName: userName }));

    for (const key of AccessKeyMetadata || []) {
      if (!key.CreateDate || !key.AccessKeyId) continue;

      const ageInDays = Math.floor((Date.now() - key.CreateDate.getTime()) / (1000 * 60 * 60 * 24));
      if (ageInDays <= 90) continue;

      const severity: ComplianceSeverity = ageInDays > 180 ? 'high' : 'medium';
      const evidence: IamAccessKeyEvidence = {
        schema_version: 1,
        resource_type: 'iam_access_key',
        resource_identifier: userArn,
        resource_name: userName,
        finding_type: 'access_key_stale',
        relevant_aws_attributes: {
          access_key_id: key.AccessKeyId,
          age_in_days: ageInDays,
          key_status: key.Status ?? 'Unknown',
        },
        detected_at: detectedAt,
      };

      issues.push({
        severity,
        category: 'iam',
        issue: `IAM user "${userName}" has an access key (${key.AccessKeyId}) that is ${ageInDays} days old`,
        recommendation:
          severity === 'high'
            ? 'URGENT: Rotate this access key immediately. Keys over 180 days old pose a significant security risk.'
            : 'Rotate access keys every 90 days. Create a new key, update applications, then delete the old key.',
        resource_arn: userArn,
        findingKey: computeIamFindingKey({ findingType: 'access_key_stale', userArn, accessKeyId: key.AccessKeyId }),
        evidence,
        provenance: 'OBSERVED',
      });
    }

    return issues;
  }
}
