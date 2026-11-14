/**
 * Demo workspace PR-1a, behaviour: every org-selecting job and platform
 * aggregate leaves the demo organization out and still includes a real one.
 *
 * Each case runs in ONE transaction on a connection of its own, rolled back
 * at the end: the demo and real organizations, and every row they own, never
 * become visible to another suite. Code that reads the module-level pool
 * (config/database) is pointed at that same connection for the duration of
 * the case. Placeholder values only.
 *
 * What this cannot show: that a job's run method calls its selection function
 * (static test job-demo-exclusion.static.test.ts and code review), or that a
 * job added later is covered (the static inventory fails on it).
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-jwt-secret-not-a-real-secret-32c';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'ci-test-encryption-key-32-chars.';

import { Client, Pool } from 'pg';
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

let mockCurrent: Client | null = null;
const mockViaCurrent = (...args: unknown[]) => {
  if (!mockCurrent) throw new Error('no test connection');
  return (mockCurrent.query as (...a: unknown[]) => unknown)(...args);
};
jest.mock('../config/database', () => {
  const actual = jest.requireActual('../config/database');
  return {
    ...actual,
    pool: {
      query: (...args: unknown[]) => mockViaCurrent(...args),
      connect: async () => ({ query: (...args: unknown[]) => mockViaCurrent(...args), release: () => undefined }),
    },
  };
});

import { DEMO_EXCLUSION_SQL, excludeDemoOrganizationSql, isDemoOrganization, DemoOrganizationLookupError } from '../demo/demo-workspace';
import { listRiskSnapshotOrganizations } from '../services/risk-tracking.service';
import { listAnomalyDetectionOrganizations } from '../jobs/anomaly-detection.job';
import { listScanRecoveryOrganizations } from '../services/custom-compliance.service';
import { listActivationFunnelOrganizations } from '../services/activationFunnel.service';
import { GracePeriodEnforcementJob } from '../jobs/grace-period-enforcement.job';
import { ScheduledReportsRepository } from '../repositories/scheduled-reports.repository';
import { WeeklySummaryRepository } from '../repositories/weekly-summary.repository';
import { onboardingService } from '../services/onboarding.service';
import { updateBusinessMetrics, servicesTotal, doraDeploymentFrequency, alertsActiveTotal } from '../metrics';
import organizationsRoutes from '../routes/organizations.routes';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

let seq = 0;
const unique = (label: string) => `demo-excl-${label}-${process.pid}-${Date.now()}-${seq++}`;

interface Orgs { client: Client; demo: string; real: string }

/** One transaction with a demo and a real organization; the module pool uses the same connection. */
async function withOrgs(fn: (orgs: Orgs) => Promise<void>): Promise<void> {
  const client = new Client(dbConfig());
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '60s'");
    const org = async (label: string, isDemo: boolean) => {
      const name = unique(label);
      const { rows } = await client.query(
        `INSERT INTO organizations (name, slug, display_name, is_demo) VALUES ($1, $1, $1, $2) RETURNING id`, [name, isDemo]);
      return rows[0].id as string;
    };
    const demo = await org('demo', true);
    const real = await org('real', false);
    mockCurrent = client;
    await fn({ client, demo, real });
  } finally {
    mockCurrent = null;
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

const asPool = (client: Client) => client as unknown as Pool;

describe('demo-workspace helper', () => {
  it('DEMO_EXCLUSION_SQL reads the database row of an organizations alias o', () => {
    expect(DEMO_EXCLUSION_SQL).toBe('o.is_demo = false');
  });

  it('excludeDemoOrganizationSql accepts only a literal column reference', () => {
    expect(excludeDemoOrganizationSql('services.organization_id')).toBe(
      'NOT EXISTS (SELECT 1 FROM organizations demo_org WHERE demo_org.id = services.organization_id AND demo_org.is_demo)');
    for (const bad of ['', 'x; DROP TABLE users', "organization_id OR 1=1", 'a.b.c', 'Org', '1col', 'a .b']) {
      expect(() => excludeDemoOrganizationSql(bad)).toThrow(/not a column reference/);
    }
  });

  it('isDemoOrganization answers from the row: true for the demo, false for a real organization', async () => {
    await withOrgs(async ({ client, demo, real }) => {
      await expect(isDemoOrganization(client as never, demo)).resolves.toBe(true);
      await expect(isDemoOrganization(client as never, real)).resolves.toBe(false);
    });
  });

  it('isDemoOrganization throws, never answering "not demo", when it cannot tell', async () => {
    await withOrgs(async ({ client }) => {
      await expect(isDemoOrganization(client as never, '00000000-0000-4000-8000-00000000000a')).rejects.toThrow(DemoOrganizationLookupError);
    });
    await expect(isDemoOrganization({ query: jest.fn() } as never, 'not-a-uuid')).rejects.toThrow(/not a UUID/);
    await expect(isDemoOrganization({ query: jest.fn().mockRejectedValue(new Error('db down')) } as never,
      '00000000-0000-4000-8000-00000000000a')).rejects.toThrow(/could not be read/);
    await expect(isDemoOrganization({ query: jest.fn().mockResolvedValue({ rows: [{ is_demo: 'false' }] }) } as never,
      '00000000-0000-4000-8000-00000000000a')).rejects.toThrow(/not a boolean/);
    await expect(isDemoOrganization({ query: jest.fn().mockResolvedValue({ rows: [{ is_demo: null }] }) } as never,
      '00000000-0000-4000-8000-00000000000a')).rejects.toThrow(/not a boolean/);
  });
});

describe('org-selecting jobs leave the demo out and keep the real organization', () => {
  it.each([
    ['RiskScoreSnapshotJob (listRiskSnapshotOrganizations)', (c: Client) => listRiskSnapshotOrganizations(c as never)],
    ['AnomalyDetectionJob (listAnomalyDetectionOrganizations)', (c: Client) => listAnomalyDetectionOrganizations(c as never)],
    ['startup scan recovery (listScanRecoveryOrganizations)', (c: Client) => listScanRecoveryOrganizations(c as never)],
  ])('%s', async (_label, select) => {
    await withOrgs(async ({ client, demo, real }) => {
      const ids = (await select(client)).map((r: { id: string }) => r.id);
      expect(ids).toContain(real);
      expect(ids).not.toContain(demo);
    });
  });

  it('ScheduledReportsJob (findDueReports): a due demo report is never picked, even with the DB refusal disabled', async () => {
    await withOrgs(async ({ client, demo, real }) => {
      // The migration refuses demo rows; disable that (in this transaction only) to test the job's own exclusion.
      await client.query('ALTER TABLE scheduled_reports DISABLE TRIGGER demo_workspace_refuse_row');
      const insert = `INSERT INTO scheduled_reports (organization_id, name, report_type, schedule_type, schedule_time, delivery_email, enabled, next_run_at)
                      VALUES ($1, $2, 'cost_summary', 'daily', '09:00', true, true, NOW() - interval '1 minute') RETURNING id`;
      const demoReport = (await client.query(insert, [demo, unique('demo-report')])).rows[0].id;
      const realReport = (await client.query(insert, [real, unique('real-report')])).rows[0].id;
      const due = (await new ScheduledReportsRepository(asPool(client)).findDueReports()).map((r) => r.id);
      expect(due).toContain(realReport);
      expect(due).not.toContain(demoReport);
    });
  });

  it('WeeklyAISummaryJob: a verified, opted-in demo owner is never a page entry or a recipient', async () => {
    await withOrgs(async ({ client, demo, real }) => {
      // users.email_weekly_summary exists in production only (legacy backend/migrations/010), so, as
      // weekly-summary-recipient.test.ts does, session TEMP tables shadow the three tables the queries read.
      await client.query(`
        CREATE TEMP TABLE organizations (id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT NOW(), deleted_at timestamptz,
          is_demo boolean NOT NULL DEFAULT false) ON COMMIT DROP;
        CREATE TEMP TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, full_name text,
          email_weekly_summary boolean, is_email_verified boolean, deleted_at timestamptz) ON COMMIT DROP;
        CREATE TEMP TABLE organization_memberships (organization_id uuid, user_id uuid, role text, created_at timestamptz DEFAULT NOW(),
          joined_at timestamptz, is_active boolean DEFAULT true, invitation_token text) ON COMMIT DROP;
      `);
      await client.query(`INSERT INTO organizations (id, is_demo) VALUES ($1, true), ($2, false)`, [demo, real]);
      for (const org of [demo, real]) {
        const { rows } = await client.query(
          `INSERT INTO users (email, full_name, is_email_verified, email_weekly_summary)
           VALUES ($1, 'weekly probe', true, true) RETURNING id`, [`${unique('owner')}@probe.invalid`]);
        await client.query(
          `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active) VALUES ($1, $2, 'owner', NOW(), true)`,
          [org, rows[0].id]);
      }
      const repository = new WeeklySummaryRepository(asPool(client));
      const pages: string[] = [];
      let after: string | null = null;
      for (;;) {
        const page = await repository.getActiveOrganizationsPage(after, 500);
        pages.push(...page);
        if (page.length < 500) break;
        after = page[page.length - 1];
      }
      expect(pages).toContain(real);
      expect(pages).not.toContain(demo);
      expect(await repository.getRecipients(demo, client as never)).toEqual([]);
      expect(await repository.getRecipients(real, client as never)).toHaveLength(1);
    });
  });

  it('GracePeriodEnforcementJob: a real organization past its grace is restricted; the demo cannot even enter grace', async () => {
    await withOrgs(async ({ client, demo, real }) => {
      await client.query(
        `UPDATE organizations SET billing_lifecycle_state = 'grace_period', payment_failed_at = NOW() - interval '8 days',
                                  grace_period_ends_at = NOW() - interval '1 day' WHERE id = $1`, [real]);
      await client.query('SAVEPOINT demo_grace');
      await expect(client.query(
        `UPDATE organizations SET billing_lifecycle_state = 'grace_period', grace_period_ends_at = NOW() - interval '1 day' WHERE id = $1`,
        [demo])).rejects.toThrow(/organizations_demo_holds_no_billing_or_credentials/);
      await client.query('ROLLBACK TO SAVEPOINT demo_grace');
      await new GracePeriodEnforcementJob(asPool(client)).enforceExpiredGracePeriods();
      const { rows } = await client.query(`SELECT id, billing_lifecycle_state FROM organizations WHERE id = ANY($1)`, [[demo, real]]);
      expect(Object.fromEntries(rows.map((r) => [r.id, r.billing_lifecycle_state]))).toEqual({ [demo]: 'healthy', [real]: 'restricted' });
    });
  });
});

describe('platform aggregates leave the demo out and count the real organization', () => {
  it('activation funnel organizations', async () => {
    await withOrgs(async ({ client, demo, real }) => {
      const ids = await listActivationFunnelOrganizations(client as never);
      expect(ids).toContain(real);
      expect(ids).not.toContain(demo);
    });
  });

  it('onboarding metrics and funnel', async () => {
    await withOrgs(async ({ client, demo, real }) => {
      // organizations' AFTER INSERT trigger already created both onboarding_progress rows.
      const complete = (org: string) => client.query(
        `UPDATE onboarding_progress SET current_stage = 'completed', completed_at = NOW(), welcome_completed_at = NOW() WHERE organization_id = $1`, [org]);
      const read = async () => ({
        metrics: Number((await onboardingService.getMetrics()).total_orgs),
        funnel: (await onboardingService.getFunnelMetrics()).total_started,
      });
      // getMetrics divides by its completed-row count (pre-existing): start from one completed real row.
      await complete(real);
      const base = await read();
      await complete(demo);
      expect(await read()).toEqual(base);
      const other = (await client.query(
        `INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, $1) RETURNING id`, [unique('real-2')])).rows[0].id;
      await complete(other);
      const after = await read();
      expect(after.metrics).toBe(base.metrics + 1);
      expect(after.funnel).toBe(base.funnel + 1);
      // The demo's own row is there and complete; only the predicate keeps it out.
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM onboarding_progress WHERE organization_id = $1 AND completed_at IS NOT NULL`, [demo]);
      expect(rows[0].n).toBe(1);
    });
  });

  it('business metrics (Prometheus gauges): demo services, deployments and alerts are not counted', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await withOrgs(async ({ client, demo, real }) => {
        const gauge = async (g: { get: () => Promise<{ values: Array<{ value: number; labels: Record<string, unknown> }> }> }, labels: Record<string, string> = {}) =>
          (await g.get()).values.find((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val))?.value ?? 0;
        const read = async () => {
          await updateBusinessMetrics(client);
          return {
            services: await gauge(servicesTotal),
            deployments: await gauge(doraDeploymentFrequency),
            critical: await gauge(alertsActiveTotal, { severity: 'critical' }),
          };
        };
        const seed = async (org: string) => {
          const { rows } = await client.query(
            `INSERT INTO services (name, template, owner, organization_id) VALUES ($1, 'api', '', $2) RETURNING id`, [unique('svc'), org]);
          for (let i = 0; i < 3; i++) {
            await client.query(
              `INSERT INTO deployments (service_id, environment, aws_region, deployed_by, organization_id, status, deployed_at)
               VALUES ($1, 'production', 'us-east-1', 'probe', $2, 'success', NOW() - interval '1 day')`, [rows[0].id, org]);
          }
          await client.query(
            `INSERT INTO alert_history (alert_name, severity, status, started_at, organization_id) VALUES ($1, 'critical', 'firing', NOW(), $2)`,
            [unique('alert'), org]);
        };
        const base = await read();
        await seed(demo);
        expect(await read()).toEqual(base);
        await seed(real);
        const after = await read();
        expect(after.services).toBe(base.services + 1);
        expect(after.deployments).toBeCloseTo(base.deployments + 3 / 30, 6);
        expect(after.critical).toBe(base.critical + 1);
      });
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it('GET /api/organizations/founding-count never counts the demo', async () => {
    const app = express();
    app.use('/api/organizations', organizationsRoutes);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/organizations/founding-count`;
    try {
      await withOrgs(async ({ client, real }) => {
        const count = async () => (await (await fetch(url)).json()).count as number;
        const base = await count();
        // The demo cannot be stored on a paid tier at all (its CHECK); a real paid organization counts.
        await client.query(`UPDATE organizations SET subscription_tier = 'pro' WHERE id = $1`, [real]);
        expect(await count()).toBe(base + 1);
        const { rows } = await client.query(
          `SELECT count(*)::int AS n FROM organizations o WHERE o.subscription_tier != 'free' AND NOT (${DEMO_EXCLUSION_SQL})`);
        expect(rows[0].n).toBe(0);
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
