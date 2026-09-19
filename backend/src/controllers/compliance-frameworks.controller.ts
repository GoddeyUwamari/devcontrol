import { Request, Response } from 'express';
import { z } from 'zod';
import { Pool } from 'pg';
import { ComplianceFrameworksRepository } from '../repositories/compliance-frameworks.repository';
import { CustomComplianceService } from '../services/custom-compliance.service';
import { isReservedFrameworkName } from '../utils/reservedFrameworkNames';
import { assessTagPatternSafety } from '../utils/regexSafety';

// V1 rule vocabulary. `custom_script` is deliberately excluded: it evaluated
// customer-authored JavaScript via an unsandboxed `new Function(...)` in
// CustomComplianceService, a server-side arbitrary-code-execution risk with
// no sandbox implemented anywhere in this codebase -- removed as a security
// foundation requirement, not a product-scope preference. `relationship_check`
// is excluded because it was never actually implemented by the evaluator
// (CustomComplianceService.evaluateRule has no case for it, only the generic
// "Unknown rule type" fallback) -- it should never have been advertised as
// supported in the first place.
const V1_RULE_TYPES = ['property_check', 'tag_required', 'tag_pattern', 'metadata_check'] as const;

// Validation schemas
const createFrameworkSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  framework_type: z.enum(['built_in', 'custom']).optional(),
  is_default: z.boolean().optional(),
  standard_name: z.string().optional(),
  version: z.string().optional(),
});

const updateFrameworkSchema = createFrameworkSchema.partial().extend({
  enabled: z.boolean().optional(),
});

const createRuleSchema = z.object({
  rule_code: z.string().min(1).max(100),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  category: z.enum(['encryption', 'backups', 'public_access', 'tagging', 'iam', 'networking', 'custom']),
  // Still accepts the full historical set at the zod layer so createRule/updateRule
  // below can distinguish "not a recognized rule_type at all" (zod 400) from
  // "a recognized-but-V1-unsupported rule_type" (its own explicit, stable-coded
  // 400 -- see the isUnsupportedRuleType check in createRule/updateRule) rather
  // than collapsing both into the same generic validation-error shape.
  rule_type: z.enum(['property_check', 'tag_required', 'tag_pattern', 'metadata_check', 'relationship_check', 'custom_script']),
  conditions: z.record(z.string(), z.any()),
  resource_types: z.array(z.string()).optional(),
  recommendation: z.string().min(1),
  remediation_url: z.string().url().optional(),
  enabled: z.boolean().optional(),
});

const updateRuleSchema = createRuleSchema.partial();

type V1RuleType = typeof V1_RULE_TYPES[number];

function isV1RuleType(ruleType: string): ruleType is V1RuleType {
  return (V1_RULE_TYPES as readonly string[]).includes(ruleType);
}

/**
 * A customer-authored framework must be unmistakably custom -- it must never
 * claim to be an official built-in standard (framework_type: 'built_in' is
 * reserved for a future, non-customer-driven provisioning path, not the
 * public API), and its name/standard_name must not impersonate one of the
 * officially-branded standards DevControl already presents elsewhere
 * (Security Hub-backed CIS/PCI/NIST, SOC 2 Readiness). Only fields actually
 * present in `data` are checked, so a partial update that doesn't touch
 * name/standard_name/framework_type is never rejected for fields it isn't
 * changing.
 */
function checkFrameworkBrandingViolation(data: {
  framework_type?: string;
  name?: string;
  standard_name?: string;
}): { code: string; error: string } | null {
  if (data.framework_type === 'built_in') {
    return {
      code: 'BUILT_IN_FRAMEWORK_NOT_ALLOWED',
      error: 'framework_type "built_in" is not available through this API -- customer-authored frameworks are always custom.',
    };
  }
  if (data.name !== undefined && isReservedFrameworkName(data.name)) {
    return {
      code: 'RESERVED_FRAMEWORK_NAME',
      error: `"${data.name}" is a reserved name for an officially-supported standard and cannot be used for a custom framework.`,
    };
  }
  if (data.standard_name !== undefined && isReservedFrameworkName(data.standard_name)) {
    return {
      code: 'RESERVED_FRAMEWORK_NAME',
      error: `"${data.standard_name}" is a reserved standard name and cannot be used for a custom framework.`,
    };
  }
  return null;
}

/**
 * Rejects a rule_type outside the V1 vocabulary (custom_script,
 * relationship_check) at the API boundary -- a direct authenticated request
 * must never reach CustomComplianceService's evaluator with either, and this
 * check runs whether or not the request also happens to be schema-valid
 * zod-wise (zod still accepts the historical 6-value enum; this is the actual
 * V1 enforcement). Also validates a tag_pattern-shaped `conditions.pattern`
 * for regex-safety whenever one is present in the payload, regardless of
 * whether rule_type itself is being changed in the same request (an update
 * can change just `conditions` on an existing tag_pattern rule).
 */
function checkRuleTypeAndConditions(data: {
  rule_type?: string;
  conditions?: Record<string, any>;
}): { code: string; error: string } | null {
  if (data.rule_type !== undefined && !isV1RuleType(data.rule_type)) {
    return {
      code: 'UNSUPPORTED_RULE_TYPE',
      error: `rule_type "${data.rule_type}" is not supported. Supported types: ${V1_RULE_TYPES.join(', ')}.`,
    };
  }

  const pattern = data.conditions?.pattern;
  if (typeof pattern === 'string') {
    const safety = assessTagPatternSafety(pattern);
    if (!safety.safe) {
      return { code: 'UNSAFE_REGEX_PATTERN', error: safety.reason };
    }
  }

  return null;
}

const executeScanSchema = z.object({
  resource_filters: z.record(z.string(), z.any()).optional(),
});

export class ComplianceFrameworksController {
  private repository: ComplianceFrameworksRepository;
  private complianceService: CustomComplianceService;

  constructor(pool: Pool) {
    this.repository = new ComplianceFrameworksRepository(pool);
    this.complianceService = new CustomComplianceService(pool);
  }

  /**
   * GET /api/compliance-frameworks
   * List all frameworks for the organization
   */
  async listFrameworks(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const frameworks = await this.repository.findAllFrameworks(organizationId);

      res.json({
        success: true,
        data: frameworks,
      });
    } catch (error: any) {
      console.error('[ComplianceFrameworks] List error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list frameworks',
        message: error.message,
      });
    }
  }

  /**
   * POST /api/compliance-frameworks
   * Create a new framework
   */
  async createFramework(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      const userId = req.user?.userId;

      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const data = createFrameworkSchema.parse(req.body);

      const brandingViolation = checkFrameworkBrandingViolation(data);
      if (brandingViolation) {
        res.status(400).json({ success: false, ...brandingViolation });
        return;
      }

      const framework = await this.repository.createFramework({
        ...data,
        organization_id: organizationId,
        created_by: userId,
      });

      res.status(201).json({
        success: true,
        data: framework,
      });
    } catch (error: any) {
      console.error('[ComplianceFrameworks] Create error:', error);
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.issues,
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: 'Failed to create framework',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/compliance-frameworks/:id
   * Get a framework with its rules
   */
  async getFramework(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      const result = await this.repository.findFrameworkWithRules(id, organizationId);

      if (!result) {
        res.status(404).json({
          success: false,
          error: 'Framework not found',
        });
        return;
      }

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error('[ComplianceFrameworks] Get error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get framework',
        message: error.message,
      });
    }
  }

  /**
   * PUT /api/compliance-frameworks/:id
   * Update a framework
   */
  async updateFramework(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const data = updateFrameworkSchema.parse(req.body);

      const brandingViolation = checkFrameworkBrandingViolation(data);
      if (brandingViolation) {
        res.status(400).json({ success: false, ...brandingViolation });
        return;
      }

      const framework = await this.repository.updateFramework(id, organizationId, data);

      if (!framework) {
        res.status(404).json({
          success: false,
          error: 'Framework not found',
        });
        return;
      }

      res.json({
        success: true,
        data: framework,
      });
    } catch (error: any) {
      console.error('[ComplianceFrameworks] Update error:', error);
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.issues,
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: 'Failed to update framework',
        message: error.message,
      });
    }
  }

  /**
   * DELETE /api/compliance-frameworks/:id
   * Delete a framework
   */
  async deleteFramework(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      const deleted = await this.repository.deleteFramework(id, organizationId);

      if (!deleted) {
        res.status(404).json({
          success: false,
          error: 'Framework not found',
        });
        return;
      }

      res.json({
        success: true,
        message: 'Framework deleted successfully',
      });
    } catch (error: any) {
      console.error('[ComplianceFrameworks] Delete error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete framework',
        message: error.message,
      });
    }
  }

  /**
   * POST /api/compliance-frameworks/:id/rules
   * Add a rule to a framework
   */
  async createRule(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id: frameworkId } = req.params;

      // Verify framework belongs to organization
      const framework = await this.repository.findFrameworkById(frameworkId, organizationId);
      if (!framework) {
        res.status(404).json({
          success: false,
          error: 'Framework not found',
        });
        return;
      }

      const data = createRuleSchema.parse(req.body);

      const ruleViolation = checkRuleTypeAndConditions(data);
      if (ruleViolation) {
        res.status(400).json({ success: false, ...ruleViolation });
        return;
      }

      // checkRuleTypeAndConditions above already confirmed data.rule_type is
      // one of the V1 types (zod's own type is the wider historical enum, so
      // TS can't narrow it automatically across the function-boundary check
      // above) -- this cast reflects that already-verified runtime fact, not
      // an unchecked assumption.
      const rule = await this.repository.createRule({
        ...data,
        rule_type: data.rule_type as V1RuleType,
        framework_id: frameworkId,
        organization_id: organizationId,
      });

      res.status(201).json({
        success: true,
        data: rule,
      });
    } catch (error: any) {
      console.error('[ComplianceFrameworks] Create rule error:', error);
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.issues,
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: 'Failed to create rule',
        message: error.message,
      });
    }
  }

  /**
   * PUT /api/compliance-frameworks/rules/:ruleId
   * Update a rule
   */
  async updateRule(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { ruleId } = req.params;
      const data = updateRuleSchema.parse(req.body);

      const ruleViolation = checkRuleTypeAndConditions(data);
      if (ruleViolation) {
        res.status(400).json({ success: false, ...ruleViolation });
        return;
      }

      // Same already-verified narrowing as createRule above.
      const rule = await this.repository.updateRule(ruleId, organizationId, {
        ...data,
        rule_type: data.rule_type as V1RuleType | undefined,
      });

      if (!rule) {
        res.status(404).json({
          success: false,
          error: 'Rule not found',
        });
        return;
      }

      res.json({
        success: true,
        data: rule,
      });
    } catch (error: any) {
      console.error('[ComplianceFrameworks] Update rule error:', error);
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.issues,
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: 'Failed to update rule',
        message: error.message,
      });
    }
  }

  /**
   * DELETE /api/compliance-frameworks/rules/:ruleId
   * Delete a rule
   */
  async deleteRule(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { ruleId } = req.params;

      const deleted = await this.repository.deleteRule(ruleId, organizationId);

      if (!deleted) {
        res.status(404).json({
          success: false,
          error: 'Rule not found',
        });
        return;
      }

      res.json({
        success: true,
        message: 'Rule deleted successfully',
      });
    } catch (error: any) {
      console.error('[ComplianceFrameworks] Delete rule error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete rule',
        message: error.message,
      });
    }
  }

  /**
   * POST /api/compliance-frameworks/:id/scan
   * Execute a compliance scan using this framework
   */
  async executeScan(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      const userId = req.user?.userId;

      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id: frameworkId } = req.params;
      const { resource_filters } = executeScanSchema.parse(req.body);

      // Verify framework exists
      const framework = await this.repository.findFrameworkById(frameworkId, organizationId);
      if (!framework) {
        res.status(404).json({
          success: false,
          error: 'Framework not found',
        });
        return;
      }

      // Execute scan (async - don't wait for completion)
      this.complianceService.executeScan(frameworkId, organizationId, userId, resource_filters)
        .catch(error => {
          console.error('[ComplianceFrameworks] Scan execution failed:', error);
        });

      res.json({
        success: true,
        message: 'Compliance scan initiated. Check scan history for results.',
      });
    } catch (error: any) {
      console.error('[ComplianceFrameworks] Execute scan error:', error);
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.issues,
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: 'Failed to execute scan',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/compliance-frameworks/scans
   * Get scan history
   */
  async listScans(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

      const scans = await this.complianceService.getScans(organizationId, limit);

      res.json({
        success: true,
        data: scans,
      });
    } catch (error: any) {
      console.error('[ComplianceFrameworks] List scans error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list scans',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/compliance-frameworks/scans/:scanId
   * Get scan results with findings
   */
  async getScanResults(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { scanId } = req.params;

      const results = await this.complianceService.getScanResults(scanId, organizationId);

      if (!results) {
        res.status(404).json({
          success: false,
          error: 'Scan not found',
        });
        return;
      }

      res.json({
        success: true,
        data: results,
      });
    } catch (error: any) {
      console.error('[ComplianceFrameworks] Get scan results error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get scan results',
        message: error.message,
      });
    }
  }
}
