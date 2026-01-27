import { Pool } from 'pg';
import {
  ComplianceFrameworksRepository,
  ComplianceFrameworkRule,
  ComplianceScan,
} from '../repositories/compliance-frameworks.repository';
import { AWSResource } from '../types/aws-resources.types';

interface RuleEvaluationResult {
  pass: boolean;
  issue?: string;
  recommendation?: string;
  error?: string;
}

export class CustomComplianceService {
  private repository: ComplianceFrameworksRepository;

  constructor(private pool: Pool) {
    this.repository = new ComplianceFrameworksRepository(pool);
  }

  /**
   * Execute a compliance scan using a custom framework
   */
  async executeScan(
    frameworkId: string,
    organizationId: string,
    userId?: string,
    resourceFilters?: Record<string, any>
  ): Promise<ComplianceScan> {
    console.log(`[CustomCompliance] Starting scan for framework ${frameworkId}`);

    // Create scan record
    const scan = await this.repository.createScan({
      organization_id: organizationId,
      framework_id: frameworkId,
      scan_type: 'manual',
      resource_filters: resourceFilters,
      triggered_by: userId,
    });

    try {
      // Update scan to running
      await this.repository.updateScan(scan.id, {
        status: 'running',
        started_at: new Date(),
      });

      const startTime = Date.now();

      // Get framework and rules
      const frameworkData = await this.repository.findFrameworkWithRules(frameworkId, organizationId);
      if (!frameworkData) {
        throw new Error('Framework not found');
      }

      const { rules } = frameworkData;
      const enabledRules = rules.filter((r) => r.enabled);

      if (enabledRules.length === 0) {
        throw new Error('No enabled rules in framework');
      }

      // Fetch resources to scan
      const resources = await this.fetchResources(organizationId, resourceFilters);

      let totalResources = resources.length;
      let compliantResources = 0;
      let nonCompliantResources = 0;
      let resourcesScanned = 0;

      const issueCounts = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      };

      // Scan each resource against all applicable rules
      for (const resource of resources) {
        const resourceResults: { ruleId: string; passed: boolean }[] = [];

        for (const rule of enabledRules) {
          // Check if rule applies to this resource type
          if (!this.ruleAppliesTo(rule, resource)) {
            // Skip - rule doesn't apply to this resource type
            await this.repository.createFinding({
              scan_id: scan.id,
              rule_id: rule.id,
              resource_id: resource.id,
              resource_arn: resource.resource_arn,
              resource_type: resource.resource_type,
              resource_name: resource.resource_name,
              status: 'skip',
              severity: rule.severity,
              category: rule.category,
              issue: null,
              recommendation: null,
            });
            continue;
          }

          // Execute rule
          const result = await this.evaluateRule(rule, resource);

          // Record finding
          await this.repository.createFinding({
            scan_id: scan.id,
            rule_id: rule.id,
            resource_id: resource.id,
            resource_arn: resource.resource_arn,
            resource_type: resource.resource_type,
            resource_name: resource.resource_name,
            status: result.error ? 'error' : result.pass ? 'pass' : 'fail',
            severity: rule.severity,
            category: rule.category,
            issue: result.issue || null,
            recommendation: result.recommendation || null,
          });

          if (!result.error) {
            resourceResults.push({ ruleId: rule.id, passed: result.pass });

            if (!result.pass) {
              // Count issues by severity
              if (rule.severity in issueCounts) {
                issueCounts[rule.severity as keyof typeof issueCounts]++;
              }
            }
          }
        }

        resourcesScanned++;

        // Resource is compliant if it passed all applicable rules
        const applicableRules = resourceResults.length;
        const passedRules = resourceResults.filter((r) => r.passed).length;

        if (applicableRules > 0 && passedRules === applicableRules) {
          compliantResources++;
        } else if (applicableRules > 0) {
          nonCompliantResources++;
        }
      }

      // Calculate compliance score
      const complianceScore =
        resourcesScanned > 0 ? (compliantResources / resourcesScanned) * 100 : 100;

      const durationSeconds = Math.floor((Date.now() - startTime) / 1000);

      // Update scan with results
      await this.repository.updateScan(scan.id, {
        status: 'completed',
        total_resources: totalResources,
        compliant_resources: compliantResources,
        non_compliant_resources: nonCompliantResources,
        resources_scanned: resourcesScanned,
        critical_issues: issueCounts.critical,
        high_issues: issueCounts.high,
        medium_issues: issueCounts.medium,
        low_issues: issueCounts.low,
        compliance_score: complianceScore,
        completed_at: new Date(),
        duration_seconds: durationSeconds,
      });

      console.log(
        `[CustomCompliance] Scan ${scan.id} completed: ${compliantResources}/${resourcesScanned} compliant (${complianceScore.toFixed(1)}%)`
      );

      return (await this.repository.findScanById(scan.id))!;
    } catch (error: any) {
      console.error(`[CustomCompliance] Scan ${scan.id} failed:`, error);

      await this.repository.updateScan(scan.id, {
        status: 'failed',
        error_message: error.message,
        completed_at: new Date(),
      });

      throw error;
    }
  }

  /**
   * Check if a rule applies to a resource
   */
  private ruleAppliesTo(rule: ComplianceFrameworkRule, resource: AWSResource): boolean {
    // If resource_types is empty, rule applies to all resources
    if (!rule.resource_types || rule.resource_types.length === 0) {
      return true;
    }

    // Check if resource type is in the list
    return rule.resource_types.includes(resource.resource_type);
  }

  /**
   * Evaluate a rule against a resource
   */
  private async evaluateRule(
    rule: ComplianceFrameworkRule,
    resource: AWSResource
  ): Promise<RuleEvaluationResult> {
    try {
      switch (rule.rule_type) {
        case 'property_check':
          return this.evaluatePropertyCheck(rule, resource);

        case 'tag_required':
          return this.evaluateTagRequired(rule, resource);

        case 'tag_pattern':
          return this.evaluateTagPattern(rule, resource);

        case 'metadata_check':
          return this.evaluateMetadataCheck(rule, resource);

        case 'custom_script':
          return this.evaluateCustomScript(rule, resource);

        default:
          return {
            pass: false,
            error: `Unknown rule type: ${rule.rule_type}`,
          };
      }
    } catch (error: any) {
      console.error(`[CustomCompliance] Error evaluating rule ${rule.rule_code}:`, error);
      return {
        pass: false,
        error: error.message,
      };
    }
  }

  /**
   * Evaluate property_check rule
   * Conditions: { property: string, operator: string, value: any }
   */
  private evaluatePropertyCheck(
    rule: ComplianceFrameworkRule,
    resource: AWSResource
  ): RuleEvaluationResult {
    const { property, operator, value } = rule.conditions;

    if (!property || !operator) {
      return { pass: false, error: 'Invalid property_check conditions' };
    }

    const resourceValue = (resource as any)[property];

    let pass = false;

    switch (operator) {
      case 'equals':
      case '==':
        pass = resourceValue === value;
        break;
      case 'not_equals':
      case '!=':
        pass = resourceValue !== value;
        break;
      case 'greater_than':
      case '>':
        pass = resourceValue > value;
        break;
      case 'less_than':
      case '<':
        pass = resourceValue < value;
        break;
      case 'contains':
        pass = String(resourceValue).includes(String(value));
        break;
      case 'not_contains':
        pass = !String(resourceValue).includes(String(value));
        break;
      case 'exists':
        pass = resourceValue !== null && resourceValue !== undefined;
        break;
      case 'not_exists':
        pass = resourceValue === null || resourceValue === undefined;
        break;
      default:
        return { pass: false, error: `Unknown operator: ${operator}` };
    }

    return {
      pass,
      issue: pass ? undefined : `Property "${property}" check failed: ${operator} ${value}`,
      recommendation: rule.recommendation,
    };
  }

  /**
   * Evaluate tag_required rule
   * Conditions: { tag_key: string }
   */
  private evaluateTagRequired(
    rule: ComplianceFrameworkRule,
    resource: AWSResource
  ): RuleEvaluationResult {
    const { tag_key } = rule.conditions;

    if (!tag_key) {
      return { pass: false, error: 'Invalid tag_required conditions - tag_key missing' };
    }

    const tagExists = resource.tags && tag_key in resource.tags;

    return {
      pass: tagExists,
      issue: tagExists ? undefined : `Required tag "${tag_key}" is missing`,
      recommendation: rule.recommendation,
    };
  }

  /**
   * Evaluate tag_pattern rule
   * Conditions: { tag_key: string, pattern: string (regex) }
   */
  private evaluateTagPattern(
    rule: ComplianceFrameworkRule,
    resource: AWSResource
  ): RuleEvaluationResult {
    const { tag_key, pattern } = rule.conditions;

    if (!tag_key || !pattern) {
      return { pass: false, error: 'Invalid tag_pattern conditions' };
    }

    const tagValue = resource.tags?.[tag_key];

    if (!tagValue) {
      return {
        pass: false,
        issue: `Tag "${tag_key}" is missing`,
        recommendation: rule.recommendation,
      };
    }

    const regex = new RegExp(pattern);
    const pass = regex.test(String(tagValue));

    return {
      pass,
      issue: pass ? undefined : `Tag "${tag_key}" value "${tagValue}" does not match pattern ${pattern}`,
      recommendation: rule.recommendation,
    };
  }

  /**
   * Evaluate metadata_check rule
   * Conditions: { path: string (JSON path), operator: string, value: any }
   */
  private evaluateMetadataCheck(
    rule: ComplianceFrameworkRule,
    resource: AWSResource
  ): RuleEvaluationResult {
    const { path, operator, value } = rule.conditions;

    if (!path || !operator) {
      return { pass: false, error: 'Invalid metadata_check conditions' };
    }

    // Extract value from metadata using simple path (e.g., "nested.field")
    const pathParts = path.split('.');
    let metadataValue: any = resource.metadata;

    for (const part of pathParts) {
      if (metadataValue && typeof metadataValue === 'object' && part in metadataValue) {
        metadataValue = metadataValue[part];
      } else {
        metadataValue = undefined;
        break;
      }
    }

    // Use same operators as property_check
    let pass = false;

    switch (operator) {
      case 'equals':
        pass = metadataValue === value;
        break;
      case 'not_equals':
        pass = metadataValue !== value;
        break;
      case 'exists':
        pass = metadataValue !== undefined;
        break;
      case 'not_exists':
        pass = metadataValue === undefined;
        break;
      default:
        return { pass: false, error: `Unknown operator: ${operator}` };
    }

    return {
      pass,
      issue: pass ? undefined : `Metadata check failed at path "${path}"`,
      recommendation: rule.recommendation,
    };
  }

  /**
   * Evaluate custom_script rule
   * Conditions: { script: string (JavaScript code) }
   * SECURITY WARNING: This executes arbitrary JavaScript - use with caution
   */
  private evaluateCustomScript(
    rule: ComplianceFrameworkRule,
    resource: AWSResource
  ): RuleEvaluationResult {
    const { script } = rule.conditions;

    if (!script) {
      return { pass: false, error: 'Invalid custom_script conditions - script missing' };
    }

    try {
      // Create a sandboxed function
      // NOTE: In production, consider using a proper sandboxing library like vm2
      const fn = new Function('resource', script);
      const result = fn(resource);

      const pass = Boolean(result);

      return {
        pass,
        issue: pass ? undefined : 'Custom script check failed',
        recommendation: rule.recommendation,
      };
    } catch (error: any) {
      return {
        pass: false,
        error: `Script execution error: ${error.message}`,
      };
    }
  }

  /**
   * Fetch resources for scanning
   */
  private async fetchResources(
    organizationId: string,
    filters?: Record<string, any>
  ): Promise<AWSResource[]> {
    const conditions: string[] = ['organization_id = $1'];
    const values: any[] = [organizationId];
    let paramIndex = 2;

    // Apply filters
    if (filters?.resource_type) {
      conditions.push(`resource_type = $${paramIndex++}`);
      values.push(filters.resource_type);
    }

    if (filters?.region) {
      conditions.push(`region = $${paramIndex++}`);
      values.push(filters.region);
    }

    if (filters?.environment) {
      conditions.push(`environment = $${paramIndex++}`);
      values.push(filters.environment);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const query = `
      SELECT * FROM aws_resources
      ${whereClause}
      ORDER BY created_at DESC
    `;

    const result = await this.pool.query(query, values);
    return result.rows;
  }

  /**
   * Get scan results with findings
   */
  async getScanResults(scanId: string, organizationId: string) {
    const scan = await this.repository.findScanById(scanId);
    if (!scan || scan.organization_id !== organizationId) {
      return null;
    }

    const findings = await this.repository.findFindingsByScan(scanId);

    return {
      scan,
      findings,
    };
  }

  /**
   * Get all scans for an organization
   */
  async getScans(organizationId: string, limit?: number) {
    return this.repository.findScansByOrganization(organizationId, limit);
  }
}
