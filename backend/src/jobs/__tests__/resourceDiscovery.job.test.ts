/**
 * Phase 5 -- SOC 2 evidence computation trigger integration (Option B: the existing
 * 6-hour scheduled discovery job, and only that job).
 *
 * AWSResourceDiscoveryService and Soc2EvidenceService are both replaced with mocks --
 * this suite is about runDiscoveryForAllOrganizations()'s own per-organization
 * sequencing and failure-isolation logic, not AWS discovery or SOC2 computation
 * semantics themselves (those are covered by awsResourceDiscovery's own tests and
 * soc2-evidence.service.test.ts respectively). Organizations are real rows in a live
 * Postgres DB (same convention as every other live-DB SOC2 test) because
 * runDiscoveryForAllOrganizations() queries `organizations` directly; assertions are
 * always scoped to this file's own created org ids via .toHaveBeenCalledWith / filter,
 * so any other pre-existing active organization in the shared test database cannot
 * make an assertion here pass or fail incorrectly.
 *
 * The job only runs discovery for an organization with an active aws_accounts
 * row, so insertOrg() connects one by default. The skip/inactive/failure
 * counting tests call scanOrganizations() with an explicit list, so the run's
 * summary counts only this file's organizations.
 */
import fs from 'fs';
import path from 'path';
import { Pool, PoolClient, QueryResult } from 'pg';

const mockDiscoverAllResources = jest.fn();
const mockComputeAndPersistEvidence = jest.fn();

jest.mock('../../services/awsResourceDiscovery', () => ({
  AWSResourceDiscoveryService: jest.fn().mockImplementation(() => ({
    discoverAllResources: mockDiscoverAllResources,
  })),
}));

jest.mock('../../services/soc2-evidence.service', () => ({
  Soc2EvidenceService: jest.fn().mockImplementation(() => ({
    computeAndPersistEvidence: mockComputeAndPersistEvidence,
  })),
}));

import { ResourceDiscoveryJob } from '../resourceDiscovery.job';
import { PlatformAwsCredentialsUnavailableError } from '../../services/platform-sts';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const pool = new Pool(dbConfig());
const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function successfulDiscovery(overrides: { errors?: string[] } = {}) {
  return {
    job_id: `job-${uniqueSuffix()}`,
    resources_discovered: 0,
    resources_updated: 0,
    resources_deleted: 0,
    errors: overrides.errors ?? [],
  };
}

/** A random 12-digit placeholder account ID; never a real account. */
function placeholderAccountId(): string {
  return String(Math.floor(1e11 + Math.random() * 9e11));
}

/** awsStatus: the aws_accounts row's status, or 'none' for no row at all. */
async function insertOrg(awsStatus: string | null | 'none' = 'active'): Promise<{ id: string; name: string }> {
  const suffix = uniqueSuffix();
  const name = `Discovery Job Org ${suffix}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status, is_active)
     VALUES ($1, $2, $3, 'free', 'free', true)
     RETURNING id, name`,
    [name, `discovery-job-org-${suffix}`, name]
  );
  createdOrgIds.push(rows[0].id);
  if (awsStatus !== 'none') {
    const accountId = placeholderAccountId();
    await pool.query(
      `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, connected_at, status)
       VALUES ($1, $2, $3, 'placeholder-external-id', 'us-east-1', NOW(), $4)`,
      [rows[0].id, `arn:aws:iam::${accountId}:role/DevControlRole`, accountId, awsStatus]
    );
  }
  return rows[0];
}

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
});

describe('ResourceDiscoveryJob — SOC 2 evidence trigger integration (Phase 5, Option B)', () => {
  let job: ResourceDiscoveryJob;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDiscoverAllResources.mockResolvedValue(successfulDiscovery());
    mockComputeAndPersistEvidence.mockResolvedValue(undefined);
    job = new ResourceDiscoveryJob(pool);
  });

  it('calls computeAndPersistEvidence(org.id) after discoverAllResources(org.id) succeeds', async () => {
    const org = await insertOrg();

    await job.triggerManualScan();

    expect(mockDiscoverAllResources).toHaveBeenCalledWith(org.id);
    expect(mockComputeAndPersistEvidence).toHaveBeenCalledWith(org.id);
  });

  it('a partially-erred but non-throwing discovery result (e.g. cost-analysis failed) still triggers SOC 2 computation', async () => {
    const org = await insertOrg();
    mockDiscoverAllResources.mockImplementation(async (id: string) =>
      id === org.id ? successfulDiscovery({ errors: ['Cost analysis: boom'] }) : successfulDiscovery()
    );

    await job.triggerManualScan();

    expect(mockComputeAndPersistEvidence).toHaveBeenCalledWith(org.id);
  });

  it('does NOT call computeAndPersistEvidence for an organization whose discoverAllResources call throws', async () => {
    const org = await insertOrg();
    mockDiscoverAllResources.mockImplementation(async (id: string) => {
      if (id === org.id) throw new Error('discovery blew up');
      return successfulDiscovery();
    });

    await job.triggerManualScan();

    expect(mockComputeAndPersistEvidence).not.toHaveBeenCalledWith(org.id);
  });

  it('a SOC 2 computation failure does not throw out of the job and does not stop the loop', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    mockComputeAndPersistEvidence.mockImplementation(async (id: string) => {
      if (id === orgA.id) throw new Error('soc2 computation blew up');
      return undefined;
    });

    await expect(job.triggerManualScan()).resolves.toBeUndefined();

    // Both organizations still got a discovery AND a SOC2 attempt -- orgA's SOC2
    // attempt simply failed internally without aborting the sweep.
    expect(mockDiscoverAllResources).toHaveBeenCalledWith(orgA.id);
    expect(mockDiscoverAllResources).toHaveBeenCalledWith(orgB.id);
    expect(mockComputeAndPersistEvidence).toHaveBeenCalledWith(orgA.id);
    expect(mockComputeAndPersistEvidence).toHaveBeenCalledWith(orgB.id);
  });

  it("one organization's discovery failure does not prevent the next organization from being processed (discovery and SOC2 both)", async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    mockDiscoverAllResources.mockImplementation(async (id: string) => {
      if (id === orgA.id) throw new Error('discovery blew up for A');
      return successfulDiscovery();
    });

    await job.triggerManualScan();

    expect(mockComputeAndPersistEvidence).not.toHaveBeenCalledWith(orgA.id);
    expect(mockDiscoverAllResources).toHaveBeenCalledWith(orgB.id);
    expect(mockComputeAndPersistEvidence).toHaveBeenCalledWith(orgB.id);
  });

  it('calls discoverAllResources before computeAndPersistEvidence for the same organization (ordering)', async () => {
    const org = await insertOrg();
    const callOrder: string[] = [];
    mockDiscoverAllResources.mockImplementation(async (id: string) => {
      if (id === org.id) callOrder.push('discover');
      return successfulDiscovery();
    });
    mockComputeAndPersistEvidence.mockImplementation(async (id: string) => {
      if (id === org.id) callOrder.push('soc2');
    });

    await job.triggerManualScan();

    expect(callOrder).toEqual(['discover', 'soc2']);
  });
});

describe('ResourceDiscoveryJob — which organizations are scanned, and how each outcome is counted and logged', () => {
  let job: ResourceDiscoveryJob;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  const logged = (spy: jest.SpyInstance) => spy.mock.calls.map((args) => args.map(String).join(' '));

  beforeEach(() => {
    jest.clearAllMocks();
    mockDiscoverAllResources.mockResolvedValue(successfulDiscovery());
    mockComputeAndPersistEvidence.mockResolvedValue(undefined);
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
    job = new ResourceDiscoveryJob(pool);
  });

  afterEach(() => {
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  it('an organization with no aws_accounts row is skipped silently: no discovery, no SOC 2, nothing logged for it', async () => {
    const org = await insertOrg('none');

    const summary = await job.scanOrganizations([org]);

    expect(summary).toEqual({ scanned: 0, skipped: 1, inactive: 0, failed: 0, platformFailed: 0, notAttempted: 0 });
    expect(mockDiscoverAllResources).not.toHaveBeenCalled();
    expect(mockComputeAndPersistEvidence).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(logged(log).filter((line) => line.includes(org.id))).toEqual([]);
  });

  it.each([['disconnected'], [null]])('an aws_accounts row with status %p: one warning naming the org and status, no discovery, no error', async (status) => {
    const org = await insertOrg(status);

    const summary = await job.scanOrganizations([org]);

    expect(summary).toEqual({ scanned: 0, skipped: 0, inactive: 1, failed: 0, platformFailed: 0, notAttempted: 0 });
    expect(mockDiscoverAllResources).not.toHaveBeenCalled();
    expect(logged(warn)).toEqual([`[Resource Discovery Job] Skipping org ${org.id}: AWS connection status is ${status ?? 'null'}, not active`]);
    expect(error).not.toHaveBeenCalled();
  });

  it("the organization's own AssumeRole failure is an error naming the error class, counted as failed, and the run continues", async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    mockDiscoverAllResources.mockImplementation(async (id: string) => {
      if (id === orgA.id) throw new Error(`AWS_NOT_CONNECTED: org ${id} has not connected an AWS account`);
      return successfulDiscovery();
    });

    const summary = await job.scanOrganizations([orgA, orgB]);

    expect(summary).toEqual({ scanned: 1, skipped: 0, inactive: 0, failed: 1, platformFailed: 0, notAttempted: 0 });
    expect(logged(error)).toEqual([
      `[Resource Discovery Job] Failed for org ${orgA.id} (Error): AWS_NOT_CONNECTED: org ${orgA.id} has not connected an AWS account`,
    ]);
    expect(warn).not.toHaveBeenCalled();
    expect(mockDiscoverAllResources).toHaveBeenCalledWith(orgB.id);
    expect(mockComputeAndPersistEvidence).not.toHaveBeenCalledWith(orgA.id);
    expect(mockComputeAndPersistEvidence).toHaveBeenCalledWith(orgB.id);
  });

  /** Every name, ARN and account ID below is a placeholder. */
  const credentialFailure = () =>
    new PlatformAwsCredentialsUnavailableError(
      Object.assign(new Error('Could not load credentials from any providers'), { name: 'CredentialsProviderError' })
    );
  const platformIamDenial = () =>
    new PlatformAwsCredentialsUnavailableError(
      Object.assign(
        new Error(
          'User: arn:aws:sts::111122223333:assumed-role/DevControlInstanceRole/i-0123456789abcdef0 is not authorized to perform: ' +
          'sts:AssumeRole on resource: arn:aws:iam::444455556666:role/PlaceholderCustomRole because no identity-based policy allows the sts:AssumeRole action'
        ),
        { name: 'AccessDenied' }
      )
    );
  const credentialFailureLine = (orgId: string) =>
    `[Resource Discovery Job] Failed for org ${orgId}: PlatformAwsCredentialsUnavailableError: platform AWS credentials unavailable`;
  const iamDenialLine = (orgId: string) =>
    `[Resource Discovery Job] Failed for org ${orgId}: PlatformAwsCredentialsUnavailableError: the platform's IAM policies refused AssumeRole for this organization's role`;

  it("a platform IAM denial is platform_failed and never stops the run, even on the first organizations attempted (one org's role may be outside the platform's policy)", async () => {
    const deniedA = await insertOrg();
    const deniedB = await insertOrg();
    const second = await insertOrg();
    mockDiscoverAllResources.mockImplementation(async (id: string) => {
      if (id === deniedA.id || id === deniedB.id) throw platformIamDenial();
      return successfulDiscovery();
    });

    const summary = await job.scanOrganizations([deniedA, deniedB, second]);

    expect(summary).toEqual({ scanned: 1, skipped: 0, inactive: 0, failed: 0, platformFailed: 2, notAttempted: 0 });
    expect(mockDiscoverAllResources.mock.calls.map(([id]) => id)).toEqual([deniedA.id, deniedB.id, second.id]);
    expect(mockComputeAndPersistEvidence).toHaveBeenCalledWith(second.id);
    expect(logged(error)).toEqual([iamDenialLine(deniedA.id), iamDenialLine(deniedB.id)]);
  });

  it('one credential failure is platform_failed and does not stop the run; a success resets the count', async () => {
    const credA = await insertOrg();
    const okA = await insertOrg();
    const credB = await insertOrg();
    const okB = await insertOrg();
    mockDiscoverAllResources.mockImplementation(async (id: string) => {
      if (id === credA.id || id === credB.id) throw credentialFailure();
      return successfulDiscovery();
    });

    const summary = await job.scanOrganizations([credA, okA, credB, okB]);

    expect(summary).toEqual({ scanned: 2, skipped: 0, inactive: 0, failed: 0, platformFailed: 2, notAttempted: 0 });
    expect(mockDiscoverAllResources.mock.calls.map(([id]) => id)).toEqual([credA.id, okA.id, credB.id, okB.id]);
    expect(logged(error)).toEqual([credentialFailureLine(credA.id), credentialFailureLine(credB.id)]);
  });

  it.each([
    ["the organization's own failure", () => new Error('AWS_NOT_CONNECTED: org placeholder has not connected an AWS account')],
    ['a platform IAM denial', () => platformIamDenial()],
  ])('a credential failure, then %s, then another credential failure: the count was reset, the run continues', async (_label, between) => {
    const credA = await insertOrg();
    const middle = await insertOrg();
    const credB = await insertOrg();
    const last = await insertOrg();
    mockDiscoverAllResources.mockImplementation(async (id: string) => {
      if (id === credA.id || id === credB.id) throw credentialFailure();
      if (id === middle.id) throw between();
      return successfulDiscovery();
    });

    const summary = await job.scanOrganizations([credA, middle, credB, last]);

    expect(summary.notAttempted).toBe(0);
    expect(summary.scanned).toBe(1);
    expect(mockDiscoverAllResources).toHaveBeenCalledWith(last.id);
  });

  it('credential failures on two different organizations in a row stop the run; organizations skipped in between do not reset the count', async () => {
    const credA = await insertOrg();
    const unconnected = await insertOrg('none');
    const credB = await insertOrg();
    const remainingConnected = await insertOrg();
    const remainingUnconnected = await insertOrg('none');
    mockDiscoverAllResources.mockImplementation(async () => {
      throw credentialFailure();
    });

    const summary = await job.scanOrganizations([credA, unconnected, credB, remainingConnected, remainingUnconnected]);

    expect(summary).toEqual({ scanned: 0, skipped: 1, inactive: 0, failed: 0, platformFailed: 2, notAttempted: 2 });
    expect(mockDiscoverAllResources.mock.calls.map(([id]) => id)).toEqual([credA.id, credB.id]);
    expect(mockComputeAndPersistEvidence).not.toHaveBeenCalled();
    expect(logged(error)).toEqual([
      credentialFailureLine(credA.id),
      `[Resource Discovery Job] Platform AWS credentials unavailable for 2 organizations in a row (last org ${credB.id}); stopping this run, 2 remaining organizations not checked`,
    ]);
    expect(logged(log)).toContain(
      '[Resource Discovery Job] Scanned 0, skipped 1 (no AWS connection), inactive 0, failed 0, platform_failed 2, 2 remaining not checked (stopped early)'
    );
  });

  it.each([
    ['pool.connect rejects', 'connect'],
    ['the aws_accounts query rejects', 'query'],
  ] as const)('the connection check fails (%s): failed, one error line, no discovery, and the run continues', async (_label, where) => {
    const broken = await insertOrg();
    const healthy = await insertOrg();
    const realConnect = pool.connect.bind(pool) as () => Promise<PoolClient>;
    const originals = new Map<PoolClient, PoolClient['query']>();
    let failed = false;
    const connectSpy = (jest.spyOn(pool, 'connect') as unknown as jest.SpyInstance<Promise<PoolClient>, []>)
      .mockImplementation(async () => {
        if (where === 'connect' && !failed) {
          failed = true;
          throw new Error('placeholder: connection refused');
        }
        const client = await realConnect();
        if (where === 'query' && !originals.has(client)) {
          originals.set(client, client.query);
          const realQuery = client.query.bind(client) as unknown as (text: unknown, values?: unknown[]) => Promise<QueryResult>;
          client.query = (async (text: unknown, values?: unknown[]) => {
            if (!failed && typeof text === 'string' && text.includes('FROM aws_accounts')) {
              failed = true;
              throw new Error('placeholder: relation is unavailable');
            }
            return realQuery(text, values);
          }) as unknown as PoolClient['query'];
        }
        return client;
      });

    let summary;
    try {
      summary = await job.scanOrganizations([broken, healthy]);
    } finally {
      connectSpy.mockRestore();
      for (const [client, realQuery] of originals) client.query = realQuery;
    }

    expect(summary).toEqual({ scanned: 1, skipped: 0, inactive: 0, failed: 1, platformFailed: 0, notAttempted: 0 });
    expect(mockDiscoverAllResources).not.toHaveBeenCalledWith(broken.id);
    expect(mockDiscoverAllResources).toHaveBeenCalledWith(healthy.id);
    const message = where === 'connect' ? 'placeholder: connection refused' : 'placeholder: relation is unavailable';
    expect(logged(error)).toEqual([
      `[Resource Discovery Job] Failed for org ${broken.id}: could not read its AWS connection (Error): ${message}`,
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('one summary line with every count, across a mixed set of organizations', async () => {
    const scannedA = await insertOrg();
    const unconnectedA = await insertOrg('none');
    const inactive = await insertOrg('suspended');
    const failing = await insertOrg();
    const unconnectedB = await insertOrg('none');
    const platformFailing = await insertOrg();
    const scannedB = await insertOrg();
    mockDiscoverAllResources.mockImplementation(async (id: string) => {
      if (id === failing.id) throw new Error(`AWS_NOT_CONNECTED: org ${id} has not connected an AWS account`);
      if (id === platformFailing.id) throw credentialFailure();
      return successfulDiscovery();
    });

    const summary = await job.scanOrganizations([scannedA, unconnectedA, inactive, failing, unconnectedB, platformFailing, scannedB]);

    expect(summary).toEqual({ scanned: 2, skipped: 2, inactive: 1, failed: 1, platformFailed: 1, notAttempted: 0 });
    const summaryLines = logged(log).filter((line) => line.startsWith('[Resource Discovery Job] Scanned '));
    expect(summaryLines).toEqual([
      '[Resource Discovery Job] Scanned 2, skipped 2 (no AWS connection), inactive 1, failed 1, platform_failed 1',
    ]);
    expect(mockDiscoverAllResources.mock.calls.map(([id]) => id)).toEqual([scannedA.id, failing.id, platformFailing.id, scannedB.id]);
  });

  it("reads each organization's connection under its own tenant tag: another organization's row never counts", async () => {
    const connected = await insertOrg();
    const unconnected = await insertOrg('none');
    const seen: Array<{ tag: string; orgId: string }> = [];
    const realConnect = pool.connect.bind(pool) as () => Promise<PoolClient>;
    type Query = (text: unknown, values?: unknown[]) => Promise<QueryResult>;
    // The pool hands back the same client object again: wrap each one once,
    // and put every original query() back afterwards so later pool.query()
    // calls (which pass a callback) reach the real method.
    const originals = new Map<PoolClient, PoolClient['query']>();
    const connectSpy = (jest.spyOn(pool, 'connect') as unknown as jest.SpyInstance<Promise<PoolClient>, []>)
      .mockImplementation(async () => {
        const client = await realConnect();
        if (!originals.has(client)) {
          originals.set(client, client.query);
          const realQuery = client.query.bind(client) as unknown as Query;
          const observed: Query = async (text, values) => {
            if (typeof text === 'string' && text.includes('FROM aws_accounts')) {
              const { rows } = await realQuery("SELECT current_setting('app.current_organization_id', true) AS tag");
              seen.push({ tag: rows[0].tag, orgId: String(values?.[0]) });
            }
            return realQuery(text, values);
          };
          client.query = observed as unknown as PoolClient['query'];
        }
        return client;
      });

    try {
      const summary = await job.scanOrganizations([connected, unconnected]);
      expect(summary).toMatchObject({ scanned: 1, skipped: 1 });
    } finally {
      connectSpy.mockRestore();
      for (const [client, realQuery] of originals) client.query = realQuery;
    }
    expect(seen).toEqual([
      { tag: connected.id, orgId: connected.id },
      { tag: unconnected.id, orgId: unconnected.id },
    ]);
  });
});

describe('SOC 2 computation is not wired into any on-demand discovery entry point (static)', () => {
  function readCode(filePath: string): string {
    const full = fs.readFileSync(filePath, 'utf-8');
    return full.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  const backendSrc = path.join(__dirname, '..', '..');

  it('the synchronous /api/services/discover route never references SOC2 computation', () => {
    const source = readCode(path.join(backendSrc, 'routes', 'services.routes.ts'));
    expect(source).not.toMatch(/computeAndPersistEvidence/);
    expect(source).not.toMatch(/Soc2EvidenceService/);
  });

  it('the fire-and-forget initial AWS-connect route (/api/aws/accounts) never references SOC2 computation', () => {
    const source = readCode(path.join(backendSrc, 'routes', 'aws.routes.ts'));
    expect(source).not.toMatch(/computeAndPersistEvidence/);
    expect(source).not.toMatch(/Soc2EvidenceService/);
  });

  it('the legacy /api/aws-resources/discover controller never references SOC2 computation', () => {
    const source = readCode(path.join(backendSrc, 'controllers', 'awsResources.controller.ts'));
    expect(source).not.toMatch(/computeAndPersistEvidence/);
    expect(source).not.toMatch(/Soc2EvidenceService/);
  });

  it('resourceDiscovery.job.ts is the only production file that actually references Soc2EvidenceService in code (not merely in an explanatory comment)', () => {
    // Comment-stripped (same convention as soc2-evidence.risk-score-isolation.test.ts's
    // own readCode() helper) so a file like soc2-customer-evidence.service.ts, which
    // legitimately NAMES Soc2EvidenceService in a comment to document that it never
    // calls it, is not mistaken for a real reference.
    function walk(dir: string, out: string[] = []): string[] {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          walk(full, out);
        } else if (entry.name.endsWith('.ts')) {
          out.push(full);
        }
      }
      return out;
    }

    const referencingFiles = walk(backendSrc).filter((file) => {
      if (file.endsWith(path.join('services', 'soc2-evidence.service.ts'))) return false;
      if (file.endsWith(path.join('repositories', 'soc2-evidence.repository.ts'))) return false;
      return /Soc2EvidenceService/.test(readCode(file));
    });

    expect(referencingFiles).toEqual([path.join(backendSrc, 'jobs', 'resourceDiscovery.job.ts')]);
  });
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});
