/**
 * AI Insights Routes
 * API endpoints for AI-powered cost analysis and insights
 */

import { Router } from 'express';
import { pool } from '../config/database';
import { AIInsightsService } from '../services/ai-insights.service';
import { AIInsightsController } from '../controllers/ai-insights.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireOwner } from '../middleware/rbac.middleware';
import { weeklySummaryTriggerRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// Initialize service and controller
const aiInsightsService = new AIInsightsService(pool);
const aiInsightsController = new AIInsightsController(aiInsightsService);

router.use(authenticate);

// POST /api/ai-insights/analyze-cost
// Analyze cost changes and get AI-powered recommendations
router.post('/analyze-cost', aiInsightsController.analyzeCost);

// GET /api/ai-insights/cache-stats
// Get the caller's organization's cache statistics (for monitoring/debugging)
router.get('/cache-stats', aiInsightsController.getCacheStats);

// POST /api/ai-insights/clear-cache
// Clear the caller's organization's insights cache (other orgs untouched)
router.post('/clear-cache', aiInsightsController.clearCache);

// POST /api/ai-insights/trigger-weekly-summary
// Manually send the weekly summary email for the caller's own org. Owner only
// and rate limited per org: each call sends a real email. The recipient is
// the org's eligible owner (opted in + verified), same as the scheduled run.
router.post('/trigger-weekly-summary', requireOwner, weeklySummaryTriggerRateLimiter, async (req, res) => {
  try {
    // Always the caller's own org — never trust a client-supplied id.
    const organizationId = (req as any).user?.organizationId;
    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'Organization context required' });
    }

    const { WeeklyAISummaryJob } = await import('../jobs/weekly-ai-summary.job');
    const job = new WeeklyAISummaryJob(pool);
    const result = await job.triggerManual(organizationId);

    const message = result.sent > 0
      ? 'Weekly summary sent to the organization owner. Check your email inbox.'
      : result.skipped > 0
        ? 'Not sent: no organization owner has weekly summaries enabled and a verified email address.'
        : 'Weekly summary could not be sent.';

    res.status(result.errors > 0 ? 500 : 200).json({
      success: result.errors === 0,
      message,
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
// Preview the caller's own org's weekly summary evidence and wording without sending email
router.get('/preview-weekly-summary', async (req, res) => {
  try {
    const { WeeklySummaryRepository } = await import('../repositories/weekly-summary.repository');
    const { composeWeeklySummary } = await import('../services/weekly-summary-content');

    const repository = new WeeklySummaryRepository(pool);
    const organizationId = (req as any).user?.organizationId;
    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'Organization context required' });
    }

    const [recipient, evidence] = await Promise.all([
      repository.getUserInfo(organizationId),
      repository.gatherWeeklyEvidence(organizationId, new Date()),
    ]);

    res.json({
      success: true,
      organizationId,
      userInfo: recipient ? { email: recipient.email, fullName: recipient.fullName } : null,
      evidence,
      content: composeWeeklySummary(evidence),
      message: 'This is the evidence and wording the weekly email would use (the AI recommendation is not generated in preview)'
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
