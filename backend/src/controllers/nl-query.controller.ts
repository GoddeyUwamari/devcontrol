/**
 * Natural Language Query Controller
 * Handles NL query API requests
 */

import { Request, Response } from 'express';
import { NLQueryService } from '../services/nl-query.service';
import { z } from 'zod';

const parseQuerySchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(200, 'Query too long'),
});

export class NLQueryController {
  private service: NLQueryService;

  constructor(service: NLQueryService) {
    this.service = service;
  }

  parseQuery = async (req: Request, res: Response): Promise<void> => {
    try {
      const { query } = parseQuerySchema.parse(req.body);
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        res.status(401).json({
          success: false,
          error: 'Unauthorized - organizationId required',
        });
        return;
      }

      console.log(`[NL Query] Parsing: "${query}" for org ${organizationId}`);

      const intent = await this.service.parseQuery(query, organizationId);

      res.json({
        success: true,
        data: intent,
        meta: {
          query,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid query',
          details: error.issues,
        });
      } else {
        console.error('[NL Query] Error:', error.message);
        res.status(500).json({
          success: false,
          error: 'Failed to parse query',
        });
      }
    }
  };

  /**
   * GET /api/nl-query/analytics
   * Get query analytics statistics
   */
  getAnalytics = async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        res.status(401).json({
          success: false,
          error: 'Unauthorized - organizationId required',
        });
        return;
      }

      const days = parseInt(req.query.days as string) || 30;

      console.log(`[NL Query] Getting analytics for org ${organizationId} (${days} days)`);

      const stats = await this.service.getAnalytics(organizationId, days);

      res.json({
        success: true,
        data: stats,
        meta: {
          days,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      console.error('[NL Query] Analytics error:', error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to get analytics',
      });
    }
  };
}
