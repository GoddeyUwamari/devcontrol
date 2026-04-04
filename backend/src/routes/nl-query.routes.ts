/**
 * Natural Language Query Routes
 * Endpoints for NL query parsing
 */

import { Router } from 'express';
import { NLQueryController } from '../controllers/nl-query.controller';
import { NLQueryService } from '../services/nl-query.service';
import { authenticate as authenticateToken } from '../middleware/auth.middleware';
import { requirePro } from '../middleware/subscription.middleware';
import { pool } from '../config/database';
import { NLQueryExecutorService } from '../services/nl-query-executor.service';

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

// POST /api/nl-query/execute — parse intent AND return real data
router.post('/execute', async (req: any, res) => {
  try {
    const { query } = req.body;
    const organizationId = req.user?.organizationId;

    if (!query?.trim()) {
      return res.status(400).json({ success: false, message: 'Query is required' });
    }
    if (!organizationId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Parse intent with Claude
    const intent = await service.parseQuery(query, organizationId);

    // Execute against real DB
    const result = await executor.execute(intent, organizationId);

    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[NL Query Execute]', err);
    return res.status(500).json({ success: false, message: 'Failed to execute query' });
  }
});

console.log('[NL Query] Routes initialized');

export default router;
