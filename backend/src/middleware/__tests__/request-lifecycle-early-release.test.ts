/**
 * releaseRequestConnection (review H1 layer 1): a handler can give its pooled
 * connection back before the response ends; the handle is revoked first, so
 * the released client is never reached through the request again.
 */
import { EventEmitter } from 'events';
import type { Response } from 'express';
import type { PoolClient } from 'pg';
import { leaseRequestClient, releaseRequestConnection } from '../request-lifecycle';

function fakeClient() {
  return { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() } as unknown as PoolClient & { query: jest.Mock; release: jest.Mock };
}

describe('releaseRequestConnection', () => {
  it('releases the leased client once, revokes the handle, and is idempotent', async () => {
    const res = new EventEmitter() as unknown as Response;
    const client = fakeClient();
    const lease = leaseRequestClient(client, res);
    const handle = lease.bindVerifiedOrganization('00000000-0000-4000-8000-000000000001');
    await handle.query('SELECT 1');
    expect(client.query).toHaveBeenCalledTimes(1);

    expect(releaseRequestConnection(res)).toBe(true);
    expect(lease.released).toBe(true);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(releaseRequestConnection(res)).toBe(false);
    (res as unknown as EventEmitter).emit('finish');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for a response with no lease', () => {
    expect(releaseRequestConnection(new EventEmitter() as unknown as Response)).toBe(false);
  });
});
