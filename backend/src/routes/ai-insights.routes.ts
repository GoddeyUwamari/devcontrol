/**
 * AI Insights Routes
 * API endpoints for AI-powered cost analysis and insights
 */

import { Router } from 'express';
import { pool } from '../config/database';
import { AIInsightsService } from '../services/ai-insights.service';
import { AIInsightsController } from '../controllers/ai-insights.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Initialize service and controller
const aiInsightsService = new AIInsightsService(pool);
const aiInsightsController = new AIInsightsController(aiInsightsService);

// Optional authentication for Phase 1 testing - works with or without token
// TODO: Re-enable strict authentication before production
router.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    return authenticate(req, res, next);
  }
  next();
});

// POST /api/ai-insights/analyze-cost
// Analyze cost changes and get AI-powered recommendations
router.post('/analyze-cost', aiInsightsController.analyzeCost);

// GET /api/ai-insights/cache-stats
// Get cache statistics (for monitoring/debugging)
router.get('/cache-stats', aiInsightsController.getCacheStats);

// POST /api/ai-insights/clear-cache
// Clear the insights cache (admin operation)
router.post('/clear-cache', aiInsightsController.clearCache);

// POST /api/ai-insights/trigger-weekly-summary
// Manually trigger weekly summary email (for testing)
router.post('/trigger-weekly-summary', async (req, res) => {
  try {
    const { WeeklyAISummaryJob } = await import('../jobs/weekly-ai-summary.job');

    const job = new WeeklyAISummaryJob(pool);
    const result = await job.triggerManual();

    res.json({
      success: true,
      message: 'Weekly summary triggered successfully. Check your email inbox.',
      result
    });
  } catch (error: any) {
    console.error('[AI Insights] Trigger weekly summary error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
