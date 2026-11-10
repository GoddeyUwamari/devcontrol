/**
 * The self-serve free trial: 14 days, card required, on Cost Control
 * (starter) and Optimization Engine (pro) only, at either cadence. One trial
 * per organization, ever: organizations.trial_used_at (admin migration
 * 202611091200_add_trial_used_at.sql) is the only eligibility marker.
 *
 * The whole trial is behind a server-side switch that is OFF unless
 * BILLING_TRIAL_ENABLED is exactly 'true'. While it is off, Checkout never
 * offers a trial and the billing summary reports no organization as
 * trial-eligible, so the app shows no trial offer. Subscriptions that already
 * have a trial keep their lifecycle (claim, first-charge rule, display):
 * those follow Stripe's data, not the switch.
 */
export const TRIAL_PERIOD_DAYS = 14;

/** Read on every call, so the switch takes effect without a restart in tests. */
export function isTrialEnabled(): boolean {
  return process.env.BILLING_TRIAL_ENABLED === 'true';
}
