import { Request, Response } from 'express';
import { z } from 'zod';
import { Pool } from 'pg';
import { ComplianceFrameworksRepository } from '../repositories/compliance-frameworks.repository';
import { CustomComplianceService } from '../services/custom-compliance.service';

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
  rule_type: z.enum(['property_check', 'tag_required', 'tag_pattern', 'metadata_check', 'relationship_check', 'custom_script']),
  conditions: z.record(z.any()),
  resource_types: z.array(z.string()).optional(),
  recommendation: z.string().min(1),
  remediation_url: z.string().url().optional(),
  enabled: z.boolean().optional(),
});

const updateRuleSchema = createRuleSchema.partial();

const executeScanSchema = z.object({
  resource_filters: z.record(z.any()).optional(),
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
      const userId = req.user?.id;

      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const data = createFrameworkSchema.parse(req.body);

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
          details: error.errors,
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
          details: error.errors,
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

      const rule = await this.repository.createRule({
        ...data,
        framework_id: frameworkId,
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
          details: error.errors,
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
      const { ruleId } = req.params;
      const data = updateRuleSchema.parse(req.body);

      const rule = await this.repository.updateRule(ruleId, data);

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
          details: error.errors,
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
      const { ruleId } = req.params;

      const deleted = await this.repository.deleteRule(ruleId);

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
      const userId = req.user?.id;

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
          details: error.errors,
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
