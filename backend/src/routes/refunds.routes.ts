/**
 * Refunds Routes
 * Issuing a refund (POST) is restricted to organization owner/admin inside
 * StripeController.issueRefund (requireBillingAdmin) -- members/viewers get
 * 403 and Stripe is never called. Listing/stats are read-only and open to
 * any authenticated org member, same access level as invoices/subscription.
 */
import { Router } from 'express';
import { stripeController } from '../controllers/stripe.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get(
  '/stats',
  authenticate,
  stripeController.getRefundStats.bind(stripeController)
);

router.post(
  '/',
  authenticate,
  stripeController.issueRefund.bind(stripeController)
);

router.get(
  '/',
  authenticate,
  stripeController.listRefunds.bind(stripeController)
);

export default router;
