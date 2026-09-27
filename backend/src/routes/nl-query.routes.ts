/**
 * Natural Language Query Routes
 * Endpoints for NL query parsing
 */

import { Router } from 'express';
import { NLQueryController } from '../controllers/nl-query.controller';
import { NLQueryService, NLParserUnavailableError } from '../services/nl-query.service';
import { authenticate as authenticateToken } from '../middleware/auth.middleware';
import { requirePro } from '../middleware/subscription.middleware';
import { pool } from '../config/database';
import { NLQueryExecutorService } from '../services/nl-query-executor.service';
import { classifyUnsupportedQuestion, reconcileWithQuery } from '../services/nl-query-guard';

const router = Router();
const service = new NLQueryService(pool);
const controller = new NLQueryController(service);
const executor = new NLQueryExecutorService(pool);

// All routes require Pro tier or higher
router.use(authenticateToken);
router.use(requirePro);

/**
 * POST /api/nl-query/parse
 * Parse natural language query into structured intent
 *
 * Request body:
 * {
 *   "query": "show me ec2 instances"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "action": "filter",
 *     "target": "infrastructure",
 *     "filters": { "resourceType": "ec2" },
 *     "explanation": "Showing all EC2 instances",
 *     "confidence": "high"
 *   }
 * }
 */
router.post('/parse', controller.parseQuery);
router.get('/analytics', controller.getAnalytics);

// POST /api/nl-query/execute — answer a question from this org's evidence
//
// 1. Questions DevControl has no evidence for (causes, comparisons,
//    forecasts, savings/waste, utilization) are answered with an explicit
//    limitation before any parsing -- the parser is never asked to invent them.
// 2. Otherwise the question is parsed by the model (no model, or a failed
//    call, means "Ask AI is temporarily unavailable" -- never a keyword guess). The
//    parser's output is untrusted: its period and date range are reconciled
//    with the question text, then validated against the allowlist in the
//    executor (supported target, CONFIDENCE: high, an honorable period,
//    allowlisted filters) before anything runs. The allowlist -- not the
//    fast path in step 1 -- is the boundary.
// 3. The organization is always req.user.organizationId -- never the body,
//    the question, or the parser output.
// An execution failure is HTTP 500 with a sanitized message, never a
// successful-looking empty result.
router.post('/execute', async (req: any, res) => {
  try {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    const organizationId = req.user?.organizationId;

    if (!query) {
      return res.status(400).json({ success: false, message: 'Query is required' });
    }
    if (query.length > 200) {
      return res.status(400).json({ success: false, message: 'Query too long' });
    }
    if (!organizationId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const unsupported = classifyUnsupportedQuestion(query);
    if (unsupported) {
      return res.json({ success: true, data: executor.notSupportedResult(unsupported.message) });
    }

    let parsed;
    try {
      parsed = await service.parseQuery(query, organizationId);
    } catch (error: unknown) {
      // No model or a failed model call: Ask AI is unavailable. The question
      // is never answered by keyword matching instead.
      if (error instanceof NLParserUnavailableError) {
        return res.json({ success: true, data: executor.unavailableResult() });
      }
      throw error;
    }

    // The parser's period, date range, cost thresholds, and (for costs and
    // inventory) every word of the question are checked against the question
    // text before the allowlist validation in execute().
    const intent = reconcileWithQuery(query, parsed);
    const result = await executor.execute(intent, organizationId);

    if (result.data.outcome === 'error') {
      return res.status(500).json({ success: false, message: result.data.summary, data: result });
    }
    return res.json({ success: true, data: result });
  } catch (err: any) {
    // Raw error to the server log only; the client gets a generic message.
    console.error('[NL Query Execute]', err?.message ?? err);
    return res.status(500).json({ success: false, message: 'Failed to execute query' });
  }
});

console.log('[NL Query] Routes initialized');

export default router;
