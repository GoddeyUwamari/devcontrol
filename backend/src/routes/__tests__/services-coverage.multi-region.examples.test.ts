/**
 * Multi-region PR 2 (review M-3), extended by PR 3a (G6, G11): the synthetic examples in
 * docs/SERVICES_COVERAGE_MULTI_REGION.md are real responses. Each scenario below is
 * built in Postgres, read through GET /api/services/coverage, and its multi_region
 * key is compared with the document's block for that example (the job id normalized to
 * a placeholder). A change to the API that the document does not show fails here.
 *
 * WRITE_COVERAGE_EXAMPLES=<file> writes the computed examples to <file> instead of
 * comparing (used once to compose the document). Placeholders only; fixed instants.
 */
import fs from 'fs';
import path from 'path';
import servicesCoverageRoutes from '../services-coverage.routes';
import servicesRoutes from '../services.routes';
import { SCAN_KIND_DISCOVERY } from '../../services/scan-session';
import { createRoleGateHarness } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

const harness = createRoleGateHarness('services-coverage-mr-examples');
const { pool } = harness;
const DOC = path.join(__dirname, '..', '..', '..', '..', 'docs', 'SERVICES_COVERAGE_MULTI_REGION.md');
const ACCOUNT = '123456789012';
const TYPES = ['ec2', 'ebs', 'rds', 's3', 'lambda', 'load-balancer', 'cloudfront', 'sqs'];
const LISTED = '2026-11-15T09:59:00.000Z';
const PREVIOUS = '2026-11-15T04:00:00.000Z';
const LATEST = '2026-11-15T10:00:00.000Z';
const BEFORE = '2026-11-01T08:00:00.000Z';
const SCAN_ID = '00000000-0000-4000-8000-00000000a001';

interface Region {
  name: string;
  enabled?: boolean;
  optIn?: boolean;
  status?: string;
  started?: string | null;
  code?: string | null;
  success?: boolean;
  resources?: number;
}

interface Scenario {
  home: string;
  /** The jobs, oldest first: [status, started_at, regions, warnings?]. */
  jobs: Array<[string, string, string[], string[]?]>;
  /** Index of the job a held lease names (a running scan), if any. */
  running?: number;
  regions: Region[];
}

const plusMinutes = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

/** The examples, by the document's names. */
const SCENARIOS: Record<string, Scenario> = {
  all_checked: {
    home: 'us-east-1',
    jobs: [['completed', LATEST, ['us-east-1', 'eu-west-1', 'ap-south-1']]],
    regions: [
      { name: 'us-east-1', status: 'ok', started: LATEST, success: true, resources: 4 },
      { name: 'eu-west-1', status: 'ok', started: LATEST, success: true, resources: 2 },
      { name: 'ap-south-1', status: 'ok', started: LATEST, success: true, code: 'resource_explorer_no_index', resources: 1 },
    ],
  },
  in_progress: {
    home: 'us-east-1',
    jobs: [
      ['completed', PREVIOUS, ['us-east-1', 'eu-west-1', 'ap-south-1']],
      ['running', LATEST, ['us-east-1', 'eu-west-1']],
    ],
    running: 1,
    regions: [
      { name: 'us-east-1', status: 'ok', started: LATEST, success: true, resources: 4 },
      { name: 'eu-west-1', status: 'ok', started: PREVIOUS, success: true, resources: 2 },
      { name: 'ap-south-1', status: 'ok', started: PREVIOUS, success: true, resources: 0 },
      { name: 'us-west-2', status: 'never_scanned' },
    ],
  },
  budget_incomplete: {
    home: 'us-east-1',
    jobs: [['completed', LATEST, ['us-east-1', 'eu-west-1']]],
    regions: [
      { name: 'us-east-1', status: 'ok', started: LATEST, success: true, resources: 4 },
      { name: 'eu-west-1', status: 'ok', started: LATEST, success: true, resources: 1 },
      { name: 'ap-south-1', status: 'timed_out', started: LATEST, code: 'scan_budget' },
      { name: 'us-west-2', status: 'timed_out', started: LATEST, code: 'scan_budget' },
    ],
  },
  regional_failure: {
    home: 'us-east-1',
    jobs: [['completed', LATEST, ['us-east-1', 'eu-west-1', 'ap-south-1', 'me-central-1']]],
    regions: [
      { name: 'us-east-1', status: 'ok', started: LATEST, success: true, resources: 4 },
      { name: 'eu-west-1', status: 'denied', started: LATEST, code: 'access_denied_scp' },
      { name: 'ap-south-1', status: 'denied', started: LATEST, code: 'access_denied', success: true, resources: 3 },
      { name: 'me-central-1', optIn: true, status: 'failed', started: LATEST, code: 'region_not_ready' },
    ],
  },
  empty_regions: {
    home: 'us-east-1',
    jobs: [['completed', LATEST, ['us-east-1', 'eu-west-1', 'ap-south-1']]],
    regions: [
      { name: 'us-east-1', status: 'ok', started: LATEST, success: true, resources: 4 },
      { name: 'eu-west-1', status: 'ok', started: LATEST, success: true, resources: 0 },
      { name: 'ap-south-1', status: 'partial', started: LATEST, code: 'discovery_listing_truncated', resources: 0 },
    ],
  },
  not_enabled: {
    home: 'us-east-1',
    jobs: [['completed', LATEST, ['us-east-1', 'me-central-1']]],
    regions: [
      { name: 'us-east-1', status: 'ok', started: LATEST, success: true, resources: 4 },
      { name: 'me-central-1', optIn: true, status: 'ok', started: LATEST, success: true, resources: 1 },
      { name: 'ap-east-1', enabled: false },
      { name: 'af-south-1', enabled: false },
      { name: 'me-south-1', enabled: false },
    ],
  },
  latest_scan_failed: {
    home: 'us-east-1',
    jobs: [
      ['completed', PREVIOUS, ['us-east-1', 'eu-west-1']],
      ['failed', LATEST, ['us-east-1']],
    ],
    regions: [
      { name: 'us-east-1', status: 'ok', started: LATEST, success: true, resources: 4 },
      { name: 'eu-west-1', status: 'ok', started: PREVIOUS, success: true, resources: 2 },
    ],
  },
  home_not_us_east_1: {
    home: 'eu-central-1',
    jobs: [['completed', LATEST, ['eu-central-1', 'us-east-1']]],
    regions: [
      { name: 'eu-central-1', status: 'ok', started: LATEST, success: true, resources: 5 },
      { name: 'us-east-1', status: 'ok', started: LATEST, success: true, resources: 0 },
    ],
  },
  single_region: {
    home: 'eu-west-1',
    jobs: [['completed', LATEST, ['eu-west-1']]],
    regions: [{ name: 'eu-west-1', status: 'ok', started: LATEST, success: true, resources: 3 }],
  },
  // PR 3a (G11): the scan reported resource_explorer_no_index, but the region it came from
  // ended partial (its one code column holds the truncation code), so no region_warnings
  // entry names it: region_warnings_unattributed carries it. resource_explorer_no_view is
  // named (ap-south-1's own ok result), so it is not repeated there.
  unattributed_warning: {
    home: 'us-east-1',
    jobs: [['completed', LATEST, ['us-east-1', 'eu-west-1', 'ap-south-1'],
      ['resource_explorer_no_index', 'resource_explorer_no_view', 'discovery_listing_truncated', 'region_incomplete']]],
    regions: [
      { name: 'us-east-1', status: 'ok', started: LATEST, success: true, resources: 4 },
      { name: 'eu-west-1', status: 'partial', started: LATEST, code: 'discovery_listing_truncated', resources: 2 },
      { name: 'ap-south-1', status: 'ok', started: LATEST, success: true, code: 'resource_explorer_no_view', resources: 0 },
    ],
  },
};

let seq = 0;

async function build(scenario: Scenario): Promise<{ orgId: string; viewer: string }> {
  const org = await harness.buildOrg();
  seq += 1;
  await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, connected_at, status)
     VALUES ($1, $2, $3, 'external-id-1', $4, $5, 'active')`,
    [org.orgId, `arn:aws:iam::${ACCOUNT}:role/DevControlRole`, `ex-${seq}-${org.orgId}`.slice(0, 32), scenario.home, BEFORE]
  );
  await pool.query(
    `INSERT INTO organization_feature_flags (organization_id, flag, enabled, set_by, note) VALUES ($1, 'multi_region_discovery', true, 'test', 'example')`,
    [org.orgId]
  );
  const jobIds: string[] = [];
  for (const [i, [status, started, regions, warnings]] of scenario.jobs.entries()) {
    const { rows } = await pool.query(
      `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, completed_at, created_at, resource_types, regions, warnings)
       VALUES ($1, $2, $3, $4, $3, $5, $6, $7::jsonb) RETURNING id`,
      [org.orgId, status, started, status === 'running' ? null : plusMinutes(started, 20 + i), TYPES, regions, JSON.stringify(warnings ?? [])]
    );
    jobIds.push(rows[0].id);
  }
  if (scenario.running !== undefined) {
    await pool.query(
      `INSERT INTO aws_scan_leases (organization_id, aws_account_id, scan_kind, holder, job_id, acquired_at, heartbeat_at, expires_at)
       VALUES ($1, $2, $3, 'example', $4, $5, $5, '2099-01-01T00:00:00Z')`,
      [org.orgId, ACCOUNT, SCAN_KIND_DISCOVERY, jobIds[scenario.running], scenario.jobs[scenario.running][1]]
    );
  }
  for (const r of scenario.regions) {
    const enabled = r.enabled ?? true;
    const status = r.status ?? 'never_scanned';
    const started = status === 'never_scanned' ? null : r.started ?? LATEST;
    const finished = started ? plusMinutes(started, 3) : null;
    await pool.query(
      `INSERT INTO aws_account_regions (organization_id, aws_account_id, region, opt_in_status, enabled, last_listed_at, last_scan_status,
                                        last_scan_started_at, last_scan_finished_at, last_success_at, last_error_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [org.orgId, ACCOUNT, r.name, enabled ? (r.optIn ? 'opted-in' : 'opt-in-not-required') : 'not-opted-in', enabled, LISTED, status, started, finished,
        // An earlier success, when given and the last result is not the success itself, a day before.
        r.success ? (status === 'ok' ? finished : plusMinutes(PREVIOUS, -24 * 60)) : null, r.code ?? null]
    );
    for (let i = 0; i < (r.resources ?? 0); i++) {
      await pool.query(
        `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, tags, metadata, first_discovered_at, created_at)
         VALUES ($1, $2, $3, $3, 'ec2', $4, 'running', '{}', '{}', $5, $5)`,
        [org.orgId, `arn:aws:ec2:${r.name}:${ACCOUNT}:instance/example-${i}-${org.orgId.slice(0, 8)}`, `example-${i}-${org.orgId.slice(0, 8)}`, r.name, BEFORE]
      );
    }
  }
  return { orgId: org.orgId, viewer: org.viewer };
}

async function exampleOf(name: string) {
  const org = await build(SCENARIOS[name]);
  const res = await harness.sendAs(org.orgId, org.viewer, 'GET', '/services/coverage');
  expect(res.status).toBe(200);
  const mr = (await res.json()).coverage.multi_region;
  if (mr.scan) mr.scan.id = SCAN_ID;
  return mr;
}

/** The document's example blocks: a ```json fence right after `<!-- example: name -->`. */
function documentExamples(): Record<string, unknown> {
  const text = fs.readFileSync(DOC, 'utf8');
  const examples: Record<string, unknown> = {};
  const pattern = /<!-- example: ([a-z_0-9]+) -->\s*```json\n([\s\S]*?)\n```/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) examples[match[1]] = JSON.parse(match[2]);
  return examples;
}

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await harness.listen((app) => {
    app.use('/api/services/coverage', servicesCoverageRoutes);
    app.use('/api/services', servicesRoutes);
  });
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await harness.close(async (orgIds) => {
    for (const table of ['aws_resources', 'aws_account_regions', 'aws_scan_leases', 'resource_discovery_jobs', 'organization_feature_flags']) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [orgIds]);
    }
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
  });
});

const writeTo = process.env.WRITE_COVERAGE_EXAMPLES;

describe('docs/SERVICES_COVERAGE_MULTI_REGION.md: every example is the API\'s real answer', () => {
  if (writeTo) {
    it('writes the computed examples', async () => {
      const out: Record<string, unknown> = {};
      for (const name of Object.keys(SCENARIOS)) out[name] = await exampleOf(name);
      fs.writeFileSync(writeTo, JSON.stringify(out, null, 2));
    });
    return;
  }

  it('the document has exactly these examples', () => {
    expect(Object.keys(documentExamples()).sort()).toEqual(Object.keys(SCENARIOS).sort());
  });

  it.each(Object.keys(SCENARIOS))('%s', async (name) => {
    expect(JSON.parse(JSON.stringify(await exampleOf(name)))).toEqual(documentExamples()[name]);
  });
});

/**
 * PR 3a (G6): the scan's checked regions split into with resources, empty and zero with
 * warnings, by the same "written by this scan" rule as regions_checked, in every example.
 */
describe('G6: scan.regions_with_resources + regions_empty + regions_zero_with_warnings = regions_checked', () => {
  // [with resources, empty, zero with warnings, checked] per example.
  const EXPECTED: Record<string, [number, number, number, number]> = {
    all_checked: [3, 0, 0, 3],
    // Only us-east-1 is done in the running scan: eu-west-1 (2, earlier) and ap-south-1 (0, earlier) never count.
    in_progress: [1, 0, 0, 1],
    budget_incomplete: [2, 0, 0, 2],
    regional_failure: [1, 0, 0, 1],
    // eu-west-1 ok and 0: empty; ap-south-1 partial and 0: zero with warnings, never empty (H-1).
    empty_regions: [1, 1, 1, 3],
    not_enabled: [2, 0, 0, 2],
    // eu-west-1's 2 come from the earlier scan (result_of earlier_scan): not this scan's.
    latest_scan_failed: [1, 0, 0, 1],
    // us-east-1 is ok and 0: empty.
    home_not_us_east_1: [1, 1, 0, 2],
    single_region: [1, 0, 0, 1],
    // ap-south-1 is ok with a Resource Explorer code and 0: zero with warnings.
    unattributed_warning: [2, 0, 1, 3],
  };

  it('covers every example', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(SCENARIOS).sort());
  });

  it.each(Object.keys(SCENARIOS))('%s', async (name) => {
    const { scan, regions } = await exampleOf(name);
    expect(scan.regions_with_resources + scan.regions_empty + scan.regions_zero_with_warnings).toBe(scan.regions_checked);
    expect([scan.regions_with_resources, scan.regions_empty, scan.regions_zero_with_warnings, scan.regions_checked]).toEqual(EXPECTED[name]);
    // regions_empty never counts more than the regions[].empty flags (the same strict rule).
    expect(scan.regions_empty).toBeLessThanOrEqual(regions.filter((r: { empty: boolean }) => r.empty).length);
  });
});
