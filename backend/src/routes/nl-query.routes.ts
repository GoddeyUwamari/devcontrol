/**
 * Natural Language Query Routes
 * Endpoints for NL query parsing
 */

import { Router } from 'express';
import { NLQueryController } from '../controllers/nl-query.controller';
import { NLQueryService } from '../services/nl-query.service';
import { authenticate as authenticateToken } from '../middleware/auth.middleware';
import { pool } from '../config/database';

const router = Router();
const service = new NLQueryService(pool);
const controller = new NLQueryController(service);

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
router.post('/parse', authenticateToken, controller.parseQuery);
router.get('/analytics', authenticateToken, controller.getAnalytics);

console.log('[NL Query] Routes initialized');

export default router;
