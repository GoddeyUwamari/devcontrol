/**
 * AI Insights Routes
 * The weekly summary email's manual trigger and preview.
 *
 * POST /analyze-cost, GET /cache-stats and POST /clear-cache were retired in
 * AI truth PR 1 (founder decision A-D8): no product page called them, and
 * /analyze-cost asked the model about client-supplied cost numbers rather
 * than evidence DevControl holds. They now get the app's ordinary 404.
 */

import { Router } from 'express';
import { pool } from '../config/database';
import { authenticate } from '../middleware/auth.middleware';
import { requireOwner } from '../middleware/rbac.middleware';
import { weeklySummaryTriggerRateLimiter } from '../middleware/rateLimiter';

const router = Router();

router.use(authenticate);

// POST /api/ai-insights/trigger-weekly-summary
// Manually send the weekly summary email for the caller's own org. Owner only
// and rate limited per org: each call sends real email. The recipients are
// the org's eligible owners (opted in + verified), same as the scheduled run.
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
    console.error('[AI Insights] Trigger weekly summary error:', error?.message);
    res.status(500).json({
      success: false,
      error: 'Weekly summary could not be sent.'
    });
  }
});

// GET /api/ai-insights/preview-weekly-summary
// Preview the caller's own org's weekly summary evidence and wording without
// sending email. Owner only, like the manual send. The evidence carries only
// what the org's plan includes (the repository leaves plan-gated figures out).
// Every read runs on one connection tagged for the org (withOrganizationClient),
// the same way the scheduled send reads, so the preview and the email agree
// under row level security.
router.get('/preview-weekly-summary', requireOwner, async (req, res) => {
  try {
    const { WeeklySummaryRepository } = await import('../repositories/weekly-summary.repository');
    const { composeWeeklySummary } = await import('../services/weekly-summary-content');

    const repository = new WeeklySummaryRepository(pool);
    const organizationId = (req as any).user?.organizationId;
    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'Organization context required' });
    }

    const [recipients, evidence, organizationName, planName] = await repository.withOrganizationClient(
      organizationId,
      (client) => Promise.all([
        repository.getRecipients(organizationId, client),
        repository.gatherWeeklyEvidence(organizationId, new Date(), client),
        repository.getOrganizationName(organizationId, client),
        repository.getPlanName(organizationId, client),
      ])
    );

    res.json({
      success: true,
      organizationId,
      recipients: recipients.map(r => ({ email: r.email, fullName: r.fullName })),
      evidence,
      content: composeWeeklySummary(evidence, { organizationName, planName }),
      message: 'This is the evidence and wording the weekly email would use'
    });
  } catch (error: any) {
    console.error('[AI Insights] Preview error:', error?.message);
    res.status(500).json({
      success: false,
      error: 'Weekly summary preview could not be generated.'
    });
  }
});

export default router;
