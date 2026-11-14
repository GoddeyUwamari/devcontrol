import cron from 'node-cron';
import { Pool } from 'pg';
import { DEMO_EXCLUSION_SQL } from '../demo/demo-workspace';

/**
 * Grace Period Enforcement Job
 *
 * Reconciliation backstop for the payment-failure lifecycle (see
 * backend/src/controllers/stripe.controller.ts's handleInvoicePaymentFailed/
 * handleInvoicePaid and backend/src/middleware/subscription.middleware.ts's
 * isOrgRestricted). Enforcement itself is already lazy -- isOrgRestricted
 * treats a 'grace_period' organization whose grace_period_ends_at has
 * passed as restricted on every request, with or without this job ever
 * running. This job exists only to keep the *persisted*
 * billing_lifecycle_state consistent with that reality (flipping
 * 'grace_period' -> 'restricted' once the deadline passes), so anything
 * that reads billing_lifecycle_state directly (reporting, support tooling,
 * a future admin view) sees an accurate value even for an organization
 * that hasn't made a request since its grace period expired.
 *
 * Deliberately does nothing else: it never touches subscription_tier,
 * subscription_status, or any Stripe object, and never sends a
 * notification (the payment-failure email already went out when the
 * grace period *started*, not when it ends).
 */
export class GracePeriodEnforcementJob {
  private task: ReturnType<typeof cron.schedule> | null = null;

  constructor(private pool: Pool) {}

  /**
   * Runs once per hour. A grace period is measured in days, so hourly
   * resolution is far more than sufficient -- this is a backstop for the
   * lazy check above, not the primary enforcement mechanism.
   */
  start(): void {
    if (this.task) {
      console.log('[Grace Period Enforcement Job] Already running');
      return;
    }

    this.task = cron.schedule('0 * * * *', async () => {
      try {
        await this.enforceExpiredGracePeriods();
      } catch (error: any) {
        console.error('[Grace Period Enforcement Job] Error during run:', error.message);
      }
    });

    console.log('[Grace Period Enforcement Job] Started - checking for expired grace periods every hour');
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }

  async enforceExpiredGracePeriods(): Promise<number> {
    const result = await this.pool.query(
      // The demo organization can never be in a grace period (its CHECK, admin
      // migration 202611141200); it is excluded here all the same, like every job.
      `UPDATE organizations o
       SET billing_lifecycle_state = 'restricted'
       WHERE o.billing_lifecycle_state = 'grace_period'
         AND o.grace_period_ends_at IS NOT NULL
         AND o.grace_period_ends_at < NOW()
         AND ${DEMO_EXCLUSION_SQL}
       RETURNING o.id`
    );

    if (result.rows.length > 0) {
      console.log(`[Grace Period Enforcement Job] Restricted ${result.rows.length} organization(s) with expired grace periods`);
    }

    return result.rows.length;
  }
}
