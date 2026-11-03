/**
 * GET /api/aws-resources/discovery/jobs never returns a discovery step's own
 * error text (raw provider errors, SQL, ARNs, stack traces): only the approved
 * fixed messages, matched exactly, pass through. The stored column is unchanged.
 * Real Postgres; placeholder identifiers only.
 */
import { Pool } from 'pg';
import { AWSResourcesRepository } from '../awsResources.repository';
import {
  COST_NO_CHECK_COMPLETED_MESSAGE,
  DISCOVERY_FAILED_MESSAGE,
  DISCOVERY_STEPS_INCOMPLETE_MESSAGE,
  approvedDiscoveryMessages,
  publicDiscoveryErrorMessage,
} from '../../services/discovery-job-messages';
import { DISCOVERY_FAILED_MESSAGE as DISCOVERY_FAILED_FROM_SERVICE } from '../../services/awsResourceDiscovery';
import { DISCOVERY_INTERRUPTED_MESSAGE, DISCOVERY_LEASE_LOST_MESSAGE } from '../../services/scan-session';
import { PLATFORM_AWS_UNAVAILABLE_MESSAGE } from '../../services/platform-sts';
import { DISCOVERY_WARNING_TRUNCATED_INDEX } from '../../services/discovery-warnings';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const createdOrgIds: string[] = [];

const RAW_PROVIDER = 'EC2: AccessDeniedException: User: arn:aws:sts::123456789012:assumed-role/placeholder-role/session is not authorized to perform: ec2:DescribeInstances';
const RAW_SQL = 'Cost analysis: duplicate key value violates unique constraint "idx_cost_recommendations_active_identity" DETAIL: Key (organization_id)=(00000000-0000-0000-0000-000000000000) already exists.';
const RAW_ARN = 'S3: arn:aws:s3:::placeholder-bucket access denied';
const RAW_STACK = 'Lambda: TypeError: Cannot read properties of undefined (reading \'Functions\')\n    at LambdaScanner.list (/opt/app/backend/dist/services/lambda.js:42:17)';
const RAW_RESOURCE = 'EBS reconciliation: volume vol-0123456789abcdef0 in i-1234567890abcdef0 not found';
// An approved message with raw text appended: no prefix match.
const APPROVED_PREFIX_PLUS_RAW = `${DISCOVERY_FAILED_MESSAGE} arn:aws:iam::123456789012:role/placeholder-role`;
const RAW_EXAMPLES = [RAW_PROVIDER, RAW_SQL, RAW_ARN, RAW_STACK, RAW_RESOURCE, APPROVED_PREFIX_PLUS_RAW];
const RAW_FRAGMENTS = ['arn:aws', 'AccessDenied', 'duplicate key', 'DETAIL', '123456789012', 'TypeError', '/opt/app', 'vol-0123456789abcdef0', 'i-1234567890abcdef0', 'Cost analysis: duplicate'];

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free') RETURNING id`,
    [`Jobs Error Org ${suffix}`, `jobs-error-org-${suffix}`, `Jobs Error Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id;
}

async function insertJob(orgId: string, minutesAgo: number, errorMessage: string | null, status = 'completed') {
  await pool.query(
    `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, created_at, error_message)
     VALUES ($1, $2, NOW() - make_interval(mins => $3), NOW() - make_interval(mins => $3), $4)`,
    [orgId, status, minutesAgo, errorMessage]
  );
}

async function listed(orgId: string) {
  await pool.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
  return new AWSResourcesRepository(pool).getDiscoveryJobs(orgId, 50);
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM resource_discovery_jobs WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('publicDiscoveryErrorMessage (pure)', () => {
  it('the allowlist is exactly the five approved messages', () => {
    expect([...approvedDiscoveryMessages()].sort()).toEqual([
      DISCOVERY_FAILED_MESSAGE,
      PLATFORM_AWS_UNAVAILABLE_MESSAGE,
      DISCOVERY_LEASE_LOST_MESSAGE,
      DISCOVERY_INTERRUPTED_MESSAGE,
      'Cost analysis: none of the checks completed.',
    ].sort());
    expect(COST_NO_CHECK_COMPLETED_MESSAGE).toBe('Cost analysis: none of the checks completed.');
    expect(DISCOVERY_STEPS_INCOMPLETE_MESSAGE).toBe("Some discovery steps didn't complete.");
    // The service still exports the same constant its writers use.
    expect(DISCOVERY_FAILED_FROM_SERVICE).toBe(DISCOVERY_FAILED_MESSAGE);
  });

  it.each(approvedDiscoveryMessages().map((m) => [m]))('passes the approved message through unchanged: %s', (message) => {
    expect(publicDiscoveryErrorMessage(message)).toBe(message);
  });

  it.each(RAW_EXAMPLES.map((m) => [m]))('replaces raw text: %s', (message) => {
    expect(publicDiscoveryErrorMessage(message)).toBe(DISCOVERY_STEPS_INCOMPLETE_MESSAGE);
  });

  it('keeps approved segments, replaces every raw one, and states the replacement once', () => {
    const stored = [RAW_PROVIDER, COST_NO_CHECK_COMPLETED_MESSAGE, RAW_SQL, RAW_STACK].join('; ');
    expect(publicDiscoveryErrorMessage(stored)).toBe(`${DISCOVERY_STEPS_INCOMPLETE_MESSAGE}; ${COST_NO_CHECK_COMPLETED_MESSAGE}`);
  });

  it('an approved message that contains the separator itself survives between raw segments', () => {
    expect(PLATFORM_AWS_UNAVAILABLE_MESSAGE).toContain('; ');
    const stored = [RAW_ARN, PLATFORM_AWS_UNAVAILABLE_MESSAGE, RAW_STACK].join('; ');
    expect(publicDiscoveryErrorMessage(stored)).toBe(`${DISCOVERY_STEPS_INCOMPLETE_MESSAGE}; ${PLATFORM_AWS_UNAVAILABLE_MESSAGE}`);
    // Half of it is not the message.
    expect(publicDiscoveryErrorMessage('DevControl cannot reach AWS right now. This is not a problem with your AWS account or role')).toBe(DISCOVERY_STEPS_INCOMPLETE_MESSAGE);
  });

  it('null and empty stay empty', () => {
    expect(publicDiscoveryErrorMessage(null)).toBeNull();
    expect(publicDiscoveryErrorMessage(undefined)).toBeNull();
    expect(publicDiscoveryErrorMessage('')).toBeNull();
  });
});

describe('GET /discovery/jobs (repository, real Postgres)', () => {
  it('never returns raw provider, SQL, ARN, resource or stack-trace text; approved messages unchanged; stored column unchanged', async () => {
    const orgId = await insertOrg();
    for (const [index, message] of RAW_EXAMPLES.entries()) await insertJob(orgId, 100 + index, message, 'failed');
    for (const [index, message] of approvedDiscoveryMessages().entries()) await insertJob(orgId, 10 + index, message, 'failed');
    await insertJob(orgId, 1, `${RAW_ARN}; ${DISCOVERY_WARNING_TRUNCATED_INDEX}`);
    await insertJob(orgId, 0, null);

    const jobs = await listed(orgId);
    const body = JSON.stringify(jobs);

    for (const fragment of RAW_FRAGMENTS) expect(body).not.toContain(fragment);
    const messages = jobs.map((job: any) => job.error_message);
    expect(messages[0]).toBeNull();
    expect(jobs[1]).toMatchObject({ error_message: DISCOVERY_STEPS_INCOMPLETE_MESSAGE, warnings: [DISCOVERY_WARNING_TRUNCATED_INDEX] });
    expect(messages.slice(2, 7).sort()).toEqual([...approvedDiscoveryMessages()].sort());
    expect(messages.slice(7)).toEqual(RAW_EXAMPLES.map(() => DISCOVERY_STEPS_INCOMPLETE_MESSAGE));

    // Diagnostics keep the full text.
    const { rows } = await pool.query(`SELECT error_message FROM resource_discovery_jobs WHERE organization_id = $1 AND error_message = $2`, [orgId, RAW_PROVIDER]);
    expect(rows).toHaveLength(1);
  });

  it("one organization's list never includes the other's jobs", async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    await insertJob(orgA, 5, DISCOVERY_FAILED_MESSAGE, 'failed');
    await insertJob(orgB, 4, DISCOVERY_INTERRUPTED_MESSAGE, 'failed');
    await insertJob(orgB, 3, null);

    const a = await listed(orgA);
    const b = await listed(orgB);

    expect(a.map((job: any) => job.organization_id)).toEqual([orgA]);
    expect(a.map((job: any) => job.error_message)).toEqual([DISCOVERY_FAILED_MESSAGE]);
    expect(b.map((job: any) => job.organization_id)).toEqual([orgB, orgB]);
  });
});
