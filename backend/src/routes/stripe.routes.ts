/**
 * Stripe Routes
 * Handles Stripe payment and subscription endpoints
 */
import { Router } from 'express';
import { stripeController } from '../controllers/stripe.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Webhook route MUST come FIRST. Raw body is already applied at the app
// level in server.ts (RAW_BODY_PATHS) before requests reach this router —
// do not re-apply express.raw() here, it would double-parse the body.
router.post(
  '/webhook',
  stripeController.handleWebhook.bind(stripeController)
);

// All other Stripe routes require authentication
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
  '/change-plan',
  authenticate,
  stripeController.changePlan.bind(stripeController)
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

export default router;