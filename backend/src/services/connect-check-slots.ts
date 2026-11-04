/**
 * Admission for the connect flow's role check (POST /api/aws/accounts), which
 * can wait on AWS for up to about 25 seconds (connect-role-check.ts):
 *
 *   single-flight  at most one check per organization at a time, keyed by the
 *                  AUTHENTICATED organization ID (req.user.organizationId, set
 *                  by authenticate from the verified token and a current
 *                  membership) -- never by anything the caller sends;
 *   cap            at most `limit` checks at once in this process.
 *
 * PROCESS-LOCAL. Both are held in this Node.js process's memory. They bound
 * what one backend process does, not the platform: N processes or hosts allow
 * N x limit checks, and one organization could run one check per process.
 * Production today is a single PM2 process. A platform-wide limit needs a
 * shared store (for example a database lease) and is not provided here.
 *
 * ATOMIC. tryAcquire checks and records in one synchronous call with no await
 * in between, so on Node's single thread two requests can never both pass a
 * check before either records its slot. The caller acquires before any AWS
 * call and releases in `finally`; release is idempotent.
 */

export type ConnectSlotRefusal = 'org_busy' | 'at_capacity';

export interface ConnectSlot {
  /** Frees the organization and the process slot. Safe to call more than once. */
  release(): void;
}

export type ConnectSlotResult = { ok: true; slot: ConnectSlot } | { ok: false; reason: ConnectSlotRefusal };

/** Concurrent connect checks per process. */
export const DEFAULT_CONNECT_CHECK_LIMIT = 5;

export class ConnectCheckSlots {
  private readonly busyOrganizations = new Set<string>();
  private active = 0;

  constructor(private limit: number = DEFAULT_CONNECT_CHECK_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('ConnectCheckSlots: limit must be a positive integer');
  }

  /** Checks in flight in this process. */
  get inFlight(): number {
    return this.active;
  }

  /**
   * Admits one check for `organizationId` or refuses it. An organization that
   * already has a check running is refused as org_busy before the cap is
   * considered, so a second click by the same owner always gets that answer.
   */
  tryAcquire(organizationId: string): ConnectSlotResult {
    if (typeof organizationId !== 'string' || organizationId === '') {
      throw new Error('ConnectCheckSlots: an authenticated organization ID is required');
    }
    if (this.busyOrganizations.has(organizationId)) return { ok: false, reason: 'org_busy' };
    if (this.active >= this.limit) return { ok: false, reason: 'at_capacity' };
    this.busyOrganizations.add(organizationId);
    this.active += 1;
    let released = false;
    return {
      ok: true,
      slot: {
        release: () => {
          if (released) return;
          released = true;
          this.busyOrganizations.delete(organizationId);
          this.active -= 1;
        },
      },
    };
  }
}
