/**
 * Resource health as read from the Resource checks evaluator's rows: the pure
 * mapping (resource-health.ts), the cache read it depends on
 * (CloudWatchService.peekCachedMetrics), and how the composed Services
 * Intelligence response carries them. No database and no AWS; identifiers are
 * synthetic.
 *
 * The live-Postgres suite (routes/__tests__/services-intelligence.test.ts)
 * proves the same against a real evaluator sweep and two organizations.
 */
import { CloudWatchMetrics, CloudWatchService, CloudWatchServiceHealth } from '../cloudwatch.service';
import { ServicesIntelligenceRows } from '../../repositories/services-intelligence.repository';
import { countByState, resourceHealthFrom, RESOURCE_HEALTH_MAX_AGE_MS, supportedChecksForType } from '../resource-health';
import { composeServicesIntelligence, ServicesIntelligenceService } from '../services-intelligence.service';
import { servicesIntelligenceSchema } from './services-intelligence-contract';

const CAPTURED_AT = '2026-01-02T03:00:00.000Z';
const EVALUATION = { capturedAt: CAPTURED_AT };

type Type = CloudWatchServiceHealth['resourceType'];

function evaluated(type: Type, overrides: Partial<CloudWatchServiceHealth> = {}): CloudWatchServiceHealth {
  return {
    resourceId: `synthetic-${type}`,
    resourceDbId: '40000000-0000-4000-8000-000000000001',
    resourceSortName: null,
    name: `synthetic-${type}`,
    description: 'synthetic',
    resourceType: type,
    status: 'healthy',
    uptime: null,
    responseTimeMs: null,
    errorRate: null,
    critical: false,
    monitored: true,
    ...overrides,
  };
}

function subject(type: string, lifecycleState: string | null = 'available', metadataType: string | null = null) {
  return { type, lifecycleState, metadataType };
}

describe('state of one resource', () => {
  it('passing: the evaluator reported a passing result', () => {
    expect(resourceHealthFrom(subject('ebs'), EVALUATION, evaluated('ebs'))).toEqual({
      state: 'checks_passing',
      checks: [{ name: 'ebs_volume_status_check', result: 'passing', observed_at: CAPTURED_AT }],
      reasons: [],
      evaluated_at: CAPTURED_AT,
      source: 'resource_checks_cache',
    });
  });

  it.each(['degraded', 'critical'] as const)('failing: the evaluator reported %s', (status) => {
    expect(resourceHealthFrom(subject('ebs'), EVALUATION, evaluated('ebs', { status }))).toEqual({
      state: 'check_failing',
      checks: [{ name: 'ebs_volume_status_check', result: 'failing', observed_at: CAPTURED_AT }],
      reasons: [],
      evaluated_at: CAPTURED_AT,
      source: 'resource_checks_cache',
    });
  });

  it('no telemetry: a row the evaluator could not back with any signal is no_signal', () => {
    const health = resourceHealthFrom(subject('lambda', 'Active'), EVALUATION, evaluated('lambda', { status: 'unknown', monitored: false }));
    expect(health).toEqual({
      state: 'no_signal',
      checks: [{ name: 'lambda_error_rate_threshold', result: 'undetermined', observed_at: CAPTURED_AT }],
      reasons: [{ kind: 'no_telemetry' }],
      evaluated_at: CAPTURED_AT,
      source: 'resource_checks_cache',
    });
  });

  it('undetermined: an evaluated row with no verdict is no_signal, never passing', () => {
    const health = resourceHealthFrom(subject('ebs'), EVALUATION, evaluated('ebs', { status: 'unknown', monitored: true }));
    expect(health.state).toBe('no_signal');
    expect(health.reasons).toEqual([{ kind: 'undetermined' }]);
    expect(health.checks).toEqual([{ name: 'ebs_volume_status_check', result: 'undetermined', observed_at: CAPTURED_AT }]);
  });

  it('a status the mapping does not know is no_signal, never passing', () => {
    const health = resourceHealthFrom(subject('ebs'), EVALUATION, evaluated('ebs', { status: 'operational' as any }));
    expect(health.state).toBe('no_signal');
    expect(health.reasons).toEqual([{ kind: 'undetermined' }]);
  });

  it('a row claiming a passing status without telemetry is no_signal, never passing', () => {
    const health = resourceHealthFrom(subject('lambda', 'Active'), EVALUATION, evaluated('lambda', { status: 'healthy', monitored: false }));
    expect(health.state).toBe('no_signal');
    expect(health.reasons).toEqual([{ kind: 'no_telemetry' }]);
  });

  it('evaluation error: an evaluation with no row for the resource is no_signal', () => {
    expect(resourceHealthFrom(subject('ec2', 'running'), EVALUATION, undefined)).toEqual({
      state: 'no_signal',
      checks: [],
      reasons: [{ kind: 'evaluation_unavailable' }],
      evaluated_at: CAPTURED_AT,
      source: 'resource_checks_cache',
    });
  });

  it('cache miss: no evaluation at all is no_signal with no evaluation time', () => {
    expect(resourceHealthFrom(subject('ec2', 'running'), null, undefined)).toEqual({
      state: 'no_signal',
      checks: [],
      reasons: [{ kind: 'evaluation_unavailable' }],
      evaluated_at: null,
      source: null,
    });
  });

  it.each(['s3', 'sns', 'sqs', 'vpc', 'api-gateway', 'elasticache', 'rds', 'a-type-added-later'])(
    'unsupported type %s is not_supported, with or without an evaluation',
    (type) => {
      const expected = { state: 'not_supported', checks: [], reasons: [], evaluated_at: null, source: null };
      expect(resourceHealthFrom(subject(type), null, undefined)).toEqual(expected);
      expect(resourceHealthFrom(subject(type), EVALUATION, undefined)).toEqual(expected);
    }
  );

  it('rds is not_supported even though the evaluator returns an inventory-derived row for it', () => {
    const row = evaluated('rds', { status: 'healthy', monitored: false });
    expect(resourceHealthFrom(subject('rds'), EVALUATION, row).state).toBe('not_supported');
  });
});

describe('load balancers', () => {
  it('an application load balancer is checked', () => {
    const health = resourceHealthFrom(subject('load-balancer', 'active', 'application'), EVALUATION, evaluated('load-balancer'));
    expect(health.state).toBe('checks_passing');
    expect(health.checks[0].name).toBe('alb_response_time_threshold');
  });

  it.each(['network', 'gateway', null])('a %p load balancer is not_supported, not evaluation_unavailable', (kind) => {
    expect(resourceHealthFrom(subject('load-balancer', 'active', kind), EVALUATION, undefined)).toEqual({
      state: 'not_supported', checks: [], reasons: [], evaluated_at: null, source: null,
    });
    expect(resourceHealthFrom(subject('load-balancer', 'active', kind), null, undefined).state).toBe('not_supported');
  });
});

describe('EC2 check name', () => {
  it('is ec2_status_check when the status came from status checks (a numeric uptime)', () => {
    const health = resourceHealthFrom(subject('ec2', 'running'), EVALUATION, evaluated('ec2', { uptime: 100 }));
    expect(health.checks).toEqual([{ name: 'ec2_status_check', result: 'passing', observed_at: CAPTURED_AT }]);
  });

  it.each([
    ['healthy', 'checks_passing', 'passing'],
    ['degraded', 'check_failing', 'failing'],
  ] as const)('is ec2_cpu_threshold when the status came from the CPU fallback (%s, no uptime)', (status, state, result) => {
    const health = resourceHealthFrom(subject('ec2', 'running'), EVALUATION, evaluated('ec2', { status, uptime: null, monitored: true }));
    expect(health.state).toBe(state);
    expect(health.checks).toEqual([{ name: 'ec2_cpu_threshold', result, observed_at: CAPTURED_AT }]);
  });

  it('is the primary check when neither signal returned data', () => {
    const health = resourceHealthFrom(subject('ec2', 'running'), EVALUATION, evaluated('ec2', { status: 'unknown', uptime: null, monitored: false }));
    expect(health.checks).toEqual([{ name: 'ec2_status_check', result: 'undetermined', observed_at: CAPTURED_AT }]);
  });
});

describe("the evaluator's 'down' rows, decided by the recorded lifecycle state", () => {
  it.each<[Type, string | null]>([
    ['ec2', 'stopped'],
    ['ec2', 'stopping'],
    ['ec2', 'shutting-down'],
    ['ebs', 'deleting'],
    ['ebs', 'deleted'],
    ['lambda', 'Inactive'],
    ['cloudfront', 'disabled'],
    ['ecs', 'inactive'],
    ['aurora', 'stopped'],
    // The evaluator saw it down from live state the inventory row does not show.
    ['ecs', 'active'],
    ['aurora', null],
  ])('%s in lifecycle state %p is no_signal (not_running), not failing', (type, lifecycleState) => {
    const health = resourceHealthFrom(subject(type, lifecycleState), EVALUATION, evaluated(type, { status: 'down' }));
    expect(health.state).toBe('no_signal');
    expect(health.reasons).toEqual([{ kind: 'not_running' }]);
    expect(health.checks.map((c) => c.result)).toEqual(['undetermined']);
  });

  it.each<[Type, string]>([
    ['ebs', 'error'],
    ['lambda', 'Failed'],
    ['aurora', 'failed'],
  ])('%s in lifecycle state %p is check_failing', (type, lifecycleState) => {
    const health = resourceHealthFrom(subject(type, lifecycleState), EVALUATION, evaluated(type, { status: 'down' }));
    expect(health.state).toBe('check_failing');
    expect(health.reasons).toEqual([]);
    expect(health.checks.map((c) => c.result)).toEqual(['failing']);
  });

  it('a failed lifecycle state decides only a down row: the same state on a passing row stays passing', () => {
    expect(resourceHealthFrom(subject('lambda', 'Failed'), EVALUATION, evaluated('lambda')).state).toBe('checks_passing');
  });

  it("another type's failed state does not apply", () => {
    const health = resourceHealthFrom(subject('ec2', 'error'), EVALUATION, evaluated('ec2', { status: 'down' }));
    expect(health.state).toBe('no_signal');
  });
});

describe('in-progress operations follow the evaluator for now', () => {
  // The evaluator reports these as 'degraded' while describing them as not a
  // failure; they are not told apart here. Follow-up: structured reason codes.
  it.each<Type>(['eks', 'ecs', 'cloudfront', 'aurora'])('%s reported degraded is check_failing', (type) => {
    expect(resourceHealthFrom(subject(type, 'active'), EVALUATION, evaluated(type, { status: 'degraded' })).state).toBe('check_failing');
  });
});

describe('supported checks', () => {
  it('every type the evaluator lists has an entry: a check, or explicitly none', () => {
    const evaluatorTypes: Type[] = ['ec2', 'rds', 'load-balancer', 'lambda', 'dynamodb', 'ecs', 'eks', 'ebs', 'cloudfront', 'aurora'];
    for (const type of evaluatorTypes) {
      const supported = supportedChecksForType(type);
      if (type === 'rds') expect(supported).toBeNull();
      else expect(supported!.checks.length).toBeGreaterThan(0);
    }
  });

  it('an object-prototype key is not a type', () => {
    expect(supportedChecksForType('constructor')).toBeNull();
    expect(supportedChecksForType('toString')).toBeNull();
  });
});

describe('CloudWatchService.peekCachedMetrics', () => {
  const ORG = '10000000-0000-4000-8000-000000000001';
  const OTHER_ORG = '10000000-0000-4000-8000-000000000002';
  const fixture = { capturedAt: CAPTURED_AT, services: [] } as unknown as CloudWatchMetrics;

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('returns nothing, and computes nothing, when nothing is cached', () => {
    const compute = jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics');
    expect(new CloudWatchService().peekCachedMetrics(ORG, RESOURCE_HEALTH_MAX_AGE_MS)).toBeNull();
    expect(compute).not.toHaveBeenCalled();
  });

  it('serves an entry up to 15 minutes old, well past the 45s refresh window, and nothing older', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const service = new CloudWatchService();
    const compute = jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockResolvedValue(fixture);
    await service.getMetrics(ORG);

    jest.setSystemTime(new Date('2026-01-01T00:14:59.000Z'));
    expect(service.peekCachedMetrics(ORG, RESOURCE_HEALTH_MAX_AGE_MS)).toEqual({
      data: fixture,
      cachedAt: new Date('2026-01-01T00:00:00.000Z').getTime(),
    });

    jest.setSystemTime(new Date('2026-01-01T00:15:01.000Z'));
    expect(service.peekCachedMetrics(ORG, RESOURCE_HEALTH_MAX_AGE_MS)).toBeNull();
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("reads only the asking organization's entry, and only the default range", async () => {
    const service = new CloudWatchService();
    jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockResolvedValue(fixture);
    await service.getMetrics(ORG, '24h');
    expect(service.peekCachedMetrics(ORG, RESOURCE_HEALTH_MAX_AGE_MS)).toBeNull();

    await service.getMetrics(ORG);
    expect(service.peekCachedMetrics(ORG, RESOURCE_HEALTH_MAX_AGE_MS)!.data).toBe(fixture);
    expect(service.peekCachedMetrics(OTHER_ORG, RESOURCE_HEALTH_MAX_AGE_MS)).toBeNull();
  });

  it('does not join a computation that is still in flight', async () => {
    const service = new CloudWatchService();
    let finish!: (value: CloudWatchMetrics) => void;
    jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = service.getMetrics(ORG);
    expect(service.peekCachedMetrics(ORG, RESOURCE_HEALTH_MAX_AGE_MS)).toBeNull();
    finish(fixture);
    await pending;
    expect(service.peekCachedMetrics(ORG, RESOURCE_HEALTH_MAX_AGE_MS)!.data).toBe(fixture);
  });
});

// ─── The composed response ──────────────────────────────────────────────────

const ORG = '10000000-0000-4000-8000-000000000001';
const SERVICE = '20000000-0000-4000-8000-000000000001';
const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function resource(n: number, type: string, status: string | null, extra: { serviceId?: string | null; metadataType?: string | null } = {}) {
  return {
    id: id(n),
    resource_arn: `arn:aws:${type}:test-region-1:000000000000:synthetic/${n}`,
    resource_id: `synthetic-${type}-${n}`,
    resource_name: null,
    resource_type: type,
    region: 'test-region-1',
    status,
    metadata_type: extra.metadataType ?? null,
    compliance_issues: [],
    last_synced_at: null,
    service_id: extra.serviceId ?? null,
  };
}

function rows(resources: ServicesIntelligenceRows['resources']): ServicesIntelligenceRows {
  return {
    resources,
    services: [{ id: SERVICE, name: 'synthetic-service', description: null, owner: null, team_id: null, team_name: null }],
    recommendations: [],
    primaryRegion: null,
    hasConnectedAccount: false,
    lastDiscoveryJob: null,
    inventoryRefreshedAt: null,
  };
}

function evaluation(services: CloudWatchServiceHealth[]): CloudWatchMetrics {
  return { capturedAt: CAPTURED_AT, services } as unknown as CloudWatchMetrics;
}

const MIXED = rows([
  resource(1, 'ebs', 'available', { serviceId: SERVICE }),   // passing
  resource(2, 'ebs', 'available', { serviceId: SERVICE }),   // failing
  resource(3, 'ebs', 'available', { serviceId: SERVICE }),   // undetermined
  resource(4, 'ec2', 'stopped', { serviceId: SERVICE }),     // not running
  resource(5, 'ec2', 'running', { serviceId: SERVICE }),     // no row
  resource(6, 's3', 'active', { serviceId: SERVICE }),       // not supported
  resource(7, 'load-balancer', 'active', { serviceId: SERVICE, metadataType: 'network' }), // not supported
  resource(8, 'lambda', 'Active'),                            // unassigned, passing
]);
const MIXED_EVALUATION = evaluation([
  evaluated('ebs', { resourceDbId: id(1), status: 'healthy' }),
  evaluated('ebs', { resourceDbId: id(2), status: 'critical' }),
  evaluated('ebs', { resourceDbId: id(3), status: 'unknown' }),
  evaluated('ec2', { resourceDbId: id(4), status: 'down', monitored: false }),
  evaluated('lambda', { resourceDbId: id(8), status: 'healthy' }),
]);

function compose(evaluationOrNull: CloudWatchMetrics | null) {
  return composeServicesIntelligence(ORG, MIXED, new Date('2026-01-02T03:04:05.000Z'), evaluationOrNull);
}

describe('composed response', () => {
  it('carries each resource state and the freshness of the evaluation it was read from', () => {
    const data = compose(MIXED_EVALUATION);

    expect(data.health).toEqual({
      evaluated_at: CAPTURED_AT, source: 'resource_checks_cache', range: '1h', cache: 'hit', max_age_seconds: 900,
    });
    const states = Object.fromEntries(data.services[0].resources.items.map((r) => [r.id, [r.health.state, r.health.reasons.map((x) => x.kind)]]));
    expect(states).toEqual({
      [id(1)]: ['checks_passing', []],
      [id(2)]: ['check_failing', []],
      [id(3)]: ['no_signal', ['undetermined']],
      [id(4)]: ['no_signal', ['not_running']],
      [id(5)]: ['no_signal', ['evaluation_unavailable']],
      [id(6)]: ['not_supported', []],
      [id(7)]: ['not_supported', []],
    });
    expect(data.unassigned.resources[0].health).toEqual({
      state: 'checks_passing',
      group: null,
      reasons: [],
      signal: null,
      checks: [{ name: 'lambda_error_rate_threshold', result: 'passing', observed_at: CAPTURED_AT }],
      evaluated_at: CAPTURED_AT,
      source: 'resource_checks_cache',
    });
    expect(servicesIntelligenceSchema.safeParse(data).success).toBe(true);
  });

  it('a service carries counts by state and no verdict', () => {
    const service = compose(MIXED_EVALUATION).services[0];
    expect(service.health).toEqual({
      state: 'not_evaluated',
      resource_counts: { checks_passing: 1, check_failing: 1, no_signal: 3, not_supported: 2 },
    });
    expect(Object.keys(service.health).sort()).toEqual(['resource_counts', 'state']);
    const counted = Object.values(service.health.resource_counts).reduce((a, b) => a + b, 0);
    expect(counted).toBe(service.resources.count);
    // A failing resource does not turn into a statement about the service.
    expect(JSON.stringify(service.health)).not.toMatch(/verdict|rollup|overall/);
  });

  it('a cache miss: every checked type is no_signal with a reason, every other type not_supported', () => {
    const data = compose(null);
    expect(data.health).toEqual({ evaluated_at: null, source: null, range: '1h', cache: 'miss', max_age_seconds: 900 });
    const all = [...data.services[0].resources.items, ...data.unassigned.resources];
    for (const r of all) {
      const checked = ['ebs', 'ec2', 'lambda'].includes(r.type);
      expect(r.health).toEqual({
        state: checked ? 'no_signal' : 'not_supported',
        group: null,
        reasons: checked ? [{ kind: 'evaluation_unavailable' }] : [],
        signal: null,
        checks: [],
        evaluated_at: null,
        source: null,
      });
    }
    expect(data.services[0].health.resource_counts).toEqual({ checks_passing: 0, check_failing: 0, no_signal: 5, not_supported: 2 });
    expect(servicesIntelligenceSchema.safeParse(data).success).toBe(true);
  });

  it('an evaluation row for a resource that is not one of the organization\'s rows is never used', () => {
    const foreign = evaluated('ebs', { resourceDbId: id(999), status: 'critical', name: 'foreign-volume', resourceId: 'foreign-volume' });
    const data = compose(evaluation([...MIXED_EVALUATION.services, foreign]));
    expect(JSON.stringify(data)).not.toContain('foreign-volume');
    expect(JSON.stringify(data)).not.toContain(id(999));
    expect(data.services[0].health.resource_counts.check_failing).toBe(1);
  });

  it('rows are matched by the resource\'s own id, never by its AWS-side id or name', () => {
    const sameAwsId = evaluated('ebs', { resourceDbId: id(998), resourceId: 'synthetic-ebs-1', name: 'synthetic-ebs-1', status: 'critical' });
    const data = compose(evaluation([sameAwsId]));
    const first = data.services[0].resources.items.find((r) => r.id === id(1))!;
    expect(first.health.state).toBe('no_signal');
    expect(first.health.reasons).toEqual([{ kind: 'evaluation_unavailable' }]);
  });

  it('countByState counts each state once per resource', () => {
    expect(countByState(['checks_passing', 'no_signal', 'no_signal'])).toEqual({
      checks_passing: 1, check_failing: 0, no_signal: 2, not_supported: 0,
    });
  });
});

describe('wording', () => {
  const FORBIDDEN = /healthy|unhealthy|at[ _-]?risk|degraded/i;

  /** Every string VALUE under a `health` key, at any depth (keys are not values). */
  function healthValues(node: unknown, inHealth = false, out: string[] = []): string[] {
    if (typeof node === 'string') { if (inHealth) out.push(node); return out; }
    if (Array.isArray(node)) { node.forEach((n) => healthValues(n, inHealth, out)); return out; }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) healthValues(value, inHealth || key === 'health', out);
    }
    return out;
  }

  it.each([
    ['with an evaluation', () => compose(MIXED_EVALUATION)],
    ['on a cache miss', () => compose(null)],
  ])('no health value %s uses a forbidden word', (_label, build) => {
    const values = healthValues(build());
    expect(values.length).toBeGreaterThan(20);
    for (const value of values) expect(value).not.toMatch(FORBIDDEN);
  });

  it("the evaluator's own status words and free text never reach a health value", () => {
    const noisy = evaluation([
      evaluated('ebs', { resourceDbId: id(1), status: 'healthy', reason: 'Volume is healthy' }),
      evaluated('ebs', { resourceDbId: id(2), status: 'degraded', reason: 'Performance is degraded' }),
      evaluated('ebs', { resourceDbId: id(3), status: 'unknown', reason: 'Possibly unhealthy; at risk' }),
    ]);
    for (const value of healthValues(compose(noisy))) expect(value).not.toMatch(FORBIDDEN);
  });

  it('the check finds a forbidden word when one is there', () => {
    expect(healthValues({ a: { health: { state: 'healthy' } } })).toEqual(['healthy']);
    expect('at_risk').toMatch(FORBIDDEN);
  });
});

describe('ServicesIntelligenceService reads the cache and nothing else', () => {
  it('asks only for the caller organization\'s cached evaluation, with the 15 minute bound', async () => {
    const peekCachedMetrics = jest.fn().mockReturnValue({ data: MIXED_EVALUATION, cachedAt: 0 });
    const service = new ServicesIntelligenceService({ read: async () => MIXED } as any, { peekCachedMetrics });

    const data = await service.get(ORG);

    expect(peekCachedMetrics).toHaveBeenCalledTimes(1);
    expect(peekCachedMetrics).toHaveBeenCalledWith(ORG, 15 * 60 * 1000);
    expect(data.health.cache).toBe('hit');
  });

  it.each([
    ['nothing cached', null],
    ['a cached "no connected account" answer', { data: null, cachedAt: 0 }],
  ])('%s is a miss', async (_label, cached) => {
    const service = new ServicesIntelligenceService({ read: async () => MIXED } as any, { peekCachedMetrics: () => cached as any });
    const data = await service.get(ORG);
    expect(data.health).toMatchObject({ cache: 'miss', evaluated_at: null, source: null });
    expect(data.services[0].health.resource_counts).toEqual({ checks_passing: 0, check_failing: 0, no_signal: 5, not_supported: 2 });
  });
});
