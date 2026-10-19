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
import * as clientFactory from '../../aws-client-factory.service';
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
