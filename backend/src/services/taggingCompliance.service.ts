import { Pool } from 'pg';
import { AWSResource } from '../types/aws-resources.types';

/**
 * Tagging Compliance Service
 * Audits resources for required tags and tag format compliance
 */

export interface TaggingRule {
  requiredTags: string[];
  tagFormat?: Record<string, RegExp>;
}

export interface TaggingComplianceIssue {
  resource_id: string;
  resource_arn: string;
  resource_type: string;
  severity: 'low' | 'medium' | 'high';
  issue: string;
  recommendation: string;
  category: 'tagging';
}

export interface TaggingComplianceReport {
  total_resources: number;
  compliant_resources: number;
  non_compliant_resources: number;
  compliance_rate: number;
  issues: TaggingComplianceIssue[];
  summary: {
    missing_owner: number;
    missing_environment: number;
    missing_team: number;
    missing_cost_center: number;
  };
}

export class TaggingComplianceService {
  private rules: TaggingRule;

  constructor(private pool: Pool, organizationRules?: TaggingRule) {
    // Default required tags
    this.rules = organizationRules || {
      requiredTags: ['Environment', 'Owner', 'Team', 'CostCenter'],
      tagFormat: {
        Environment: /^(production|staging|development|qa)$/i,
        CostCenter: /^CC-\d{4}$/,
      },
    };
  }

  /**
   * Audit a single resource for tagging compliance
   */
  auditResource(resource: AWSResource): TaggingComplianceIssue[] {
    const issues: TaggingComplianceIssue[] = [];
    const tags = resource.tags || {};

    // Check for missing required tags
    for (const requiredTag of this.rules.requiredTags) {
      if (!tags[requiredTag]) {
        issues.push({
          resource_id: resource.resource_id,
          resource_arn: resource.resource_arn,
          resource_type: resource.resource_type,
          severity: 'medium',
          issue: `Missing required tag: ${requiredTag}`,
          recommendation: `Add ${requiredTag} tag to this resource`,
          category: 'tagging',
        });
      }
    }

    // Check tag format
    if (this.rules.tagFormat) {
      for (const [tagName, pattern] of Object.entries(this.rules.tagFormat)) {
        if (tags[tagName] && !pattern.test(tags[tagName])) {
          issues.push({
            resource_id: resource.resource_id,
            resource_arn: resource.resource_arn,
            resource_type: resource.resource_type,
            severity: 'low',
            issue: `Invalid ${tagName} tag format: "${tags[tagName]}"`,
            recommendation: `${tagName} should match pattern: ${pattern.source}`,
            category: 'tagging',
          });
        }
      }
    }

    return issues;
  }

  /**
   * Audit all resources for an organization
   */
  async auditAllResources(organizationId: string): Promise<TaggingComplianceReport> {
    const client = await this.pool.connect();

    try {
      // Fetch all resources — excludes soft-terminated rows, which no longer exist
      // to be tagged and shouldn't drag down the current compliance_rate.
      const result = await client.query(
        `SELECT * FROM aws_resources WHERE organization_id = $1 AND status != 'terminated'`,
        [organizationId]
      );

      const resources: AWSResource[] = result.rows.map(row => ({
        ...row,
        tags: row.tags || {},
        metadata: row.metadata || {},
        compliance_issues: row.compliance_issues || [],
      }));

      let totalResources = resources.length;
      let compliantResources = 0;
      let nonCompliantResources = 0;
      const issues: TaggingComplianceIssue[] = [];

      for (const resource of resources) {
        const resourceIssues = this.auditResource(resource);

        if (resourceIssues.length === 0) {
          compliantResources++;
        } else {
          nonCompliantResources++;
          issues.push(...resourceIssues);
        }
      }

      return {
        total_resources: totalResources,
        compliant_resources: compliantResources,
        non_compliant_resources: nonCompliantResources,
        compliance_rate: totalResources > 0 ? (compliantResources / totalResources) * 100 : 0,
        issues,
        summary: {
          missing_owner: issues.filter(i => i.issue.includes('Owner')).length,
          missing_environment: issues.filter(i => i.issue.includes('Environment')).length,
          missing_team: issues.filter(i => i.issue.includes('Team')).length,
          missing_cost_center: issues.filter(i => i.issue.includes('CostCenter')).length,
        },
      };
    } finally {
      client.release();
    }
  }
}
