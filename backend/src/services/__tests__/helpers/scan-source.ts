/**
 * Test setup for discovery over fake clients.
 *
 * A scan reads its account from the record AWSClientFactory.createClients()
 * keeps for the clients it built (assumedRoleSourceOf, scan-context.ts) and
 * refuses to start without one. A test that replaces createClients() with
 * fake clients stubs that record too, with a placeholder account whose
 * credentials do not expire during the test.
 *
 * Placeholders only: the documented example account ID and ARN.
 */
import { Pool } from 'pg';
import * as clientFactory from '../../aws-client-factory.service';
import { HeldLease, acquireJobLease, acquireScanLease } from '../../scan-lease';
import { DISCOVERY_JOB_NAME, SCAN_KIND_DISCOVERY, onTaggedConnection } from '../../scan-session';
import { ensureSharedFixtureTable } from '../../../routes/__tests__/shared-fixture-tables';
import type { AwsAccountRow } from '../../../repositories/aws-accounts.repository';

export const PLACEHOLDER_ACCOUNT_ROW: AwsAccountRow = {
  id: '00000000-0000-4000-8000-0000000000a1',
  org_id: '00000000-0000-4000-8000-0000000000a2',
  account_id: '123456789012',
  role_arn: 'arn:aws:iam::123456789012:role/devcontrol-readonly',
  external_id: 'placeholder-external-id',
  region: 'us-east-1',
  nickname: null,
  status: 'active',
  connected_at: null,
};

/** Every set of clients has the placeholder account's record. */
export function stubScanSource(): jest.SpyInstance {
  return jest.spyOn(clientFactory, 'assumedRoleSourceOf').mockImplementation(() => ({
    organizationId: PLACEHOLDER_ACCOUNT_ROW.org_id,
    account: { ...PLACEHOLDER_ACCOUNT_ROW },
    region: 'us-east-1',
    credentials: { accessKeyId: 'ASIAPLACEHOLDER', secretAccessKey: 'placeholder-secret', sessionToken: 'placeholder-token' },
    expiration: new Date(Date.now() + 60 * 60 * 1000),
  }));
}

/**
 * Gives `organizationId` one eligible aws_accounts row naming the placeholder
 * account (multi-region plan M4b): a scan leases the account its ScanContext names
 * (the stub above), and every fenced write checks the database's one eligible
 * account against it (scan-lease.ts fenceScanLease). The fixture's account_id
 * column is UNIQUE, so each organization gets its own (non-numeric) value; the role
 * ARN, which the fence reads, is the placeholder's. Remove with
 * removePlaceholderAccounts().
 */
export async function connectPlaceholderAccount(pool: Pool, organizationId: string): Promise<void> {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, status)
     VALUES ($1, $2, $3, 'placeholder-external-id', 'us-east-1', 'active')
     ON CONFLICT (org_id) DO NOTHING`,
    [organizationId, PLACEHOLDER_ACCOUNT_ROW.role_arn, placeholderAccountColumn(organizationId)]
  );
}

export async function removePlaceholderAccounts(pool: Pool, organizationIds: string[]): Promise<void> {
  if (organizationIds.length === 0) return;
  await pool.query(`DELETE FROM aws_accounts WHERE org_id = ANY($1) AND account_id LIKE 'ph-%'`, [organizationIds]);
}

/** The fixture's account_id (VARCHAR(32), UNIQUE): one per organization, never a 12-digit id. */
function placeholderAccountColumn(organizationId: string): string {
  return `ph-${organizationId.replace(/-/g, '').slice(0, 29)}`;
}

/** How long a test lease is held: no heartbeat renews it, so it outlives any one test file. */
const TEST_LEASE_TTL_SECONDS = 60 * 60;

/**
 * Real leases for the organizations a test creates (multi-region plan M4b): every
 * destructive repository method requires one and starts its transaction with the
 * commit fence, which passes only for a lease that is really held. `scan` connects
 * the placeholder account first (the scan-lease fence checks the database's
 * account); `job` is the cron's job lease. Hold one per organization when it is
 * created; of() returns it.
 */
export class TestLeases {
  private readonly held = new Map<string, HeldLease>();

  constructor(private readonly pool: Pool, private readonly kind: 'scan' | 'job' = 'scan') {}

  async hold(organizationId: string): Promise<HeldLease> {
    const existing = this.held.get(organizationId);
    if (existing) return existing;
    if (this.kind === 'scan') await connectPlaceholderAccount(this.pool, organizationId);
    const lease = await onTaggedConnection(this.pool, organizationId, (client) =>
      this.kind === 'scan'
        ? acquireScanLease(
            client,
            { organizationId, awsAccountId: PLACEHOLDER_ACCOUNT_ROW.account_id!, scanKind: SCAN_KIND_DISCOVERY },
            'test-lease-holder',
            { ttlSeconds: TEST_LEASE_TTL_SECONDS }
          )
        : acquireJobLease(client, { organizationId, jobName: DISCOVERY_JOB_NAME }, 'test-lease-holder', { ttlSeconds: TEST_LEASE_TTL_SECONDS })
    );
    if (!lease) throw new Error(`TestLeases: the ${this.kind} lease of a test organization is already held`);
    this.held.set(organizationId, lease);
    return lease;
  }

  /** Removes the placeholder accounts hold() connected (the leases go with their organizations). */
  async cleanup(): Promise<void> {
    if (this.kind === 'scan') await removePlaceholderAccounts(this.pool, [...this.held.keys()]);
  }

  /**
   * Records a lease the test acquired itself (a real one, e.g. inside its own
   * rolled-back transaction), so of() returns it.
   */
  remember(organizationId: string, lease: HeldLease): void {
    this.held.set(organizationId, lease);
  }

  /** The lease hold() acquired (or remember() recorded) for the organization. */
  of(organizationId: string): HeldLease {
    const lease = this.held.get(organizationId);
    if (!lease) throw new Error('TestLeases: no lease was held for this test organization (call hold() when creating it)');
    return lease;
  }
}
