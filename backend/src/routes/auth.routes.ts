/**
 * Authentication Routes
 */

import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// Public routes (no authentication required, but rate limited)
router.post('/register', authRateLimiter, authController.register.bind(authController));
router.post('/login', authRateLimiter, authController.login.bind(authController));
router.post('/refresh', authController.refreshToken.bind(authController));
router.post('/forgot-password', authRateLimiter, authController.forgotPassword.bind(authController));
router.post('/reset-password', authRateLimiter, authController.resetPassword.bind(authController));
router.post('/verify-email', authController.verifyEmail.bind(authController));

// Protected routes (authentication required)
router.post('/logout', authenticate, authController.logout.bind(authController));
router.get('/me', authenticate, authController.getCurrentUser.bind(authController));
router.post('/change-password', authenticate, authController.changePassword.bind(authController));

export default router;
