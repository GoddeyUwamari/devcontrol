/**
 * Every user-authenticated API surface refuses a caller who is no longer a
 * member of their token's organization.
 *
 * Mounts the same routers server.ts mounts and calls one representative
 * route on each with a real, unexpired token whose membership has been
 * removed. Any router that answers with anything other than authenticate's
 * MEMBERSHIP_REVOKED -- data, a different error, a gate that ran first --
 * fails here, so a new or reordered router can't quietly skip the check.
 *
 * Not mounted: the anomaly router, which server.ts builds inline (it applies
 * authenticateToken to every route with router.use), and routers that are
 * not user-authenticated (Stripe and GitHub webhooks, metrics, newsletter).
 *
 * The routers are loaded in beforeAll, with any interval a service starts at
 * import time unref'd, so those background timers can't keep Jest alive.
 */
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { MEMBERSHIP_REVOKED_CODE } from '../auth.middleware';
import { authService } from '../../services/auth.service';
import { organizationService } from '../../services/organization.service';
import { pool as appPool } from '../../config/database';

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
const jwtSecret: string = (authService as any).jwtSecret;
let orgId: string;
let ownerId: string;
let removedId: string;
let token: string;

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const suffix = uniqueSuffix();
  const org = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, max_services, max_users)
     VALUES ($1, $2, $3, 'enterprise', 10, 20) RETURNING id`,
    [`Route Sweep ${suffix}`, `route-sweep-${suffix}`, `Route Sweep ${suffix}`]
  );
  orgId = org.rows[0].id;
  const owner = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Sweep Owner') RETURNING id`,
    [`route-sweep-owner-${suffix}@example.com`]
  );
  ownerId = owner.rows[0].id;
  const removed = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Sweep Removed') RETURNING id`,
    [`route-sweep-removed-${suffix}@example.com`]
  );
  removedId = removed.rows[0].id;
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, 'owner', NOW(), true), ($1, $3, 'owner', NOW(), true)`,
    [orgId, ownerId, removedId]
  );
  // Still an owner in the token's claim; no longer a member at all.
  await organizationService.removeUser(orgId, ownerId, removedId);
  token = jwt.sign(
    { userId: removedId, email: 'removed@example.com', organizationId: orgId, role: 'owner', type: 'access' },
    jwtSecret,
    { expiresIn: '1h', jwtid: randomUUID() }
  );

  const realSetInterval = global.setInterval;
  global.setInterval = ((...args: Parameters<typeof setInterval>) =>
    realSetInterval(...args).unref()) as unknown as typeof setInterval;
  let mods: any;
  try {
    mods = {
      routes: (await import('../../routes')).default,
      apiKeysRouter: (await import('../../routes/api-keys.routes')).default,
      webhooksRouter: (await import('../../routes/webhooks.routes')).default,
      observabilityRoutes: (await import('../../routes/observability.routes')).default,
      ...(await import('../../routes/custom-anomaly-rules.routes')),
      ...(await import('../../routes/slo.routes')),
      ...(await import('../../routes/forecast.routes')),
      ...(await import('../../routes/dora-benchmarks.routes')),
      ...(await import('../../routes/saml.routes')),
      ...(await import('../../routes/remediation.routes')),
      ...(await import('../../routes/compliance.routes')),
    };
  } finally {
    global.setInterval = realSetInterval;
  }
  const {
    routes,
    apiKeysRouter,
    webhooksRouter,
    observabilityRoutes,
    createCustomRulesRoutes,
    createSloRoutes,
    createForecastRoutes,
    createDoraBenchmarksRoutes,
    createSAMLRoutes,
    createRemediationRoutes,
    createComplianceRoutes,
  } = mods;

  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  app.use('/api/keys', apiKeysRouter);
  app.use('/api/anomaly-rules', createCustomRulesRoutes(appPool));
  app.use('/api/slos', createSloRoutes(appPool));
  app.use('/api/webhooks', webhooksRouter);
  app.use('/api/forecast', createForecastRoutes(appPool));
  app.use('/api/dora', createDoraBenchmarksRoutes(appPool));
  app.use('/api/auth/saml', createSAMLRoutes());
  app.use('/api/remediation', createRemediationRoutes(appPool));
  app.use('/api/compliance', createComplianceRoutes(appPool));
  app.use('/api/observability', observabilityRoutes);
  app.use('/api/system', observabilityRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM audit_logs WHERE organization_id = $1', [orgId]);
  await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [[ownerId, removedId]]);
  await pool.end();
  await appPool.end();
});

const SURFACES: Array<[string, string]> = [
  ['GET', '/api/auth/me'],
  ['POST', '/api/auth/change-password'],
  ['GET', '/api/organizations'],
  ['GET', '/api/organizations/:org/members'],
  ['POST', '/api/organizations/accept-invitation'],
  ['GET', '/api/services/stats'],
  ['GET', '/api/dependencies'],
  ['GET', '/api/deployments/stats'],
  ['GET', '/api/infrastructure'],
  ['GET', '/api/teams'],
  ['GET', '/api/platform/stats/dashboard'],
  ['GET', '/api/aws/accounts'],
  ['GET', '/api/aws-resources'],
  ['GET', '/api/cost-recommendations'],
  ['GET', '/api/metrics/dora'],
  ['GET', '/api/alerts/history'],
  ['GET', '/api/alert-config/config'],
  ['GET', '/api/audit-logs'],
  ['POST', '/api/stripe/create-checkout-session'],
  ['GET', '/api/payments/stats'],
  ['GET', '/api/refunds/stats'],
  ['GET', '/api/onboarding/status'],
  ['GET', '/api/prometheus/query'],
  ['GET', '/api/cloudwatch/status'],
  ['GET', '/api/risk-score/trend'],
  ['GET', '/api/security/account-findings'],
  ['GET', '/api/scheduled-reports'],
  ['GET', '/api/compliance-frameworks'],
  ['GET', '/api/security-hub/capability'],
  ['GET', '/api/soc2/readiness'],
  ['GET', '/api/soc2/customer-evidence'],
  ['POST', '/api/ai-insights/analyze-cost'],
  ['GET', '/api/ai-chat/context'],
  ['POST', '/api/nl-query/parse'],
  ['POST', '/api/ai-reports/generate'],
  ['GET', '/api/user/preferences/email'],
  ['GET', '/api/tenants'],
  ['GET', '/api/usage/api-requests'],
  ['GET', '/api/admin/activation-funnel'],
  ['GET', '/api/logs/streams/active'],
  ['GET', '/api/keys'],
  ['GET', '/api/anomaly-rules'],
  ['GET', '/api/slos'],
  ['GET', '/api/webhooks'],
  ['GET', '/api/forecast'],
  ['GET', '/api/dora/benchmarks'],
  ['GET', '/api/auth/saml/config'],
  ['GET', '/api/remediation'],
  ['GET', '/api/compliance/report/soc2'],
  ['GET', '/api/observability/readiness'],
  ['GET', '/api/system/readiness'],
];

it.each(SURFACES)('%s %s refuses a removed member', async (method, path) => {
  const res = await fetch(`${baseUrl}${path.replace(':org', orgId)}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify({}),
  });
  expect(res.status).toBe(401);
  expect(((await res.json()) as { code?: string }).code).toBe(MEMBERSHIP_REVOKED_CODE);
});
