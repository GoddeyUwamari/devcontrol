/**
 * User Preferences Routes
 * API endpoints for managing user email preferences
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import { unsubscribeRateLimiter } from '../middleware/rateLimiter';
import {
  getEmailPreferences,
  updateEmailPreferences,
  showUnsubscribeConfirm,
  confirmUnsubscribe,
  unsubscribeResponseHeaders,
  getDisplayPreferences,
  updateDisplayPreferences,
} from '../controllers/user-preferences.controller';

const router = express.Router();

// Get current email preferences (requires authentication)
router.get('/email', authenticateToken, getEmailPreferences);

// Update email preferences (requires authentication)
router.put('/email', authenticateToken, updateEmailPreferences);

// Display preferences (theme, timezone, language)
router.get('/display', authenticateToken, getDisplayPreferences);
router.put('/display', authenticateToken, updateDisplayPreferences);

// Weekly summary unsubscribe (public, signed token from the email link).
// CAN-SPAM Act compliance - must be accessible without login.
// GET only shows a confirm page; POST unsubscribes (confirm button or
// RFC 8058 one-click).
router.get('/unsubscribe', unsubscribeResponseHeaders, unsubscribeRateLimiter, showUnsubscribeConfirm);
router.post('/unsubscribe', unsubscribeResponseHeaders, unsubscribeRateLimiter, confirmUnsubscribe);

export default router;
