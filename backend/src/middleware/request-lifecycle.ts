/**
 * Request connection lease.
 *
 * A request's checked-out client is released when the response is done
 * (`finish` or `close`), as before. What changes is what the request context
 * holds: not the client itself but a handle bound to the organization that
 * was verified for this request. Releasing the lease revokes the handle
 * before the client goes back to the pool, so the released connection is
 * never reached through the request again; request work that queries after
 * that runs on a fresh connection tagged for the same verified organization
 * (see createRequestClientHandle in config/database.ts).
 */
import type { Response } from 'express';
import { PoolClient } from 'pg';
import { createRequestClientHandle } from '../config/database';

export interface RequestClientLease {
  readonly released: boolean;
  /**
   * Records the organization verified for this request and returns the
   * handle to bind as the requestContext store. Call once, only after the
   * organization has been authorized. On an already-released lease the
   * handle starts revoked: it never reaches this lease's connection.
   */
  bindVerifiedOrganization(organizationId: string): PoolClient;
  /** Revokes the handle (if bound), then returns the client to the pool. Idempotent. */
  release(err?: Error): void;
}

/** Each response's lease, so a handler can give its connection back early (releaseRequestConnection). */
const requestLeases = new WeakMap<Response, RequestClientLease>();

export function leaseRequestClient(client: PoolClient, res: Response): RequestClientLease {
  let released = false;
  let revokeHandle: (() => void) | null = null;

  const release = (err?: Error) => {
    if (released) return;
    released = true;
    // Revoke first: from here on the handle never touches `client`.
    revokeHandle?.();
    client.release(err);
  };

  res.on('finish', () => release());
  res.on('close', () => release());

  const lease: RequestClientLease = {
    get released() {
      return released;
    },
    bindVerifiedOrganization(organizationId: string): PoolClient {
      if (revokeHandle) throw new Error('Request lease is already bound to an organization');
      const { handle, revoke } = createRequestClientHandle(client, organizationId);
      revokeHandle = revoke;
      if (released) revoke();
      return handle;
    },
    release,
  };
  requestLeases.set(res, lease);
  return lease;
}

/**
 * Returns the request's connection to the pool now, before the response ends,
 * for a handler about to wait on something slow that needs no database (an
 * external API call). The handle is revoked first, exactly as at `finish`:
 * every later `pool.query` of this request runs on its own fresh connection,
 * tagged for the same verified organization, borrowed for that one statement
 * and returned at once (createRequestClientHandle in config/database.ts).
 * Work needing one session across statements must hold its own client.
 *
 * Returns true if this call released it; false if there was no lease for
 * `res` or it was already released. Idempotent.
 */
export function releaseRequestConnection(res: Response): boolean {
  const lease = requestLeases.get(res);
  if (!lease || lease.released) return false;
  lease.release();
  return true;
}
