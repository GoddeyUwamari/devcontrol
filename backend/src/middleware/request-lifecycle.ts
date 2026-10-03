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

  return {
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
}
