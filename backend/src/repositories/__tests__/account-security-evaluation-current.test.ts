/**
 * Live-DB coverage for AccountSecurityFindingsRepository.isLatestSecurityEvaluationCurrent():
 * the gate on the Dashboard's W11 line. Only a latest *finished* run that completed,
 * with its compliance and account-level scans complete, within the age bound, counts.
 */
import { Pool } from 'pg';
import { AccountSecurityFindingsRepository } from '../account-security-findings.repository';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const repository = new AccountSecurityFindingsRepository();
const createdOrgIds: string[] = [];
const MAX_AGE = 13 * 60 * 60;

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free') RETURNING id`,
    [`Eval Org ${suffix}`, `eval-org-${suffix}`, `Eval Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

/** A discovery run; ages are hours before now (null = not finished). */
async function insertJob(orgId: string, job: { status: string; compliance: boolean; finishedHoursAgo: number | null; createdHoursAgo?: number }) {
  const created = job.createdHoursAgo ?? (job.finishedHoursAgo ?? 0) + 0.5;
  await pool.query(
    `INSERT INTO resource_discovery_jobs (organization_id, status, compliance_scan_completed, created_at, completed_at)
     VALUES ($1, $2, $3, NOW() - make_interval(secs => $4), CASE WHEN $5::float8 IS NULL THEN NULL ELSE NOW() - make_interval(secs => $5::float8) END)`,
    [orgId, job.status, job.compliance, created * 3600, job.finishedHoursAgo === null ? null : job.finishedHoursAgo * 3600]
  );
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('isLatestSecurityEvaluationCurrent', () => {
  it('true for a completed, fully complete run within the bound', async () => {
    const org = await insertOrg();
    await insertJob(org, { status: 'completed', compliance: true, finishedHoursAgo: 1 });
    await expect(repository.isLatestSecurityEvaluationCurrent(org, MAX_AGE)).resolves.toBe(true);
  });

  it('false when no run ever finished', async () => {
    const org = await insertOrg();
    await expect(repository.isLatestSecurityEvaluationCurrent(org, MAX_AGE)).resolves.toBe(false);
    await insertJob(org, { status: 'running', compliance: false, finishedHoursAgo: null });
    await expect(repository.isLatestSecurityEvaluationCurrent(org, MAX_AGE)).resolves.toBe(false);
  });

  it('false when the latest finished run was partial (compliance or account scan incomplete), even after an earlier complete one', async () => {
    const org = await insertOrg();
    await insertJob(org, { status: 'completed', compliance: true, finishedHoursAgo: 7 });
    await insertJob(org, { status: 'completed', compliance: false, finishedHoursAgo: 1 });
    await expect(repository.isLatestSecurityEvaluationCurrent(org, MAX_AGE)).resolves.toBe(false);
  });

  it('false when the latest finished run failed', async () => {
    const org = await insertOrg();
    await insertJob(org, { status: 'completed', compliance: true, finishedHoursAgo: 7 });
    await insertJob(org, { status: 'failed', compliance: true, finishedHoursAgo: 1 });
    await expect(repository.isLatestSecurityEvaluationCurrent(org, MAX_AGE)).resolves.toBe(false);
  });

  it('false when the complete run is older than the bound', async () => {
    const org = await insertOrg();
    await insertJob(org, { status: 'completed', compliance: true, finishedHoursAgo: 14 });
    await expect(repository.isLatestSecurityEvaluationCurrent(org, MAX_AGE)).resolves.toBe(false);
  });

  it('a run still in progress does not hide the latest finished one', async () => {
    const org = await insertOrg();
    await insertJob(org, { status: 'completed', compliance: true, finishedHoursAgo: 2 });
    await insertJob(org, { status: 'running', compliance: false, finishedHoursAgo: null, createdHoursAgo: 0.1 });
    await expect(repository.isLatestSecurityEvaluationCurrent(org, MAX_AGE)).resolves.toBe(true);
  });

  it("another organization's run never counts", async () => {
    const org = await insertOrg();
    const other = await insertOrg();
    await insertJob(other, { status: 'completed', compliance: true, finishedHoursAgo: 1 });
    await expect(repository.isLatestSecurityEvaluationCurrent(org, MAX_AGE)).resolves.toBe(false);
  });
});
