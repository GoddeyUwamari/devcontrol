/**
 * Framework applicability inside AWSResourceDiscoveryService.discoverAllResources:
 * the compliance scan reads the organization's built-in framework settings, runs a
 * framework's checks only when it is explicitly enabled, and rewrites each
 * resource's compliance_issues accordingly -- including what happens to findings an
 * earlier scan persisted when the framework is then disabled, loses its setting, or
 * has settings that cannot be read or interpreted. Also covers the score input
 * (AWSResourcesRepository.getStats) reading that snapshot, and the settings read
 * under a role that row-level security applies to.
 *
 * Real Postgres for compliance_frameworks and aws_resources (the settings read and
 * the persisted snapshot are what is under test). AWSClientFactory is mocked as in
 * awsResourceDiscovery.s3-security.test.ts: every AWS phase fails fast inside its
 * own try/catch, so the pre-inserted rows are left alone. No real AWS call is made.
 */
import { Pool } from 'pg';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { AWSClientFactory } from '../aws-client-factory.service';
import { stubScanSource } from './helpers/scan-source';
import costOptimizationService from '../cost-optimization.service';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { AWSResourcesRepository } from '../../repositories/awsResources.repository';
import * as frameworksRepository from '../../repositories/compliance-frameworks.repository';
import * as evaluationsRepository from '../../repositories/framework-evaluations.repository';
import { readFrameworkEvaluations } from '../../repositories/framework-evaluations.repository';
import { resolveFrameworkApplicability } from '../../utils/frameworkApplicability';
import { ComplianceScannerService } from '../complianceScanner';
import { ReportGeneratorService } from '../report-generator.service';
import { AWSResourcesExportService } from '../awsResourcesExport.service';
import { derivePrioritySeverity, mapStatus } from '../../routes/services.routes';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free') RETURNING id`,
    [`Framework Org ${suffix}`, `framework-org-${suffix}`, `Framework Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

/** A built-in framework setting, written directly: no API creates these today. */
async function insertSetting(orgId: string, standardName: string | null, enabled: boolean | null, type = 'built_in'): Promise<void> {
  await pool.query(
    `INSERT INTO compliance_frameworks (organization_id, name, framework_type, standard_name, enabled)
     VALUES ($1, $2, $3, $4, $5)`,
    [orgId, `setting-${uniqueSuffix()}`, type, standardName, enabled]
  );
}

const VOLUME = 'vol-framework';
const INSTANCE = 'i-framework';
const volumeArn = (orgId: string) => `arn:aws:ec2:us-east-1:111122223333:volume/${VOLUME}-${orgId}`;

/** An EBS volume AWS Backup reported no backup for: a HIPAA failure only if HIPAA is evaluated. */
async function insertVolume(orgId: string, hasBackup: boolean | null, complianceIssues: unknown[]): Promise<void> {
  await pool.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status,
        tags, is_encrypted, is_public, has_backup, compliance_issues)
     VALUES ($1, $2, $3, $3, 'ebs', 'us-east-1', 'available', $4, true, false, $5, $6)`,
    [orgId, volumeArn(orgId), VOLUME, JSON.stringify({ Owner: 'o', Environment: 'e', Team: 't' }), hasBackup, JSON.stringify(complianceIssues)]
  );
}

/** An EC2 instance with a public IP and no tags: baseline findings whatever the framework settings. */
async function insertInstance(orgId: string): Promise<void> {
  await pool.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status,
        tags, is_encrypted, is_public, has_backup, compliance_issues)
     VALUES ($1, $2, $3, $3, 'ec2', 'us-east-1', 'running', '{}', true, true, true, '[]')`,
    [orgId, `arn:aws:ec2:us-east-1:111122223333:instance/${INSTANCE}-${orgId}`, INSTANCE]
  );
}

async function issuesFor(orgId: string, resourceId: string): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT compliance_issues FROM aws_resources WHERE organization_id = $1 AND resource_id = $2`,
    [orgId, resourceId]
  );
  return rows[0].compliance_issues;
}


// These scans cannot read any AWS API (mockAws), security groups included, so the
// instance's public IP is Medium, "exposure not checked" (2B).
const EC2_PUBLIC_UNKNOWN = 'EC2 instance has a public IP address. Exposure not checked: its security groups have not been read yet.';
const BASELINE_INSTANCE_FINDINGS = [
  ['medium', EC2_PUBLIC_UNKNOWN],
  ['low', 'Resource is missing required tags: Owner, Environment, Team'],
];

const BACKUP_KEY = 'hipaa.automated_backups';
const FAILED = (orgId: string) => ({
  severity: 'critical',
  category: 'backups',
  issue: 'HIPAA: EBS storing PHI must have automated backups',
  recommendation: 'Enable automated backups with minimum 30-day retention. Test backup restoration quarterly. Document backup procedures.',
  resource_arn: volumeArn(orgId),
  findingKey: BACKUP_KEY,
  framework: 'HIPAA',
  applicability: 'enabled',
  evaluation_state: 'failed',
  evidence_basis: 'aws_api',
  evaluation_reason: 'AWS Backup reports no backup for this resource',
});
/** What the scanner wrote for every organization before frameworks had to be enabled. */
const LEGACY = [
  { severity: 'medium', category: 'encryption', issue: 'HIPAA: Resource should use AWS KMS Customer Managed Keys (CMK) for encryption', recommendation: 'r' },
  { severity: 'critical', category: 'backups', issue: 'HIPAA: EBS storing PHI must have automated backups', recommendation: 'r' },
  { severity: 'high', category: 'backups', issue: 'HIPAA: Resource lacks documented backup retention policy', recommendation: 'r' },
];

function mockAws() {
  const denied = { send: jest.fn(async () => { throw Object.assign(new Error('AccessDenied'), { name: 'AccessDenied' }); }) };
  stubScanSource();
  jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
    enabled: true,
    region: 'us-east-1',
    accountId: '111122223333',
    s3: denied,
    s3Control: denied,
    costExplorer: {}, ec2: {}, rds: {}, cloudWatch: {}, lambda: {}, ecs: {}, elb: {}, eks: {}, dynamodb: {},
    cloudFront: {}, apiGateway: {}, elastiCache: {}, sqs: {}, sns: {}, iam: {}, resourceExplorer: {},
  } as any);
  jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({ observations: [], riRecommendations: [], riSucceeded: true } as any);
  jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations').mockResolvedValue({ insertedCount: 0 } as any);
  jest.spyOn(CostRecommendationsRepository.prototype, 'deleteActiveByIssue').mockResolvedValue(0);
  jest.spyOn(CostRecommendationsRepository.prototype, 'createBulk').mockResolvedValue(0);
}

/** Runs one discovery and returns what that run logged. */
async function discover(orgId: string): Promise<string[]> {
  mockAws();
  const logSpy = jest.spyOn(console, 'log');
  const before = logSpy.mock.calls.length;
  await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId).catch(() => {});
  return logSpy.mock.calls.slice(before).map((c) => String(c[0]));
}

const fullApplicabilityLine = (logged: string[]) => logged.find((line) => line.includes('[Discovery] Framework applicability:'));
/** The applicability line without SOC 2's entry: these cases set HIPAA's settings only; SOC 2 has its own block below. */
const applicabilityLine = (logged: string[]) => fullApplicabilityLine(logged)?.replace(/, SOC2=\w+ \(\w+\)/, '');

async function complianceSeverityCounts(orgId: string) {
  const stats = await new AWSResourcesRepository(pool).getStats(orgId);
  return stats.compliance_stats.by_severity;
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM compliance_frameworks WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM framework_evaluation_runs WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM resource_discovery_jobs WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

/** The volume's stored check rows, as the API's read sees them: check -> [state, reason, last conclusive, stale]. */
async function storedFor(orgId: string, resourceId = VOLUME): Promise<Record<string, [string, string, string | null, boolean]>> {
  const { rows } = await pool.query(`SELECT id FROM aws_resources WHERE organization_id = $1 AND resource_id = $2`, [orgId, resourceId]);
  const { checks } = await readFrameworkEvaluations(pool, orgId);
  return Object.fromEntries(
    checks.filter((c) => c.resource_id === rows[0].id).map((c) => [c.check, [c.evaluation_state, c.reason_code, c.last_conclusive_state, c.stale]])
  );
}

async function runsOf(orgId: string, framework = 'HIPAA'): Promise<Array<{ applicability: string; applicability_reason_code: string; status: string; resources_persisted: number | null; resources_failed: number | null; has_job: boolean }>> {
  return (await pool.query(
    `SELECT applicability, applicability_reason_code, status, resources_persisted, resources_failed, discovery_job_id IS NOT NULL AS has_job
       FROM framework_evaluation_runs WHERE organization_id = $1 AND framework = $2 ORDER BY generation ASC`,
    [orgId, framework]
  )).rows;
}

const BACKUPS_ROW = (state: string, reason: string, lastConclusive: string | null = null) => ({ [BACKUP_KEY]: [state, reason, lastConclusive, false] });
/** The other two checks that apply to an encrypted EBS volume with no documentation tags. */
const TAG_ONLY_ROWS = {
  'hipaa.backup_retention_policy': ['unable_to_evaluate', 'no_evidence_collected', null, false],
  'hipaa.customer_managed_key': ['unable_to_evaluate', 'no_evidence_collected', null, false],
};
const NOT_EVALUATED_TAG_ROWS = (reason: string) => ({
  'hipaa.backup_retention_policy': ['not_evaluated', reason, null, false],
  'hipaa.customer_managed_key': ['not_evaluated', reason, null, false],
});

describe('discovery compliance scan: framework applicability', () => {
  type Setting = [string | null, boolean | null, string?];
  type Case = {
    name: string;
    /** Run one scan with HIPAA explicitly enabled first, so a failure is really stored. */
    enabledFirst?: boolean;
    settings: Setting[];
    readFails?: boolean;
    /** What is in compliance_issues before the first scan. */
    previous: unknown[];
    applicability: string;
    /** The framework findings in compliance_issues after the scan. */
    findings: (orgId: string) => unknown[];
    /** The volume's stored check rows after the scan. */
    stored: Record<string, unknown>;
    run: { applicability: string; applicability_reason_code: string };
    criticalCounted: number;
  };

  const cases: Case[] = [
    {
      name: 'explicitly enabled: the supported failure is stored and projected as a current finding',
      settings: [['HIPAA', true]],
      previous: LEGACY,
      applicability: 'HIPAA=enabled (explicitly_enabled)',
      findings: (orgId) => [FAILED(orgId)],
      stored: { ...BACKUPS_ROW('failed', 'no_backup_reported', 'failed'), ...TAG_ONLY_ROWS },
      run: { applicability: 'enabled', applicability_reason_code: 'explicitly_enabled' },
      criticalCounted: 1,
    },
    {
      name: 'explicitly disabled after a stored failure: no longer a finding; the row says not evaluated and keeps its last conclusive result',
      enabledFirst: true,
      settings: [['HIPAA', false]],
      previous: LEGACY,
      applicability: 'HIPAA=disabled (explicitly_disabled)',
      findings: () => [],
      stored: { ...BACKUPS_ROW('not_evaluated', 'explicitly_disabled', 'failed'), ...NOT_EVALUATED_TAG_ROWS('explicitly_disabled') },
      run: { applicability: 'disabled', applicability_reason_code: 'explicitly_disabled' },
      criticalCounted: 0,
    },
    {
      name: 'missing settings: nothing is evaluated, nothing is stored, and the legacy entries are cleared',
      settings: [],
      previous: LEGACY,
      applicability: 'HIPAA=not_configured (no_setting)',
      findings: () => [],
      stored: {},
      run: { applicability: 'not_configured', applicability_reason_code: 'no_setting' },
      criticalCounted: 0,
    },
    {
      name: 'a setting removed after a stored failure: no longer a finding',
      enabledFirst: true,
      settings: [],
      previous: [],
      applicability: 'HIPAA=not_configured (no_setting)',
      findings: () => [],
      stored: { ...BACKUPS_ROW('not_evaluated', 'no_setting', 'failed'), ...NOT_EVALUATED_TAG_ROWS('no_setting') },
      run: { applicability: 'not_configured', applicability_reason_code: 'no_setting' },
      criticalCounted: 0,
    },
    {
      name: 'a custom framework is not a setting for the built-in checks, even one named HIPAA',
      settings: [['HIPAA', true, 'custom'], [null, true, 'custom']],
      previous: LEGACY,
      applicability: 'HIPAA=not_configured (no_setting)',
      findings: () => [],
      stored: {},
      run: { applicability: 'not_configured', applicability_reason_code: 'no_setting' },
      criticalCounted: 0,
    },
    {
      name: 'settings read failure after a stored failure: not a finding and not a pass; the row says why and keeps its last conclusive result',
      enabledFirst: true,
      settings: [['HIPAA', true]],
      readFails: true,
      previous: LEGACY,
      applicability: 'HIPAA=unavailable (settings_unavailable)',
      findings: () => [],
      stored: { ...BACKUPS_ROW('not_evaluated', 'settings_unavailable', 'failed'), ...NOT_EVALUATED_TAG_ROWS('settings_unavailable') },
      run: { applicability: 'unavailable', applicability_reason_code: 'settings_unavailable' },
      criticalCounted: 0,
    },
    {
      name: 'settings read failure with nothing stored before: no finding and no row is invented',
      settings: [['HIPAA', true]],
      readFails: true,
      previous: [],
      applicability: 'HIPAA=unavailable (settings_unavailable)',
      findings: () => [],
      stored: {},
      run: { applicability: 'unavailable', applicability_reason_code: 'settings_unavailable' },
      criticalCounted: 0,
    },
    {
      name: 'invalid setting (enabled is NULL) after a stored failure: neither enabled nor disabled',
      enabledFirst: true,
      settings: [['HIPAA', null]],
      previous: [],
      applicability: 'HIPAA=invalid (invalid_enabled_value)',
      findings: () => [],
      stored: { ...BACKUPS_ROW('not_evaluated', 'invalid_enabled_value', 'failed'), ...NOT_EVALUATED_TAG_ROWS('invalid_enabled_value') },
      run: { applicability: 'invalid', applicability_reason_code: 'invalid_enabled_value' },
      criticalCounted: 0,
    },
    {
      name: 'invalid settings (one enabled, one disabled): neither wins',
      settings: [['HIPAA', true], ['HIPAA', false]],
      previous: [],
      applicability: 'HIPAA=invalid (conflicting_settings)',
      findings: () => [],
      stored: {},
      run: { applicability: 'invalid', applicability_reason_code: 'conflicting_settings' },
      criticalCounted: 0,
    },
    {
      name: 'an enabled setting for a framework with no checks: reported, evaluated by nothing, given no run; HIPAA untouched',
      settings: [['PCI-DSS', true]],
      previous: LEGACY,
      applicability: 'HIPAA=not_configured (no_setting), PCI-DSS=invalid (unrecognized_framework)',
      findings: () => [],
      stored: {},
      run: { applicability: 'not_configured', applicability_reason_code: 'no_setting' },
      criticalCounted: 0,
    },
  ];

  it.each(cases)('$name', async ({ enabledFirst, settings, readFails, previous, applicability, findings, stored, run, criticalCounted }) => {
    const orgId = await insertOrg();
    await insertVolume(orgId, false, previous);
    await insertInstance(orgId);
    if (enabledFirst) {
      await insertSetting(orgId, 'HIPAA', true);
      await discover(orgId);
      expect(await issuesFor(orgId, VOLUME)).toEqual([FAILED(orgId)]);
      await pool.query(`DELETE FROM compliance_frameworks WHERE organization_id = $1`, [orgId]);
      jest.restoreAllMocks();
      jest.spyOn(console, 'error').mockImplementation(() => {});
    }
    for (const [name, enabled, type] of settings) await insertSetting(orgId, name, enabled, type);
    if (readFails) {
      jest.spyOn(frameworksRepository, 'readBuiltInFrameworkSettings').mockRejectedValue(new Error('relation unavailable'));
    }

    const logged = await discover(orgId);

    expect(applicabilityLine(logged)).toContain(`Framework applicability: ${applicability}`);

    // Findings: only a stored failure. The volume has no baseline finding, so this is its whole array.
    const volume = await issuesFor(orgId, VOLUME);
    expect(volume).toEqual(findings(orgId));
    // Stored evaluations: every outcome, with its reason, and current (the run finished complete).
    expect(await storedFor(orgId)).toEqual(stored);
    // The projection is exactly the stored failures.
    expect(volume.map((i: any) => i.findingKey)).toEqual(Object.entries(await storedFor(orgId)).filter(([, v]) => v[0] === 'failed').map(([k]) => k));

    // One HIPAA run per scan, recording what was applied and linked to its discovery job.
    const runs = await runsOf(orgId);
    expect(runs).toHaveLength(enabledFirst ? 2 : 1);
    expect(runs[runs.length - 1]).toEqual({ ...run, status: 'complete', resources_persisted: 2, resources_failed: 0, has_job: true });

    // Baseline findings are the same in every case, and carry no framework fields.
    const instance = await issuesFor(orgId, INSTANCE);
    expect(instance.map((i) => [i.severity, i.issue])).toEqual(BASELINE_INSTANCE_FINDINGS);
    for (const issue of instance) {
      expect(issue).not.toHaveProperty('framework');
      expect(issue).not.toHaveProperty('evaluation_state');
      expect(issue).not.toHaveProperty('applicability');
    }
    // No framework row is stored for the instance unless the framework was evaluated.
    const instanceRows = await storedFor(orgId, INSTANCE);
    expect(Object.values(instanceRows).filter(([state]) => state === 'failed' || state === 'passed')).toEqual([]);

    // Score input: the baseline 1 Medium (public IP, exposure not checked) + 1 Low always (the
    // two tag-only SOC 2 signals used to add 2 High here); the framework Critical only when
    // it is a stored failure.
    expect(await complianceSeverityCounts(orgId)).toEqual({ critical: criticalCounted, high: 0, medium: 1, low: 1 });

    // An unreadable or uninterpretable setting does not abort the scan.
    expect(logged.some((line) => line.includes('Compliance scan complete (2 resources scanned)'))).toBe(true);
  });

  it('explicitly enabled with a supported pass: stored as passed, no finding, and an earlier stored failure is replaced', async () => {
    const orgId = await insertOrg();
    await insertSetting(orgId, 'HIPAA', true);
    await insertVolume(orgId, false, []);
    await discover(orgId);
    expect(await issuesFor(orgId, VOLUME)).toEqual([FAILED(orgId)]);

    await pool.query(`UPDATE aws_resources SET has_backup = true WHERE organization_id = $1`, [orgId]);
    await discover(orgId);

    expect(await issuesFor(orgId, VOLUME)).toEqual([]);
    expect(await storedFor(orgId)).toEqual({ ...BACKUPS_ROW('passed', 'backup_reported', 'passed'), ...TAG_ONLY_ROWS });
  });

  it('explicitly enabled with unknown backup state: unable_to_evaluate -- not a finding, not a pass -- and the last conclusive failure is kept', async () => {
    const orgId = await insertOrg();
    await insertSetting(orgId, 'HIPAA', true);
    await insertVolume(orgId, false, []);
    await discover(orgId);

    await pool.query(`UPDATE aws_resources SET has_backup = NULL WHERE organization_id = $1`, [orgId]);
    await discover(orgId);

    expect(await issuesFor(orgId, VOLUME)).toEqual([]);
    expect(await storedFor(orgId)).toEqual({ ...BACKUPS_ROW('unable_to_evaluate', 'backup_state_unknown', 'failed'), ...TAG_ONLY_ROWS });
    expect(await complianceSeverityCounts(orgId)).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });

  it('the next scan recomputes: enabled -> disabled -> enabled again', async () => {
    const orgId = await insertOrg();
    await insertSetting(orgId, 'HIPAA', true);
    await insertVolume(orgId, false, LEGACY);

    await discover(orgId);
    expect(await issuesFor(orgId, VOLUME)).toEqual([FAILED(orgId)]);

    await pool.query(`UPDATE compliance_frameworks SET enabled = false WHERE organization_id = $1`, [orgId]);
    await discover(orgId);
    expect(await issuesFor(orgId, VOLUME)).toEqual([]);
    expect(await complianceSeverityCounts(orgId)).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });

    await pool.query(`UPDATE compliance_frameworks SET enabled = true WHERE organization_id = $1`, [orgId]);
    await discover(orgId);
    expect(await issuesFor(orgId, VOLUME)).toEqual([FAILED(orgId)]);
    expect(await complianceSeverityCounts(orgId)).toEqual({ critical: 1, high: 0, medium: 0, low: 0 });
    expect((await runsOf(orgId)).map((r) => [r.applicability, r.status])).toEqual([['enabled', 'complete'], ['disabled', 'complete'], ['enabled', 'complete']]);
  });

  it('one organization enabling a framework does not enable it for another', async () => {
    const enabledOrg = await insertOrg();
    const otherOrg = await insertOrg();
    await insertSetting(enabledOrg, 'HIPAA', true);
    await insertVolume(enabledOrg, false, []);
    await insertVolume(otherOrg, false, []);

    await discover(enabledOrg);
    const otherLogged = await discover(otherOrg);

    expect(await issuesFor(enabledOrg, VOLUME)).toEqual([FAILED(enabledOrg)]);
    expect(await issuesFor(otherOrg, VOLUME)).toEqual([]);
    expect(await storedFor(otherOrg)).toEqual({});
    expect(applicabilityLine(otherLogged)).toContain('HIPAA=not_configured (no_setting)');
  });

  it('a stale legacy snapshot that has not been rescanned does not count toward the score', async () => {
    const orgId = await insertOrg();
    await insertVolume(orgId, false, LEGACY);
    // No discovery: the snapshot is exactly what the previous scanner left.
    expect(await complianceSeverityCounts(orgId)).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });
});

describe('discovery compliance scan: when the evaluation cannot be stored', () => {
  const NEW_BASELINE = ['low', 'Resource is missing required tags: Owner, Environment, Team'];

  /** An enabled organization with one stored, projected failure. */
  async function withStoredFailure(): Promise<string> {
    const orgId = await insertOrg();
    await insertSetting(orgId, 'HIPAA', true);
    await insertVolume(orgId, false, []);
    await discover(orgId);
    expect(await issuesFor(orgId, VOLUME)).toEqual([FAILED(orgId)]);
    jest.restoreAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    return orgId;
  }

  const errorLines = () => (console.error as jest.Mock).mock.calls.map((c) => String(c[0]));

  it.each([
    ['the evaluation tables do not exist', () => jest.spyOn(evaluationsRepository, 'frameworkEvaluationStorageAvailable').mockResolvedValue(false)],
    ['a run cannot be started', () => jest.spyOn(evaluationsRepository, 'startFrameworkRun').mockRejectedValue(Object.assign(new Error('permission denied for table'), { code: '42501' }))],
  ])('%s: frameworks are not evaluated, the stored finding is preserved exactly, the baseline is refreshed, and it is logged', async (_name, breakStorage) => {
    const orgId = await withStoredFailure();
    const runsBefore = await runsOf(orgId);
    const storedBefore = await storedFor(orgId);
    // The resource has changed in both respects since the stored evaluation.
    await pool.query(`UPDATE aws_resources SET has_backup = true, tags = '{}' WHERE organization_id = $1`, [orgId]);
    // A legacy entry and a malformed one are in the array too.
    await pool.query(`UPDATE aws_resources SET compliance_issues = compliance_issues || $2::jsonb WHERE organization_id = $1`, [orgId, JSON.stringify([LEGACY[0], null])]);
    breakStorage();

    const logged = await discover(orgId);

    // Not evaluated: has_backup is now true, yet the stored failure is neither removed nor re-stated.
    const volume = await issuesFor(orgId, VOLUME);
    expect(volume.map((i: any) => [i.severity, i.issue])).toEqual([NEW_BASELINE, ['critical', FAILED(orgId).issue]]);
    expect(volume[1]).toEqual(FAILED(orgId));
    expect(await storedFor(orgId)).toEqual(storedBefore);
    // No run is left behind claiming to be in progress or complete.
    expect((await runsOf(orgId)).filter((r) => r.status !== 'failed')).toEqual(runsBefore);
    // Observable: one line with the stable token, and the scan itself completed.
    expect(errorLines().filter((line) => line.includes('FRAMEWORK_EVAL_STORAGE_UNAVAILABLE'))).toHaveLength(1);
    expect(logged.some((line) => line.includes('Compliance scan complete (1 resources scanned)'))).toBe(true);

    // Recovery: storage is back; the next scan evaluates, stores, and rebuilds the findings from what it stored.
    jest.restoreAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await discover(orgId);

    expect((await issuesFor(orgId, VOLUME)).map((i: any) => [i.severity, i.issue])).toEqual([NEW_BASELINE]);
    expect(await storedFor(orgId)).toMatchObject(BACKUPS_ROW('passed', 'backup_reported', 'passed'));
    expect((await runsOf(orgId)).slice(-1)).toEqual([expect.objectContaining({ applicability: 'enabled', status: 'complete', resources_failed: 0 })]);
    expect(errorLines().filter((line) => line.includes('FRAMEWORK_EVAL_STORAGE_UNAVAILABLE'))).toEqual([]);
  });

  it('storage unavailable for an organization with nothing stored: no framework finding appears from nowhere', async () => {
    const orgId = await insertOrg();
    await insertSetting(orgId, 'HIPAA', true);
    await insertVolume(orgId, false, LEGACY);
    jest.spyOn(evaluationsRepository, 'frameworkEvaluationStorageAvailable').mockResolvedValue(false);

    await discover(orgId);

    // HIPAA is enabled and the volume has no backup, but with nowhere to store the evaluation it is not made.
    expect(await issuesFor(orgId, VOLUME)).toEqual([]);
    expect(await runsOf(orgId)).toEqual([]);
  });

  it('one resource\'s transaction fails: its finding is preserved and flagged, the other resource is stored, the run is partial, and the next scan reconciles', async () => {
    const orgId = await withStoredFailure();
    // A second volume, stored as passing.
    await pool.query(
      `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, tags, is_encrypted, is_public, has_backup, compliance_issues)
       VALUES ($1, $2, 'vol-second', 'vol-second', 'ebs', 'us-east-1', 'available', $3, true, false, true, '[]')`,
      [orgId, `arn:aws:ec2:us-east-1:111122223333:volume/vol-second-${orgId}`, JSON.stringify({ Owner: 'o', Environment: 'e', Team: 't' })]
    );
    // The first volume now has a backup (it would pass) and has lost its tags (a new baseline finding).
    await pool.query(`UPDATE aws_resources SET has_backup = true, tags = '{}' WHERE organization_id = $1 AND resource_id = $2`, [orgId, VOLUME]);

    // Its transaction fails at the findings write, after its check rows were written.
    const volumeId = (await pool.query(`SELECT id FROM aws_resources WHERE organization_id = $1 AND resource_id = $2`, [orgId, VOLUME])).rows[0].id;
    const realPersist = evaluationsRepository.persistResourceEvaluation;
    jest.spyOn(evaluationsRepository, 'persistResourceEvaluation').mockImplementation((client, input) =>
      realPersist(client, input.resourceId === volumeId ? { ...input, project: () => { throw new Error('projection failed'); } } : input)
    );

    const logged = await discover(orgId);

    // Preserved, not re-verified: the stored failure is still listed, unchanged, beside the refreshed baseline.
    const volume = await issuesFor(orgId, VOLUME);
    expect(volume.map((i: any) => [i.severity, i.issue])).toEqual([NEW_BASELINE, ['critical', FAILED(orgId).issue]]);
    expect(volume[1]).toEqual(FAILED(orgId));
    // The check rows agree with it (still 'failed'), and are now stale; the run says partial.
    expect(await storedFor(orgId)).toEqual({
      [BACKUP_KEY]: ['failed', 'no_backup_reported', 'failed', true],
      'hipaa.backup_retention_policy': ['unable_to_evaluate', 'no_evidence_collected', null, true],
      'hipaa.customer_managed_key': ['unable_to_evaluate', 'no_evidence_collected', null, true],
    });
    expect((await runsOf(orgId)).slice(-1)).toEqual([expect.objectContaining({ status: 'partial', resources_persisted: 1, resources_failed: 1 })]);
    // The other resource was stored normally and is current.
    expect(await storedFor(orgId, 'vol-second')).toMatchObject({ [BACKUP_KEY]: ['passed', 'backup_reported', 'passed', false] });
    // Durable and observable.
    expect((await pool.query(`SELECT failure_count, failure_code FROM framework_evaluation_reconciliations WHERE resource_id = $1`, [volumeId])).rows)
      .toEqual([{ failure_count: 1, failure_code: 'persist_error' }]);
    expect(errorLines().filter((line) => line.includes('FRAMEWORK_EVAL_RECONCILIATION_REQUIRED'))).toHaveLength(1);
    expect(logged.some((line) => line.includes('Compliance scan complete (2 resources scanned)'))).toBe(true);

    // It fails again: counted, still partial, still preserved.
    await discover(orgId);
    expect((await pool.query(`SELECT failure_count FROM framework_evaluation_reconciliations WHERE resource_id = $1`, [volumeId])).rows).toEqual([{ failure_count: 2 }]);
    expect((await issuesFor(orgId, VOLUME))[1]).toEqual(FAILED(orgId));

    // The failure is corrected: the next scan stores the evaluation, rebuilds the findings and clears the marker.
    jest.restoreAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await discover(orgId);

    expect((await issuesFor(orgId, VOLUME)).map((i: any) => [i.severity, i.issue])).toEqual([NEW_BASELINE]);
    expect(await storedFor(orgId)).toMatchObject({ [BACKUP_KEY]: ['passed', 'backup_reported', 'passed', false] });
    expect((await pool.query(`SELECT count(*)::int AS n FROM framework_evaluation_reconciliations WHERE organization_id = $1`, [orgId])).rows[0].n).toBe(0);
    expect((await runsOf(orgId)).slice(-1)).toEqual([expect.objectContaining({ status: 'complete', resources_persisted: 2, resources_failed: 0 })]);
  });
});

// ─── Entries stored before this release, SOC 2, and S3 buckets that could not be read ───

const BUCKET = 'bucket-framework';
const bucketArn = (orgId: string) => `arn:aws:s3:::${BUCKET}-${orgId}`;

/** An S3 bucket, fully tagged and encrypted, holding whatever the previous scan left. */
async function insertBucket(orgId: string, complianceIssues: unknown[]): Promise<void> {
  await pool.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status,
        tags, is_encrypted, is_public, has_backup, compliance_issues)
     VALUES ($1, $2, $3, $3, 's3', 'us-east-1', 'active', $4, true, false, NULL, $5)`,
    [orgId, bucketArn(orgId), BUCKET, JSON.stringify({ Owner: 'o', Environment: 'e', Team: 't' }), JSON.stringify(complianceIssues)]
  );
}

/** The instance of insertInstance, holding whatever the previous scan left. */
async function setInstanceIssues(orgId: string, complianceIssues: unknown[]): Promise<void> {
  await pool.query(`UPDATE aws_resources SET compliance_issues = $1 WHERE organization_id = $2 AND resource_id = $3`, [
    JSON.stringify(complianceIssues), orgId, INSTANCE,
  ]);
}

/** The two tag-only SOC 2 signals, as the scanner wrote them for every organization. */
const LEGACY_SOC2 = [
  { severity: 'high', category: 'tagging', issue: 'Tagging: IAM role/owner not documented', recommendation: 'r', provenance: 'SELF_ATTESTED' },
  { severity: 'high', category: 'networking', issue: 'Observability: Monitoring/logging not documented via tag', recommendation: 'r', provenance: 'SELF_ATTESTED' },
];
const PUBLIC_IP = { severity: 'high', category: 'public_access', issue: 'EC2 instance has a public IP address', recommendation: 'r', provenance: 'OBSERVED' };
const MISSING_TAGS = { severity: 'low', category: 'tagging', issue: 'Resource is missing required tags: Owner, Environment, Team', recommendation: 'r', provenance: 'SELF_ATTESTED' };
const S3_PUBLIC_POLICY = (orgId: string) => ({
  severity: 'critical', category: 'public_access', issue: 'S3 bucket policy allows public access', recommendation: 'r',
  resource_arn: bucketArn(orgId), provenance: 'OBSERVED', findingKey: 's3.public_access.policy',
});
const S3_HTTPS = (orgId: string) => ({
  severity: 'high', category: 'encryption', issue: 'S3 bucket does not enforce HTTPS-only access', recommendation: 'r',
  resource_arn: bucketArn(orgId), provenance: 'OBSERVED', findingKey: 's3.https_only',
});

/** Every count, score input and at-risk flag an organization's stored findings feed, read the way the product reads them. */
async function everyCount(orgId: string) {
  const repository = new AWSResourcesRepository(pool);
  const stats = (await repository.getStats(orgId)).compliance_stats;
  const listed = await repository.getComplianceIssues(orgId);
  const report = await (new ReportGeneratorService(pool) as any).fetchComplianceStatusData(orgId);
  const { rows } = await pool.query(
    `SELECT resource_id, compliance_issues FROM aws_resources WHERE organization_id = $1 ORDER BY resource_id`,
    [orgId]
  );
  const exportColumn = (AWSResourcesExportService as any).COLUMN_MAPPINGS.compliance.formatter;
  return {
    score: { total: stats.total_issues, ...stats.by_severity },
    listing: Object.fromEntries(listed.map((r) => [r.resource_id, r.issues.map((i) => i.issue)])),
    report: {
      totalIssues: report.totalIssues,
      bySeverity: report.bySeverity,
      nonCompliant: report.topNonCompliantResources.map((r: any) => [r.name, r.issueCount]),
      complianceScore: report.complianceScore,
    },
    export: Object.fromEntries(rows.map((r) => [r.resource_id, exportColumn(r)])),
    atRisk: Object.fromEntries(rows.map((r) => [r.resource_id, derivePrioritySeverity('healthy', r.compliance_issues, []).needs_attention])),
  };
}

describe('entries stored before frameworks had to be enabled (no data migration removes them)', () => {
  /** What a scan by the previous release left: legacy HIPAA and SOC 2 entries beside real baseline findings. */
  async function legacyOrg(): Promise<string> {
    const orgId = await insertOrg();
    await insertVolume(orgId, false, LEGACY);
    await insertInstance(orgId);
    await setInstanceIssues(orgId, [PUBLIC_IP, MISSING_TAGS, ...LEGACY_SOC2, LEGACY[0]]);
    return orgId;
  }

  it('(a) before any scan by this release, the read filter keeps them out of every count, score and at-risk flag', async () => {
    const orgId = await legacyOrg();

    // The stored arrays are untouched: 3 legacy entries on the volume, 2 real + 3 legacy on the instance.
    expect(await issuesFor(orgId, VOLUME)).toHaveLength(3);
    expect(await issuesFor(orgId, INSTANCE)).toHaveLength(5);

    expect(await everyCount(orgId)).toEqual({
      // Only the instance's public IP (High) and missing tags (Low).
      score: { total: 2, critical: 0, high: 1, medium: 0, low: 1 },
      // The volume holds nothing but legacy entries, so it is not listed at all.
      listing: { [INSTANCE]: [PUBLIC_IP.issue, MISSING_TAGS.issue] },
      report: {
        totalIssues: 2,
        bySeverity: { critical: 0, high: 1, medium: 0, low: 1 },
        nonCompliant: [[INSTANCE, 2]],
        complianceScore: 50,
      },
      export: { [INSTANCE]: '2 issues', [VOLUME]: 'No issues' },
      // The instance is at risk for its real High; the volume's legacy Critical does not make it so.
      atRisk: { [INSTANCE]: true, [VOLUME]: false },
    });
  });

  it('(a) an organization whose only stored entries are legacy ones has no issues anywhere', async () => {
    const orgId = await insertOrg();
    await insertVolume(orgId, false, LEGACY);
    await insertInstance(orgId);
    await setInstanceIssues(orgId, LEGACY_SOC2);

    expect(await everyCount(orgId)).toEqual({
      score: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
      listing: {},
      report: { totalIssues: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, nonCompliant: [], complianceScore: 100 },
      export: { [INSTANCE]: 'No issues', [VOLUME]: 'No issues' },
      atRisk: { [INSTANCE]: false, [VOLUME]: false },
    });
  });

  it('(b) the next scan drops them from the stored arrays, with no framework enabled', async () => {
    const orgId = await legacyOrg();
    const before = await everyCount(orgId);

    await discover(orgId);

    expect(await issuesFor(orgId, VOLUME)).toEqual([]);
    const instance = await issuesFor(orgId, INSTANCE);
    expect(instance.map((i) => [i.severity, i.issue])).toEqual(BASELINE_INSTANCE_FINDINGS);
    for (const issue of [...LEGACY, ...LEGACY_SOC2]) expect(instance.map((i) => i.issue)).not.toContain(issue.issue);
    // Nothing was stored as an evaluation for either: no framework was evaluated.
    expect(await storedFor(orgId, VOLUME)).toEqual({});
    expect(await storedFor(orgId, INSTANCE)).toEqual({});
    // The same two findings count as before the scan: the read filter had already excluded
    // exactly what the scan removed. Only the public IP's grade moved, High to Medium,
    // because this scan could not read the instance's security groups (2B).
    const after = await everyCount(orgId);
    expect(before.score).toEqual({ total: 2, critical: 0, high: 1, medium: 0, low: 1 });
    expect(after.score).toEqual({ total: 2, critical: 0, high: 0, medium: 1, low: 1 });
    expect(after.listing).toEqual({ [INSTANCE]: [EC2_PUBLIC_UNKNOWN, MISSING_TAGS.issue] });
    expect(after.report.totalIssues).toBe(before.report.totalIssues);
    expect(after.report.nonCompliant).toEqual(before.report.nonCompliant);
  });

  it('(b) the next scan drops them even when the evaluation tables do not exist', async () => {
    const orgId = await legacyOrg();
    const storage = () => jest.spyOn(evaluationsRepository, 'frameworkEvaluationStorageAvailable').mockResolvedValue(false);
    storage();
    mockAws();
    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId).catch(() => {});

    expect(await issuesFor(orgId, VOLUME)).toEqual([]);
    expect((await issuesFor(orgId, INSTANCE)).map((i) => [i.severity, i.issue])).toEqual(BASELINE_INSTANCE_FINDINGS);
    expect(await runsOf(orgId)).toEqual([]);
    expect(await runsOf(orgId, 'SOC2')).toEqual([]);
  });

  it('(b) and they do not come back on the scan after that', async () => {
    const orgId = await legacyOrg();
    await discover(orgId);
    await discover(orgId);
    expect(await issuesFor(orgId, VOLUME)).toEqual([]);
    expect((await issuesFor(orgId, INSTANCE)).map((i) => [i.severity, i.issue])).toEqual(BASELINE_INSTANCE_FINDINGS);
  });
});

describe('discovery compliance scan: SOC 2 follows the same rules as HIPAA', () => {
  const SOC2_ROWS = (state: string, reason: string) => ({
    'soc2.iam_role_documented': [state, reason, null, false],
    'soc2.monitoring_logging_documented': [state, reason, null, false],
  });

  it('off by default: a SOC 2 run records that it was not configured, no check is stored, and the untagged instance has no High from it', async () => {
    const orgId = await insertOrg();
    await insertInstance(orgId);
    const logged = await discover(orgId);

    expect(fullApplicabilityLine(logged)).toContain('SOC2=not_configured (no_setting)');
    expect(await runsOf(orgId, 'SOC2')).toEqual([
      { applicability: 'not_configured', applicability_reason_code: 'no_setting', status: 'complete', resources_persisted: 1, resources_failed: 0, has_job: true },
    ]);
    expect(await storedFor(orgId, INSTANCE)).toEqual({});
    expect((await issuesFor(orgId, INSTANCE)).map((i) => [i.severity, i.issue])).toEqual(BASELINE_INSTANCE_FINDINGS);
    expect(await complianceSeverityCounts(orgId)).toEqual({ critical: 0, high: 0, medium: 1, low: 1 });
  });

  it('explicitly enabled: both tag-only checks are stored as unable_to_evaluate -- no finding, no pass, no severity -- and the counts do not move', async () => {
    const orgId = await insertOrg();
    await insertInstance(orgId);
    await insertSetting(orgId, 'SOC2', true);
    const logged = await discover(orgId);

    expect(fullApplicabilityLine(logged)).toContain('HIPAA=not_configured (no_setting), SOC2=enabled (explicitly_enabled)');
    expect(await runsOf(orgId, 'SOC2')).toEqual([
      { applicability: 'enabled', applicability_reason_code: 'explicitly_enabled', status: 'complete', resources_persisted: 1, resources_failed: 0, has_job: true },
    ]);
    // Enabling SOC 2 does not enable HIPAA.
    expect((await runsOf(orgId)).map((r) => r.applicability)).toEqual(['not_configured']);

    expect(await storedFor(orgId, INSTANCE)).toEqual(SOC2_ROWS('unable_to_evaluate', 'no_evidence_collected'));
    const { rows } = await pool.query(
      `SELECT check_key, severity, evidence_basis, provenance FROM compliance_check_evaluations WHERE organization_id = $1 ORDER BY check_key`,
      [orgId]
    );
    expect(rows).toEqual([
      { check_key: 'soc2.iam_role_documented', severity: null, evidence_basis: 'none', provenance: null },
      { check_key: 'soc2.monitoring_logging_documented', severity: null, evidence_basis: 'none', provenance: null },
    ]);

    const instance = await issuesFor(orgId, INSTANCE);
    expect(instance.map((i) => [i.severity, i.issue])).toEqual(BASELINE_INSTANCE_FINDINGS);
    expect(instance.filter((i) => i.framework !== undefined)).toEqual([]);
    expect(await complianceSeverityCounts(orgId)).toEqual({ critical: 0, high: 0, medium: 1, low: 1 });
  });

  it('explicitly enabled with the tags present: still unable_to_evaluate (a tag is self-attested), never passed', async () => {
    const orgId = await insertOrg();
    await insertInstance(orgId);
    await pool.query(`UPDATE aws_resources SET tags = $1 WHERE organization_id = $2`, [
      JSON.stringify({ IAMRole: 'app-role', MonitoringEnabled: 'true' }), orgId,
    ]);
    await insertSetting(orgId, 'SOC2', true);
    await discover(orgId);

    expect(await storedFor(orgId, INSTANCE)).toEqual(SOC2_ROWS('unable_to_evaluate', 'tag_only_evidence'));
    expect((await issuesFor(orgId, INSTANCE)).filter((i) => i.framework !== undefined)).toEqual([]);
  });

  it('enabled then disabled: the stored rows say not evaluated, and there is still no finding', async () => {
    const orgId = await insertOrg();
    await insertInstance(orgId);
    await insertSetting(orgId, 'SOC2', true);
    await discover(orgId);
    await pool.query(`UPDATE compliance_frameworks SET enabled = false WHERE organization_id = $1`, [orgId]);
    await discover(orgId);

    expect(await storedFor(orgId, INSTANCE)).toEqual(SOC2_ROWS('not_evaluated', 'explicitly_disabled'));
    expect((await issuesFor(orgId, INSTANCE)).map((i) => [i.severity, i.issue])).toEqual(BASELINE_INSTANCE_FINDINGS);
  });

  it('legacy High SOC 2 entries are dropped by a scan with SOC 2 enabled too: the check that replaces them cannot fail', async () => {
    const orgId = await insertOrg();
    await insertInstance(orgId);
    await setInstanceIssues(orgId, LEGACY_SOC2);
    await insertSetting(orgId, 'SOC2', true);
    await discover(orgId);

    expect((await issuesFor(orgId, INSTANCE)).map((i) => [i.severity, i.issue])).toEqual(BASELINE_INSTANCE_FINDINGS);
  });
});

describe('discovery compliance scan: an S3 bucket that could not be read', () => {
  const NOT_READ = {
    verification: 'unverified',
    evaluation_state: 'unable_to_evaluate',
    evidence_basis: 'none',
    evaluation_reason:
      'The configuration this check reads could not be read on the latest scan; this finding is from an earlier scan and was not re-verified',
  };
  const THREW = {
    verification: 'unverified',
    evaluation_state: 'error',
    evidence_basis: 'none',
    evaluation_reason: 'The check could not be completed on the latest scan; this finding is from an earlier scan and was not re-verified',
  };
  const NO_ISSUES = {
    score: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
    listing: {},
    report: { totalIssues: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, nonCompliant: [], complianceScore: 100 },
    export: { [BUCKET]: 'No issues' },
    atRisk: { [BUCKET]: false },
  };

  it('verified findings count: the fixture really is at risk before the bucket becomes unreadable', async () => {
    const orgId = await insertOrg();
    await insertBucket(orgId, [S3_PUBLIC_POLICY(orgId), S3_HTTPS(orgId)]);
    expect(await everyCount(orgId)).toMatchObject({
      score: { total: 2, critical: 1, high: 1, medium: 0, low: 0 },
      export: { [BUCKET]: '2 issues' },
      atRisk: { [BUCKET]: true },
    });
  });

  it('every S3 read denied: the previous findings are carried as unable_to_evaluate and counted nowhere', async () => {
    const orgId = await insertOrg();
    await insertBucket(orgId, [S3_PUBLIC_POLICY(orgId), S3_HTTPS(orgId)]);

    await discover(orgId); // mockAws: every S3 and S3 Control call is AccessDenied

    expect(await issuesFor(orgId, BUCKET)).toEqual([
      { ...S3_PUBLIC_POLICY(orgId), ...NOT_READ },
      { ...S3_HTTPS(orgId), ...NOT_READ },
    ]);
    expect(await everyCount(orgId)).toEqual(NO_ISSUES);
  });

  it('the evaluation itself throws: the previous findings are carried as error and counted nowhere', async () => {
    const orgId = await insertOrg();
    await insertBucket(orgId, [S3_PUBLIC_POLICY(orgId), S3_HTTPS(orgId)]);

    jest.spyOn(ComplianceScannerService.prototype, 'evaluateS3Security').mockRejectedValue(new Error('socket hang up at 203.0.113.7'));
    mockAws();
    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId).catch(() => {});

    const stored = await issuesFor(orgId, BUCKET);
    expect(stored).toEqual([
      { ...S3_PUBLIC_POLICY(orgId), ...THREW },
      { ...S3_HTTPS(orgId), ...THREW },
    ]);
    // The exception's text is logged, never stored.
    expect(JSON.stringify(stored)).not.toContain('socket hang up');
    expect(await everyCount(orgId)).toEqual(NO_ISSUES);
  });

  it('stays excluded scan after scan while the bucket stays unreadable, without duplicating', async () => {
    const orgId = await insertOrg();
    await insertBucket(orgId, [S3_PUBLIC_POLICY(orgId)]);
    await discover(orgId);
    await discover(orgId);
    await discover(orgId);

    expect(await issuesFor(orgId, BUCKET)).toEqual([{ ...S3_PUBLIC_POLICY(orgId), ...NOT_READ }]);
    expect(await everyCount(orgId)).toEqual(NO_ISSUES);
  });

  it('an unverified entry stored by the previous release (no recorded state) is already excluded before any scan', async () => {
    const orgId = await insertOrg();
    await insertBucket(orgId, [{ ...S3_PUBLIC_POLICY(orgId), verification: 'unverified' }]);
    expect(await everyCount(orgId)).toEqual(NO_ISSUES);
  });

  it('a bucket with nothing found before and nothing readable now has no finding and no pass invented for it', async () => {
    const orgId = await insertOrg();
    await insertBucket(orgId, []);
    await discover(orgId);
    expect(await issuesFor(orgId, BUCKET)).toEqual([]);
    expect(await everyCount(orgId)).toEqual(NO_ISSUES);
  });
});

describe('the supplied production account (audit 4.3): which findings remain', () => {
  // Nine resources and the 41 entries the previous scanner stored for them, as the
  // audit reconciled them (9 live resources; 5 Critical, 17 High, 10 Medium, 9 Low;
  // 6 of 9 at risk). Every name and identifier is a placeholder.
  const T = (severity: string, category: string, issue: string, extra: Record<string, unknown> = {}) => ({ severity, category, issue, recommendation: 'r', ...extra });
  const TAGS = T('low', 'tagging', 'Resource is missing required tags: Owner, Environment, Team', { provenance: 'SELF_ATTESTED' });
  const HIPAA_RETENTION = T('high', 'backups', 'HIPAA: Resource lacks documented backup retention policy');
  const HIPAA_CMK = T('medium', 'encryption', 'HIPAA: Resource should use AWS KMS Customer Managed Keys (CMK) for encryption');
  const HIPAA_BACKUPS = T('critical', 'backups', 'HIPAA: EBS storing PHI must have automated backups');
  const HIPAA_LOGGING = (type: string) => T('critical', 'networking', `HIPAA: ${type} lacks required access logging for audit trails`);
  const HIPAA_VERSIONING = T('high', 'backups', 'HIPAA: S3 bucket should have versioning enabled for PHI data integrity');
  const SOC2_IAM = T('high', 'tagging', 'Tagging: IAM role/owner not documented', { provenance: 'SELF_ATTESTED' });
  const SOC2_MONITORING = T('high', 'networking', 'Observability: Monitoring/logging not documented via tag', { provenance: 'SELF_ATTESTED' });
  const NOT_ENCRYPTED = (type: string) => T('medium', 'encryption', `${type} resource is not encrypted`, { provenance: 'OBSERVED' });
  const EC2_PUBLIC = T('high', 'public_access', 'EC2 instance has a public IP address', { provenance: 'OBSERVED' });
  const EC2_SNAPSHOTS = T('medium', 'backups', 'EC2 instance does not have regular snapshots', { provenance: 'OBSERVED' });
  const HTTPS_ONLY = T('high', 'encryption', 'S3 bucket does not enforce HTTPS-only access', { provenance: 'OBSERVED', findingKey: 's3.https_only' });
  const S3_COMMON = [TAGS, SOC2_MONITORING, HIPAA_CMK, HIPAA_LOGGING('S3'), HIPAA_RETENTION, HIPAA_VERSIONING];

  type Fixture = { id: string; type: string; status: string; encrypted: boolean; isPublic: boolean; hasBackup: boolean | null; stored: unknown[] };
  const ACCOUNT: Fixture[] = [
    { id: 'vol-unattached', type: 'ebs', status: 'available', encrypted: false, isPublic: false, hasBackup: null, stored: [NOT_ENCRYPTED('EBS'), TAGS, HIPAA_RETENTION] },
    { id: 'vol-attached', type: 'ebs', status: 'in-use', encrypted: true, isPublic: false, hasBackup: false, stored: [TAGS, HIPAA_CMK, HIPAA_RETENTION, HIPAA_BACKUPS] },
    { id: 'instance', type: 'ec2', status: 'running', encrypted: true, isPublic: true, hasBackup: false, stored: [EC2_PUBLIC, EC2_SNAPSHOTS, TAGS, SOC2_IAM, SOC2_MONITORING, HIPAA_CMK, HIPAA_LOGGING('EC2'), HIPAA_RETENTION] },
    { id: 'bucket-one', type: 's3', status: 'active', encrypted: true, isPublic: false, hasBackup: null, stored: [...S3_COMMON, HTTPS_ONLY] },
    { id: 'bucket-two', type: 's3', status: 'active', encrypted: true, isPublic: false, hasBackup: null, stored: [...S3_COMMON, HTTPS_ONLY] },
    { id: 'bucket-three', type: 's3', status: 'active', encrypted: true, isPublic: false, hasBackup: null, stored: S3_COMMON },
    { id: 'topic', type: 'sns', status: 'active', encrypted: false, isPublic: false, hasBackup: false, stored: [NOT_ENCRYPTED('SNS'), TAGS] },
    { id: 'vpc-one', type: 'vpc', status: 'available', encrypted: false, isPublic: false, hasBackup: false, stored: [NOT_ENCRYPTED('VPC'), TAGS] },
    { id: 'vpc-two', type: 'vpc', status: 'available', encrypted: false, isPublic: false, hasBackup: false, stored: [NOT_ENCRYPTED('VPC'), TAGS] },
  ];
  const HTTPS_FAILING = new Set(['bucket-one', 'bucket-two']);

  async function insertAccount(): Promise<string> {
    const orgId = await insertOrg();
    for (const r of ACCOUNT) {
      await pool.query(
        `INSERT INTO aws_resources
           (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status,
            tags, is_encrypted, is_public, has_backup, compliance_issues)
         VALUES ($1, $2, $3, $3, $4, 'us-east-1', $5, '{}', $6, $7, $8, $9)`,
        [orgId, `arn:aws:${r.type}:us-east-1:111122223333:fixture/${r.id}-${orgId}`, r.id, r.type, r.status, r.encrypted, r.isPublic, r.hasBackup, JSON.stringify(r.stored)]
      );
    }
    return orgId;
  }

  /** The S3 evaluator, reading each bucket successfully: HTTPS-only fails on two buckets and passes on the third. */
  function mockReadableS3() {
    jest.spyOn(ComplianceScannerService.prototype, 'evaluateS3Security').mockImplementation(async (resource) => {
      const pass = (key: string) => ({ key, status: 'pass', reason: 'ok' });
      const failing = HTTPS_FAILING.has(resource.resource_id);
      return {
        issues: failing ? [{ ...HTTPS_ONLY, resource_arn: resource.resource_arn }] : [],
        evaluation: {
          publicPolicy: pass('s3.public_access.policy'),
          publicAcl: pass('s3.public_access.acl'),
          httpsOnly: failing ? { key: 's3.https_only', status: 'fail', reason: 'no policy' } : pass('s3.https_only'),
        },
      } as any;
    });
  }

  async function scan(orgId: string): Promise<void> {
    mockReadableS3();
    mockAws();
    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId).catch(() => {});
    jest.restoreAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  }

  /** Per resource: every stored entry, and the ones that count; plus the organization's totals. */
  async function snapshot(orgId: string) {
    const { rows } = await pool.query(
      `SELECT resource_id, resource_type, status, compliance_issues FROM aws_resources WHERE organization_id = $1`,
      [orgId]
    );
    const byId = new Map(rows.map((r) => [r.resource_id, r]));
    const stats = (await new AWSResourcesRepository(pool).getStats(orgId)).compliance_stats;
    const perResource = Object.fromEntries(
      ACCOUNT.map(({ id }) => {
        const row = byId.get(id);
        const priority = derivePrioritySeverity(mapStatus(row.resource_type, row.status), row.compliance_issues, []);
        return [id, {
          stored: row.compliance_issues.length,
          counted: (row.compliance_issues as any[]).filter((i) => derivePrioritySeverity('healthy', [i], []).priority_severity !== null).map((i) => `${i.severity}: ${i.issue}`),
          worst: priority.priority_severity,
          atRisk: priority.needs_attention,
        }];
      })
    );
    const stored = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
    for (const row of rows) for (const issue of row.compliance_issues) stored[issue.severity]++;
    return {
      storedEntries: rows.reduce((n, r) => n + r.compliance_issues.length, 0),
      storedBySeverity: stored,
      counted: { total: stats.total_issues, ...stats.by_severity },
      atRisk: Object.values(perResource).filter((r) => r.atRisk).length,
      perResource,
    };
  }

  // What remains once only current findings count, before any scan. Since 2B an
  // attached volume (`in-use`) is no longer at risk through its status, and a bucket,
  // topic or VPC has no status to be at risk through.
  const REMAINING = {
    'vol-unattached': { counted: ['medium: EBS resource is not encrypted', 'low: Resource is missing required tags: Owner, Environment, Team'], worst: 'medium', atRisk: false },
    'vol-attached': { counted: ['low: Resource is missing required tags: Owner, Environment, Team'], worst: 'low', atRisk: false },
    instance: { counted: ['high: EC2 instance has a public IP address', 'medium: EC2 instance does not have regular snapshots', 'low: Resource is missing required tags: Owner, Environment, Team'], worst: 'high', atRisk: true },
    'bucket-one': { counted: ['low: Resource is missing required tags: Owner, Environment, Team', 'high: S3 bucket does not enforce HTTPS-only access'], worst: 'high', atRisk: true },
    'bucket-two': { counted: ['low: Resource is missing required tags: Owner, Environment, Team', 'high: S3 bucket does not enforce HTTPS-only access'], worst: 'high', atRisk: true },
    'bucket-three': { counted: ['low: Resource is missing required tags: Owner, Environment, Team'], worst: 'low', atRisk: false },
    topic: { counted: ['medium: SNS resource is not encrypted', 'low: Resource is missing required tags: Owner, Environment, Team'], worst: 'medium', atRisk: false },
    'vpc-one': { counted: ['medium: VPC resource is not encrypted', 'low: Resource is missing required tags: Owner, Environment, Team'], worst: 'medium', atRisk: false },
    'vpc-two': { counted: ['medium: VPC resource is not encrypted', 'low: Resource is missing required tags: Owner, Environment, Team'], worst: 'medium', atRisk: false },
  };
  // What a scan leaves when it can read nothing from AWS (mockAws): only findings that
  // rest on what is already recorded. With no security groups read the instance's
  // public IP is Medium; with no tags read a bucket, topic or VPC has no tag finding;
  // and a topic or VPC has no "not encrypted" finding, because nothing reads that.
  // (awsResourceDiscovery.resource-truth-fixture.test.ts runs the same account with
  // AWS answering.)
  const NONE = { counted: [] as string[], worst: null as string | null, atRisk: false };
  const REMAINING_AFTER_BLIND_SCAN = {
    ...REMAINING,
    instance: { counted: [`medium: ${EC2_PUBLIC_UNKNOWN}`, 'medium: EC2 instance does not have regular snapshots', 'low: Resource is missing required tags: Owner, Environment, Team'], worst: 'medium', atRisk: false },
    'bucket-one': { counted: ['high: S3 bucket does not enforce HTTPS-only access'], worst: 'high', atRisk: true },
    'bucket-two': { counted: ['high: S3 bucket does not enforce HTTPS-only access'], worst: 'high', atRisk: true },
    'bucket-three': NONE,
    topic: NONE,
    'vpc-one': NONE,
    'vpc-two': NONE,
  };
  const sorted = (per: Record<string, { counted: string[]; worst: string | null; atRisk: boolean }>) =>
    Object.fromEntries(Object.entries(per).map(([id, r]) => [id, { counted: [...r.counted].sort(), worst: r.worst, atRisk: r.atRisk }]));

  it('the fixture is the account the audit describes: 41 stored entries, 5 Critical / 17 High / 10 Medium / 9 Low', async () => {
    const orgId = await insertAccount();
    const before = await snapshot(orgId);
    expect(before.storedEntries).toBe(41);
    expect(before.storedBySeverity).toEqual({ critical: 5, high: 17, medium: 10, low: 9 });
    expect(Object.values(before.perResource).map((r) => r.stored)).toEqual([3, 4, 8, 7, 7, 6, 2, 2, 2]);
  });

  it('on deploy, before any scan: 17 of the 41 stored entries count, with no Critical; 3 of 9 are at risk', async () => {
    const orgId = await insertAccount();
    const deployed = await snapshot(orgId);

    expect(deployed.storedEntries).toBe(41);
    expect(deployed.counted).toEqual({ total: 17, critical: 0, high: 3, medium: 5, low: 9 });
    expect(deployed.atRisk).toBe(3);
    expect(sorted(deployed.perResource)).toEqual(sorted(REMAINING));
  });

  it('after the next scan, with no framework enabled and AWS unreadable: 8 findings are all that is stored, 2 of 9 at risk', async () => {
    const orgId = await insertAccount();
    await scan(orgId);
    const scanned = await snapshot(orgId);

    expect(scanned.storedEntries).toBe(8);
    expect(scanned.storedBySeverity).toEqual({ critical: 0, high: 2, medium: 3, low: 3 });
    expect(scanned.counted).toEqual({ total: 8, critical: 0, high: 2, medium: 3, low: 3 });
    expect(scanned.atRisk).toBe(2);
    expect(sorted(scanned.perResource)).toEqual(sorted(REMAINING_AFTER_BLIND_SCAN));
    // Nothing was evaluated for a framework, so nothing is stored as an evaluation.
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM compliance_check_evaluations WHERE organization_id = $1`, [orgId]);
    expect(rows[0].n).toBe(0);
  });

  it('with HIPAA and SOC 2 both enabled: one more finding (the observed missing EBS backup); every tag-only check is unable_to_evaluate', async () => {
    const orgId = await insertAccount();
    await insertSetting(orgId, 'HIPAA', true);
    await insertSetting(orgId, 'SOC2', true);
    await scan(orgId);
    const enabled = await snapshot(orgId);

    expect(enabled.counted).toEqual({ total: 9, critical: 1, high: 2, medium: 3, low: 3 });
    expect(enabled.storedEntries).toBe(9);
    expect(enabled.atRisk).toBe(3);
    expect(enabled.perResource['vol-attached']).toMatchObject({
      counted: expect.arrayContaining(['critical: HIPAA: EBS storing PHI must have automated backups']),
      worst: 'critical',
      atRisk: true,
    });
    const others = Object.fromEntries(Object.entries(sorted(enabled.perResource)).filter(([id]) => id !== 'vol-attached'));
    const expectedOthers = Object.fromEntries(Object.entries(sorted(REMAINING_AFTER_BLIND_SCAN)).filter(([id]) => id !== 'vol-attached'));
    expect(others).toEqual(expectedOthers);

    const { rows } = await pool.query(
      `SELECT source_key, evaluation_state, count(*)::int AS n, count(severity)::int AS with_severity
         FROM compliance_check_evaluations WHERE organization_id = $1
        GROUP BY source_key, evaluation_state ORDER BY source_key, evaluation_state`,
      [orgId]
    );
    expect(rows).toEqual([
      // vol-attached: AWS Backup reports none.
      { source_key: 'HIPAA', evaluation_state: 'failed', n: 1, with_severity: 1 },
      // vol-unattached: unencrypted, so the customer-managed-key check defers to the baseline encryption finding.
      { source_key: 'HIPAA', evaluation_state: 'not_evaluated', n: 1, with_severity: 0 },
      { source_key: 'HIPAA', evaluation_state: 'unable_to_evaluate', n: 19, with_severity: 0 },
      { source_key: 'SOC2', evaluation_state: 'unable_to_evaluate', n: 5, with_severity: 0 },
    ]);
  });
});

describe('readBuiltInFrameworkSettings under a role that row-level security applies to', () => {
  it('returns only the context organization\'s built-in settings, and nothing for another organization\'s id', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    await insertSetting(orgA, 'HIPAA', true);
    await insertSetting(orgA, null, true, 'custom');
    await insertSetting(orgB, 'HIPAA', false);

    const role = `fw_reader_${Math.random().toString(36).slice(2, 10)}`;
    const client = await pool.connect();
    try {
      // Rolled back: the role never outlives this test. pg_read_all_data grants
      // SELECT and does not bypass RLS.
      await client.query('BEGIN');
      await client.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
      await client.query(`GRANT pg_read_all_data TO ${role}`);
      await client.query(`SET LOCAL ROLE ${role}`);
      const subject = await client.query('SELECT rolsuper OR rolbypassrls AS bypasses FROM pg_roles WHERE rolname = current_user');
      expect(subject.rows[0].bypasses).toBe(false);

      // With no organization context, the role reads nothing.
      expect(await frameworksRepository.readBuiltInFrameworkSettings(client, orgA)).toEqual([]);

      await client.query(`SELECT set_config('app.current_organization_id', $1, true)`, [orgA]);

      const own = await frameworksRepository.readBuiltInFrameworkSettings(client, orgA);
      expect(own).toEqual([{ standard_name: 'HIPAA', enabled: true }]);
      expect(resolveFrameworkApplicability({ status: 'ok', rows: own }).map((a) => [a.framework, a.state])).toEqual([['HIPAA', 'enabled'], ['SOC2', 'not_configured']]);

      // Asking for another organization's settings from A's context reads nothing:
      // it resolves to not_configured, never to B's (or A's) setting.
      const foreign = await frameworksRepository.readBuiltInFrameworkSettings(client, orgB);
      expect(foreign).toEqual([]);
      expect(resolveFrameworkApplicability({ status: 'ok', rows: foreign }).map((a) => [a.framework, a.state])).toEqual([['HIPAA', 'not_configured'], ['SOC2', 'not_configured']]);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });
});
