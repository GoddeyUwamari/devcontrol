import { Pool, PoolClient } from 'pg';
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

/**
 * Distinct from cost-recommendations.repository.ts's RECONCILIATION_LOCK_SALT
 * (1) and soc2-evidence.repository.ts's SOC2_COMPUTATION_LOCK_SALT (2) --
 * same hashtextextended(key, salt) convention, new salt so this lock's key
 * space can never collide with either of those.
 */
const SCAN_CONCURRENCY_LOCK_SALT = 3;

/**
 * Thrown by executeScan() when another scan is already active (pending or
 * running) for this framework. No scan row is created when this is thrown.
 */
export class ScanInProgressError extends Error {
  constructor() {
    super('A scan is already in progress for this framework.');
    this.name = 'ScanInProgressError';
  }
}

export type ScanStartResult =
  | { status: 'started'; scanId: string }
  | { status: 'already_in_progress' };

type ScanClaim = { client: PoolClient; scan: ComplianceScan; lockKey: string };

export class CustomComplianceService {
  private repository: ComplianceFrameworksRepository;

  constructor(private pool: Pool) {
    this.repository = new ComplianceFrameworksRepository(pool);
  }

  /**
   * Execute a compliance scan and resolve/reject once it reaches a terminal
   * state. Preserves the original blocking contract relied on by existing
   * callers/tests. Rejects with ScanInProgressError (no scan row created) if
   * a scan is already active for this framework -- see startScan() for the
   * non-blocking variant the HTTP controller uses instead.
   */
  async executeScan(
    frameworkId: string,
    organizationId: string,
    userId?: string,
    resourceFilters?: Record<string, any>
  ): Promise<ComplianceScan> {
    console.log(`[CustomCompliance] Starting scan for framework ${frameworkId}`);

    const claim = await this.acquireLockAndCreateScan(frameworkId, organizationId, userId, resourceFilters);
    if (!claim) {
      throw new ScanInProgressError();
    }

    return this.handOffToLongRunningScan(claim, frameworkId, organizationId, resourceFilters);
  }

  /**
   * Non-blocking start used by the HTTP controller. Resolves as soon as the
   * concurrency claim (advisory lock + pending scan row) is settled --
   * bounded by one lock attempt plus one INSERT, not by the scan's total
   * duration. The actual scan work continues in the background on the same
   * dedicated client; this service owns that client end-to-end from here, so
   * callers never receive it and never need to remember to release/unlock
   * anything themselves.
   */
  async startScan(
    frameworkId: string,
    organizationId: string,
    userId?: string,
    resourceFilters?: Record<string, any>
  ): Promise<ScanStartResult> {
    console.log(`[CustomCompliance] Starting scan for framework ${frameworkId}`);

    const claim = await this.acquireLockAndCreateScan(frameworkId, organizationId, userId, resourceFilters);
    if (!claim) {
      return { status: 'already_in_progress' };
    }

    // Intentionally not awaited -- handOffToLongRunningScan takes exclusive
    // ownership of unlocking and releasing `claim.client` for every
    // remaining path (scan success, scan failure, or a synchronous throw
    // during the handoff itself) from this point on.
    this.handOffToLongRunningScan(claim, frameworkId, organizationId, resourceFilters).catch((error) => {
      console.error(`[CustomCompliance] Scan ${claim.scan.id} failed after start:`, error);
    });

    return { status: 'started', scanId: claim.scan.id };
  }

  /**
   * Acquire the framework-scoped session advisory lock and, only if
   * acquired, create the pending scan row -- both on one dedicated client.
   * Every exit path leaves the client in exactly one of two states: released
   * here (lock not acquired, or acquired but createScan failed), or handed
   * back to the caller for immediate, synchronous handoff into
   * handOffToLongRunningScan (lock acquired, scan row created). There is no
   * path that both keeps and releases the client, and no path that does
   * neither.
   *
   * Lock key is `${organizationId}:${frameworkId}` -- deterministic per
   * framework and inherently org-scoped (framework_id is unique per org via
   * compliance_frameworks_id_org_unique), so this never serializes unrelated
   * frameworks or unrelated organizations against each other.
   */
  private async acquireLockAndCreateScan(
    frameworkId: string,
    organizationId: string,
    userId?: string,
    resourceFilters?: Record<string, any>
  ): Promise<ScanClaim | null> {
    const client = await this.pool.connect();
    const lockKey = `${organizationId}:${frameworkId}`;
    let lockAcquired = false;

    try {
      await client.query(
        "SELECT set_config('app.current_organization_id', $1, false)",
        [organizationId]
      );

      const { rows } = await client.query(
        `SELECT pg_try_advisory_lock(hashtextextended($1, ${SCAN_CONCURRENCY_LOCK_SALT})) AS locked`,
        [lockKey]
      );

      if (!rows[0].locked) {
        client.release();
        return null;
      }
      lockAcquired = true;

      const scan = await this.repository.createScan({
        organization_id: organizationId,
        framework_id: frameworkId,
        scan_type: 'manual',
        resource_filters: resourceFilters,
        triggered_by: userId,
      }, client);

      return { client, scan, lockKey };
    } catch (error) {
      if (lockAcquired) {
        await this.unlockQuietly(client, lockKey);
      }
      client.release();
      throw error;
    }
  }

  /**
   * The boundary between the fast "claim this framework" phase and the
   * long-running scan body. Kept as its own method -- rather than inlined at
   * each call site -- specifically so the handoff itself (not just
   * runScanBody's own try/catch) is covered by one place that guarantees
   * `claim.client` is unlocked and released on every path, including a
   * synchronous throw at this call boundary before runScanBody's own try
   * block ever starts.
   */
  private async handOffToLongRunningScan(
    claim: ScanClaim,
    frameworkId: string,
    organizationId: string,
    resourceFilters?: Record<string, any>
  ): Promise<ComplianceScan> {
    try {
      return await this.runScanBody(claim.client, claim.scan, frameworkId, organizationId, resourceFilters);
    } finally {
      await this.unlockQuietly(claim.client, claim.lockKey);
      claim.client.release();
    }
  }

  private async unlockQuietly(client: PoolClient, lockKey: string): Promise<void> {
    try {
      await client.query(
        `SELECT pg_advisory_unlock(hashtextextended($1, ${SCAN_CONCURRENCY_LOCK_SALT}))`,
        [lockKey]
      );
    } catch (error) {
      console.error(`[CustomCompliance] Failed to release advisory lock for ${lockKey}:`, error);
    }
  }

  /**
   * The scan body, run entirely on the caller's dedicated client -- every
   * repository/query call below is passed `client` explicitly so none of
   * them fall back to the AsyncLocalStorage-routed this.pool. The scan row
   * already exists (created by acquireLockAndCreateScan) by the time this
   * runs.
   */
  private async runScanBody(
    client: PoolClient,
    scan: ComplianceScan,
    frameworkId: string,
    organizationId: string,
    resourceFilters?: Record<string, any>
  ): Promise<ComplianceScan> {
    try {
      // Update scan to running
      await this.repository.updateScan(scan.id, {
        status: 'running',
        started_at: new Date(),
      }, client);

      const startTime = Date.now();

      // Get framework and rules
      const frameworkData = await this.repository.findFrameworkWithRules(frameworkId, organizationId, client);
      if (!frameworkData) {
        throw new Error('Framework not found');
      }

      const { rules } = frameworkData;
      const enabledRules = rules.filter((r) => r.enabled);

      if (enabledRules.length === 0) {
        throw new Error('No enabled rules in framework');
      }

      // Fetch resources to scan
      const resources = await this.fetchResources(client, organizationId, resourceFilters);

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
              organization_id: organizationId,
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
            }, client);
            continue;
          }

          // Execute rule
          const result = await this.evaluateRule(rule, resource);

          // Record finding
          await this.repository.createFinding({
            scan_id: scan.id,
            organization_id: organizationId,
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
          }, client);

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
      }, client);

      console.log(
        `[CustomCompliance] Scan ${scan.id} completed: ${compliantResources}/${resourcesScanned} compliant (${complianceScore.toFixed(1)}%)`
      );

      return (await this.repository.findScanById(scan.id, client))!;
    } catch (error: any) {
      console.error(`[CustomCompliance] Scan ${scan.id} failed:`, error);

      await this.repository.updateScan(scan.id, {
        status: 'failed',
        error_message: error.message,
        completed_at: new Date(),
      }, client);

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

  // evaluateCustomScript (rule_type 'custom_script') was removed as part of
  // the Phase 1 security foundation (2026-09): it executed customer-authored
  // JavaScript via an unsandboxed `new Function('resource', script)`, a
  // server-side arbitrary-code-execution risk with no sandbox implemented
  // anywhere in this codebase. 'custom_script' is no longer in the V1 rule
  // vocabulary (see ComplianceRuleType) and is rejected at the API boundary
  // by compliance-frameworks.controller.ts before a rule can ever be created
  // with it. If evaluateRule's switch above is ever reached with a legacy or
  // otherwise-unsupported rule_type value, the `default` branch already
  // fails safely and explicitly (`error: 'Unknown rule type: ...'`) rather
  // than executing anything.

  /**
   * Fetch resources for scanning
   */
  private async fetchResources(
    client: PoolClient,
    organizationId: string,
    filters?: Record<string, any>
  ): Promise<AWSResource[]> {
    // Compliance scan target list — a terminated resource no longer exists to
    // evaluate against the framework's rules.
    const conditions: string[] = ['organization_id = $1', "status != 'terminated'"];
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

    const result = await client.query(query, values);
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
