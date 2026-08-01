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

router.use(authenticate);

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
// Manually trigger weekly summary email for the caller's own org (for testing)
router.post('/trigger-weekly-summary', async (req, res) => {
  try {
    const { WeeklyAISummaryJob } = await import('../jobs/weekly-ai-summary.job');
    // Always the caller's own org — never trust a client-supplied id, and
    // never call triggerManual() with no id (it falls through to sending
    // every organization's summary).
    const organizationId = (req as any).user?.organizationId;

    const job = new WeeklyAISummaryJob(pool);
    const result = await job.triggerManual(organizationId);

    res.json({
      success: true,
      message: `Weekly summary sent to organization ${organizationId}. Check your email inbox.`,
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

// GET /api/ai-insights/test-email-config
// Test email configuration without sending
router.get('/test-email-config', async (req, res) => {
  try {
    const { WeeklyAISummaryJob } = await import('../jobs/weekly-ai-summary.job');

    const job = new WeeklyAISummaryJob(pool);
    const isConfigured = await job.testEmailConfig();

    res.json({
      success: isConfigured,
      message: isConfigured
        ? 'Email configuration is valid and ready to send'
        : 'Email configuration failed - check SMTP settings',
      smtp: {
        host: process.env.SMTP_HOST || 'Not configured',
        port: process.env.SMTP_PORT || 'Not configured',
        user: process.env.SMTP_USER || 'Not configured',
        configured: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
      }
    });
  } catch (error: any) {
    console.error('[AI Insights] Email config test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/ai-insights/preview-weekly-summary
// Preview weekly summary data (for the caller's own org) without sending email
router.get('/preview-weekly-summary', async (req, res) => {
  try {
    const { WeeklySummaryRepository } = await import('../repositories/weekly-summary.repository');

    const repository = new WeeklySummaryRepository(pool);
    const organizationId = (req as any).user?.organizationId;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const query = { organizationId, startDate, endDate };

    // Gather weekly data
    const [costData, costComparison, alertsData, userInfo, doraMetrics] = await Promise.all([
      repository.getWeeklyCostData(query),
      repository.getWeeklyCostComparison(query),
      repository.getWeeklyAlerts(query),
      repository.getUserInfo(organizationId),
      repository.getWeeklyDORAMetrics(query)
    ]);

    const { currentCost, previousCost, hasComparableCosts, costSource } = costComparison;
    const changePercent = hasComparableCosts && previousCost
      ? ((currentCost - previousCost) / previousCost) * 100
      : 0;

    res.json({
      success: true,
      organizationId,
      userInfo,
      data: {
        costs: {
          previous: previousCost,
          current: currentCost,
          changePercent: Math.round(changePercent * 100) / 100,
          costSource,
          hasComparableCosts,
          topSpenders: costData.slice(0, 5)
        },
        alerts: alertsData,
        dora: doraMetrics
      },
      message: 'This is the data that will be sent in the weekly email'
    });
  } catch (error: any) {
    console.error('[AI Insights] Preview error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
