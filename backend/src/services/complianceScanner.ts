import {
  AWSResource,
  ComplianceIssue,
  ComplianceSeverity,
  ComplianceCategory,
} from '../types/aws-resources.types';
import {
  S3Client,
  GetBucketAclCommand,
  GetBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import {
  EC2Client,
  DescribeSecurityGroupsCommand,
} from '@aws-sdk/client-ec2';
import {
  IAMClient,
  ListUsersCommand,
  ListMFADevicesCommand,
  ListAccessKeysCommand,
} from '@aws-sdk/client-iam';

/**
 * Compliance Scanner Service
 * Scans AWS resources for security and compliance issues
 */
export class ComplianceScannerService {
  /**
   * Scan a single resource for compliance issues
   */
  async scanResource(resource: AWSResource, frameworks?: string[]): Promise<ComplianceIssue[]> {
    const issues: ComplianceIssue[] = [];

    // Generic security checks (always run)
    issues.push(...this.checkEncryption(resource));
    issues.push(...this.checkPublicAccess(resource));
    issues.push(...this.checkBackups(resource));
    issues.push(...this.checkTags(resource));

    // Framework-specific checks
    if (!frameworks || frameworks.length === 0) {
      // If no frameworks specified, run all framework-specific checks
      issues.push(...this.checkSOC2Compliance(resource));
      issues.push(...this.checkHIPAACompliance(resource));
    } else {
      if (frameworks.includes('SOC2')) {
        issues.push(...this.checkSOC2Compliance(resource));
      }
      if (frameworks.includes('HIPAA')) {
        issues.push(...this.checkHIPAACompliance(resource));
      }
    }

    return issues;
  }

  /**
   * Check encryption compliance
   */
  private checkEncryption(resource: AWSResource): ComplianceIssue[] {
    const issues: ComplianceIssue[] = [];

    if (!resource.is_encrypted) {
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
      });
    }

    return issues;
  }

  /**
   * Check public access compliance
   */
  private checkPublicAccess(resource: AWSResource): ComplianceIssue[] {
    const issues: ComplianceIssue[] = [];

    if (resource.is_public) {
      let severity: ComplianceSeverity = 'high';
      let issue = '';
      let recommendation = '';

      switch (resource.resource_type) {
        case 's3':
          severity = 'critical';
          issue = 'S3 bucket is publicly accessible';
          recommendation = 'Remove public access permissions from bucket ACL and bucket policy. Enable S3 Block Public Access.';
          break;

        case 'rds':
          severity = 'critical';
          issue = 'RDS database is publicly accessible';
          recommendation = 'Modify the RDS instance to disable public accessibility. Access should be restricted to VPC resources only.';
          break;

        case 'ec2':
          severity = 'high';
          issue = 'EC2 instance has a public IP address';
          recommendation = 'Review security groups to ensure only necessary ports are exposed. Consider using a bastion host or VPN for access.';
          break;

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
      });
    }

    return issues;
  }

  /**
   * Check backup compliance
   */
  private checkBackups(resource: AWSResource): ComplianceIssue[] {
    const issues: ComplianceIssue[] = [];

    // Only check backups for resources that should have them
    if (['rds', 'ec2'].includes(resource.resource_type) && !resource.has_backup) {
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
      });
    }

    return issues;
  }

  /**
   * SOC2-specific compliance checks
   * Focuses on: Access Controls, Change Management, System Monitoring
   */
  private checkSOC2Compliance(resource: AWSResource): ComplianceIssue[] {
    const issues: ComplianceIssue[] = [];

    // SOC2: Access Control - Check for IAM role/policy attachment
    if (['ec2', 'lambda', 'ecs'].includes(resource.resource_type)) {
      // Check if resource has proper IAM role attached
      const hasIAMRole = resource.tags?.['IAMRole'] || resource.tags?.['Role'];
      if (!hasIAMRole) {
        issues.push({
          severity: 'high',
          category: 'iam',
          issue: 'SOC2: Resource lacks documented IAM role for access control',
          recommendation: 'Attach an IAM role with least-privilege permissions and tag the resource with "IAMRole" or "Role" for audit tracking.',
          resource_arn: resource.resource_arn,
        });
      }
    }

    // SOC2: Change Management - Check for change tracking tags
    const hasChangeManagement = resource.tags?.['LastModifiedBy'] ||
                                 resource.tags?.['ChangeTicket'] ||
                                 resource.tags?.['Version'];
    if (!hasChangeManagement) {
      issues.push({
        severity: 'medium',
        category: 'tagging',
        issue: 'SOC2: Resource lacks change management tracking tags',
        recommendation: 'Add tags like "LastModifiedBy", "ChangeTicket", or "Version" to track changes for audit compliance.',
        resource_arn: resource.resource_arn,
      });
    }

    // SOC2: System Monitoring - Check for monitoring/logging configuration
    if (['ec2', 'rds', 'lambda', 's3'].includes(resource.resource_type)) {
      const hasMonitoring = resource.tags?.['MonitoringEnabled'] ||
                           resource.tags?.['LoggingEnabled'] ||
                           resource.tags?.['CloudWatchAlarms'];

      if (!hasMonitoring) {
        let recommendation = '';
        switch (resource.resource_type) {
          case 's3':
            recommendation = 'Enable S3 server access logging and tag with "LoggingEnabled:true". Configure CloudWatch metrics for bucket monitoring.';
            break;
          case 'rds':
            recommendation = 'Enable RDS Enhanced Monitoring, audit logs, and error logs. Tag with "MonitoringEnabled:true" and "LoggingEnabled:true".';
            break;
          case 'ec2':
            recommendation = 'Install CloudWatch agent for detailed monitoring. Enable VPC Flow Logs. Tag with "MonitoringEnabled:true".';
            break;
          case 'lambda':
            recommendation = 'Ensure CloudWatch Logs are enabled (default). Add CloudWatch alarms for errors and throttles.';
            break;
          default:
            recommendation = 'Enable monitoring and logging for this resource type according to SOC2 requirements.';
        }

        issues.push({
          severity: 'high',
          category: 'networking',
          issue: 'SOC2: Resource lacks documented monitoring/logging configuration',
          recommendation,
          resource_arn: resource.resource_arn,
        });
      }
    }

    // SOC2: Access logging for S3 buckets
    if (resource.resource_type === 's3' && !resource.tags?.['AccessLogging']) {
      issues.push({
        severity: 'high',
        category: 'networking',
        issue: 'SOC2: S3 bucket does not have access logging enabled',
        recommendation: 'Enable S3 server access logging to track all requests. Configure logs to be sent to a dedicated logging bucket.',
        resource_arn: resource.resource_arn,
      });
    }

    return issues;
  }

  /**
   * HIPAA-specific compliance checks
   * Focuses on: PHI Data Encryption, Access Logging, Backup Requirements
   */
  private checkHIPAACompliance(resource: AWSResource): ComplianceIssue[] {
    const issues: ComplianceIssue[] = [];

    // HIPAA: PHI Data Encryption - Stricter encryption requirements
    if (['s3', 'rds', 'ebs', 'ec2'].includes(resource.resource_type)) {
      if (!resource.is_encrypted) {
        issues.push({
          severity: 'critical',
          category: 'encryption',
          issue: `HIPAA: ${resource.resource_type.toUpperCase()} resource storing PHI must be encrypted at rest`,
          recommendation: 'HIPAA requires encryption of all PHI data at rest. Enable encryption using AWS KMS with customer-managed keys (CMK) for audit trail.',
          resource_arn: resource.resource_arn,
        });
      } else {
        // Even if encrypted, check if using KMS CMK (recommended for HIPAA)
        const usesKMSCMK = resource.tags?.['KMSKey'] || resource.tags?.['EncryptionKey'];
        if (!usesKMSCMK) {
          issues.push({
            severity: 'medium',
            category: 'encryption',
            issue: 'HIPAA: Resource should use AWS KMS Customer Managed Keys (CMK) for encryption',
            recommendation: 'Use AWS KMS CMK instead of AWS-managed keys for better audit capabilities and key rotation control.',
            resource_arn: resource.resource_arn,
          });
        }
      }
    }

    // HIPAA: Encryption in transit for data stores
    if (['rds', 's3', 'elasticache'].includes(resource.resource_type)) {
      const hasTransitEncryption = resource.tags?.['SSLEnabled'] ||
                                   resource.tags?.['TLSEnabled'] ||
                                   resource.tags?.['EncryptionInTransit'];
      if (!hasTransitEncryption) {
        let recommendation = '';
        switch (resource.resource_type) {
          case 'rds':
            recommendation = 'Enable SSL/TLS connections and enforce with rds.force_ssl parameter. Tag with "SSLEnabled:true".';
            break;
          case 's3':
            recommendation = 'Create bucket policy requiring aws:SecureTransport condition. Use HTTPS endpoints only.';
            break;
          case 'elasticache':
            recommendation = 'Enable in-transit encryption when creating the cluster. Recreate cluster if necessary.';
            break;
          default:
            recommendation = 'Enable encryption in transit using TLS/SSL for all data communications.';
        }

        issues.push({
          severity: 'critical',
          category: 'encryption',
          issue: `HIPAA: ${resource.resource_type.toUpperCase()} must have encryption in transit for PHI data`,
          recommendation,
          resource_arn: resource.resource_arn,
        });
      }
    }

    // HIPAA: Access Logging - Required for audit trails
    if (['s3', 'rds', 'lambda', 'ec2'].includes(resource.resource_type)) {
      const hasAccessLogging = resource.tags?.['AccessLogging'] ||
                              resource.tags?.['AuditLogging'] ||
                              resource.tags?.['CloudTrailEnabled'];

      if (!hasAccessLogging) {
        let recommendation = '';
        switch (resource.resource_type) {
          case 's3':
            recommendation = 'Enable S3 server access logging and CloudTrail data events. Store logs in WORM-enabled bucket with MFA delete.';
            break;
          case 'rds':
            recommendation = 'Enable audit logging, error logging, and slow query logs. Export logs to CloudWatch for long-term retention.';
            break;
          case 'lambda':
            recommendation = 'Ensure CloudWatch Logs retention is set to at least 6 years (HIPAA requirement). Enable X-Ray tracing for detailed audit.';
            break;
          case 'ec2':
            recommendation = 'Enable VPC Flow Logs, CloudTrail, and CloudWatch Logs agent. Configure log retention for 6+ years.';
            break;
          default:
            recommendation = 'Enable comprehensive access logging with minimum 6-year retention for HIPAA compliance.';
        }

        issues.push({
          severity: 'critical',
          category: 'networking',
          issue: `HIPAA: ${resource.resource_type.toUpperCase()} lacks required access logging for audit trails`,
          recommendation,
          resource_arn: resource.resource_arn,
        });
      }
    }

    // HIPAA: Backup Requirements - More stringent than generic
    if (['rds', 'ec2', 'ebs', 's3'].includes(resource.resource_type)) {
      if (!resource.has_backup && resource.resource_type !== 's3') {
        issues.push({
          severity: 'critical',
          category: 'backups',
          issue: `HIPAA: ${resource.resource_type.toUpperCase()} storing PHI must have automated backups`,
          recommendation: 'Enable automated backups with minimum 30-day retention. Test backup restoration quarterly. Document backup procedures.',
          resource_arn: resource.resource_arn,
        });
      }

      // Check for backup retention tagging
      const hasBackupRetention = resource.tags?.['BackupRetention'] ||
                                 resource.tags?.['BackupPolicy'];
      if (!hasBackupRetention) {
        issues.push({
          severity: 'high',
          category: 'backups',
          issue: 'HIPAA: Resource lacks documented backup retention policy',
          recommendation: 'Tag resource with "BackupRetention" indicating retention period (minimum 6 years for HIPAA). Document in backup policy.',
          resource_arn: resource.resource_arn,
        });
      }
    }

    // HIPAA: S3 versioning for data integrity
    if (resource.resource_type === 's3') {
      const hasVersioning = resource.tags?.['VersioningEnabled'];
      if (!hasVersioning) {
        issues.push({
          severity: 'high',
          category: 'backups',
          issue: 'HIPAA: S3 bucket should have versioning enabled for PHI data integrity',
          recommendation: 'Enable S3 versioning and MFA delete protection. Configure lifecycle policies for version retention.',
          resource_arn: resource.resource_arn,
        });
      }
    }

    return issues;
  }

  /**
   * Scan multiple resources and return aggregate compliance data
   */
  async scanMultipleResources(
    resources: AWSResource[],
    frameworks?: string[]
  ): Promise<Map<string, ComplianceIssue[]>> {
    const results = new Map<string, ComplianceIssue[]>();

    for (const resource of resources) {
      const issues = await this.scanResource(resource, frameworks);
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
    };
    return names[category];
  }

  /**
   * Enhanced S3 public access check
   * Checks both ACL and bucket policy for public access
   */
  async checkS3PublicAccessEnhanced(resource: AWSResource, region: string): Promise<ComplianceIssue[]> {
    if (resource.resource_type !== 's3') return [];

    const issues: ComplianceIssue[] = [];

    try {
      const s3Client = new S3Client({ region });

      // Check bucket ACL
      try {
        const { Grants } = await s3Client.send(
          new GetBucketAclCommand({ Bucket: resource.resource_id })
        );

        const hasPublicRead = Grants?.some(grant =>
          grant.Grantee?.URI === 'http://acs.amazonaws.com/groups/global/AllUsers' &&
          (grant.Permission === 'READ' || grant.Permission === 'FULL_CONTROL')
        );

        if (hasPublicRead) {
          issues.push({
            severity: 'critical',
            category: 'public_access',
            issue: 'S3 bucket ACL allows public read access',
            recommendation: 'Remove public read permissions from bucket ACL. Use AWS S3 Block Public Access feature.',
            resource_arn: resource.resource_arn,
          });
        }
      } catch (error: any) {
        console.error('[Compliance] Error checking S3 ACL:', error.message);
      }

      // Check bucket policy for public access
      try {
        const { Policy } = await s3Client.send(
          new GetBucketPolicyCommand({ Bucket: resource.resource_id })
        );

        if (Policy) {
          const policyDoc = JSON.parse(Policy);

          // Check for wildcard principals
          if (Policy.includes('"Principal":"*"') || Policy.includes('"Principal":{"AWS":"*"}')) {
            issues.push({
              severity: 'critical',
              category: 'public_access',
              issue: 'S3 bucket policy allows public access (wildcard principal)',
              recommendation: 'Restrict bucket policy to specific IAM principals or AWS accounts only.',
              resource_arn: resource.resource_arn,
            });
          }
        }
      } catch (error: any) {
        // NoSuchBucketPolicy error is expected for buckets without policies
        if (error.name !== 'NoSuchBucketPolicy') {
          console.error('[Compliance] Error checking S3 policy:', error.message);
        }
      }
    } catch (error: any) {
      console.error('[Compliance] Error in S3 public access check:', error.message);
    }

    return issues;
  }

  /**
   * Check for overly permissive security groups
   * Identifies security groups with 0.0.0.0/0 ingress rules
   */
  async checkSecurityGroups(region: string, accountId?: string): Promise<ComplianceIssue[]> {
    const issues: ComplianceIssue[] = [];

    try {
      const ec2Client = new EC2Client({ region });
      const { SecurityGroups } = await ec2Client.send(new DescribeSecurityGroupsCommand({}));

      for (const sg of SecurityGroups || []) {
        // Check for 0.0.0.0/0 ingress rules
        const openRules = sg.IpPermissions?.filter(rule =>
          rule.IpRanges?.some(range => range.CidrIp === '0.0.0.0/0')
        );

        if (openRules && openRules.length > 0) {
          for (const rule of openRules) {
            const fromPort = rule.FromPort || 0;
            const toPort = rule.ToPort || 65535;

            // Critical if SSH (22) or RDP (3389) is open to the world
            if (fromPort <= 22 && toPort >= 22) {
              issues.push({
                severity: 'critical',
                category: 'networking',
                issue: `Security group "${sg.GroupName}" (${sg.GroupId}) allows SSH (port 22) from anywhere (0.0.0.0/0)`,
                recommendation: 'Restrict SSH access to specific IP addresses or use AWS Systems Manager Session Manager instead.',
                resource_arn: `arn:aws:ec2:${region}:${accountId || '*'}:security-group/${sg.GroupId}`,
              });
            } else if (fromPort <= 3389 && toPort >= 3389) {
              issues.push({
                severity: 'critical',
                category: 'networking',
                issue: `Security group "${sg.GroupName}" (${sg.GroupId}) allows RDP (port 3389) from anywhere (0.0.0.0/0)`,
                recommendation: 'Restrict RDP access to specific IP addresses or use a bastion host.',
                resource_arn: `arn:aws:ec2:${region}:${accountId || '*'}:security-group/${sg.GroupId}`,
              });
            } else {
              issues.push({
                severity: 'high',
                category: 'networking',
                issue: `Security group "${sg.GroupName}" (${sg.GroupId}) allows port ${fromPort}${fromPort !== toPort ? `-${toPort}` : ''} from anywhere (0.0.0.0/0)`,
                recommendation: 'Restrict access to known IP ranges or use security group references for inter-resource communication.',
                resource_arn: `arn:aws:ec2:${region}:${accountId || '*'}:security-group/${sg.GroupId}`,
              });
            }
          }
        }
      }
    } catch (error: any) {
      console.error('[Compliance] Error checking security groups:', error.message);
    }

    return issues;
  }

  /**
   * Check IAM security best practices
   * Checks for MFA on users and access key rotation
   */
  async checkIAMSecurity(): Promise<ComplianceIssue[]> {
    const issues: ComplianceIssue[] = [];

    try {
      const iamClient = new IAMClient({ region: 'us-east-1' }); // IAM is global
      const { Users } = await iamClient.send(new ListUsersCommand({}));

      for (const user of Users || []) {
        if (!user.UserName || !user.Arn) continue;

        // Check if user has MFA enabled
        try {
          const { MFADevices } = await iamClient.send(
            new ListMFADevicesCommand({ UserName: user.UserName })
          );

          if (!MFADevices || MFADevices.length === 0) {
            issues.push({
              severity: 'high',
              category: 'iam',
              issue: `IAM user "${user.UserName}" does not have MFA enabled`,
              recommendation: 'Enable multi-factor authentication (MFA) for all IAM users, especially those with console access.',
              resource_arn: user.Arn,
            });
          }
        } catch (error: any) {
          console.error(`[Compliance] Error checking MFA for user ${user.UserName}:`, error.message);
        }

        // Check for old access keys (>90 days)
        try {
          const { AccessKeyMetadata } = await iamClient.send(
            new ListAccessKeysCommand({ UserName: user.UserName })
          );

          for (const key of AccessKeyMetadata || []) {
            if (!key.CreateDate || !key.AccessKeyId) continue;

            const ageInDays = Math.floor(
              (Date.now() - key.CreateDate.getTime()) / (1000 * 60 * 60 * 24)
            );

            if (ageInDays > 90) {
              issues.push({
                severity: 'medium',
                category: 'iam',
                issue: `IAM user "${user.UserName}" has an access key (${key.AccessKeyId}) that is ${ageInDays} days old`,
                recommendation: 'Rotate access keys every 90 days. Create a new key, update applications, then delete the old key.',
                resource_arn: user.Arn,
              });
            }

            // Warning for very old keys (>180 days)
            if (ageInDays > 180) {
              issues.push({
                severity: 'high',
                category: 'iam',
                issue: `IAM user "${user.UserName}" has an access key (${key.AccessKeyId}) that is ${ageInDays} days old (>180 days)`,
                recommendation: 'URGENT: Rotate this access key immediately. Keys over 180 days old pose a significant security risk.',
                resource_arn: user.Arn,
              });
            }
          }
        } catch (error: any) {
          console.error(`[Compliance] Error checking access keys for user ${user.UserName}:`, error.message);
        }
      }
    } catch (error: any) {
      console.error('[Compliance] Error checking IAM security:', error.message);
    }

    return issues;
  }
}
