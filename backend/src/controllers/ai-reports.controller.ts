import { Request, Response } from 'express';
import { AIReportGeneratorService } from '../services/ai-report-generator.service';
import { pool } from '../config/database';
import { z } from 'zod';

const service = new AIReportGeneratorService(pool);

// Validation schemas
const generateReportSchema = z.object({
  dateRange: z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  }).optional(),
  reportType: z.enum(['weekly_summary', 'monthly_summary', 'executive_summary']).optional()
});

const getHistorySchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
  reportType: z.enum(['weekly_summary', 'monthly_summary', 'executive_summary']).optional()
});

export class AIReportsController {
  /**
   * Generate report on-demand
   * POST /api/ai-reports/generate
   */
  async generateReport(req: Request, res: Response) {
    try {
      // Validate request
      const validation = generateReportSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request',
          details: validation.error.issues
        });
      }

      const { dateRange, reportType } = validation.data;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      // Default to last 7 days if no date range provided
      const defaultDateRange = {
        from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        to: new Date().toISOString().split('T')[0]
      };

      console.log('[AI Reports] Generating report for organization:', organizationId);

      // Fetch data
      const data = await service.fetchReportData(organizationId, dateRange || defaultDateRange);

      // Generate report
      const startTime = Date.now();
      const report = await service.generateWeeklyReport(data);
      const generationTime = Date.now() - startTime;

      // Save to database
      const reportId = await service.saveGeneratedReport(
        organizationId,
        report,
        data.dateRange,
        reportType || 'weekly_summary'
      );

      console.log(`[AI Reports] Report generated successfully in ${generationTime}ms`);

      return res.json({
        success: true,
        data: {
          ...report,
          reportId,
          generationTime
        }
      });

    } catch (error: any) {
      console.error('[AI Reports] Generate report error:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Failed to generate report'
      });
    }
  }

  /**
   * Get report history
   * GET /api/ai-reports/history?limit=10&reportType=weekly_summary
   */
  async getReportHistory(req: Request, res: Response) {
    try {
      // Validate query params
      const validation = getHistorySchema.safeParse(req.query);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          details: validation.error.issues
        });
      }

      const organizationId = req.user?.organizationId;
      const { limit = '10', reportType } = validation.data;

      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      const reports = await service.fetchReportHistory(
        organizationId,
        Number(limit),
        reportType
      );

      return res.json({
        success: true,
        data: reports
      });

    } catch (error: any) {
      console.error('[AI Reports] Get report history error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch report history'
      });
    }
  }

  /**
   * Get single report by ID
   * GET /api/ai-reports/:id
   */
  async getReport(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid report ID format'
        });
      }

      const result = await pool.query(
        `SELECT
          id,
          organization_id,
          report_type,
          date_range_from,
          date_range_to,
          report_data,
          sent_to,
          sent_at,
          delivery_status,
          ai_model,
          generation_time_ms,
          was_fallback,
          created_at
        FROM generated_reports
        WHERE id = $1 AND organization_id = $2`,
        [id, organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Report not found'
        });
      }

      const report = result.rows[0];

      return res.json({
        success: true,
        data: {
          id: report.id,
          reportType: report.report_type,
          dateRange: {
            from: report.date_range_from,
            to: report.date_range_to
          },
          ...report.report_data,
          metadata: {
            aiModel: report.ai_model,
            generationTime: report.generation_time_ms,
            wasFallback: report.was_fallback,
            createdAt: report.created_at,
            sentTo: report.sent_to,
            sentAt: report.sent_at,
            deliveryStatus: report.delivery_status
          }
        }
      });

    } catch (error: any) {
      console.error('[AI Reports] Get report error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch report'
      });
    }
  }

  /**
   * Delete report
   * DELETE /api/ai-reports/:id
   */
  async deleteReport(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid report ID format'
        });
      }

      const result = await pool.query(
        'DELETE FROM generated_reports WHERE id = $1 AND organization_id = $2 RETURNING id',
        [id, organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Report not found'
        });
      }

      return res.json({
        success: true,
        message: 'Report deleted successfully'
      });

    } catch (error: any) {
      console.error('[AI Reports] Delete report error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to delete report'
      });
    }
  }
}
