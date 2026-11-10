/**
 * Self-serve Checkout reservation: at most one open Checkout session per
 * organization, so double clicks, retries, two admins or two sessions can
 * never produce two billable subscriptions.
 *
 * The invariant: an organization has at most one non-terminal Stripe
 * subscription, the one in organizations.stripe_subscription_id, under its
 * one stripe_customer_id. Ownership is only ever that column. A reservation
 * is not ownership: it is a short-lived lock on the window before a
 * subscription exists, held on the organization row
 * (organizations.checkout_reservation_*, admin migration
 * 202611071200_add_checkout_reservation.sql).
 *
 * Why it is race-safe:
 *  - Taking a reservation is ONE conditional UPDATE ... RETURNING. Postgres
 *    serializes concurrent UPDATEs of the same row; a waiting UPDATE
 *    re-evaluates its WHERE against the committed row, so exactly one
 *    caller wins, across processes and instances.
 *  - The same statement refuses while the organization records a billable
 *    subscription, so there is no check-then-act gap.
 *  - Only the holder creates the Stripe customer and the session.
 *  - The Stripe session expires (expires_at) 5 minutes before the
 *    reservation does. After its expires_at Stripe never completes it, so a
 *    reservation that has expired can be taken again with no completable
 *    session left behind.
 *  - Replacing a reservation (a different plan) or clearing it compares the
 *    reservation id, so only the holder of that exact reservation can.
 *
 * No connection is held across a Stripe call: every function here is one
 * short statement.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { pool } from '../config/database';
import { TERMINAL_SUBSCRIPTION_STATUSES } from './stripe.service';

/**
 * Stripe Checkout session lifetime: now + 31 minutes (one minute above
 * Stripe's 30-minute minimum, so request latency or clock skew never makes
 * Stripe reject it). The reservation outlives it by 5 minutes: 36 in all.
 */
export const CHECKOUT_SESSION_LIFETIME_SECONDS = 31 * 60;
/** A reservation outlives its session by 5 minutes. */
export const RESERVATION_MARGIN_SECONDS = 5 * 60;

type Executor = Pool | PoolClient;

/** The organization records a subscription Stripe can still bill. */
const BILLABLE_SUBSCRIPTION_SQL = (terminalParam: string) =>
  `(stripe_subscription_id IS NOT NULL AND COALESCE(subscription_status, '') <> ALL(${terminalParam}::text[]))`;

/**
 * Whether the organization may get the free trial (config/trial.ts), read in
 * the same statement that takes the reservation, so the decision is atomic
 * with it. Deny-only beyond the one marker: the organization has never used
 * its trial (trial_used_at, the only eligibility marker), has never recorded
 * a subscription, and is not on a plan our team set up (no subscription and
 * a stored tier above free). The trial is claimed only later, once Stripe
 * shows a trial on a subscription verified as the organization's own
 * (StripeService.claimTrial), so an abandoned, expired or failed checkout
 * never uses it up.
 */
export const TRIAL_ELIGIBLE_SQL =
  `(trial_used_at IS NULL AND stripe_subscription_id IS NULL AND COALESCE(subscription_tier, 'free') = 'free')`;

/** A reservation this request holds, and whether its session may carry the trial. */
export interface CheckoutReservation {
  reservationId: string;
  /** The organization's trial eligibility when the reservation was taken (before the switch and plan checks). */
  trialEligible: boolean;
}

function reservationOf(rows: any[]): CheckoutReservation | null {
  if (rows.length === 0) return null;
  return { reservationId: rows[0].checkout_reservation_id as string, trialEligible: rows[0].trial_eligible === true };
}

export interface CheckoutState {
  stripeCustomerId: string | null;
  subscriptionTier: string | null;
  hasBillableSubscription: boolean;
  reservationId: string | null;
  reservationPlan: string | null;
  reservationActive: boolean;
  sessionId: string | null;
}

/** The plan a reservation is for, e.g. "starter:monthly". */
export function checkoutPlanKey(tier: string, billingInterval: string): string {
  return `${tier}:${billingInterval}`;
}

/**
 * Take the organization's Checkout reservation for `plan`. Returns the new
 * reservation (with the organization's trial eligibility, read in the same
 * statement), or null when the organization records a billable subscription
 * or another reservation is still active.
 */
export async function tryReserveCheckout(
  organizationId: string,
  plan: string,
  executor: Executor = pool
): Promise<CheckoutReservation | null> {
  const reservationId = randomUUID();
  const { rows } = await executor.query(
    `UPDATE organizations
        SET checkout_reservation_id = $2,
            checkout_reservation_plan = $3,
            checkout_reservation_expires_at = NOW() + make_interval(secs => $4),
            checkout_session_id = NULL
      WHERE id = $1
        AND deleted_at IS NULL
        AND NOT ${BILLABLE_SUBSCRIPTION_SQL('$5')}
        AND (checkout_reservation_id IS NULL OR checkout_reservation_expires_at <= NOW())
      RETURNING checkout_reservation_id, ${TRIAL_ELIGIBLE_SQL} AS trial_eligible`,
    [
      organizationId,
      reservationId,
      plan,
      CHECKOUT_SESSION_LIFETIME_SECONDS + RESERVATION_MARGIN_SECONDS,
      TERMINAL_SUBSCRIPTION_STATUSES,
    ]
  );
  return reservationOf(rows);
}

/**
 * Replace reservation `currentReservationId` with a new one for `plan`. Only
 * after the old reservation's session has been expired in Stripe. Compare
 * and swap on the old id: returns null if it is no longer the reservation.
 */
export async function replaceCheckoutReservation(
  organizationId: string,
  currentReservationId: string,
  plan: string
): Promise<CheckoutReservation | null> {
  const reservationId = randomUUID();
  const { rows } = await pool.query(
    `UPDATE organizations
        SET checkout_reservation_id = $3,
            checkout_reservation_plan = $4,
            checkout_reservation_expires_at = NOW() + make_interval(secs => $5),
            checkout_session_id = NULL
      WHERE id = $1
        AND checkout_reservation_id = $2
        AND NOT ${BILLABLE_SUBSCRIPTION_SQL('$6')}
      RETURNING checkout_reservation_id, ${TRIAL_ELIGIBLE_SQL} AS trial_eligible`,
    [
      organizationId,
      currentReservationId,
      reservationId,
      plan,
      CHECKOUT_SESSION_LIFETIME_SECONDS + RESERVATION_MARGIN_SECONDS,
      TERMINAL_SUBSCRIPTION_STATUSES,
    ]
  );
  return reservationOf(rows);
}

/**
 * Record the session created under `reservationId`; the reservation now
 * expires 5 minutes after the session does. Returns false if the
 * reservation is no longer this one.
 */
export async function recordCheckoutSession(
  organizationId: string,
  reservationId: string,
  sessionId: string,
  sessionExpiresAtSeconds: number
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE organizations
        SET checkout_session_id = $3,
            checkout_reservation_expires_at = to_timestamp($4)
      WHERE id = $1 AND checkout_reservation_id = $2`,
    [organizationId, reservationId, sessionId, sessionExpiresAtSeconds + RESERVATION_MARGIN_SECONDS]
  );
  return (rowCount ?? 0) > 0;
}

/** Clear reservation `reservationId` (compare and clear). */
export async function clearCheckoutReservation(organizationId: string, reservationId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE organizations
        SET checkout_reservation_id = NULL,
            checkout_reservation_plan = NULL,
            checkout_reservation_expires_at = NULL,
            checkout_session_id = NULL
      WHERE id = $1 AND checkout_reservation_id = $2`,
    [organizationId, reservationId]
  );
  return (rowCount ?? 0) > 0;
}

/** Clear the reservation whose session is `sessionId` (it completed). */
export async function clearCheckoutReservationForSession(organizationId: string, sessionId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE organizations
        SET checkout_reservation_id = NULL,
            checkout_reservation_plan = NULL,
            checkout_reservation_expires_at = NULL,
            checkout_session_id = NULL
      WHERE id = $1 AND checkout_session_id = $2`,
    [organizationId, sessionId]
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Record `customerId` as the organization's Stripe customer unless it
 * already has one. Returns the customer the organization uses afterwards:
 * an existing customer always wins.
 */
export async function attachCustomerIfAbsent(organizationId: string, customerId: string): Promise<string> {
  await pool.query(
    `UPDATE organizations
        SET stripe_customer_id = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND stripe_customer_id IS NULL`,
    [organizationId, customerId]
  );
  const { rows } = await pool.query('SELECT stripe_customer_id FROM organizations WHERE id = $1', [organizationId]);
  const recorded = rows[0]?.stripe_customer_id as string | null | undefined;
  if (!recorded) throw new Error('Organization has no Stripe customer after recording one');
  return recorded;
}

export async function readCheckoutState(organizationId: string): Promise<CheckoutState | null> {
  const { rows } = await pool.query(
    `SELECT stripe_customer_id,
            subscription_tier,
            ${BILLABLE_SUBSCRIPTION_SQL('$2')} AS has_billable_subscription,
            checkout_reservation_id,
            checkout_reservation_plan,
            (checkout_reservation_id IS NOT NULL AND checkout_reservation_expires_at > NOW()) AS reservation_active,
            checkout_session_id
       FROM organizations
      WHERE id = $1 AND deleted_at IS NULL`,
    [organizationId, TERMINAL_SUBSCRIPTION_STATUSES]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    stripeCustomerId: row.stripe_customer_id,
    subscriptionTier: row.subscription_tier,
    hasBillableSubscription: row.has_billable_subscription === true,
    reservationId: row.checkout_reservation_id,
    reservationPlan: row.checkout_reservation_plan,
    reservationActive: row.reservation_active === true,
    sessionId: row.checkout_session_id,
  };
}
