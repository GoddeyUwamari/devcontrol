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
 */
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

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

async function insertOrg(): Promise<{ id: string; name: string }> {
  const suffix = uniqueSuffix();
  const name = `Discovery Job Org ${suffix}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status, is_active)
     VALUES ($1, $2, $3, 'free', 'free', true)
     RETURNING id, name`,
    [name, `discovery-job-org-${suffix}`, name]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0];
}

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
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});
