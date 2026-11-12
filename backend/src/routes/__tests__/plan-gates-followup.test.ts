/**
 * Pricing PR 1A follow-up:
 *
 *   A1. The organization responses the UI loads (GET /api/auth/me,
 *       GET /api/organizations, login) report `effectiveTier`: the tier the
 *       plan gates enforce (free while the organization is restricted or its
 *       grace period has ended), next to the stored `subscriptionTier`, which
 *       is unchanged. Proven equal to what the real gate decides.
 *   A2. The weekly summary (the email and its preview) leaves the DORA
 *       metrics -- deployment frequency and the change failure rate -- out
 *       below Pro, and when the plan cannot be read. The counts and every
 *       other section are the same on every plan.
 *   A4. Resource inventory export is PLAN_ENTITLEMENTS.resourceInventoryExport:
 *       Starter and above, unchanged.
 *
 * Real routes, real authentication and the real plan middleware against
 * Postgres (role-gate-harness.ts). Stubbed: Cost Explorer, the security score,
 * cost recommendations and account findings (not under test), the weekly
 * recipient lookup (its columns are not in the CI schema; covered by
 * weekly-summary-recipient.test.ts), the weekly AWS connection lookup (the CI
 * schema has no aws_accounts table; stubbed as connected so the security
 * section is always read), the Resend client, and the export handler.
 * Expected tiers are written out, never read from PLAN_ENTITLEMENTS.
 */
jest.mock('../../services/aws-cost.service', () => ({
  ...jest.requireActual('../../services/aws-cost.service'),
  __esModule: true,
  default: {
    fetchCostTrend: jest.fn(async () => {
      throw new Error('AWS_NOT_CONNECTED: no connection in this test');
    }),
    getCostTrendFetchedAt: jest.fn(async () => null),
  },
}));
jest.mock('../../services/onboardingEvents', () => ({ emitOnboardingEvent: jest.fn() }));

import bcrypt from 'bcrypt';
import { Client } from 'pg';
import authRoutes from '../auth.routes';
import organizationsRoutes from '../organizations.routes';
import doraMetricsRoutes from '../dora-metrics.routes';
import awsResourcesRoutes from '../awsResources.routes';
import aiInsightsRoutes from '../ai-insights.routes';
import { pool as appPool } from '../../config/database';
import { PLAN_ENTITLEMENTS } from '../../config/plan-entitlements';
import { authService } from '../../services/auth.service';
import { AWSResourcesController } from '../../controllers/awsResources.controller';
import { WeeklyAISummaryJob } from '../../jobs/weekly-ai-summary.job';
import { WeeklySummaryRepository } from '../../repositories/weekly-summary.repository';
import { RiskTrackingService } from '../../services/risk-tracking.service';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { AccountSecurityFindingsRepository } from '../../repositories/account-security-findings.repository';
import type { WeeklySummaryContent } from '../../services/weekly-summary-content';
import { RoleGateOrg, createRoleGateHarness } from './role-gate-harness';

// Forced plan lookup failures, as in plan-gates-pr1a.test.ts.
let failWhen: ((sql: string) => boolean) | null = null;
const clientQuery = Client.prototype.query;
Client.prototype.query = function (this: Client, ...args: unknown[]) {
  const first = args[0] as { text?: unknown } | string;
  const sql = typeof first === 'string' ? first : typeof first?.text === 'string' ? first.text : '';
  if (failWhen && typeof args[args.length - 1] !== 'function' && failWhen(sql)) {
    return Promise.reject(new Error('forced plan lookup failure'));
  }
  return (clientQuery as (...a: unknown[]) => unknown).apply(this, args);
} as unknown as typeof Client.prototype.query;

const PLAN_LOOKUP = 'SELECT subscription_tier, billing_lifecycle_state, grace_period_ends_at';
const PASSWORD = 'Followup-Test-Password-1';

const harness = createRoleGateHarness('plan-followup');
const { pool, sendAs } = harness;

type Tier = 'free' | 'starter' | 'pro' | 'enterprise';
const RANK: Record<Tier, number> = { free: 0, starter: 1, pro: 2, enterprise: 3 };

interface PlanState {
  tier: string;
  billing?: 'healthy' | 'grace_period' | 'restricted';
  graceEndsInMs?: number;
  /** What the plan gates enforce: free while restricted or lapsed; an unrecognised tier passes through. */
  effective: string;
}

const STATES: Record<string, PlanState> = {
  free: { tier: 'free', effective: 'free' },
  starter: { tier: 'starter', effective: 'starter' },
  pro: { tier: 'pro', effective: 'pro' },
  enterprise: { tier: 'enterprise', effective: 'enterprise' },
  'pro, restricted': { tier: 'pro', billing: 'restricted', effective: 'free' },
  'enterprise, restricted': { tier: 'enterprise', billing: 'restricted', effective: 'free' },
  'pro, grace period ended': { tier: 'pro', billing: 'grace_period', graceEndsInMs: -60_000, effective: 'free' },
  'enterprise, grace period running': { tier: 'enterprise', billing: 'grace_period', graceEndsInMs: 86_400_000, effective: 'enterprise' },
  'unrecognised tier': { tier: 'team', effective: 'team' },
};
const STATE_NAMES = Object.keys(STATES);
const RECOGNISED = STATE_NAMES.filter((name) => STATES[name].effective in RANK);
const atLeast = (state: PlanState, tier: Tier) => RANK[state.effective as Tier] >= RANK[tier];

let org: RoleGateOrg;
let serviceId: string;
let exportHandler: jest.SpyInstance;

async function setPlan(state: PlanState): Promise<void> {
  await pool.query(
    `UPDATE organizations
        SET subscription_tier = $1, billing_lifecycle_state = $2, grace_period_ends_at = $3
      WHERE id = $4`,
    [
      state.tier,
      state.billing ?? 'healthy',
      state.graceEndsInMs === undefined ? null : new Date(Date.now() + state.graceEndsInMs),
      org.orgId,
    ]
  );
}

async function insertDeployment(status: 'success' | 'failed', hoursAgo: number): Promise<void> {
  const at = new Date(Date.now() - hoursAgo * 3_600_000);
  await pool.query(
    `INSERT INTO deployments
       (service_id, environment, aws_region, status, cost_estimate, deployed_by, deployed_at, created_at, organization_id)
     VALUES ($1, 'production', 'us-east-1', $2, 0, 'github-actions', $3, $3, $4)`,
    [serviceId, status, at, org.orgId]
  );
}

beforeAll(async () => {
  org = await harness.buildOrg();
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, org.owner]);
  const service = await pool.query(
    `INSERT INTO services (name, template, owner, status, organization_id)
     VALUES ($1, 'api', 'owner@example.com', 'active', $2) RETURNING id`,
    [`plan-followup-svc-${Date.now()}`, org.orgId]
  );
  serviceId = service.rows[0].id;
  // 3 succeeded + 1 failed in the last 7 days: frequency 0.43 per day, change failure rate 25%.
  await insertDeployment('success', 2);
  await insertDeployment('success', 30);
  await insertDeployment('success', 50);
  await insertDeployment('failed', 70);
  await harness.listen((app) => {
    app.use('/api/auth', authRoutes);
    app.use('/api/organizations', organizationsRoutes);
    app.use('/api/metrics/dora', doraMetricsRoutes);
    app.use('/api/aws-resources', awsResourcesRoutes);
    app.use('/api/ai-insights', aiInsightsRoutes);
  });
});

beforeEach(() => {
  failWhen = null;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(RiskTrackingService.prototype, 'getCurrentRiskScore').mockResolvedValue({
    score: 82,
    isPreliminary: false,
    complianceIssueCounts: { critical: 0, high: 1, medium: 0, low: 0 },
  } as never);
  jest.spyOn(AccountSecurityFindingsRepository.prototype, 'getActive').mockResolvedValue([] as never);
  jest.spyOn(CostRecommendationsRepository.prototype, 'getStats').mockResolvedValue({
    active_recommendations: 2,
    total_potential_savings: 120,
  } as never);
  jest.spyOn(CostRecommendationsRepository.prototype, 'getActiveSavingsBreakdown').mockResolvedValue({
    active: 2, estimatedMonthlySavings: 120, estimatedFindings: 2, ceilingByResourceType: {}, unestimatedFindings: 0,
  });
  jest.spyOn(WeeklySummaryRepository.prototype, 'getAwsConnection').mockResolvedValue('connected');
  jest.spyOn(WeeklySummaryRepository.prototype, 'getUserInfo').mockResolvedValue({
    userId: org.owner,
    email: org.emails.owner,
    fullName: 'Owner Person',
  });
  exportHandler = jest
    .spyOn(AWSResourcesController.prototype, 'exportResources')
    .mockImplementation(async (_req: any, res: any) => {
      res.status(200).json({ success: true, exported: true });
    });
});

afterEach(() => {
  failWhen = null;
  jest.restoreAllMocks();
});

afterAll(async () => {
  failWhen = null;
  await harness.close(async (orgIds, userIds) => {
    await pool.query('DELETE FROM sessions WHERE user_id = ANY($1)', [userIds]);
    await pool.query('DELETE FROM deployments WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM services WHERE organization_id = ANY($1)', [orgIds]);
  });
  Client.prototype.query = clientQuery;
});

// ─── A1: effectiveTier ───────────────────────────────────────────────────────

describe('A1: effectiveTier on the organization responses the UI loads', () => {
  it.each(STATE_NAMES)('%s: GET /api/auth/me reports the enforced tier and keeps the stored one', async (name) => {
    const state = STATES[name];
    await setPlan(state);
    const res = await sendAs(org.orgId, org.owner, 'GET', '/auth/me');
    expect(res.status).toBe(200);
    const orgs = (await res.json()).data.organizations;
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({ id: org.orgId, subscriptionTier: state.tier, effectiveTier: state.effective });
  });

  it.each(STATE_NAMES)('%s: GET /api/organizations reports the enforced tier and keeps the stored one', async (name) => {
    const state = STATES[name];
    await setPlan(state);
    const res = await sendAs(org.orgId, org.owner, 'GET', '/organizations');
    expect(res.status).toBe(200);
    const orgs = (await res.json()).data;
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({ id: org.orgId, subscriptionTier: state.tier, effectiveTier: state.effective });
  });

  it.each(STATE_NAMES)('%s: login reports the enforced tier and keeps the stored one', async (name) => {
    const state = STATES[name];
    await setPlan(state);
    const login = await authService.login(org.emails.owner, PASSWORD);
    expect(login.organization).toMatchObject({ id: org.orgId, subscriptionTier: state.tier, effectiveTier: state.effective });
  });

  it.each(RECOGNISED)('%s: effectiveTier is what the plan gate decides (GET /api/metrics/dora, Pro)', async (name) => {
    const state = STATES[name];
    await setPlan(state);
    const me = await (await sendAs(org.orgId, org.owner, 'GET', '/auth/me')).json();
    const reported = me.data.organizations[0].effectiveTier as Tier;
    const res = await sendAs(org.orgId, org.owner, 'GET', '/metrics/dora');
    expect(res.status).toBe(RANK[reported] >= RANK.pro ? 200 : 402);
    if (res.status === 402) expect((await res.json()).details.currentTier).toBe(reported);
  });

  it('the stored tier is never rewritten by reading it', async () => {
    await setPlan(STATES['enterprise, restricted']);
    await sendAs(org.orgId, org.owner, 'GET', '/auth/me');
    await sendAs(org.orgId, org.owner, 'GET', '/organizations');
    const { rows } = await pool.query('SELECT subscription_tier FROM organizations WHERE id = $1', [org.orgId]);
    expect(rows[0].subscription_tier).toBe('enterprise');
  });
});

// ─── A2: weekly summary ──────────────────────────────────────────────────────

/** DORA figures -- not the plan line that names the metrics (WE-1). */
const DORA_TEXT = /Deployment frequency \(successful|Change failure rate:|lead time/i;
const DORA_KEYS = /deploymentFrequency|changeFailureRate/;
const COUNTS = { deploymentCount: 4, successfulDeployments: 3, failedDeployments: 1 };
const COUNTS_LINE = '4 deployments recorded in DevControl in the 7 days before this summary: 3 succeeded, 1 failed.';
const DORA_PLAN_LINE = 'Deployment frequency and change failure rate are DORA metrics, included in Optimization Engine.';
/** The delivery section's words (links left out). */
const deliveryOf = (content: any): string[] =>
  content.sections.find((s: any) => s.id === 'delivery').lines.map((l: any) => l.text).filter((t: string) => t !== '');
/** The posture score is plan-gated too (riskScore, Optimization Engine): on the plan its line, below it the line naming the plan. */
const SCORE_LINE = 'Security posture score: 82/100.';
const SCORE_PLAN_LINE = 'Security posture score and its trend are included in Optimization Engine.';
const securityOf = (content: any): string[] =>
  content.sections.find((s: any) => s.id === 'security').lines.map((l: any) => l.text).filter((t: string) => t !== '');
/** Every section but delivery, with the posture score's line (or its plan line) left out of security. */
const withoutPlanGated = (content: any) => ({
  ...content,
  sections: content.sections
    .filter((s: any) => s.id !== 'delivery')
    .map((s: any) => (s.id === 'security'
      ? { ...s, lines: s.lines.filter((l: any) => l.text !== SCORE_LINE && l.text !== SCORE_PLAN_LINE) }
      : s)),
});

/** The weekly email for the org, through the job's own send path, with the content it was built from. */
async function sendWeeklyEmail(): Promise<{ content: WeeklySummaryContent; html: string; text: string }> {
  const job = new WeeklyAISummaryJob(appPool);
  const send = jest.fn(async (_message: { html: string; text: string }) => ({ data: { id: 'email-id' }, error: null }));
  (job as any).resend = { emails: { send } };
  const buildTemplateData = jest.spyOn(job, 'buildTemplateData');
  const outcome = await job.triggerManual(org.orgId);
  expect(outcome).toEqual({ sent: 1, skipped: 0, errors: 0 });
  expect(send).toHaveBeenCalledTimes(1);
  const message = send.mock.calls[0][0];
  return { content: buildTemplateData.mock.calls[0][0].content, html: message.html, text: message.text };
}

async function preview(): Promise<any> {
  const res = await sendAs(org.orgId, org.owner, 'GET', '/ai-insights/preview-weekly-summary');
  expect(res.status).toBe(200);
  return res.json();
}

describe('A2: the weekly email leaves the DORA metrics out below Pro', () => {
  it.each(RECOGNISED)('%s', async (name) => {
    const state = STATES[name];
    await setPlan(state);
    const { content, html, text } = await sendWeeklyEmail();
    if (atLeast(state, 'pro')) {
      expect(deliveryOf(content)).toContain('Deployment frequency (successful deployments): 0.43 per day.');
      expect(deliveryOf(content)).toContain('Change failure rate: 25% (1 of 4 finished deployments failed).');
      expect(deliveryOf(content)).not.toContain(DORA_PLAN_LINE);
      expect(text).toMatch(/Change failure rate: 25%/);
      expect(html).toMatch(/Change failure rate: 25%/);
    } else {
      // Below the plan the figures are replaced by the line naming the plan -- never silently dropped.
      expect(deliveryOf(content)).toEqual([COUNTS_LINE, DORA_PLAN_LINE]);
      expect(text).not.toMatch(DORA_TEXT);
      expect(html).not.toMatch(DORA_TEXT);
      expect(text).toContain(COUNTS_LINE);
      expect(text).toContain(DORA_PLAN_LINE);
    }
  });

  it('every other section is the same below Pro as on Pro, and the counts line is Pro\'s first line', async () => {
    await setPlan(STATES.pro);
    const proContent = (await sendWeeklyEmail()).content;
    await setPlan(STATES.free);
    const freeContent = (await sendWeeklyEmail()).content;
    expect(withoutPlanGated(freeContent)).toEqual(withoutPlanGated(proContent));
    expect(deliveryOf(proContent)[0]).toBe(deliveryOf(freeContent)[0]);
    // The security section differs only by the posture score's plan gate.
    expect(securityOf(proContent)).toContain(SCORE_LINE);
    expect(securityOf(proContent)).not.toContain(SCORE_PLAN_LINE);
    expect(securityOf(freeContent)).toContain(SCORE_PLAN_LINE);
    expect(securityOf(freeContent)).not.toContain(SCORE_LINE);
  });

  it('the plan cannot be read: the DORA metrics are left out, the plan line is shown, and the email is still sent', async () => {
    await setPlan(STATES.enterprise);
    failWhen = (sql) => sql.includes(PLAN_LOOKUP);
    const { content, text } = await sendWeeklyEmail();
    expect(deliveryOf(content)).toEqual([COUNTS_LINE, DORA_PLAN_LINE]);
    expect(text).not.toMatch(DORA_TEXT);
  });
});

describe('A2: the weekly summary preview applies the same rule', () => {
  it.each(RECOGNISED)('%s', async (name) => {
    const state = STATES[name];
    await setPlan(state);
    const body = await preview();
    const delivery = body.evidence.delivery;
    expect(delivery.state).toBe('available');
    if (atLeast(state, 'pro')) {
      expect(delivery.data).toEqual({ ...COUNTS, deploymentFrequency: '0.43 per day', changeFailureRate: 25 });
      expect(deliveryOf(body.content)).toContain('Change failure rate: 25% (1 of 4 finished deployments failed).');
    } else {
      expect(delivery.data).toEqual(COUNTS);
      expect(deliveryOf(body.content)).toEqual([COUNTS_LINE, DORA_PLAN_LINE]);
      expect(JSON.stringify(body)).not.toMatch(DORA_KEYS);
      expect(JSON.stringify(body)).not.toMatch(DORA_TEXT);
    }
  });

  it('non-DORA evidence and content are the same below Pro as on Pro', async () => {
    await setPlan(STATES.pro);
    const pro = await preview();
    await setPlan(STATES['pro, restricted']);
    const restricted = await preview();
    // Everything but the delivery section and the posture score (and the
    // generation time, and each section's per-call retrievedAt).
    const strip = (b: any) => {
      const evidence = JSON.parse(JSON.stringify(b.evidence, (key, value) => (key === 'retrievedAt' ? undefined : value)));
      const content = withoutPlanGated(b.content);
      delete evidence.delivery;
      delete evidence.period;
      delete evidence.security.data.score;
      return { evidence, content };
    };
    expect(strip(restricted)).toEqual(strip(pro));
  });

  // WE-1 review L-3: the score is left out of the preview JSON below the plan, even with a completed scan.
  it.each(RECOGNISED)('posture score from a completed scan, %s: in the preview only on Optimization Engine', async (name) => {
    const state = STATES[name];
    await setPlan(state);
    const body = await preview();
    const security = body.evidence.security;
    expect(security.state).toBe('available'); // not preliminary: the scan completed
    if (atLeast(state, 'pro')) {
      expect(security.data).toEqual({ score: 82, accountLevelFindings: 0, resourceComplianceIssues: 1 });
      expect(securityOf(body.content)).toContain(SCORE_LINE);
      expect(securityOf(body.content)).not.toContain(SCORE_PLAN_LINE);
    } else {
      expect(security.data).toEqual({ accountLevelFindings: 0, resourceComplianceIssues: 1 });
      expect(securityOf(body.content)).toContain(SCORE_PLAN_LINE);
      expect(JSON.stringify(body)).not.toMatch(/"score"|82\/100/);
    }
  });

  it('the plan cannot be read: the DORA metrics are left out', async () => {
    await setPlan(STATES.enterprise);
    failWhen = (sql) => sql.includes(PLAN_LOOKUP);
    const body = await preview();
    expect(body.evidence.delivery.data).toEqual(COUNTS);
    expect(JSON.stringify(body)).not.toMatch(DORA_KEYS);
  });
});

// ─── A4: inventory export ────────────────────────────────────────────────────

describe('A4: resource inventory export is in the central table, Starter and above', () => {
  it('the table entry is Starter', () => {
    expect(PLAN_ENTITLEMENTS.resourceInventoryExport).toBe('starter');
  });

  it.each(RECOGNISED)('%s', async (name) => {
    const state = STATES[name];
    await setPlan(state);
    const res = await sendAs(org.orgId, org.owner, 'POST', '/aws-resources/export', { format: 'csv' });
    if (atLeast(state, 'starter')) {
      expect(res.status).toBe(200);
      expect(exportHandler).toHaveBeenCalledTimes(1);
    } else {
      expect(res.status).toBe(402);
      const body = await res.json();
      expect(body.code).toBe('TIER_REQUIRED');
      expect(body.details).toMatchObject({ currentTier: 'free', requiredTier: 'starter' });
      expect(exportHandler).not.toHaveBeenCalled();
    }
  });

  it('unrecognised tier: fails closed (500), handler not run', async () => {
    await setPlan(STATES['unrecognised tier']);
    const res = await sendAs(org.orgId, org.owner, 'POST', '/aws-resources/export', { format: 'csv' });
    expect(res.status).toBe(500);
    expect(exportHandler).not.toHaveBeenCalled();
  });
});
