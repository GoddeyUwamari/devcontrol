/**
 * Payments Routes
 * Read-only payment history, derived from Stripe invoices
 * (see StripeController.listPayments/getPayment/getPaymentStats).
 */
import { Router } from 'express';
import { stripeController } from '../controllers/stripe.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// '/stats' must be registered before '/:id' so it isn't captured as an id.
router.get(
  '/stats',
  authenticate,
  stripeController.getPaymentStats.bind(stripeController)
);

router.get(
  '/:id',
  authenticate,
  stripeController.getPayment.bind(stripeController)
);

router.get(
  '/',
  authenticate,
  stripeController.listPayments.bind(stripeController)
);

export default router;
