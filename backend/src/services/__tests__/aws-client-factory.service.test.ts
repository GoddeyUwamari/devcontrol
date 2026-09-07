/**
 * Phase 3E, Checkpoint A: AWSClientFactory's new getDynamoDBClientForRegion
 * capability must be purely additive -- every pre-existing field/client on
 * the returned AWSClients object must be unaffected, and building a regional
 * DynamoDB client must never require (or trigger) a new AssumeRole call.
 *
 * createClientsFromEnv() and createMockClients() are tested directly (no
 * external dependency -- no DB, no STS) since they exercise the same
 * `getDynamoDBClientForRegion` code shape used by the AssumeRole
 * (production) path in createClients(). createClients()'s own
 * AWS_NOT_CONNECTED/dev-fallback branches are tested by mocking the pool
 * this file's only DB dependency.
 */
import { EC2Client } from '@aws-sdk/client-ec2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { AWSClientFactory } from '../aws-client-factory.service';

jest.mock('../../config/database', () => ({
  pool: { query: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { pool } = require('../../config/database');

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.resetAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('AWSClientFactory.createClientsFromEnv -- getDynamoDBClientForRegion is additive', () => {
  it('every pre-existing client field is still present and correctly shaped', () => {
    process.env.AWS_ACCESS_KEY_ID = 'test-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
    process.env.AWS_REGION = 'us-east-1';

    const clients = AWSClientFactory.createClientsFromEnv();

    expect(clients.ec2).toBeInstanceOf(EC2Client);
    expect(clients.dynamodb).toBeInstanceOf(DynamoDBClient);
    expect(clients.region).toBe('us-east-1');
    expect(clients.enabled).toBe(true);
  });

  it('getDynamoDBClientForRegion builds a real DynamoDBClient for the given region, independent of the default `region` field', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'test-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
    process.env.AWS_REGION = 'us-east-1';

    const clients = AWSClientFactory.createClientsFromEnv();
    const regionalClient = clients.getDynamoDBClientForRegion('eu-west-1');

    expect(regionalClient).toBeInstanceOf(DynamoDBClient);
    expect(await regionalClient.config.region()).toBe('eu-west-1');
    // The default `dynamodb` client is unaffected -- still the org's configured region.
    expect(await clients.dynamodb.config.region()).toBe('us-east-1');
  });

  it('two calls for different regions produce two distinct client instances', () => {
    process.env.AWS_ACCESS_KEY_ID = 'test-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
    process.env.AWS_REGION = 'us-east-1';

    const clients = AWSClientFactory.createClientsFromEnv();
    const a = clients.getDynamoDBClientForRegion('us-west-2');
    const b = clients.getDynamoDBClientForRegion('ap-southeast-1');

    expect(a).not.toBe(b);
  });

  it('falls back to mock clients (enabled: false) when no env credentials are configured -- unchanged pre-existing behavior', () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_REGION;

    const clients = AWSClientFactory.createClientsFromEnv();

    expect(clients.enabled).toBe(false);
    // Additive field must still exist on the mock shape and must not throw.
    expect(() => clients.getDynamoDBClientForRegion('us-east-1')).not.toThrow();
  });
});

describe('AWSClientFactory.createClients -- pre-existing AWS_NOT_CONNECTED/dev-fallback behavior is unchanged', () => {
  it('throws AWS_NOT_CONNECTED in production when the org has no aws_accounts row', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    pool.query.mockResolvedValueOnce({ rows: [] });

    await expect(AWSClientFactory.createClients('org-without-aws')).rejects.toThrow('AWS_NOT_CONNECTED');

    process.env.NODE_ENV = originalNodeEnv;
  });

  it('throws AWS_NOT_CONNECTED when the aws_accounts row is missing external_id', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    pool.query.mockResolvedValueOnce({
      rows: [{ role_arn: 'arn:aws:iam::123456789012:role/x', external_id: null, region: 'us-east-1' }],
    });

    await expect(AWSClientFactory.createClients('org-missing-external-id')).rejects.toThrow('AWS_NOT_CONNECTED');

    process.env.NODE_ENV = originalNodeEnv;
  });
});
