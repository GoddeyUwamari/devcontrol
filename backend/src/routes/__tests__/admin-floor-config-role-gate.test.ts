/**
 * Organization-wide configuration and permanent deletes are open to owners
 * and admins only; one platform diagnostic is open to platform staff only;
 * and an alert acknowledgement is attributed to whoever actually made it.
 *
 * Owner/admin (viewer and member refused with 403, admin and owner answered
 * exactly as before):
 *   - PUT, DELETE /api/cost-recommendations/optimization-rules/configuration/:ruleId/:parameterId
 *   - DELETE /api/cost-recommendations/:id
 *   - POST   /api/security/account-findings/:id/accept-risk
 *   - POST, PATCH, DELETE /api/tenants
 *   - POST, PATCH, PATCH /:id/toggle, DELETE /api/anomaly-rules
 *   - DELETE /api/alerts/:id
 *   - POST   /api/prometheus/snapshot   (writes only the caller's organization's rows)
 *
 * Platform staff, whatever their organization role:
 *   - POST   /api/prometheus/diagnose   (probes the one Prometheus all organizations share)
 *
 * Real routes and real authentication (see role-gate-harness.ts). The data
 * layer is stubbed except for `tenants` and `alert_history`, which are real.
 */
import fs from 'fs';
import path from 'path';
import costRecommendationsRoutes from '../cost-recommendations.routes';
import alertHistoryRoutes from '../alert-history.routes';
import accountSecurityFindingsRoutes from '../account-security-findings.routes';
import tenantsRoutes from '../tenants.routes';
import prometheusRoutes from '../prometheus.routes';
import { createCustomRulesRoutes } from '../custom-anomaly-rules.routes';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { AlertHistoryRepository } from '../../repositories/alert-history.repository';
import { AccountSecurityFindingsRepository } from '../../repositories/account-security-findings.repository';
import { OptimizationRuleConfigService } from '../../services/optimization-rule-config.service';
import { CustomAnomalyRulesService } from '../../services/custom-anomaly-rules.service';
import { MonitoringSnapshotService } from '../../services/monitoring-snapshot.service';
import { MonitoringDiagnosticService } from '../../services/monitoring-diagnostic.service';
import { OPTIMIZATION_RULE_PARAMETERS } from '../../config/optimization-rules';
import { pool as appPool } from '../../config/database';
import { ADMIN_REFUSAL, MEMBER_REFUSAL, ROLES, RoleGateOrg, createRoleGateHarness } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

const harness = createRoleGateHarness('admin-floor');
const { pool, sendAs } = harness;

const ID = '00000000-0000-4000-8000-000000000003';
const PARAMETER = OPTIMIZATION_RULE_PARAMETERS[0];
const PARAMETER_ROUTE = `/cost-recommendations/optimization-rules/configuration/${PARAMETER.ruleId}/${PARAMETER.parameterId}`;
const RULE_BODY = { name: 'Admin floor rule', metric: 'cost', condition: 'greater_than', threshold: 10 };

let org: RoleGateOrg;
let spies: Record<string, jest.SpyInstance>;

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'tenants');
  org = await harness.buildOrg();
  await harness.listen((app) => {
    app.use('/api/cost-recommendations', costRecommendationsRoutes);
    app.use('/api/alerts', alertHistoryRoutes);
    app.use('/api/security/account-findings', accountSecurityFindingsRoutes);
    app.use('/api/tenants', tenantsRoutes);
    app.use('/api/prometheus', prometheusRoutes);
    // The same factory, mounted at the same path, as server.ts.
    app.use('/api/anomaly-rules', createCustomRulesRoutes(appPool));
  });
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});

  const row = { id: ID };
  spies = {
    overrideUpsert: jest
      .spyOn(OptimizationRuleConfigService.prototype, 'upsertOverride')
      .mockResolvedValue({ ruleId: PARAMETER.ruleId, parameterId: PARAMETER.parameterId, value: 1 } as never),
    overrideDelete: jest.spyOn(OptimizationRuleConfigService.prototype, 'deleteOverride').mockResolvedValue(undefined as never),
    recommendationDelete: jest.spyOn(CostRecommendationsRepository.prototype, 'delete').mockResolvedValue(true as never),
    recommendationStatus: jest.spyOn(CostRecommendationsRepository.prototype, 'updateStatus').mockResolvedValue(row as never),
    findingDisposition: jest
      .spyOn(AccountSecurityFindingsRepository.prototype, 'setDisposition')
      .mockResolvedValue({ outcome: 'updated', finding: row } as never),
    ruleCreate: jest.spyOn(CustomAnomalyRulesService.prototype, 'createRule').mockResolvedValue(row as never),
    ruleUpdate: jest.spyOn(CustomAnomalyRulesService.prototype, 'updateRule').mockResolvedValue(row as never),
    ruleToggle: jest.spyOn(CustomAnomalyRulesService.prototype, 'toggleRule').mockResolvedValue(row as never),
    ruleDelete: jest.spyOn(CustomAnomalyRulesService.prototype, 'deleteRule').mockResolvedValue(undefined as never),
    alertDelete: jest.spyOn(AlertHistoryRepository.prototype, 'delete').mockResolvedValue(true as never),
    snapshotSave: jest.spyOn(MonitoringSnapshotService.prototype, 'saveSnapshot').mockResolvedValue(undefined),
    snapshotPrune: jest.spyOn(MonitoringSnapshotService.prototype, 'pruneOldSnapshots').mockResolvedValue(undefined),
    snapshotRead: jest.spyOn(MonitoringSnapshotService.prototype, 'getLatestSnapshot').mockResolvedValue(null),
    diagnose: jest.spyOn(MonitoringDiagnosticService.prototype, 'diagnose').mockResolvedValue({ reachable: true } as never),
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await harness.close(async (orgIds, userIds) => {
    await pool.query('DELETE FROM tenants WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM alert_history WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM platform_staff WHERE user_id = ANY($1)', [userIds]);
  });
});

async function insertTenant(orgId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO tenants (organization_id, name, email) VALUES ($1, 'Before', 'tenant@example.com') RETURNING id`,
    [orgId]
  );
  return rows[0].id as string;
}

async function tenantName(id: string): Promise<string | undefined> {
  return (await pool.query('SELECT name FROM tenants WHERE id = $1', [id])).rows[0]?.name;
}

async function tenantCount(orgId: string): Promise<number> {
  return (await pool.query('SELECT COUNT(*)::int AS n FROM tenants WHERE organization_id = $1', [orgId])).rows[0].n;
}

async function insertAlert(orgId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO alert_history (alert_name, severity, status, started_at, organization_id)
     VALUES ('Admin floor alert', 'warning', 'firing', NOW(), $1) RETURNING id`,
    [orgId]
  );
  return rows[0].id as string;
}

const called = (name: string) => async () => spies[name].mock.calls.length > 0;
const none = async () => ID;

interface Mutation {
  name: string;
  method: string;
  route: (id: string) => string;
  body?: unknown;
  /** State the request acts on; returns the id used by the route and by `happened`. */
  prepare: (orgId: string) => Promise<string>;
  /** What an owner or admin is answered: unchanged by the role gate. */
  allowed: number;
  /** Whether the write the route exists for was reached. */
  happened: (orgId: string, id: string) => Promise<boolean>;
}

const mutations: Mutation[] = [
  { name: 'PUT /api/cost-recommendations/optimization-rules/configuration/:ruleId/:parameterId', method: 'PUT', route: () => PARAMETER_ROUTE, body: { value: 1 }, prepare: none, allowed: 200, happened: called('overrideUpsert') },
  { name: 'DELETE /api/cost-recommendations/optimization-rules/configuration/:ruleId/:parameterId', method: 'DELETE', route: () => PARAMETER_ROUTE, prepare: none, allowed: 200, happened: called('overrideDelete') },
  { name: 'DELETE /api/cost-recommendations/:id', method: 'DELETE', route: (id) => `/cost-recommendations/${id}`, prepare: none, allowed: 200, happened: called('recommendationDelete') },

  { name: 'POST /api/security/account-findings/:id/accept-risk', method: 'POST', route: (id) => `/security/account-findings/${id}/accept-risk`, body: { note: 'accepted by the business' }, prepare: none, allowed: 200, happened: called('findingDisposition') },

  { name: 'POST /api/tenants', method: 'POST', route: () => '/tenants', body: { name: 'New', email: 'new@example.com' }, prepare: async (orgId) => String(await tenantCount(orgId)), allowed: 201, happened: async (orgId, before) => (await tenantCount(orgId)) !== Number(before) },
  { name: 'PATCH /api/tenants/:id', method: 'PATCH', route: (id) => `/tenants/${id}`, body: { name: 'After' }, prepare: insertTenant, allowed: 200, happened: async (_orgId, id) => (await tenantName(id)) === 'After' },
  { name: 'DELETE /api/tenants/:id', method: 'DELETE', route: (id) => `/tenants/${id}`, prepare: insertTenant, allowed: 200, happened: async (_orgId, id) => (await tenantName(id)) === undefined },

  { name: 'POST /api/anomaly-rules', method: 'POST', route: () => '/anomaly-rules', body: RULE_BODY, prepare: none, allowed: 201, happened: called('ruleCreate') },
  { name: 'PATCH /api/anomaly-rules/:id', method: 'PATCH', route: (id) => `/anomaly-rules/${id}`, body: { threshold: 20 }, prepare: none, allowed: 200, happened: called('ruleUpdate') },
  { name: 'PATCH /api/anomaly-rules/:id/toggle', method: 'PATCH', route: (id) => `/anomaly-rules/${id}/toggle`, body: { enabled: false }, prepare: none, allowed: 200, happened: called('ruleToggle') },
  { name: 'DELETE /api/anomaly-rules/:id', method: 'DELETE', route: (id) => `/anomaly-rules/${id}`, prepare: none, allowed: 200, happened: called('ruleDelete') },

  { name: 'DELETE /api/alerts/:id', method: 'DELETE', route: (id) => `/alerts/${id}`, prepare: none, allowed: 200, happened: called('alertDelete') },

  { name: 'POST /api/prometheus/snapshot', method: 'POST', route: () => '/prometheus/snapshot', body: { uptime: 99.9 }, prepare: none, allowed: 200, happened: async () => spies.snapshotSave.mock.calls.length + spies.snapshotPrune.mock.calls.length > 0 },
];

describe.each(mutations)('$name', ({ method, route, body, prepare, allowed, happened }) => {
  it.each(['viewer', 'member'] as const)('refuses a %s with 403 and changes nothing', async (role) => {
    const id = await prepare(org.orgId);

    const response = await sendAs(org.orgId, org[role], method, route(id), body);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ...ADMIN_REFUSAL, current: role });
    expect(await happened(org.orgId, id)).toBe(false);
  });

  it.each(['admin', 'owner'] as const)('answers an %s as before', async (role) => {
    const id = await prepare(org.orgId);

    // The token claims the lowest role: the membership is what counts.
    const response = await sendAs(org.orgId, org[role], method, route(id), body, 'viewer');

    expect(response.status).toBe(allowed);
    expect(await happened(org.orgId, id)).toBe(true);
  });
});

describe('POST /api/prometheus/snapshot writes only the caller\'s organization', () => {
  it('saves and prunes under the authenticated organization, ignoring one named in the body', async () => {
    const other = await harness.buildOrg();

    await sendAs(org.orgId, org.admin, 'POST', '/prometheus/snapshot', { organizationId: other.orgId, uptime: 1 });

    expect(spies.snapshotSave).toHaveBeenCalledWith(expect.objectContaining({ organizationId: org.orgId }));
    expect(spies.snapshotPrune).toHaveBeenCalledWith(org.orgId);
  });

  it('every role can still read the latest snapshot', async () => {
    for (const role of ROLES) {
      expect((await sendAs(org.orgId, org[role], 'GET', '/prometheus/snapshot')).status).toBe(200);
    }
    expect(spies.snapshotRead).toHaveBeenCalledWith(org.orgId);
  });
});

describe('POST /api/prometheus/diagnose', () => {
  async function grantPlatformStaff(userId: string): Promise<void> {
    await pool.query(
      `INSERT INTO platform_staff (user_id, status, added_at) VALUES ($1, 'active', NOW())
       ON CONFLICT (user_id) DO UPDATE SET status = 'active', revoked_at = NULL, updated_at = NOW()`,
      [userId]
    );
  }

  it('the diagnostic has no organization input: it probes the one shared instance', () => {
    expect(MonitoringDiagnosticService.prototype.diagnose.length).toBe(0);
  });

  it.each(ROLES)('refuses a %s who is not platform staff, and probes nothing', async (role) => {
    const response = await sendAs(org.orgId, org[role], 'POST', '/prometheus/diagnose');

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, error: 'Platform staff authorization required' });
    expect(spies.diagnose).not.toHaveBeenCalled();
  });

  it('answers platform staff, even one who is only a viewer in their organization', async () => {
    const staffOrg = await harness.buildOrg();
    await grantPlatformStaff(staffOrg.viewer);

    const response = await sendAs(staffOrg.orgId, staffOrg.viewer, 'POST', '/prometheus/diagnose');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { reachable: true } });
    expect(spies.diagnose).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH /api/alerts/:id/acknowledge records who acknowledged', () => {
  async function acknowledgedBy(alertId: string): Promise<string | null> {
    return (await pool.query('SELECT acknowledged_by FROM alert_history WHERE id = $1', [alertId])).rows[0].acknowledged_by;
  }

  it.each([
    ['another member of the organization', () => ({ user: org.emails.owner })],
    ['the old default name', () => ({ user: 'admin' })],
    ['someone outside the organization', () => ({ user: 'ceo@elsewhere.example', acknowledgedBy: 'ceo@elsewhere.example' })],
  ])('a member naming %s in the body is still recorded as themselves', async (_label, body) => {
    const alertId = await insertAlert(org.orgId);

    const response = await sendAs(org.orgId, org.member, 'PATCH', `/alerts/${alertId}/acknowledge`, body());

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ status: 'acknowledged', acknowledgedBy: org.emails.member });
    expect(await acknowledgedBy(alertId)).toBe(org.emails.member);
  });

  it('with no body at all, the caller is recorded, not a default name', async () => {
    const alertId = await insertAlert(org.orgId);

    const response = await sendAs(org.orgId, org.admin, 'PATCH', `/alerts/${alertId}/acknowledge`);

    expect(response.status).toBe(200);
    expect(await acknowledgedBy(alertId)).toBe(org.emails.admin);
  });

  it('the actor is the caller\'s account email, not the email claimed in the token', async () => {
    const alertId = await insertAlert(org.orgId);

    // sendAs issues a token whose email claim is token-claim@example.com.
    await sendAs(org.orgId, org.member, 'PATCH', `/alerts/${alertId}/acknowledge`, {});

    expect(await acknowledgedBy(alertId)).toBe(org.emails.member);
  });

  it('still cannot acknowledge another organization\'s alert', async () => {
    const other = await harness.buildOrg();
    const alertId = await insertAlert(other.orgId);

    const response = await sendAs(org.orgId, org.member, 'PATCH', `/alerts/${alertId}/acknowledge`, {});

    expect(response.status).toBe(404);
    expect(await acknowledgedBy(alertId)).toBeNull();
  });

  it('a viewer is refused and nothing is recorded', async () => {
    const alertId = await insertAlert(org.orgId);

    const response = await sendAs(org.orgId, org.viewer, 'PATCH', `/alerts/${alertId}/acknowledge`, { user: org.emails.owner });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ...MEMBER_REFUSAL, current: 'viewer' });
    expect(await acknowledgedBy(alertId)).toBeNull();
  });
});

describe('tenant scope is unchanged', () => {
  it('an admin cannot change or delete another organization\'s tenant', async () => {
    const other = await harness.buildOrg();
    const tenantId = await insertTenant(other.orgId);

    expect((await sendAs(org.orgId, org.admin, 'PATCH', `/tenants/${tenantId}`, { name: 'After' })).status).toBe(404);
    expect((await sendAs(org.orgId, org.admin, 'DELETE', `/tenants/${tenantId}`)).status).toBe(404);
    expect(await tenantName(tenantId)).toBe('Before');
  });

  it('stubbed writes are still addressed to the caller\'s own organization', async () => {
    await sendAs(org.orgId, org.admin, 'DELETE', PARAMETER_ROUTE);
    await sendAs(org.orgId, org.admin, 'DELETE', `/cost-recommendations/${ID}`);
    await sendAs(org.orgId, org.admin, 'DELETE', `/alerts/${ID}`);
    await sendAs(org.orgId, org.admin, 'DELETE', `/anomaly-rules/${ID}`);
    await sendAs(org.orgId, org.admin, 'POST', `/security/account-findings/${ID}/accept-risk`, { note: 'ok' });

    expect(spies.overrideDelete).toHaveBeenCalledWith(org.orgId, PARAMETER.ruleId, PARAMETER.parameterId);
    expect(spies.recommendationDelete).toHaveBeenCalledWith(ID, org.orgId);
    expect(spies.alertDelete).toHaveBeenCalledWith(ID, org.orgId);
    expect(spies.ruleDelete).toHaveBeenCalledWith(ID, org.orgId);
    expect(spies.findingDisposition).toHaveBeenCalledWith(org.orgId, ID, 'accepted_risk', org.admin, 'ok');
  });
});

describe('routes this change leaves alone', () => {
  it('a member keeps the triage routes next to each owner/admin route', async () => {
    jest.spyOn(AlertHistoryRepository.prototype, 'findById').mockResolvedValue({ id: ID, status: 'firing' } as never);
    jest.spyOn(AlertHistoryRepository.prototype, 'resolve').mockResolvedValue({ id: ID } as never);

    expect((await sendAs(org.orgId, org.member, 'PATCH', `/cost-recommendations/${ID}/dismiss`)).status).toBe(200);
    expect((await sendAs(org.orgId, org.member, 'PATCH', `/alerts/${ID}/resolve`)).status).toBe(200);
    expect((await sendAs(org.orgId, org.member, 'POST', `/security/account-findings/${ID}/dismiss`, { note: 'n/a' })).status).toBe(200);
  });

  it('a viewer can still read tenants, anomaly rules and the optimization rule catalog', async () => {
    jest.spyOn(CustomAnomalyRulesService.prototype, 'getRules').mockResolvedValue([] as never);

    for (const route of ['/tenants', '/tenants/stats', '/anomaly-rules', '/cost-recommendations/optimization-rules']) {
      expect([route, (await sendAs(org.orgId, org.viewer, 'GET', route)).status]).toEqual([route, 200]);
    }
  });

  it('starting an analysis is still owner and admin only, and remediation execution is untouched', async () => {
    const analyze = await sendAs(org.orgId, org.member, 'POST', '/cost-recommendations/analyze');
    expect(analyze.status).toBe(403);
    expect(await analyze.json()).toMatchObject({ required: ['owner', 'admin'] });

    const execute = await sendAs(org.orgId, org.member, 'POST', `/cost-recommendations/${ID}/execute-remediation`);
    expect(execute.status).toBe(403);
    expect(await execute.json()).toEqual({
      success: false,
      error: 'Only admins and owners can execute automated remediation actions.',
    });
  });
});

describe('the routers under test are the ones the application serves', () => {
  // server.ts starts the server when loaded, so it is read, not imported.
  const source = (file: string) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf-8');

  it('server.ts mounts the anomaly-rules factory once, at the path used here', () => {
    expect(source('server.ts').match(/app\.use\('\/api\/anomaly-rules', createCustomRulesRoutes\(pool\)\)/g)).toHaveLength(1);
  });

  it('routes/index.ts mounts each remaining router exactly once', () => {
    const index = source('routes/index.ts');
    for (const mount of [
      "router.use('/cost-recommendations', costRecommendationsRoutes)",
      "router.use('/alerts', alertHistoryRoutes)",
      "router.use('/security/account-findings', accountSecurityFindingsRoutes)",
      "router.use('/tenants', tenantsRoutes)",
      "router.use('/prometheus', prometheusRoutes)",
    ]) {
      expect([mount, index.split(mount).length - 1]).toEqual([mount, 1]);
    }
  });
});
