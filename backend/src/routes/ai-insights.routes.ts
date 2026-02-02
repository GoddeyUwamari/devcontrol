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
    const { organizationId } = req.body;

    const job = new WeeklyAISummaryJob(pool);
    const result = await job.triggerManual(organizationId);

    res.json({
      success: true,
      message: organizationId
        ? `Weekly summary sent to organization ${organizationId}. Check your email inbox.`
        : 'Weekly summary triggered successfully. Check your email inbox.',
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
// Preview weekly summary data without sending email
router.get('/preview-weekly-summary', async (req, res) => {
  try {
    const { WeeklySummaryRepository } = await import('../repositories/weekly-summary.repository');

    const repository = new WeeklySummaryRepository(pool);

    // Get first organization for preview
    const organizations = await repository.getActiveOrganizations();
    if (organizations.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No organizations found'
      });
    }

    const organizationId = organizations[0];
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const query = { organizationId, startDate, endDate };

    // Gather weekly data
    const [costData, previousCost, alertsData, userInfo, doraMetrics] = await Promise.all([
      repository.getWeeklyCostData(query),
      repository.getPreviousWeekCostData(query),
      repository.getWeeklyAlerts(query),
      repository.getUserInfo(organizationId),
      repository.getWeeklyDORAMetrics(query)
    ]);

    const currentCost = costData.reduce((sum, item) => sum + parseFloat(item.total_cost || '0'), 0);
    const changePercent = previousCost > 0 ? ((currentCost - previousCost) / previousCost) * 100 : 0;

    res.json({
      success: true,
      organizationId,
      userInfo,
      data: {
        costs: {
          previous: previousCost,
          current: currentCost,
          changePercent: Math.round(changePercent * 100) / 100,
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
