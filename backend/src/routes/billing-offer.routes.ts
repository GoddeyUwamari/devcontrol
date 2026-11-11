/**
 * GET /api/billing/offer -- the public offer the marketing pages read, so a
 * trial line shows only while the free trial is really on.
 *
 * Public (listed in config/public-routes.ts): it answers constants from the
 * server's own trial switch and plan list, with no session, no database, no
 * organization and no user data. While the switch is off (the default) the
 * answer says only that, nothing else.
 */
import { Router, Request, Response } from 'express';
import { isTrialEnabled, TRIAL_PERIOD_DAYS } from '../config/trial';
import { SELF_SERVE_TIERS } from '../services/stripe.service';

export interface BillingOffer {
  trial:
    | { enabled: false }
    | { enabled: true; days: number; plans: string[]; cardRequired: true };
}

export function currentBillingOffer(): BillingOffer {
  if (!isTrialEnabled()) return { trial: { enabled: false } };
  return {
    trial: { enabled: true, days: TRIAL_PERIOD_DAYS, plans: [...SELF_SERVE_TIERS], cardRequired: true },
  };
}

export function billingOfferHandler(_req: Request, res: Response): void {
  // A switch flip shows within a minute; nothing here differs per visitor.
  res.set('Cache-Control', 'public, max-age=60');
  res.json(currentBillingOffer());
}

const router = Router();
router.get('/offer', billingOfferHandler);

export default router;
