/**
 * GET /api/metrics/dora's D4 figures, from the real service and repository
 * against live Postgres, with the clock frozen:
 *
 *   - one captured `now`; current [now − N×24h, now), previous
 *     [now − 2N×24h, now − N×24h); nothing in both, `now` itself excluded
 *   - daily: every UTC day the window touches, zero-filled, partial first /
 *     last, UTC midnights honoured even when the database session's TimeZone
 *     is America/New_York (across the 2026-03-08 US DST change)
 *   - busiest day (ties → most recent, tiedDays)
 *   - deploymentFrequency.value null (not 0) when nothing finished
 *   - change % null rules and the previous period's raw values
 *   - one filter set for current, previous, daily and busiest day
 *   - the standard bands graded from config/dora-bands.ts, and the grade
 *     changes D4 makes
 *   - invariants: Σ daily = finished, busiest = max daily, change null rules
 */
import { Pool } from 'pg';
import { pool as appPool } from '../../config/database';
import { DORA_BANDS, gradeAgainstBands } from '../../config/dora-bands';
import { DORAMetricsRepository } from '../../repositories/dora-metrics.repository';
import { DORAMetricsService, type ComprehensiveDORAMetrics } from '../dora-metrics.service';
import { DAY_MS } from '../dora-periods';

// 2026-03-10 15:30 UTC: the 7-day window spans the US DST start (2026-03-08).
const NOW = new Date('2026-03-10T15:30:00.000Z');
const ms = (iso: string) => new Date(iso);
const before = (offsetMs: number) => new Date(NOW.getTime() - offsetMs);

// A pool whose sessions run in a non-UTC zone: the SQL must still bucket by UTC date.
const nyPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  options: '-c TimeZone=America/New_York',
  max: 4,
});

const clock = jest.fn(() => new Date(NOW.getTime()));
const service = new DORAMetricsService(new DORAMetricsRepository(nyPool), undefined, clock);
const utcService = new DORAMetricsService(new DORAMetricsRepository(appPool as unknown as Pool), undefined, () => new Date(NOW.getTime()));

const createdOrgIds: string[] = [];
const createdTeamIds: string[] = [];
const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface Org { orgId: string; serviceId: string }

async function buildOrg(): Promise<Org> {
  const s = suffix();
  const org = await appPool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`DORA D4 ${s}`, `dora-d4-${s}`]
  );
  const orgId = org.rows[0].id as string;
  createdOrgIds.push(orgId);
  return { orgId, serviceId: await addService(orgId) };
}

async function addService(orgId: string, teamId: string | null = null): Promise<string> {
  const svc = await appPool.query(
    `INSERT INTO services (name, template, owner, status, organization_id, team_id)
     VALUES ($1, 'api', 'github-actions@webhook', 'active', $2, $3) RETURNING id`,
    [`dora-d4-svc-${suffix()}`, orgId, teamId]
  );
  return svc.rows[0].id as string;
}

async function addTeam(orgId: string): Promise<string> {
  const team = await appPool.query(
    `INSERT INTO teams (name, owner, organization_id) VALUES ($1, 'owner@example.com', $2) RETURNING id`,
    [`dora-d4-team-${suffix()}`, orgId]
  );
  createdTeamIds.push(team.rows[0].id);
  return team.rows[0].id as string;
}

async function insert(
  org: { orgId: string; serviceId: string },
  status: string,
  deployedAt: Date,
  count = 1,
  environment = 'production'
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await appPool.query(
      `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, deployed_at, organization_id)
       VALUES ($1, $2, 'us-east-1', $3, 'github-actions', $4, $5)`,
      [org.serviceId, environment, status, deployedAt, org.orgId]
    );
  }
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await appPool.query('DELETE FROM deployments WHERE organization_id = ANY($1::uuid[])', [createdOrgIds]);
    await appPool.query('DELETE FROM services WHERE organization_id = ANY($1::uuid[])', [createdOrgIds]);
    await appPool.query('DELETE FROM teams WHERE id = ANY($1::uuid[])', [createdTeamIds]);
    await appPool.query('DELETE FROM analytics_events WHERE organization_id = ANY($1::uuid[])', [createdOrgIds]);
    await appPool.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [createdOrgIds]);
  }
  await nyPool.end();
  await appPool.end();
});

/** Invariants every response must hold, whatever the data. */
function expectInvariants(m: ComprehensiveDORAMetrics): void {
  const sum = (key: 'succeeded' | 'failed' | 'total') => m.daily.reduce((n, d) => n + d[key], 0);
  expect(sum('succeeded')).toBe(m.deployments.successful);
  expect(sum('failed')).toBe(m.deployments.failed);
  expect(sum('total')).toBe(m.deployments.finished);
  expect(m.daily[0].date).toBe(m.period.start);
  expect(m.daily[m.daily.length - 1].date).toBe(m.period.end);
  const dates = m.daily.map((d) => d.date);
  expect([...dates].sort()).toEqual(dates);
  expect(new Set(dates).size).toBe(dates.length);
  for (let i = 1; i < dates.length; i++) {
    expect(Date.parse(`${dates[i]}T00:00:00Z`) - Date.parse(`${dates[i - 1]}T00:00:00Z`)).toBe(DAY_MS);
  }
  const max = Math.max(0, ...m.daily.map((d) => d.total));
  if (m.deployments.finished === 0) {
    expect(m.busiestDay).toBeNull();
    expect(m.deploymentFrequency.value).toBeNull();
    expect(m.changeFailureRate.value).toBeNull();
    expect(m.deploymentFrequency.tracked && m.deploymentFrequency.benchmark).toBeNull();
    expect(m.changeFailureRate.tracked && m.changeFailureRate.benchmark).toBeNull();
  } else {
    expect(m.busiestDay?.total).toBe(max);
    expect(m.busiestDay?.tiedDays).toBe(m.daily.filter((d) => d.total === max).length);
  }
  if (m.deployments.finished === 0 || m.previousPeriod.deployments.finished === 0) {
    expect(m.change).toEqual({ finishedPercent: null, deploymentsPerDayPercent: null, changeFailureRatePercent: null });
  }
  if (m.previousPeriod.deployments.successful === 0) expect(m.change.deploymentsPerDayPercent).toBeNull();
  if (m.previousPeriod.deployments.failed === 0) expect(m.change.changeFailureRatePercent).toBeNull();
  expect(m.previousPeriod.endAt).toBe(m.period.startAt);
  expect(m.bands).toEqual(DORA_BANDS);
  // The industry grade is exactly the reported value read against the served bands.
  if (m.deploymentFrequency.value !== null && !m.deploymentFrequency.isCustomBenchmark) {
    expect(m.deploymentFrequency.benchmark).toBe(gradeAgainstBands(m.bands.deploymentFrequency, m.deploymentFrequency.value));
  }
  if (m.changeFailureRate.value !== null && !m.changeFailureRate.isCustomBenchmark) {
    expect(m.changeFailureRate.benchmark).toBe(gradeAgainstBands(m.bands.changeFailureRate, m.changeFailureRate.value));
  }
}

describe('periods: one captured now, half-open, never double-counted', () => {
  it('rows at each bound land on exactly one side (7d)', async () => {
    const org = await buildOrg();
    const currentStart = before(7 * DAY_MS);
    const previousStart = before(14 * DAY_MS);
    await insert(org, 'success', currentStart);                         // current (inclusive lower bound)
    await insert(org, 'failed', new Date(currentStart.getTime() - 1));  // previous (just before the boundary)
    await insert(org, 'success', new Date(NOW.getTime() - 1));          // current (last ms)
    await insert(org, 'success', NOW);                                  // excluded: now is the exclusive end
    await insert(org, 'failed', new Date(NOW.getTime() + 60_000));      // excluded: after now
    await insert(org, 'success', previousStart);                        // previous (inclusive lower bound)
    await insert(org, 'failed', new Date(previousStart.getTime() - 1)); // excluded: before the previous window

    clock.mockClear();
    const m = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '7d' });

    expect(clock).toHaveBeenCalledTimes(1);
    expect(m.period).toEqual({
      start: '2026-03-03', end: '2026-03-10', days: 7,
      startAt: '2026-03-03T15:30:00.000Z', endAt: '2026-03-10T15:30:00.000Z',
    });
    expect(m.previousPeriod).toMatchObject({
      start: '2026-02-24', end: '2026-03-03', days: 7,
      startAt: '2026-02-24T15:30:00.000Z', endAt: '2026-03-03T15:30:00.000Z',
    });
    expect(m.deployments).toEqual({ successful: 2, failed: 0, finished: 2 });
    expect(m.previousPeriod.deployments).toEqual({ successful: 1, failed: 1, finished: 2 });
    expectInvariants(m);
  });

  it.each(['7d', '30d', '90d'] as const)('%s: endAt is the frozen now and both windows are N × 24 h', async (range) => {
    const org = await buildOrg();
    const m = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: range });
    const n = { '7d': 7, '30d': 30, '90d': 90 }[range];
    expect(m.period.endAt).toBe(NOW.toISOString());
    expect(Date.parse(m.period.endAt) - Date.parse(m.period.startAt)).toBe(n * DAY_MS);
    expect(Date.parse(m.previousPeriod.endAt) - Date.parse(m.previousPeriod.startAt)).toBe(n * DAY_MS);
    expect(m.daily).toHaveLength(n + 1);
    expect(m.daily.filter((d) => d.partial).map((d) => d.date)).toEqual([m.period.start, m.period.end]);
    expectInvariants(m);
  });

  it('defaults to 30 days, as before', async () => {
    const org = await buildOrg();
    const m = await service.getComprehensiveMetrics({ organizationId: org.orgId });
    expect(m.period.days).toBe(30);
    expect(m.previousPeriod.days).toBe(30);
  });
});

describe('daily series: UTC days', () => {
  it('splits success / failed per UTC day, zero-fills, and keeps UTC midnight under a New York session across DST', async () => {
    const tz = await nyPool.query('SHOW TimeZone');
    expect(tz.rows[0].TimeZone).toBe('America/New_York');
    const org = await buildOrg();
    await insert(org, 'success', ms('2026-03-03T16:00:00.000Z'));      // first, partial day
    await insert(org, 'success', ms('2026-03-07T23:59:59.999Z'));      // 18:59 in New York on the 7th
    await insert(org, 'failed', ms('2026-03-08T00:00:00.000Z'));       // still the 7th in New York
    await insert(org, 'success', ms('2026-03-08T06:30:00.000Z'), 2);   // DST starts at 07:00Z
    await insert(org, 'failed', ms('2026-03-08T07:30:00.000Z'));
    await insert(org, 'success', ms('2026-03-09T03:59:59.000Z'));      // 23:59 on the 8th in New York
    await insert(org, 'failed', ms('2026-03-10T15:29:59.999Z'));       // last ms of the window
    await insert(org, 'deploying', ms('2026-03-05T12:00:00.000Z'), 3); // never counted
    await insert(org, 'running', ms('2026-03-05T12:00:00.000Z'), 2);   // unknown, never counted

    const m = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '7d' });

    expect(m.daily).toEqual([
      { date: '2026-03-03', succeeded: 1, failed: 0, total: 1, partial: true },
      { date: '2026-03-04', succeeded: 0, failed: 0, total: 0, partial: false },
      { date: '2026-03-05', succeeded: 0, failed: 0, total: 0, partial: false },
      { date: '2026-03-06', succeeded: 0, failed: 0, total: 0, partial: false },
      { date: '2026-03-07', succeeded: 1, failed: 0, total: 1, partial: false },
      { date: '2026-03-08', succeeded: 2, failed: 2, total: 4, partial: false },
      { date: '2026-03-09', succeeded: 1, failed: 0, total: 1, partial: false },
      { date: '2026-03-10', succeeded: 0, failed: 1, total: 1, partial: true },
    ]);
    expect(m.busiestDay).toEqual({ date: '2026-03-08', total: 4, succeeded: 2, failed: 2, partial: false, tiedDays: 1 });
    expect(m.deployments).toEqual({ successful: 5, failed: 3, finished: 8 });
    expectInvariants(m);

    // The same rows through the application pool (session in UTC) give the same answer.
    const viaUtc = await utcService.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '7d' });
    expect(viaUtc.daily).toEqual(m.daily);
  });

  it('a UTC day cut by the period boundary counts its earlier part in the previous period only', async () => {
    const org = await buildOrg();
    await insert(org, 'success', ms('2026-03-03T10:00:00.000Z')); // before 15:30: previous
    await insert(org, 'failed', ms('2026-03-03T20:00:00.000Z'));  // after 15:30: current
    const m = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '7d' });
    expect(m.daily[0]).toEqual({ date: '2026-03-03', succeeded: 0, failed: 1, total: 1, partial: true });
    expect(m.previousPeriod.deployments).toEqual({ successful: 1, failed: 0, finished: 1 });
    expectInvariants(m);
  });

  it('busiest-day ties go to the most recent tied day, with tiedDays', async () => {
    const org = await buildOrg();
    // Inserted newest first, so row order cannot be what picks the day.
    await insert(org, 'success', ms('2026-03-09T12:00:00.000Z'), 2);
    await insert(org, 'failed', ms('2026-03-06T12:00:00.000Z'));
    await insert(org, 'success', ms('2026-03-06T13:00:00.000Z'));
    await insert(org, 'success', ms('2026-03-04T12:00:00.000Z'), 2);
    await insert(org, 'success', ms('2026-03-05T12:00:00.000Z'));
    const m = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '7d' });
    expect(m.busiestDay).toEqual({ date: '2026-03-09', total: 2, succeeded: 2, failed: 0, partial: false, tiedDays: 3 });
    expectInvariants(m);
  });
});

describe('nothing finished (D4-D7)', () => {
  it('deploymentFrequency.value is null, not 0; no grade, no busiest day, no change; daily still zero-filled', async () => {
    const org = await buildOrg();
    await insert(org, 'deploying', before(DAY_MS), 3);
    await insert(org, 'running', before(DAY_MS), 2);
    await insert(org, 'success', before(10 * DAY_MS), 4); // previous period only
    const m = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '7d' });

    expect(m.deployments).toEqual({ successful: 0, failed: 0, finished: 0 });
    expect(m.deploymentFrequency).toMatchObject({ tracked: true, value: null, benchmark: null, isCustomBenchmark: false });
    expect(m.changeFailureRate).toMatchObject({ tracked: true, value: null, benchmark: null });
    expect(m.busiestDay).toBeNull();
    expect(m.change).toEqual({ finishedPercent: null, deploymentsPerDayPercent: null, changeFailureRatePercent: null });
    expect(m.daily).toHaveLength(8);
    expect(m.daily.every((d) => d.total === 0)).toBe(true);
    expect(m.previousPeriod).toMatchObject({
      deployments: { successful: 4, failed: 0, finished: 4 }, deploymentsPerDay: 0.57, changeFailureRate: 0,
    });
    expectInvariants(m);
  });

  it('finished but none succeeded is a measured 0/day, graded low', async () => {
    const org = await buildOrg();
    await insert(org, 'failed', before(DAY_MS), 2);
    const m = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '7d' });
    expect(m.deploymentFrequency).toMatchObject({ value: 0, benchmark: 'low' });
    expect(m.changeFailureRate).toMatchObject({ value: 100, benchmark: 'low' });
    expectInvariants(m);
  });
});

describe('change % (D4-D8)', () => {
  it('relative change from each metric\'s own values, plus the previous raw figures', async () => {
    const org = await buildOrg();
    // Previous: 8 success + 2 failed (20%). Current: 12 success + 3 failed (20%) -> rate unchanged.
    await insert(org, 'success', before(10 * DAY_MS), 8);
    await insert(org, 'failed', before(10 * DAY_MS), 2);
    await insert(org, 'success', before(2 * DAY_MS), 12);
    await insert(org, 'failed', before(2 * DAY_MS), 3);
    const m = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '7d' });
    expect(m.previousPeriod).toMatchObject({
      deployments: { successful: 8, failed: 2, finished: 10 },
      deploymentsPerDay: 1.14,
      changeFailureRate: 20,
    });
    expect(m.change).toEqual({ finishedPercent: 50, deploymentsPerDayPercent: 50, changeFailureRatePercent: 0 });
    expectInvariants(m);
  });

  it('failure-rate change is not the frequency change', async () => {
    const org = await buildOrg();
    // Previous 9 + 1 (10%), current 9 + 3 (25%): frequency 0%, failure rate +150%.
    await insert(org, 'success', before(10 * DAY_MS), 9);
    await insert(org, 'failed', before(10 * DAY_MS), 1);
    await insert(org, 'success', before(DAY_MS), 9);
    await insert(org, 'failed', before(DAY_MS), 3);
    const m = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '7d' });
    expect(m.change).toEqual({ finishedPercent: 20, deploymentsPerDayPercent: 0, changeFailureRatePercent: 150 });
    expect(m.previousPeriod.changeFailureRate).toBe(10);
    expect(m.changeFailureRate.value).toBe(25);
  });

  it('previous period with nothing finished: every change null, previous rates null', async () => {
    const org = await buildOrg();
    await insert(org, 'success', before(DAY_MS), 3);
    await insert(org, 'deploying', before(10 * DAY_MS), 2);
    const m = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '7d' });
    expect(m.previousPeriod).toMatchObject({
      deployments: { successful: 0, failed: 0, finished: 0 }, deploymentsPerDay: null, changeFailureRate: null,
    });
    expect(m.change).toEqual({ finishedPercent: null, deploymentsPerDayPercent: null, changeFailureRatePercent: null });
    expectInvariants(m);
  });

  it('previous value 0 (no failures / no successes) makes only that change null', async () => {
    const org = await buildOrg();
    await insert(org, 'success', before(10 * DAY_MS), 4); // previous: 0% failure
    await insert(org, 'success', before(DAY_MS), 2);
    await insert(org, 'failed', before(DAY_MS), 2);
    let m = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '7d' });
    expect(m.change).toEqual({ finishedPercent: 0, deploymentsPerDayPercent: -50, changeFailureRatePercent: null });

    const org2 = await buildOrg();
    await insert(org2, 'failed', before(10 * DAY_MS), 2); // previous: 0 successes
    await insert(org2, 'success', before(DAY_MS), 3);
    m = await service.getComprehensiveMetrics({ organizationId: org2.orgId, dateRange: '7d' });
    expect(m.previousPeriod.deploymentsPerDay).toBe(0);
    expect(m.change).toEqual({ finishedPercent: 50, deploymentsPerDayPercent: null, changeFailureRatePercent: -100 });
    expectInvariants(m);
  });
});

describe('filters: one normalized set for every figure', () => {
  it('environment, service and team move current, previous, daily and busiest day together; filters are echoed', async () => {
    const org = await buildOrg();
    const teamId = await addTeam(org.orgId);
    const teamService = { orgId: org.orgId, serviceId: await addService(org.orgId, teamId) };
    const otherService = { orgId: org.orgId, serviceId: await addService(org.orgId) };

    // Matching rows (team service, production) in both periods.
    await insert(teamService, 'success', before(2 * DAY_MS), 2);
    await insert(teamService, 'failed', before(9 * DAY_MS), 1);
    // Non-matching: other environment, other service, in both periods.
    await insert(teamService, 'success', before(2 * DAY_MS), 5, 'staging');
    await insert(teamService, 'failed', before(9 * DAY_MS), 5, 'staging');
    await insert(otherService, 'failed', before(2 * DAY_MS), 7);
    await insert(otherService, 'success', before(9 * DAY_MS), 7);

    const all = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '7d' });
    expect(all.filters).toEqual({ environment: null, serviceId: null, teamId: null });
    expect(all.deployments.finished).toBe(14);
    expect(all.previousPeriod.deployments.finished).toBe(13);
    expectInvariants(all);

    const cases = [
      { filters: { environment: 'production', teamId }, echo: { environment: 'production', serviceId: null, teamId } },
      { filters: { environment: 'production', serviceId: teamService.serviceId }, echo: { environment: 'production', serviceId: teamService.serviceId, teamId: null } },
      { filters: { environment: 'production', serviceId: teamService.serviceId, teamId }, echo: { environment: 'production', serviceId: teamService.serviceId, teamId } },
    ];
    for (const { filters, echo } of cases) {
      const m = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '7d', ...filters });
      expect(m.filters).toEqual(echo);
      expect(m.deployments).toEqual({ successful: 2, failed: 0, finished: 2 });
      expect(m.previousPeriod.deployments).toEqual({ successful: 0, failed: 1, finished: 1 });
      expect(m.busiestDay).toMatchObject({ total: 2 });
      expect(Object.keys(m.deploymentFrequency.tracked ? m.deploymentFrequency.breakdown ?? {} : {})).toHaveLength(1);
      expectInvariants(m);
    }

    const staging = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '7d', environment: 'staging' });
    expect(staging.deployments).toEqual({ successful: 5, failed: 0, finished: 5 });
    expect(staging.previousPeriod.deployments).toEqual({ successful: 0, failed: 5, finished: 5 });

    const otherOnly = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '7d', serviceId: otherService.serviceId });
    expect(otherOnly.deployments).toEqual({ successful: 0, failed: 7, finished: 7 });
    expect(otherOnly.previousPeriod.deployments).toEqual({ successful: 7, failed: 0, finished: 7 });

    const allEnv = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '7d', environment: 'all' });
    expect(allEnv.filters.environment).toBeNull();
    expect(allEnv.deployments).toEqual(all.deployments);
  });

  it("never counts another organization's rows in either period, even with its service id as the filter", async () => {
    const orgA = await buildOrg();
    const orgB = await buildOrg();
    await insert(orgA, 'success', before(DAY_MS), 1);
    await insert(orgB, 'failed', before(DAY_MS), 9);
    await insert(orgB, 'failed', before(10 * DAY_MS), 9);
    const m = await service.getComprehensiveMetrics({ organizationId: orgA.orgId, dateRange: '7d' });
    expect(m.deployments).toEqual({ successful: 1, failed: 0, finished: 1 });
    expect(m.previousPeriod.deployments.finished).toBe(0);
    const crossed = await service.getComprehensiveMetrics({ organizationId: orgA.orgId, dateRange: '7d', serviceId: orgB.serviceId });
    expect(crossed.deployments.finished).toBe(0);
    expect(crossed.previousPeriod.deployments.finished).toBe(0);
  });
});

describe('standard bands: the grade changes D4 makes (change failure rate only)', () => {
  // [successes, failures, rate, grade before D4 (15/30/45), grade now]
  it.each<[number, number, number, string, string]>([
    [19, 1, 5, 'elite', 'elite'],
    [18, 2, 10, 'elite', 'high'],     // >5–10: Elite → High
    [17, 3, 15, 'elite', 'medium'],   // >10–15: Elite → Medium
    [4, 1, 20, 'high', 'low'],        // >15–30: High → Low
    [3, 2, 40, 'medium', 'low'],      // >30–45: Medium → Low
    [1, 1, 50, 'low', 'low'],
  ])('%i succeeded + %i failed = %i%%: was %s, now %s', async (successes, failures, rate, _was, now) => {
    const org = await buildOrg();
    await insert(org, 'success', before(DAY_MS), successes);
    await insert(org, 'failed', before(DAY_MS), failures);
    const m = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '30d' });
    expect(m.changeFailureRate).toMatchObject({ value: rate, benchmark: now, isCustomBenchmark: false });
    expectInvariants(m);
  });

  it.each<[number, '7d' | '30d' | '90d', number, string]>([
    [1, '7d', 0.14, 'high'],
    [8, '7d', 1.14, 'elite'],
    [7, '7d', 1, 'high'],
    [1, '30d', 0.03, 'medium'],
    [4, '30d', 0.13, 'medium'],
    [2, '90d', 0.02, 'low'],
  ])('frequency unchanged: %i successes in %s = %s/day → %s', async (successes, range, value, grade) => {
    const org = await buildOrg();
    await insert(org, 'success', before(DAY_MS), successes);
    const m = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: range });
    expect(m.deploymentFrequency).toMatchObject({ value, benchmark: grade });
  });
});
