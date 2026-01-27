import { Request, Response } from 'express';
import { ScheduledReportsService } from '../services/scheduled-reports.service';
import { z } from 'zod';

// Validation schemas
const createScheduleSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  report_type: z.enum(['cost_summary', 'security_audit', 'compliance_status']),
  schedule_type: z.enum(['daily', 'weekly', 'monthly']),
  schedule_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Invalid time format (use HH:MM or HH:MM:SS)'),
  schedule_day_of_week: z.number().min(0).max(6).optional(),
  schedule_day_of_month: z.number().min(1).max(31).optional(),
  timezone: z.string().min(1),
  delivery_email: z.boolean(),
  delivery_slack: z.boolean(),
  email_recipients: z.array(z.string().email()).optional().default([]),
  slack_channels: z.array(z.string()).optional().default([]),
  format: z.enum(['pdf', 'csv', 'both']).optional().default('pdf'),
  filters: z.record(z.any()).optional().default({}),
  columns: z.array(z.string()).optional().default([]),
});

const updateScheduleSchema = createScheduleSchema.partial().extend({
  enabled: z.boolean().optional(),
});

const toggleScheduleSchema = z.object({
  enabled: z.boolean(),
});

const listFiltersSchema = z.object({
  report_type: z.enum(['cost_summary', 'security_audit', 'compliance_status']).optional(),
  enabled: z.boolean().optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export class ScheduledReportsController {
  constructor(private service: ScheduledReportsService) {}

  /**
   * GET /api/scheduled-reports
   * List all scheduled reports for the organization
   */
  async list(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      // Validate query parameters
      const filters = listFiltersSchema.parse({
        report_type: req.query.report_type,
        enabled: req.query.enabled === 'true' ? true : req.query.enabled === 'false' ? false : undefined,
        page: req.query.page ? parseInt(req.query.page as string) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      });

      const result = await this.service.list(organizationId, filters);

      res.json({
        success: true,
        data: result.reports,
        pagination: {
          total: result.total,
          page: filters.page || 1,
          limit: filters.limit || 50,
        },
      });
    } catch (error: any) {
      console.error('[ScheduledReportsController] List error:', error);
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
        error: 'Failed to list scheduled reports',
        message: error.message,
      });
    }
  }

  /**
   * POST /api/scheduled-reports
   * Create a new scheduled report
   */
  async create(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      const userId = req.user?.id;

      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      // Validate request body
      const data = createScheduleSchema.parse(req.body);

      // Validate at least one delivery method
      if (!data.delivery_email && !data.delivery_slack) {
        res.status(400).json({
          success: false,
          error: 'At least one delivery method (email or Slack) must be enabled',
        });
        return;
      }

      // Validate email recipients if email delivery enabled
      if (data.delivery_email && data.email_recipients.length === 0) {
        res.status(400).json({
          success: false,
          error: 'Email recipients are required when email delivery is enabled',
        });
        return;
      }

      // Validate Slack channels if Slack delivery enabled
      if (data.delivery_slack && data.slack_channels.length === 0) {
        res.status(400).json({
          success: false,
          error: 'Slack channels are required when Slack delivery is enabled',
        });
        return;
      }

      // Validate schedule_day_of_week for weekly schedules
      if (data.schedule_type === 'weekly' && data.schedule_day_of_week === undefined) {
        res.status(400).json({
          success: false,
          error: 'schedule_day_of_week is required for weekly schedules',
        });
        return;
      }

      // Validate schedule_day_of_month for monthly schedules
      if (data.schedule_type === 'monthly' && data.schedule_day_of_month === undefined) {
        res.status(400).json({
          success: false,
          error: 'schedule_day_of_month is required for monthly schedules',
        });
        return;
      }

      const schedule = await this.service.create({
        ...data,
        organization_id: organizationId,
        created_by: userId,
      });

      res.status(201).json({
        success: true,
        data: schedule,
      });
    } catch (error: any) {
      console.error('[ScheduledReportsController] Create error:', error);
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
        error: 'Failed to create scheduled report',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/scheduled-reports/:id
   * Get a single scheduled report by ID
   */
  async get(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      const schedule = await this.service.get(id, organizationId);

      if (!schedule) {
        res.status(404).json({
          success: false,
          error: 'Scheduled report not found',
        });
        return;
      }

      res.json({
        success: true,
        data: schedule,
      });
    } catch (error: any) {
      console.error('[ScheduledReportsController] Get error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get scheduled report',
        message: error.message,
      });
    }
  }

  /**
   * PUT /api/scheduled-reports/:id
   * Update a scheduled report
   */
  async update(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      // Validate request body
      const data = updateScheduleSchema.parse(req.body);

      // Validate delivery methods if provided
      if (data.delivery_email === false && data.delivery_slack === false) {
        res.status(400).json({
          success: false,
          error: 'At least one delivery method must be enabled',
        });
        return;
      }

      const schedule = await this.service.update(id, organizationId, data);

      if (!schedule) {
        res.status(404).json({
          success: false,
          error: 'Scheduled report not found',
        });
        return;
      }

      res.json({
        success: true,
        data: schedule,
      });
    } catch (error: any) {
      console.error('[ScheduledReportsController] Update error:', error);
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
        error: 'Failed to update scheduled report',
        message: error.message,
      });
    }
  }

  /**
   * DELETE /api/scheduled-reports/:id
   * Delete a scheduled report
   */
  async delete(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      const deleted = await this.service.delete(id, organizationId);

      if (!deleted) {
        res.status(404).json({
          success: false,
          error: 'Scheduled report not found',
        });
        return;
      }

      res.json({
        success: true,
        message: 'Scheduled report deleted successfully',
      });
    } catch (error: any) {
      console.error('[ScheduledReportsController] Delete error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete scheduled report',
        message: error.message,
      });
    }
  }

  /**
   * PATCH /api/scheduled-reports/:id/toggle
   * Toggle a scheduled report on/off
   */
  async toggle(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      // Validate request body
      const { enabled } = toggleScheduleSchema.parse(req.body);

      const schedule = await this.service.toggle(id, organizationId, enabled);

      if (!schedule) {
        res.status(404).json({
          success: false,
          error: 'Scheduled report not found',
        });
        return;
      }

      res.json({
        success: true,
        data: schedule,
        message: `Scheduled report ${enabled ? 'enabled' : 'disabled'} successfully`,
      });
    } catch (error: any) {
      console.error('[ScheduledReportsController] Toggle error:', error);
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
        error: 'Failed to toggle scheduled report',
        message: error.message,
      });
    }
  }

  /**
   * POST /api/scheduled-reports/:id/test
   * Manually trigger a report generation (for testing)
   */
  async test(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      // Run test in background and return immediately
      this.service.test(id, organizationId).catch((error) => {
        console.error('[ScheduledReportsController] Test execution failed:', error);
      });

      res.json({
        success: true,
        message: 'Report generation triggered. Check execution history for results.',
      });
    } catch (error: any) {
      console.error('[ScheduledReportsController] Test error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to trigger report generation',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/scheduled-reports/:id/executions
   * Get execution history for a scheduled report
   */
  async getExecutions(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

      // Verify the schedule belongs to this organization
      const schedule = await this.service.get(id, organizationId);
      if (!schedule) {
        res.status(404).json({
          success: false,
          error: 'Scheduled report not found',
        });
        return;
      }

      const executions = await this.service.getExecutions(id, limit);
      const stats = await this.service.getExecutionStats(id);

      res.json({
        success: true,
        data: {
          executions,
          stats,
        },
      });
    } catch (error: any) {
      console.error('[ScheduledReportsController] Get executions error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get execution history',
        message: error.message,
      });
    }
  }
}
