/**
 * User Preferences Routes
 * API endpoints for managing user email preferences
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import { unsubscribeRateLimiter, unsubscribeSignedUserRateLimiter } from '../middleware/rateLimiter';
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
// RFC 8058 one-click). Valid signed tokens are limited per user, everything
// else per IP (see rateLimiter.ts).
const unsubscribeLimiters = [unsubscribeSignedUserRateLimiter, unsubscribeRateLimiter];
router.get('/unsubscribe', unsubscribeResponseHeaders, ...unsubscribeLimiters, showUnsubscribeConfirm);
router.post('/unsubscribe', unsubscribeResponseHeaders, ...unsubscribeLimiters, confirmUnsubscribe);

export default router;
