/**
 * User Preferences Routes
 * API endpoints for managing user email preferences
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
  getEmailPreferences,
  updateEmailPreferences,
  unsubscribeAll
} from '../controllers/user-preferences.controller';

const router = express.Router();

// Get current email preferences (requires authentication)
router.get('/email', authenticateToken, getEmailPreferences);

// Update email preferences (requires authentication)
router.put('/email', authenticateToken, updateEmailPreferences);

// Unsubscribe from all emails (public endpoint, uses token from email link)
// CAN-SPAM Act compliance - must be accessible without login
router.get('/unsubscribe', unsubscribeAll);

export default router;
