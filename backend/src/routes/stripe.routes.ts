/**
 * Stripe Routes
 * Handles Stripe payment and subscription endpoints
 */

import { Router } from 'express';
import { stripeController } from '../controllers/stripe.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All Stripe routes require authentication (except webhook)
router.post(
  '/create-checkout-session',
  authenticate,
  stripeController.createCheckoutSession.bind(stripeController)
);

router.post(
  '/customer-portal',
  authenticate,
  stripeController.createCustomerPortal.bind(stripeController)
);

router.get(
  '/subscription',
  authenticate,
  stripeController.getSubscription.bind(stripeController)
);

router.post(
  '/cancel-subscription',
  authenticate,
  stripeController.cancelSubscription.bind(stripeController)
);

router.post(
  '/resume-subscription',
  authenticate,
  stripeController.resumeSubscription.bind(stripeController)
);

router.get(
  '/invoices',
  authenticate,
  stripeController.getInvoices.bind(stripeController)
);

// Webhook endpoint (no authentication - Stripe signature verification instead)
router.post('/webhook', stripeController.handleWebhook.bind(stripeController));

export default router;
