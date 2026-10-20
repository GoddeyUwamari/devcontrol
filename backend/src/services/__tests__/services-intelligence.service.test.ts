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
import {
  CheckEvaluationRow,
  FrameworkEvaluationRows,
  FrameworkRunSummaryRow,
} from '../../repositories/framework-evaluations.repository';

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

/** The evaluation tables exist and hold nothing. */
const EMPTY_STORAGE = (): FrameworkEvaluationRows => ({ latestRuns: [], activity: [], checks: [], reconciliations: [] });

function rows(overrides: Partial<ServicesIntelligenceRows> = {}): ServicesIntelligenceRows {
  return {
    frameworkEvaluations: EMPTY_STORAGE(),
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
          framework: null,
          applicability: null,
          evaluation_state: null,
          evidence_basis: null,
          evaluation_reason: null,
          current: true,
          not_current_reason: null,
          remediation: {
            available: true,
            path: 'cost_recommendation_execute',
            action_type: 'stop_instance',
            recommendation_id: IDLE_REC,
            requires: { role: 'admin', plan: 'enterprise' },
          },
        },
      ],
      check_evaluations: [],
      framework_reconciliation: null,
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
          framework: null,
          applicability: null,
          evaluation_state: null,
          evidence_basis: null,
          evaluation_reason: null,
          // Carried forward unverified: listed, and not a current finding.
          current: false,
          not_current_reason: 'not_reverified',
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
          framework: null,
          applicability: null,
          evaluation_state: null,
          evidence_basis: null,
          evaluation_reason: null,
          current: true,
          not_current_reason: null,
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
          framework: null,
          applicability: null,
          evaluation_state: null,
          evidence_basis: null,
          evaluation_reason: null,
          current: true,
          not_current_reason: null,
          remediation: null,
        },
      ],
      check_evaluations: [],
      framework_reconciliation: null,
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
      // The tables exist and no run has ever finished: nothing is claimed about HIPAA.
      framework_evaluation: {
        storage: 'available',
        frameworks: [
          {
            framework: 'HIPAA',
            applicability: null,
            applicability_reason_code: null,
            applicability_reason: null,
            latest_run: null,
            running: false,
            last_attempt_failed: false,
            stale: true,
            stale_reason: 'no_run',
            counts: { failed: 0, passed: 0, unable_to_evaluate: 0, error: 0, not_evaluated: 0, not_applicable: 0, stale: 0 },
            reconciliation_required: 0,
          },
          {
            framework: 'SOC2',
            applicability: null,
            applicability_reason_code: null,
            applicability_reason: null,
            latest_run: null,
            running: false,
            last_attempt_failed: false,
            stale: true,
            stale_reason: 'no_run',
            counts: { failed: 0, passed: 0, unable_to_evaluate: 0, error: 0, not_evaluated: 0, not_applicable: 0, stale: 0 },
            reconciliation_required: 0,
          },
        ],
      },
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
    ['a missing evaluation state field', (b) => { delete b.unassigned.resources[0].findings[0].evaluation_state; }],
    ['a missing applicability field', (b) => { delete b.unassigned.resources[0].findings[0].applicability; }],
    ['a missing current flag', (b) => { delete b.unassigned.resources[0].findings[0].current; }],
    ['an unknown evaluation state', (b) => { b.unassigned.resources[0].findings[0].evaluation_state = 'pass'; }],
    ['an unknown applicability', (b) => { b.unassigned.resources[0].findings[0].applicability = 'on'; }],
    ['a severity standing in for an evaluation state', (b) => { b.unassigned.resources[0].findings[0].evaluation_state = 'critical'; }],
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

  // What is recorded on the entry is passed through as recorded. Whether the entry
  // is a CURRENT finding is decided from the stored evaluations: see the
  // "framework evaluations" tests below.
  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    [
      'a baseline finding',
      { severity: 'high', category: 'encryption', issue: 'S3 bucket does not enforce HTTPS-only access', provenance: 'OBSERVED' },
      { framework: null, applicability: null, evaluation_state: null, evidence_basis: null, evaluation_reason: null, severity: 'high', current: true, not_current_reason: null },
    ],
    [
      // Was `current: true` ("S3 convention, unchanged").
      'a baseline finding carried forward unverified, as stored before it recorded a state',
      { severity: 'critical', category: 'public_access', issue: 'S3 bucket policy allows public access', verification: 'unverified', findingKey: 's3.public_access.policy' },
      { framework: null, verification: 'unverified', evaluation_state: null, severity: 'critical', current: false, not_current_reason: 'not_reverified' },
    ],
    [
      'a baseline finding carried forward because the bucket could not be read',
      {
        severity: 'critical', category: 'public_access', issue: 'S3 bucket policy allows public access', verification: 'unverified', findingKey: 's3.public_access.policy',
        evaluation_state: 'unable_to_evaluate', evidence_basis: 'none', evaluation_reason: 'The configuration this check reads could not be read on the latest scan; this finding is from an earlier scan and was not re-verified',
      },
      {
        framework: null, verification: 'unverified', evaluation_state: 'unable_to_evaluate', evidence_basis: 'none',
        evaluation_reason: 'The configuration this check reads could not be read on the latest scan; this finding is from an earlier scan and was not re-verified',
        current: false, not_current_reason: 'not_reverified',
      },
    ],
    [
      'a baseline finding carried forward because its evaluation threw',
      { severity: 'high', category: 'encryption', issue: 'S3 bucket does not enforce HTTPS-only access', verification: 'unverified', findingKey: 's3.https_only', evaluation_state: 'error', evidence_basis: 'none' },
      { framework: null, verification: 'unverified', evaluation_state: 'error', evidence_basis: 'none', current: false, not_current_reason: 'not_reverified' },
    ],
    [
      'a SOC 2 tag signal written before frameworks had to be enabled',
      { severity: 'high', category: 'tagging', issue: 'Tagging: IAM role/owner not documented', provenance: 'SELF_ATTESTED' },
      { framework: null, applicability: null, evaluation_state: null, severity: 'high', current: false, not_current_reason: 'legacy_unattributed' },
    ],
    [
      'a HIPAA entry written before frameworks had to be enabled',
      { severity: 'critical', category: 'networking', issue: 'HIPAA: S3 lacks required access logging for audit trails' },
      { framework: null, applicability: null, evaluation_state: null, severity: 'critical', current: false, not_current_reason: 'legacy_unattributed' },
    ],
    [
      'a framework entry whose recorded state is not failed',
      { severity: 'critical', issue: 'x', framework: 'HIPAA', findingKey: 'hipaa.automated_backups', applicability: 'unavailable', evaluation_state: 'not_evaluated' },
      { framework: 'HIPAA', applicability: 'unavailable', evaluation_state: 'not_evaluated', severity: 'critical', current: false, not_current_reason: 'not_current_state' },
    ],
    [
      'recorded values nobody knows',
      { severity: 'high', issue: 'x', framework: 'HIPAA', applicability: 'on', evaluation_state: 'pass', evidence_basis: 'vibes', evaluation_reason: 7 },
      { framework: 'HIPAA', applicability: null, evaluation_state: null, evidence_basis: null, evaluation_reason: null, severity: 'high', current: false, not_current_reason: 'not_current_state' },
    ],
  ])('reports %s as recorded', (_name, entry, expected) => {
    const [finding] = findingsFor([entry]);
    expect(finding).toMatchObject(expected);
    expect(servicesIntelligenceSchema.safeParse(compose({ resources: [{ ...rows().resources[0], compliance_issues: [entry] }], recommendations: [] })).success).toBe(true);
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

  it('says S3 tags are collected (each bucket\'s tags are read in its own region) and CloudFront\'s are not', () => {
    expect(capabilities.s3.tags).toEqual({ collected: true });
    expect(capabilities.cloudfront.tags).toEqual({ collected: false });
    for (const type of ['ec2', 'ebs', 'rds', 'lambda', 'load-balancer', ...GENERIC_RESOURCE_TYPES]) {
      expect([type, capabilities[type].tags]).toEqual([type, { collected: true }]);
    }
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
      tags: { collected: true },
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


// ─── framework evaluations ──────────────────────────────────────────────────

describe('framework evaluations', () => {
  const EVALUATED_AT = new Date('2026-01-01T06:00:00.000Z');
  const BACKUPS = 'hipaa.automated_backups';
  const VOLUME = '90000000-0000-4000-8000-000000000001';
  const OTHER_VOLUME = '90000000-0000-4000-8000-000000000002';

  /** An EBS volume: the one type with a check that can pass or fail. */
  const volume = (id: string, complianceIssues: unknown[] = []) => ({
    ...rows().resources[0], id, resource_type: 'ebs', resource_id: `vol-${id.slice(-1)}`, resource_arn: `arn:aws:ec2:r:000000000000:volume/vol-${id.slice(-1)}`,
    compliance_issues: complianceIssues, service_id: null,
  });

  const run = (overrides: Partial<FrameworkRunSummaryRow> = {}): FrameworkRunSummaryRow => ({
    framework: 'HIPAA', applicability: 'enabled', applicability_reason_code: 'explicitly_enabled', status: 'complete',
    started_at: new Date('2026-01-01T05:59:00.000Z'), finished_at: EVALUATED_AT, evaluator_version: '1', aged: false, ...overrides,
  });

  const check = (overrides: Partial<CheckEvaluationRow> = {}): CheckEvaluationRow => ({
    resource_id: VOLUME, framework: 'HIPAA', check: BACKUPS, evaluation_state: 'failed', severity: 'critical',
    evidence_basis: 'aws_api', provenance: 'OBSERVED', reason_code: 'no_backup_reported', error_code: null,
    evaluated_at: EVALUATED_AT, last_conclusive_state: 'failed', last_conclusive_at: EVALUATED_AT, last_conclusive_severity: 'critical',
    stale: false, ...overrides,
  });

  const FINDING = {
    severity: 'critical', category: 'backups', issue: 'HIPAA: EBS storing PHI must have automated backups', recommendation: 'r',
    findingKey: BACKUPS, framework: 'HIPAA', applicability: 'enabled', evaluation_state: 'failed', evidence_basis: 'aws_api',
    evaluation_reason: 'AWS Backup reports no backup for this resource',
  };

  function body(storage: Partial<FrameworkEvaluationRows> | null, resources = [volume(VOLUME, [FINDING])]) {
    const composed = compose({
      resources, services: [], recommendations: [],
      frameworkEvaluations: storage === null ? null : { ...EMPTY_STORAGE(), ...storage },
    });
    // Everything these tests produce must satisfy the strict contract.
    const parsed = servicesIntelligenceSchema.safeParse(composed);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
    return composed;
  }
  const hipaa = (b: ReturnType<typeof body>) => b.framework_evaluation.frameworks.find((f) => f.framework === 'HIPAA')!;
  const resource = (b: ReturnType<typeof body>, id = VOLUME) => b.unassigned.resources.find((r) => r.id === id)!;
  const frameworkFinding = (b: ReturnType<typeof body>, id = VOLUME) => resource(b, id).findings.find((f) => f.framework === 'HIPAA')!;
  const evaluation = (b: ReturnType<typeof body>, key = BACKUPS, id = VOLUME) => resource(b, id).check_evaluations.find((c) => c.check === key)!;

  it('a failed check in the latest complete run: a current finding, backed by its evaluation', () => {
    const b = body({ latestRuns: [run()], checks: [check()] });

    expect(hipaa(b)).toEqual({
      framework: 'HIPAA',
      applicability: 'enabled',
      applicability_reason_code: 'explicitly_enabled',
      applicability_reason: 'Framework is explicitly enabled for this organization',
      latest_run: { status: 'complete', started_at: '2026-01-01T05:59:00.000Z', finished_at: '2026-01-01T06:00:00.000Z', evaluator_version: '1' },
      running: false,
      last_attempt_failed: false,
      stale: false,
      stale_reason: null,
      counts: { failed: 1, passed: 0, unable_to_evaluate: 0, error: 0, not_evaluated: 0, not_applicable: 0, stale: 0 },
      reconciliation_required: 0,
    });
    expect(evaluation(b)).toEqual({
      source: { kind: 'framework', key: 'HIPAA' },
      check: BACKUPS,
      evaluation_state: 'failed',
      severity: 'critical',
      evidence_basis: 'aws_api',
      provenance: 'OBSERVED',
      reason_code: 'no_backup_reported',
      reason: 'AWS Backup reports no backup for this resource',
      error_code: null,
      evaluated_at: '2026-01-01T06:00:00.000Z',
      recorded: true,
      stale: false,
      last_conclusive: null,
    });
    expect(frameworkFinding(b)).toMatchObject({ severity: 'critical', current: true, not_current_reason: null });
  });

  // Each non-failure state is an evaluation and never a finding; severity stays null.
  it.each<[string, Partial<CheckEvaluationRow>, Record<string, unknown>]>([
    ['passed', { evaluation_state: 'passed', severity: null, reason_code: 'backup_reported', last_conclusive_state: 'passed', last_conclusive_severity: null },
      { evaluation_state: 'passed', severity: null, evidence_basis: 'aws_api', last_conclusive: null }],
    ['unable_to_evaluate, after an earlier failure', { evaluation_state: 'unable_to_evaluate', severity: null, evidence_basis: 'none', provenance: null, reason_code: 'backup_state_unknown' },
      { evaluation_state: 'unable_to_evaluate', severity: null, reason: 'Backup state of this resource is unknown', last_conclusive: { state: 'failed', at: '2026-01-01T06:00:00.000Z', severity: 'critical' } }],
    ['error, after an earlier failure', { evaluation_state: 'error', severity: null, evidence_basis: 'none', provenance: null, reason_code: 'check_exception', error_code: 'check_exception' },
      { evaluation_state: 'error', severity: null, error_code: 'check_exception', reason: 'Check could not be completed', last_conclusive: { state: 'failed', at: '2026-01-01T06:00:00.000Z', severity: 'critical' } }],
    ['not_applicable, after an earlier pass', { evaluation_state: 'not_applicable', severity: null, evidence_basis: 'none', provenance: null, reason_code: 'check_not_applicable_to_resource', last_conclusive_state: 'passed', last_conclusive_severity: null },
      { evaluation_state: 'not_applicable', severity: null, reason: 'Check does not apply to this resource', last_conclusive: { state: 'passed', at: '2026-01-01T06:00:00.000Z', severity: null } }],
  ])('%s: reported as an evaluation, never as a finding', (_name, row, expected) => {
    const b = body({ latestRuns: [run()], checks: [check(row)] }, [volume(VOLUME, [])]);
    expect(evaluation(b)).toMatchObject({ recorded: true, stale: false, ...expected });
    expect(resource(b).findings).toEqual([]);
    expect(hipaa(b).counts.failed).toBe(0);
  });

  it('a stored severity on a row that is not a failure is not reported', () => {
    const b = body({ latestRuns: [run()], checks: [check({ evaluation_state: 'unable_to_evaluate', severity: 'critical', evidence_basis: 'none', provenance: null, reason_code: 'backup_state_unknown' })] }, [volume(VOLUME, [])]);
    expect(evaluation(b).severity).toBeNull();
  });

  it('no run has ever finished: nothing is claimed about the framework, and a framework finding left in the snapshot is not current', () => {
    const b = body({});
    expect(hipaa(b)).toMatchObject({ applicability: null, applicability_reason: null, latest_run: null, running: false, stale: true, stale_reason: 'no_run' });
    expect(resource(b).check_evaluations).toEqual([]);
    expect(frameworkFinding(b)).toMatchObject({ current: false, not_current_reason: 'no_evaluation_record' });
  });

  it('a first scan is running: flagged as running, still nothing claimed until it finishes', () => {
    const b = body({ activity: [{ framework: 'HIPAA', running: true, last_attempt_failed: false }], checks: [check({ stale: true })] });
    expect(hipaa(b)).toMatchObject({ running: true, latest_run: null, applicability: null, stale: true, stale_reason: 'no_run', counts: expect.objectContaining({ failed: 1, stale: 1 }) });
    expect(frameworkFinding(b)).toMatchObject({ current: false, not_current_reason: 'stale_evaluation' });
  });

  it('a later scan is running: the latest finished run still describes the framework', () => {
    const b = body({ latestRuns: [run()], activity: [{ framework: 'HIPAA', running: true, last_attempt_failed: false }], checks: [check()] });
    expect(hipaa(b)).toMatchObject({ running: true, applicability: 'enabled', stale: false, latest_run: expect.objectContaining({ status: 'complete' }) });
    expect(frameworkFinding(b).current).toBe(true);
  });

  it('the latest run is partial: the resource it stored is current, the one it could not store is stale and flagged for reconciliation', () => {
    const b = body(
      {
        latestRuns: [run({ status: 'partial' })],
        checks: [check(), check({ resource_id: OTHER_VOLUME, stale: true })],
        reconciliations: [{ resource_id: OTHER_VOLUME, first_failed_at: new Date('2026-01-01T00:00:00.000Z'), last_failed_at: EVALUATED_AT, failure_count: 3, failure_code: 'persist_error' }],
      },
      [volume(VOLUME, [FINDING]), volume(OTHER_VOLUME, [FINDING])]
    );

    expect(hipaa(b)).toMatchObject({
      latest_run: expect.objectContaining({ status: 'partial' }), stale: false,
      counts: { failed: 2, passed: 0, unable_to_evaluate: 0, error: 0, not_evaluated: 0, not_applicable: 0, stale: 1 },
      reconciliation_required: 1,
    });
    expect(frameworkFinding(b)).toMatchObject({ current: true, not_current_reason: null });
    expect(resource(b).framework_reconciliation).toBeNull();

    // The preserved finding is still listed -- it is what was last verified -- and says it is not current.
    expect(frameworkFinding(b, OTHER_VOLUME)).toMatchObject({ severity: 'critical', current: false, not_current_reason: 'stale_evaluation' });
    expect(evaluation(b, BACKUPS, OTHER_VOLUME)).toMatchObject({ evaluation_state: 'failed', recorded: true, stale: true });
    expect(resource(b, OTHER_VOLUME).framework_reconciliation).toEqual({
      required: true, since: '2026-01-01T00:00:00.000Z', last_attempt_at: '2026-01-01T06:00:00.000Z', attempts: 3, reason_code: 'persist_error',
    });
  });

  it('a check with no stored evaluation is not_evaluated and never stale -- including after a partial run', () => {
    const b = body({ latestRuns: [run({ status: 'partial' })], checks: [] }, [volume(VOLUME, [])]);

    const applicable = ['hipaa.automated_backups', 'hipaa.backup_retention_policy', 'hipaa.customer_managed_key'];
    expect(resource(b).check_evaluations.map((c) => c.check)).toEqual(applicable);
    for (const entry of resource(b).check_evaluations) {
      expect(entry).toEqual({
        source: { kind: 'framework', key: 'HIPAA' }, check: entry.check, evaluation_state: 'not_evaluated', severity: null,
        evidence_basis: null, provenance: null, reason_code: 'no_evaluation_recorded',
        reason: 'No evaluation of this check has been recorded for this resource', error_code: null, evaluated_at: null,
        recorded: false, stale: false, last_conclusive: null,
      });
    }
    // Unrecorded entries are not stored rows: they are in no count.
    expect(hipaa(b).counts).toEqual({ failed: 0, passed: 0, unable_to_evaluate: 0, error: 0, not_evaluated: 0, not_applicable: 0, stale: 0 });
  });

  it('lists an unrecorded check only where the check applies and the framework was evaluated', () => {
    const vpc = { ...volume(OTHER_VOLUME), resource_type: 'vpc' };
    const enabled = body({ latestRuns: [run()] }, [volume(VOLUME, []), vpc]);
    expect(resource(enabled, OTHER_VOLUME).check_evaluations).toEqual([]);
    expect(resource(enabled).check_evaluations).toHaveLength(3);

    for (const applicability of ['disabled', 'not_configured', 'unavailable', 'invalid'] as const) {
      const b = body({ latestRuns: [run({ applicability, applicability_reason_code: 'no_setting' })] }, [volume(VOLUME, [])]);
      expect(resource(b).check_evaluations).toEqual([]);
    }
  });

  it('the most recent attempt failed: the latest finished run still stands, and the failure is flagged', () => {
    const b = body({ latestRuns: [run()], activity: [{ framework: 'HIPAA', running: false, last_attempt_failed: true }], checks: [check()] });
    expect(hipaa(b)).toMatchObject({ last_attempt_failed: true, applicability: 'enabled', latest_run: expect.objectContaining({ status: 'complete' }), stale: false });
    expect(frameworkFinding(b).current).toBe(true);
  });

  it('the latest finished run is too old: the framework is stale, and says why', () => {
    const b = body({ latestRuns: [run({ aged: true })], checks: [check()] });
    expect(hipaa(b)).toMatchObject({ stale: true, stale_reason: 'run_too_old', applicability: 'enabled' });
  });

  it.each([
    ['unavailable', 'settings_unavailable', 'Framework settings could not be read'],
    ['invalid', 'invalid_enabled_value', 'Framework setting has no usable enabled/disabled value'],
    ['invalid', 'conflicting_settings', 'Framework has conflicting settings: both enabled and disabled'],
    ['disabled', 'explicitly_disabled', 'Framework is explicitly disabled for this organization'],
    ['not_configured', 'no_setting', 'No setting is recorded for this framework; a framework is evaluated only when explicitly enabled'],
  ] as const)('settings %s (%s): the framework says so, the check is not_evaluated with that reason, and the last conclusive failure is still shown', (applicability, code, text) => {
    const b = body(
      { latestRuns: [run({ applicability, applicability_reason_code: code })], checks: [check({ evaluation_state: 'not_evaluated', severity: null, evidence_basis: 'none', provenance: null, reason_code: code })] },
      [volume(VOLUME, [])]
    );
    expect(hipaa(b)).toMatchObject({ applicability, applicability_reason_code: code, applicability_reason: text, stale: false });
    expect(evaluation(b)).toMatchObject({
      evaluation_state: 'not_evaluated', severity: null, reason_code: code, reason: text, recorded: true, stale: false,
      last_conclusive: { state: 'failed', at: '2026-01-01T06:00:00.000Z', severity: 'critical' },
    });
    expect(resource(b).findings).toEqual([]);
  });

  it('storage unavailable: nothing is claimed about any framework, and a framework finding in the snapshot is listed as preserved, not current', () => {
    const baseline = { severity: 'high', category: 'encryption', issue: 'EC2 instance has unencrypted EBS volumes', recommendation: 'r', provenance: 'OBSERVED' };
    const b = body(null, [volume(VOLUME, [baseline, FINDING])]);

    expect(b.framework_evaluation).toEqual({ storage: 'unavailable', frameworks: [] });
    expect(resource(b).check_evaluations).toEqual([]);
    expect(resource(b).framework_reconciliation).toBeNull();
    expect(resource(b).findings.map((f) => [f.framework, f.current, f.not_current_reason])).toEqual([
      [null, true, null],
      ['HIPAA', false, 'storage_unavailable'],
    ]);
  });

  it('a framework finding whose stored evaluation is no longer a failure is not current', () => {
    const b = body({ latestRuns: [run()], checks: [check({ evaluation_state: 'passed', severity: null, reason_code: 'backup_reported', last_conclusive_state: 'passed', last_conclusive_severity: null })] });
    expect(frameworkFinding(b)).toMatchObject({ current: false, not_current_reason: 'not_current_state' });
  });

  it('counts only stored evaluations of resources in the response, and reports frameworks that have runs even when unregistered', () => {
    const b = body({
      latestRuns: [run(), run({ framework: 'RETIRED-FW', applicability: 'disabled', applicability_reason_code: 'explicitly_disabled' })],
      checks: [check(), check({ resource_id: '90000000-0000-4000-8000-000000000009' })],
      reconciliations: [{ resource_id: '90000000-0000-4000-8000-000000000009', first_failed_at: EVALUATED_AT, last_failed_at: EVALUATED_AT, failure_count: 1, failure_code: 'persist_error' }],
    });
    expect(b.framework_evaluation.frameworks.map((f) => f.framework)).toEqual(['HIPAA', 'RETIRED-FW', 'SOC2']);
    expect(hipaa(b).counts.failed).toBe(1);
    expect(hipaa(b).reconciliation_required).toBe(0);
  });

  it('exposes no run generation and no raw reason other than the fixed wording', () => {
    const b = body({ latestRuns: [run()], checks: [check({ reason_code: 'something_nobody_defined' })] });
    expect(JSON.stringify(b)).not.toMatch(/generation/i);
    expect(evaluation(b)).toMatchObject({ reason_code: 'something_nobody_defined', reason: 'No further detail is recorded' });
  });
});

describe('the strict contract rejects what the framework evaluation rules forbid', () => {
  const EVALUATED_AT = new Date('2026-01-01T06:00:00.000Z');
  const valid = () => {
    const [first] = rows().resources;
    return compose({
      resources: [{
        ...first, resource_type: 'ebs', service_id: null,
        compliance_issues: [{ severity: 'critical', category: 'backups', issue: 'HIPAA: EBS storing PHI must have automated backups', findingKey: 'hipaa.automated_backups', framework: 'HIPAA', applicability: 'enabled', evaluation_state: 'failed', evidence_basis: 'aws_api' }],
      }],
      services: [], recommendations: [],
      frameworkEvaluations: {
        latestRuns: [{ framework: 'HIPAA', applicability: 'enabled', applicability_reason_code: 'explicitly_enabled', status: 'complete', started_at: EVALUATED_AT, finished_at: EVALUATED_AT, evaluator_version: '1', aged: false }],
        activity: [],
        checks: [{
          resource_id: first.id, framework: 'HIPAA', check: 'hipaa.automated_backups', evaluation_state: 'failed', severity: 'critical', evidence_basis: 'aws_api',
          provenance: 'OBSERVED', reason_code: 'no_backup_reported', error_code: null, evaluated_at: EVALUATED_AT,
          last_conclusive_state: 'failed', last_conclusive_at: EVALUATED_AT, last_conclusive_severity: 'critical', stale: false,
        }],
        reconciliations: [{ resource_id: first.id, first_failed_at: EVALUATED_AT, last_failed_at: EVALUATED_AT, failure_count: 1, failure_code: 'persist_error' }],
      },
    });
  };
  const failed = (b: any) => b.unassigned.resources[0].check_evaluations.find((c: any) => c.check === 'hipaa.automated_backups');
  const unrecorded = (b: any) => b.unassigned.resources[0].check_evaluations.find((c: any) => !c.recorded);
  const framework = (b: any) => b.framework_evaluation.frameworks[0];
  const finding = (b: any) => b.unassigned.resources[0].findings[0];

  it('accepts the valid body', () => {
    expect(servicesIntelligenceSchema.safeParse(valid()).success).toBe(true);
    expect(unrecorded(valid())).toBeDefined();
  });

  it.each<[string, (body: any) => void]>([
    ['a missing framework_evaluation block', (b) => { delete b.framework_evaluation; }],
    ['a missing check_evaluations list', (b) => { delete b.unassigned.resources[0].check_evaluations; }],
    ['a missing framework_reconciliation field', (b) => { delete b.unassigned.resources[0].framework_reconciliation; }],
    ['a missing not_current_reason', (b) => { delete finding(b).not_current_reason; }],
    ['an unknown storage state', (b) => { b.framework_evaluation.storage = 'degraded'; }],
    ['frameworks described while storage is unavailable', (b) => { b.framework_evaluation.storage = 'unavailable'; }],
    ['an unknown evaluation state', (b) => { failed(b).evaluation_state = 'unknown'; }],
    ['an unknown applicability', (b) => { framework(b).applicability = 'on'; }],
    ['an unknown run status', (b) => { framework(b).latest_run.status = 'failed'; }],
    ['a failure with no severity', (b) => { failed(b).severity = null; }],
    ['a severity on unable_to_evaluate', (b) => { failed(b).evaluation_state = 'unable_to_evaluate'; }],
    ['a severity on an error', (b) => { failed(b).evaluation_state = 'error'; failed(b).error_code = 'check_exception'; }],
    ['a severity on a pass', (b) => { failed(b).evaluation_state = 'passed'; }],
    ['a severity on not_applicable', (b) => { failed(b).evaluation_state = 'not_applicable'; }],
    ['an unknown severity', (b) => { failed(b).severity = 'severe'; }],
    ['a failure resting on a tag', (b) => { failed(b).evidence_basis = 'tag'; }],
    ['a failure resting on nothing', (b) => { failed(b).evidence_basis = 'none'; }],
    ['a failure with self-attested provenance', (b) => { failed(b).provenance = 'SELF_ATTESTED'; }],
    ['a failure with no provenance', (b) => { failed(b).provenance = null; }],
    ['an unknown provenance', (b) => { failed(b).provenance = 'GUESSED'; }],
    ['an error with no code', (b) => { failed(b).evaluation_state = 'error'; failed(b).severity = null; }],
    ['an error code on a failure', (b) => { failed(b).error_code = 'check_exception'; }],
    ['error text where a code belongs', (b) => { failed(b).reason_code = 'AccessDenied: arn:aws:iam::1:role/x'; }],
    ['a recorded evaluation with no time', (b) => { failed(b).evaluated_at = null; }],
    ['an unrecorded check that is stale', (b) => { unrecorded(b).stale = true; }],
    ['an unrecorded check with a time', (b) => { unrecorded(b).evaluated_at = '2026-01-01T06:00:00.000Z'; }],
    ['an unrecorded check in a state other than not_evaluated', (b) => { unrecorded(b).evaluation_state = 'passed'; unrecorded(b).evidence_basis = 'aws_api'; unrecorded(b).provenance = 'OBSERVED'; }],
    ['a run generation on a check', (b) => { failed(b).run_generation = 12; }],
    ['a run generation on a framework', (b) => { framework(b).latest_run.generation = 12; }],
    ['an organization id on a framework', (b) => { framework(b).organization_id = b.organization_id; }],
    ['a stale framework with no reason', (b) => { framework(b).stale = true; }],
    ['an applicability with no finished run', (b) => { framework(b).latest_run = null; }],
    ['a negative count', (b) => { framework(b).counts.failed = -1; }],
    ['a missing not_applicable count', (b) => { delete framework(b).counts.not_applicable; }],
    ['a current finding with a reason it is not', (b) => { finding(b).not_current_reason = 'stale_evaluation'; }],
    ['a finding that is not current with no reason', (b) => { finding(b).current = false; }],
    ['a current framework finding whose evaluation is stale', (b) => { failed(b).stale = true; }],
    ['a current framework finding whose evaluation passed', (b) => { failed(b).evaluation_state = 'passed'; failed(b).severity = null; }],
    ['a current framework finding with no evaluation', (b) => { b.unassigned.resources[0].check_evaluations = []; }],
    ['a reconciliation with zero attempts', (b) => { b.unassigned.resources[0].framework_reconciliation.attempts = 0; }],
    ['a reconciliation with free text', (b) => { b.unassigned.resources[0].framework_reconciliation.reason_code = 'relation does not exist'; }],
  ])('rejects %s', (_name, corrupt) => {
    const b = JSON.parse(JSON.stringify(valid()));
    corrupt(b);
    expect(servicesIntelligenceSchema.safeParse(b).success).toBe(false);
  });
});
