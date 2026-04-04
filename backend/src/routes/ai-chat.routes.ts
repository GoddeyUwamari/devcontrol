/**
 * AI Chat Routes
 * Endpoints for conversational AI assistant
 */

import { Router } from 'express';
import { pool } from '../config/database';
import { AIChatController } from '../controllers/ai-chat.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requirePro } from '../middleware/subscription.middleware';

const router = Router();
const controller = new AIChatController(pool);

// All routes require Pro tier or higher
router.use(authenticateToken);
router.use(requirePro);

/**
 * POST /api/ai-chat
 * Send message to AI assistant (streaming response)
 *
 * Request body:
 * {
 *   "messages": [
 *     { "role": "user", "content": "Why did my costs increase?" }
 *   ]
 * }
 *
 * Response: Server-Sent Events stream
 * data: {"chunk": "text..."}
 * data: {"done": true}
 */
router.post('/', controller.chat);

/**
 * POST /api/ai-chat/sync
 * Non-streaming chat (for testing)
 */
router.post('/sync', controller.chatSync);

/**
 * GET /api/ai-chat/context
 * Get current AWS context (for debugging)
 */
router.get('/context', controller.getContext);

console.log('[AI Chat] Routes initialized');

export default router;
