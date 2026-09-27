/**
 * AI Insights Controller
 * Handles API requests for AI-powered cost analysis
 */

import { Request, Response } from 'express';
import { AIInsightsService } from '../services/ai-insights.service';
import { z } from 'zod';

// Validation schema
const analyzeCostSchema = z.object({
  previousCost: z.number().min(0, 'Previous cost must be non-negative'),
  currentCost: z.number().min(0, 'Current cost must be non-negative'),
  percentageIncrease: z.number(),
  newResources: z.array(z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    cost: z.number(),
    region: z.string()
  })).optional(),
  topSpenders: z.array(z.object({
    service: z.string(),
    cost: z.number(),
    change: z.number()
  })).optional(),
  timeRange: z.string().min(1, 'Time range is required')
});

/**
 * The caller's organization, taken only from the authenticated token — never
 * from the body/query. Sends 401 and returns null when it's missing so every
 * cache-touching handler fails closed.
 */
function requireAuthenticatedOrganizationId(req: Request, res: Response): string | null {
  const organizationId = (req as any).user?.organizationId;
  if (typeof organizationId !== 'string' || organizationId.trim() === '') {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return null;
  }
  return organizationId;
}

export class AIInsightsController {
  private service: AIInsightsService;

  constructor(service: AIInsightsService) {
    this.service = service;
  }

  /**
   * POST /api/ai-insights/analyze-cost
   * Analyze cost changes and provide AI insights
   */
  analyzeCost = async (req: Request, res: Response): Promise<void> => {
    const organizationId = requireAuthenticatedOrganizationId(req, res);
    if (!organizationId) return;

    try {
      console.log('[AI Insights Controller] Received cost analysis request');

      // Validate request body
      const validatedData = analyzeCostSchema.parse(req.body);

      // Log request details (without sensitive data)
      console.log(`[AI Insights Controller] Cost change: ${validatedData.percentageIncrease.toFixed(1)}% ($${validatedData.previousCost.toFixed(2)} → $${validatedData.currentCost.toFixed(2)})`);

      // Determine analysis type based on change direction
      let insights;
      if (validatedData.percentageIncrease > 5) {
        console.log('[AI Insights Controller] Analysis type: INCREASE');
        insights = await this.service.analyzeCostIncrease(organizationId, validatedData);
      } else if (validatedData.percentageIncrease < -5) {
        console.log('[AI Insights Controller] Analysis type: DECREASE');
        insights = await this.service.analyzeCostDecrease(organizationId, validatedData);
      } else {
        console.log('[AI Insights Controller] Analysis type: TREND');
        insights = await this.service.analyzeCostTrend(organizationId, validatedData);
      }

      console.log(`[AI Insights Controller] Analysis complete - Confidence: ${insights.confidence}, Cached: ${insights.cached || false}`);

      res.json({
        success: true,
        data: insights,
        meta: {
          requestedAt: new Date().toISOString(),
          cached: insights.cached || false,
          cacheAge: insights.cacheAge || 0
        }
      });

    } catch (error: any) {
      if (error instanceof z.ZodError) {
        console.error('[AI Insights Controller] Validation error:', error.issues);
        res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: error.issues.map((e: any) => ({
            field: e.path.join('.'),
            message: e.message
          }))
        });
      } else {
        console.error('[AI Insights Controller] Error:', error.message);
        res.status(500).json({
          success: false,
          error: 'Failed to analyze cost data',
          message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }
  };

  /**
   * GET /api/ai-insights/cache-stats
   * Get the caller's organization's cache statistics (for debugging)
   */
  getCacheStats = async (req: Request, res: Response): Promise<void> => {
    const organizationId = requireAuthenticatedOrganizationId(req, res);
    if (!organizationId) return;

    try {
      const stats = this.service.getCacheStats(organizationId);

      res.json({
        success: true,
        data: {
          cacheSize: stats.size,
          cachedKeys: stats.keys.length,
          cacheTTL: '1 hour'
        }
      });

    } catch (error: any) {
      console.error('[AI Insights Controller] Error fetching cache stats:', error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cache statistics'
      });
    }
  };

  /**
   * POST /api/ai-insights/clear-cache
   * Clear the caller's organization's insights cache only
   */
  clearCache = async (req: Request, res: Response): Promise<void> => {
    const organizationId = requireAuthenticatedOrganizationId(req, res);
    if (!organizationId) return;

    try {
      console.log('[AI Insights Controller] Cache clear requested');
      this.service.clearCache(organizationId);

      res.json({
        success: true,
        message: 'Cache cleared successfully'
      });

    } catch (error: any) {
      console.error('[AI Insights Controller] Error clearing cache:', error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to clear cache'
      });
    }
  };
}
