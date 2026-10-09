/**
 * Composition of the GET /api/services/intelligence response from one
 * organization's rows. Pure: no database, no clock (the generation time is
 * passed in), synthetic identifiers only.
 *
 * Tenant isolation and authorization are covered against live Postgres in
 * routes/__tests__/services-intelligence.test.ts.
 */
import { ISSUE_EC2_IDLE_INSTANCE, ISSUE_S3_LIFECYCLE_OPTIMIZATION } from '../../config/optimization-rules';
import { ServicesIntelligenceRows } from '../../repositories/services-intelligence.repository';
import { isAutomatedRemediationEnabled } from '../remediation.service';
import { GENERIC_RESOURCE_TYPES } from '../resourceExplorer.service';
import {
  buildCapabilities,
  composeServicesIntelligence,
  RECOMMENDATION_REMEDIATION_RULES,
} from '../services-intelligence.service';
import { servicesIntelligenceSchema } from './services-intelligence-contract';

const ORG = '10000000-0000-4000-8000-000000000001';
const SERVICE = '20000000-0000-4000-8000-000000000001';
const EMPTY_SERVICE = '20000000-0000-4000-8000-000000000002';
const TEAM = '30000000-0000-4000-8000-000000000001';
const INSTANCE = '40000000-0000-4000-8000-000000000001';
const BUCKET = '40000000-0000-4000-8000-000000000002';
const IDLE_REC = '50000000-0000-4000-8000-000000000001';
const LIFECYCLE_REC = '50000000-0000-4000-8000-000000000002';
const JOB = '60000000-0000-4000-8000-000000000001';

const GENERATED_AT = new Date('2026-01-02T03:04:05.000Z');
const SYNCED_AT = new Date('2026-01-01T00:00:00.000Z');

// With no cached evaluation: a checked type has no signal, an unchecked type is not supported.
const UNAVAILABLE_HEALTH = {
  state: 'no_signal', group: null, reasons: [{ kind: 'evaluation_unavailable' }], signal: null,
  checks: [], evaluated_at: null, source: null,
};
const NOT_SUPPORTED_HEALTH = {
  state: 'not_supported', group: null, reasons: [], signal: null, checks: [], evaluated_at: null, source: null,
};
const NOT_EVALUATED_COST = { state: 'not_evaluated', amount: null, basis: null, display: null };

function rows(overrides: Partial<ServicesIntelligenceRows> = {}): ServicesIntelligenceRows {
  return {
    resources: [
      {
        id: INSTANCE,
        resource_arn: 'arn:aws:ec2:test-region-1:000000000000:instance/i-synthetic',
        resource_id: 'i-synthetic',
        resource_name: 'synthetic-instance',
        resource_type: 'ec2',
        region: 'test-region-1',
        status: 'running',
        metadata_type: null,
        compliance_issues: [],
        last_synced_at: SYNCED_AT,
        service_id: SERVICE,
      },
      {
        id: BUCKET,
        resource_arn: 'arn:aws:s3:::synthetic-bucket',
        resource_id: 'synthetic-bucket',
        resource_name: null,
        resource_type: 's3',
        region: 'test-region-2',
        status: null,
        metadata_type: null,
        compliance_issues: [
          {
            severity: 'critical',
            category: 'public_access',
            issue: 'Synthetic keyed finding',
            recommendation: 'ignored',
            findingKey: 'synthetic.finding.key',
            provenance: 'OBSERVED',
            verification: 'unverified',
          },
          { severity: 'medium', category: 'encryption', issue: 'Synthetic legacy finding', recommendation: 'ignored' },
        ],
        last_synced_at: null,
        service_id: null,
      },
    ],
    services: [
      { id: SERVICE, name: 'synthetic-service', description: null, owner: 'declared-owner', team_id: TEAM, team_name: 'synthetic-team' },
      { id: EMPTY_SERVICE, name: 'synthetic-empty', description: 'no resources', owner: null, team_id: null, team_name: null },
    ],
    recommendations: [
      { id: IDLE_REC, resource_id: 'i-synthetic', resource_type: 'EC2', issue: ISSUE_EC2_IDLE_INSTANCE, severity: 'HIGH' },
      { id: LIFECYCLE_REC, resource_id: 'synthetic-bucket', resource_type: 'S3', issue: ISSUE_S3_LIFECYCLE_OPTIMIZATION, severity: 'LOW' },
    ],
    primaryRegion: 'test-region-1',
    hasConnectedAccount: true,
    lastDiscoveryJob: { id: JOB, status: 'failed', started_at: SYNCED_AT, completed_at: null },
    inventoryRefreshedAt: null,
    ...overrides,
  };
}

function compose(overrides: Partial<ServicesIntelligenceRows> = {}) {
  return composeServicesIntelligence(ORG, rows(overrides), GENERATED_AT);
}

const ORIGINAL_REMEDIATION_SETTING = process.env.ENABLE_AUTOMATED_REMEDIATION;

function setRemediationSetting(value: string | undefined): void {
  if (value === undefined) delete process.env.ENABLE_AUTOMATED_REMEDIATION;
  else process.env.ENABLE_AUTOMATED_REMEDIATION = value;
}

beforeEach(() => setRemediationSetting(undefined));
afterAll(() => setRemediationSetting(ORIGINAL_REMEDIATION_SETTING));

describe('response contract', () => {
  it('composes exactly this response for the fixture', () => {
    const instance = {
      id: INSTANCE,
      arn: 'arn:aws:ec2:test-region-1:000000000000:instance/i-synthetic',
      resource_id: 'i-synthetic',
      name: 'synthetic-instance',
      type: 'ec2',
      region: 'test-region-1',
      lifecycle_state: 'running',
      service_id: SERVICE,
      last_seen_at: '2026-01-01T00:00:00.000Z',
      findings: [
        {
          source: 'cost_recommendation',
          source_id: IDLE_REC,
          finding_key: null,
          verification: null,
          severity: 'high',
          source_severity: 'HIGH',
          category: 'cost',
          title: ISSUE_EC2_IDLE_INSTANCE,
          provenance: null,
          remediation: {
            available: true,
            path: 'cost_recommendation_execute',
            action_type: 'stop_instance',
            recommendation_id: IDLE_REC,
            requires: { role: 'admin', plan: 'enterprise' },
          },
        },
      ],
      health: UNAVAILABLE_HEALTH,
      cost: NOT_EVALUATED_COST,
    };
    const bucket = {
      id: BUCKET,
      arn: 'arn:aws:s3:::synthetic-bucket',
      resource_id: 'synthetic-bucket',
      name: null,
      type: 's3',
      region: 'test-region-2',
      lifecycle_state: null,
      service_id: null,
      last_seen_at: null,
      findings: [
        {
          source: 'resource_scan',
          source_id: null,
          finding_key: 'synthetic.finding.key',
          verification: 'unverified',
          severity: 'critical',
          source_severity: 'critical',
          category: 'public_access',
          title: 'Synthetic keyed finding',
          provenance: 'OBSERVED',
          remediation: null,
        },
        {
          source: 'resource_scan',
          source_id: null,
          finding_key: null,
          verification: null,
          severity: 'medium',
          source_severity: 'medium',
          category: 'encryption',
          title: 'Synthetic legacy finding',
          provenance: null,
          remediation: null,
        },
        {
          source: 'cost_recommendation',
          source_id: LIFECYCLE_REC,
          finding_key: null,
          verification: null,
          severity: 'low',
          source_severity: 'LOW',
          category: 'cost',
          title: ISSUE_S3_LIFECYCLE_OPTIMIZATION,
          provenance: null,
          remediation: null,
        },
      ],
      health: NOT_SUPPORTED_HEALTH,
      cost: NOT_EVALUATED_COST,
    };

    expect(compose()).toEqual({
      contract_version: '1',
      generated_at: '2026-01-02T03:04:05.000Z',
      organization_id: ORG,
      discovery: {
        primary_region: 'test-region-1',
        scope: 'single_region_plus_global',
        regions_present: ['test-region-1', 'test-region-2'],
        last_attempt: { job_id: JOB, started_at: '2026-01-01T00:00:00.000Z', completed_at: null, status: 'failed' },
        inventory_refreshed_at: null,
      },
      remediation_execution_enabled: false,
      health: { evaluated_at: null, source: null, range: '1h', cache: 'miss', max_age_seconds: 900 },
      capabilities: buildCapabilities(),
      totals: { resources: 2, services: 2, unassigned_resources: 1 },
      services: [
        {
          id: SERVICE,
          name: 'synthetic-service',
          description: null,
          owner_declared: 'declared-owner',
          team: { id: TEAM, name: 'synthetic-team' },
          resources: { count: 1, by_type: { ec2: 1 }, items: [instance] },
          health: { state: 'not_evaluated', resource_counts: { checks_passing: 0, check_failing: 0, no_signal: 1, not_supported: 0 } },
          cost: { state: 'not_evaluated', amount: null, priced_resources: null, unpriced_resources: null },
        },
        {
          id: EMPTY_SERVICE,
          name: 'synthetic-empty',
          description: 'no resources',
          owner_declared: null,
          team: null,
          resources: { count: 0, by_type: {}, items: [] },
          health: { state: 'not_evaluated', resource_counts: { checks_passing: 0, check_failing: 0, no_signal: 0, not_supported: 0 } },
          cost: { state: 'not_evaluated', amount: null, priced_resources: null, unpriced_resources: null },
        },
      ],
      unassigned: { resources: [bucket] },
    });
  });

  it('satisfies the strict schema', () => {
    expect(servicesIntelligenceSchema.safeParse(compose()).success).toBe(true);
    expect(
      servicesIntelligenceSchema.safeParse(
        compose({ resources: [], services: [], recommendations: [], hasConnectedAccount: false, primaryRegion: null, lastDiscoveryJob: null })
      ).success
    ).toBe(true);
  });

  // The schema has to bite, or it protects nothing.
  it.each<[string, (body: any) => void]>([
    ['an added top-level key', (b) => { b.insight = null; }],
    ['a removed top-level key', (b) => { delete b.totals; }],
    ['a missing remediation execution flag', (b) => { delete b.remediation_execution_enabled; }],
    ['a non-boolean remediation execution flag', (b) => { b.remediation_execution_enabled = 'true'; }],
    ['an added resource key', (b) => { b.unassigned.resources[0].environment = null; }],
    ['a health classification', (b) => { b.unassigned.resources[0].health.group = 'healthy'; }],
    ['a service verdict', (b) => { b.services[0].health.state = 'checks_passing'; }],
    ['an extra service verdict field', (b) => { b.services[0].health.verdict = 'check_failing'; }],
    ['removed service counts', (b) => { b.services[0].health.resource_counts = null; }],
    ['a resource state outside the four', (b) => { b.unassigned.resources[0].health.state = 'not_evaluated'; }],
    ['a removed PR 1 health field', (b) => { delete b.unassigned.resources[0].health.signal; }],
    ['a renamed PR 1 health field', (b) => { const h = b.unassigned.resources[0].health; h.grouping = h.group; delete h.group; }],
    ['a removed checks field', (b) => { delete b.unassigned.resources[0].health.checks; }],
    ['no_signal without a reason', (b) => { b.services[0].resources.items[0].health.reasons = []; }],
    ['a reason on a state other than no_signal', (b) => { b.unassigned.resources[0].health.reasons = [{ kind: 'no_telemetry' }]; }],
    ['a free-text reason', (b) => { b.services[0].resources.items[0].health.reasons = [{ kind: 'Resource is degraded' }]; }],
    ['a removed top-level health block', (b) => { delete b.health; }],
    ['a miss that claims an evaluation time', (b) => { b.health.evaluated_at = '2026-01-01T00:00:00.000Z'; }],
    ['a cost amount', (b) => { b.unassigned.resources[0].cost.amount = 5; }],
    ['a service cost amount', (b) => { b.services[0].cost.amount = 0; }],
    ['a missing finding key field', (b) => { delete b.unassigned.resources[0].findings[0].finding_key; }],
    ['a missing verification field', (b) => { delete b.unassigned.resources[0].findings[0].verification; }],
    ['an unknown severity', (b) => { b.unassigned.resources[0].findings[0].severity = 'severe'; }],
    ['an unknown capability health kind', (b) => { b.capabilities.ec2.health.kind = 'heuristic'; }],
    ['a capability reverted to not_evaluated', (b) => { b.capabilities.ec2.health.state = 'not_evaluated'; }],
    ['a supported capability with no checks', (b) => { b.capabilities.ec2.health.checks = []; }],
    ['an at-risk claim', (b) => { b.capabilities.ec2.health.counts_toward_at_risk = true; }],
    ['a capability pricing basis', (b) => { b.capabilities.ec2.pricing.basis = 'list_price'; }],
    ['a non-ISO timestamp', (b) => { b.generated_at = 'yesterday'; }],
    ['an unavailable remediation', (b) => { b.services[0].resources.items[0].findings[0].remediation.available = false; }],
  ])('the schema rejects %s', (_label, mutate) => {
    const body = JSON.parse(JSON.stringify(compose()));
    mutate(body);
    expect(servicesIntelligenceSchema.safeParse(body).success).toBe(false);
  });
});

describe('grouping', () => {
  it('places every resource in exactly one group', () => {
    const body = compose();
    const grouped = [...body.services.flatMap((s) => s.resources.items), ...body.unassigned.resources].map((r) => r.id);
    expect(grouped.sort()).toEqual([BUCKET, INSTANCE].sort());
    expect(body.totals.resources).toBe(grouped.length);
  });

  it('reports a resource whose service is not one of the organization\'s services as unassigned, without the id', () => {
    const body = compose({ services: [] });
    expect(body.services).toEqual([]);
    expect(body.unassigned.resources.map((r) => [r.id, r.service_id])).toEqual([[INSTANCE, null], [BUCKET, null]]);
    expect(body.totals).toEqual({ resources: 2, services: 0, unassigned_resources: 2 });
    expect(JSON.stringify(body)).not.toContain(SERVICE);
  });
});

describe('findings are passed through as recorded', () => {
  function findingsFor(complianceIssues: unknown) {
    const [resource] = rows().resources;
    return compose({ resources: [{ ...resource, compliance_issues: complianceIssues }], recommendations: [] })
      .services[0].resources.items[0].findings;
  }

  it.each([null, undefined, 'not-an-array', { severity: 'high' }, 7])('compliance_issues = %p yields no findings', (value) => {
    expect(findingsFor(value)).toEqual([]);
  });

  it('skips entries that are not objects and keeps the rest in order', () => {
    const findings = findingsFor([null, 'text', ['nested'], { issue: 'first' }, { issue: 'second' }]);
    expect(findings.map((f) => f.title)).toEqual(['first', 'second']);
  });

  it('keeps an unrecognised severity as stated and does not map it to a level', () => {
    const [finding] = findingsFor([{ severity: 'SEVERE', issue: 'x' }]);
    expect(finding).toMatchObject({ severity: null, source_severity: 'SEVERE' });
  });

  it('never reports a finding as verified: the marker is the recorded value or null', () => {
    const findings = findingsFor([
      { issue: 'carried', findingKey: 'k.carried', verification: 'unverified' },
      { issue: 'no marker', findingKey: 'k.fresh' },
      { issue: 'other marker', verification: 'stale' },
      { issue: 'malformed marker', verification: true },
    ]);
    expect(findings.map((f) => [f.finding_key, f.verification])).toEqual([
      ['k.carried', 'unverified'],
      ['k.fresh', null],
      [null, 'stale'],
      [null, null],
    ]);
  });

  it('reports only a known provenance', () => {
    const findings = findingsFor([
      { issue: 'a', provenance: 'DERIVED' },
      { issue: 'b', provenance: 'SELF_ATTESTED' },
      { issue: 'c', provenance: 'GUESSED' },
      { issue: 'd' },
    ]);
    expect(findings.map((f) => f.provenance)).toEqual(['DERIVED', 'SELF_ATTESTED', null, null]);
  });
});

describe('remediation eligibility', () => {
  const idle = { id: IDLE_REC, resource_id: 'i-synthetic', resource_type: 'EC2', issue: ISSUE_EC2_IDLE_INSTANCE, severity: 'HIGH' };

  function remediations(recommendations: ServicesIntelligenceRows['recommendations']) {
    return compose({ recommendations }).services[0].resources.items[0].findings.map((f) => f.remediation);
  }

  it('is offered only for what the execute-remediation route accepts', () => {
    expect(RECOMMENDATION_REMEDIATION_RULES).toEqual([
      {
        recommendationResourceType: 'EC2',
        issue: 'Idle Instance',
        path: 'cost_recommendation_execute',
        actionType: 'stop_instance',
        requires: { role: 'admin', plan: 'enterprise' },
      },
    ]);
  });

  it('is null for a recommendation with another issue on the same resource', () => {
    expect(remediations([{ ...idle, issue: 'Old-Generation Instance' }])).toEqual([null]);
  });

  it('is null when the recommendation\'s resource type differs in case, as the route compares it exactly', () => {
    expect(remediations([{ ...idle, resource_type: 'ec2' }])).toEqual([null]);
  });

  it('a recommendation for a resource that is not in inventory is not attached to anything', () => {
    const body = compose({ recommendations: [{ ...idle, resource_id: 'i-not-in-inventory' }] });
    expect(JSON.stringify(body)).not.toContain(IDLE_REC);
  });

  it('a recommendation is attached only to the resource of the same type and id', () => {
    const body = compose({ recommendations: [{ ...idle, resource_id: 'synthetic-bucket' }] });
    expect(JSON.stringify(body)).not.toContain(IDLE_REC);
  });
});

describe('remediation_execution_enabled', () => {
  it('is true when ENABLE_AUTOMATED_REMEDIATION is exactly "true"', () => {
    setRemediationSetting('true');
    expect(compose().remediation_execution_enabled).toBe(true);
  });

  it.each([undefined, 'false', 'TRUE', 'True', ' true', 'true ', '1', 'yes', 'on', ''])('is false for %p', (value) => {
    setRemediationSetting(value);
    expect(compose().remediation_execution_enabled).toBe(false);
  });

  it.each([undefined, 'true', 'false', 'TRUE', '1'])('for %p it is the remediation service\'s own answer', (value) => {
    setRemediationSetting(value);
    expect(compose().remediation_execution_enabled).toBe(isAutomatedRemediationEnabled());
  });

  it('is read per request, not captured at load', () => {
    setRemediationSetting('true');
    expect(compose().remediation_execution_enabled).toBe(true);
    setRemediationSetting('false');
    expect(compose().remediation_execution_enabled).toBe(false);
  });

  it('does not change which findings carry a remediation', () => {
    const remediations = () =>
      compose().services[0].resources.items[0].findings.map((f) => f.remediation);
    setRemediationSetting('true');
    const enabled = remediations();
    setRemediationSetting(undefined);
    expect(remediations()).toEqual(enabled);
  });
});

describe('discovery provenance and freshness', () => {
  it('is null when there is no connected account and no discovery job', () => {
    expect(compose({ hasConnectedAccount: false, primaryRegion: null, lastDiscoveryJob: null }).discovery).toBeNull();
  });

  it('a connected account that has never run discovery makes no freshness claim', () => {
    expect(compose({ lastDiscoveryJob: null, inventoryRefreshedAt: null }).discovery).toMatchObject({
      primary_region: 'test-region-1',
      last_attempt: null,
      inventory_refreshed_at: null,
    });
  });

  it('a job without a connected account reports no primary region', () => {
    expect(compose({ hasConnectedAccount: false, primaryRegion: null }).discovery).toMatchObject({
      primary_region: null,
      last_attempt: { job_id: JOB, status: 'failed' },
    });
  });

  it('reports the refresh time it was given, independently of the latest attempt', () => {
    const refreshed = new Date('2025-12-31T12:00:00.000Z');
    expect(compose({ inventoryRefreshedAt: refreshed }).discovery).toMatchObject({
      last_attempt: { status: 'failed', completed_at: null },
      inventory_refreshed_at: '2025-12-31T12:00:00.000Z',
    });
  });
});

describe('capabilities', () => {
  const capabilities = buildCapabilities();

  it('lists the evaluator\'s checks for a checked type, and not_supported for the rest', () => {
    expect(capabilities.ec2.health).toEqual({
      state: 'supported', kind: 'aws_status_check', counts_toward_at_risk: null,
      checks: ['ec2_status_check', 'ec2_cpu_threshold'],
    });
    expect(capabilities.ebs.health).toEqual({
      state: 'supported', kind: 'aws_status_check', counts_toward_at_risk: null, checks: ['ebs_volume_status_check'],
    });
    expect(capabilities.ecs.health).toMatchObject({ state: 'supported', kind: 'control_plane' });
    expect(capabilities.lambda.health).toMatchObject({ state: 'supported', kind: 'cloudwatch_metric' });
    for (const type of ['rds', 's3', 'sns', 'sqs', 'vpc', 'api-gateway', 'elasticache']) {
      expect(capabilities[type].health).toEqual({ state: 'not_supported', kind: null, counts_toward_at_risk: null, checks: [] });
    }
    const supported = Object.entries(capabilities).filter(([, c]) => c.health.state === 'supported').map(([type]) => type);
    expect(supported.sort()).toEqual(['aurora', 'cloudfront', 'dynamodb', 'ebs', 'ec2', 'ecs', 'eks', 'lambda', 'load-balancer']);
  });

  it('claims no pricing basis and no at-risk policy for any type', () => {
    for (const capability of Object.values(capabilities)) {
      expect(capability.health.counts_toward_at_risk).toBeNull();
      expect(capability.pricing).toEqual({ state: 'not_evaluated', basis: null });
    }
  });

  it('describes every generic inventory type as Resource Explorer sourced, without listing them here', () => {
    expect(GENERIC_RESOURCE_TYPES.length).toBeGreaterThan(0);
    for (const type of GENERIC_RESOURCE_TYPES) {
      expect(capabilities[type].discovery).toEqual({ source: 'resource_explorer', region_scope: 'primary' });
    }
  });

  it('describes the dedicated-discovery types', () => {
    expect(capabilities.ec2.discovery).toEqual({ source: 'describe', region_scope: 'primary' });
    expect(capabilities.s3).toMatchObject({
      discovery: { source: 'describe', region_scope: 'per_resource' },
      tags: { collected: false },
    });
    expect(capabilities.cloudfront).toMatchObject({
      discovery: { source: 'describe', region_scope: 'global' },
      tags: { collected: false },
    });
  });

  it('lists a remediation action only for the type a rule covers', () => {
    const withActions = Object.entries(capabilities).filter(([, c]) => c.remediation.action_types.length > 0);
    expect(withActions.map(([type, c]) => [type, c.remediation.action_types])).toEqual([['ec2', ['stop_instance']]]);
  });

  it('a type outside the registry has no entry', () => {
    expect(capabilities['not-a-known-type']).toBeUndefined();
  });
});
