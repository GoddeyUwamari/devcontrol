/**
 * Ask AI guardrails (nl-query-guard.ts): which questions are answered with an
 * explicit limitation before parsing, and which parsed intents may execute.
 * Pure functions -- no DB, no model.
 */
import {
  classifyUnsupportedQuestion,
  COST_PERIOD_NOT_SUPPORTED,
  describeIntent,
  detectPeriod,
  fullyRecognized,
  GENERIC_NOT_SUPPORTED,
  reconcileWithQuery,
  statedCostBounds,
  validateIntent,
} from '../nl-query-guard';
import type { NLQueryIntent } from '../nl-query.service';

const intent = (target: string, filters?: Record<string, unknown>, action = 'filter', extra: Record<string, unknown> = {}): NLQueryIntent =>
  ({ target, action, filters, explanation: 'model text', confidence: 'high', period: 'none', ...extra } as unknown as NLQueryIntent);

describe('classifyUnsupportedQuestion', () => {
  it.each([
    ['Why is EC2 cost high?', 'causal'],
    ["What's driving our AWS bill?", 'causal'],
    ['Compare this month with last month', 'comparison'],
    ['Compare vs last month', 'comparison'],
    ['Show spending trends', 'comparison'],
    ['Is spend higher than last month?', 'comparison'],
    ['Forecast next month spend', 'forecast'],
    ['How much will we spend by end of the month?', 'forecast'],
    ['What can I optimize today?', 'optimization'],
    ['Show biggest waste', 'optimization'],
    ['How can I save money?', 'optimization'],
    ['Should I buy Reserved Instances?', 'optimization'],
    ['Which Savings Plans should I purchase?', 'optimization'],
    ['Which EC2 instances can I rightsize today?', 'utilization'],
    ['Show underutilized instances', 'utilization'],
    ['Find idle resources', 'utilization'],
    ['Which instances have high CPU utilization?', 'utilization'],
  ])('"%s" is not supported (%s)', (question, kind) => {
    const result = classifyUnsupportedQuestion(question);
    expect(result?.kind).toBe(kind);
    expect(result?.message).not.toMatch(/you can save|\$\d|20[–-]40%/i);
  });

  it('never estimates savings or waste in its limitation messages', () => {
    for (const q of ['What can I optimize today?', 'Show biggest waste', 'Which EC2 instances can I rightsize today?']) {
      const msg = classifyUnsupportedQuestion(q)!.message;
      expect(msg).not.toMatch(/\d+%|\$\d/);
      expect(msg).toMatch(/doesn't have/);
    }
  });

  it.each([
    'What is my AWS spend this month?',
    'Show running EC2 instances',
    'Unencrypted S3 buckets',
    'Failed production deployments',
    'ec2 instances in us-east-1 over $200',
    'show services',
    'deployments from the last 30 days',
  ])('"%s" is a supported question', question => {
    expect(classifyUnsupportedQuestion(question)).toBeNull();
  });
});

describe('validateIntent', () => {
  it('accepts every supported infrastructure filter with typed values', () => {
    const v = validateIntent(intent('infrastructure', {
      resourceType: 'EC2', status: 'running', awsRegion: 'us-east-1', costMin: '100', costMax: 500,
      encrypted: false, hasBackup: true, publicAccess: true,
    }));
    expect(v).toEqual({
      ok: true,
      intent: {
        target: 'infrastructure',
        filters: { resourceType: 'ec2', status: 'running', awsRegion: 'us-east-1', costMin: 100, costMax: 500, encrypted: false, hasBackup: true, publicAccess: true },
      },
    });
  });

  it('accepts supported services and deployments filters', () => {
    expect(validateIntent(intent('services', { status: 'failed', template: 'api' }))).toMatchObject({ ok: true, intent: { filters: { status: 'failed', template: 'api' } } });
    expect(validateIntent(intent('deployments', { environment: 'production', status: 'failed', dateRange: '30d' })))
      .toMatchObject({ ok: true, intent: { filters: { environment: 'production', status: 'failed', dateRangeDays: 30 } } });
  });

  it('P0: a parser-supplied organization filter is rejected, never applied', () => {
    for (const key of ['organization_id', 'organizationId', 'org', 'tenant']) {
      const v = validateIntent(intent('infrastructure', { [key]: 'other-org-id' }));
      expect(v.ok).toBe(false);
    }
  });

  it('rejects a filter that does not belong to the target instead of silently dropping it', () => {
    // e.g. "production EC2" -- infrastructure has no environment filter; dropping it would answer a different question.
    expect(validateIntent(intent('infrastructure', { resourceType: 'ec2', environment: 'production' })).ok).toBe(false);
    expect(validateIntent(intent('deployments', { encrypted: false })).ok).toBe(false);
    expect(validateIntent(intent('services', { costMin: 100 })).ok).toBe(false);
  });

  it('rejects invalid values (including SQL-looking text)', () => {
    expect(validateIntent(intent('infrastructure', { resourceType: "ec2'; DROP TABLE aws_resources;--" })).ok).toBe(false);
    expect(validateIntent(intent('infrastructure', { awsRegion: 'mars-1' })).ok).toBe(false);
    expect(validateIntent(intent('infrastructure', { costMin: -5 })).ok).toBe(false);
    expect(validateIntent(intent('infrastructure', { costMin: 'lots' })).ok).toBe(false);
    expect(validateIntent(intent('infrastructure', { encrypted: 'false' })).ok).toBe(false);
    expect(validateIntent(intent('infrastructure', { status: 'failed' })).ok).toBe(false);
    expect(validateIntent(intent('deployments', { dateRange: "30 days'; --" })).ok).toBe(false);
    expect(validateIntent(intent('infrastructure', { costMin: 500, costMax: 100 })).ok).toBe(false);
  });

  it('costs accepts no filters: no per-service, per-resource, or date-range billing exists', () => {
    expect(validateIntent(intent('costs', undefined, 'navigate'))).toEqual({ ok: true, intent: { target: 'costs', filters: {} } });
    const v = validateIntent(intent('costs', { resourceType: 'ec2' }));
    expect(v).toEqual({ ok: false, reason: expect.stringMatching(/only report total month-to-date AWS spend/) });
    expect(validateIntent(intent('costs', { dateRange: '30d' })).ok).toBe(false);
  });

  it('alerts and teams are not supported, with a stated reason', () => {
    expect(validateIntent(intent('alerts', { severity: 'critical' }))).toEqual({ ok: false, reason: expect.stringMatching(/does not yet associate alerts with an organization/) });
    expect(validateIntent(intent('teams'))).toEqual({ ok: false, reason: expect.stringMatching(/can't list teams/) });
  });

  it('rejects unknown targets and actions', () => {
    expect(validateIntent(intent('billing')).ok).toBe(false);
    expect(validateIntent(intent('infrastructure', {}, 'delete')).ok).toBe(false);
    expect(validateIntent(null).ok).toBe(false);
  });

  it('describeIntent is deterministic and labels cost thresholds as estimates', () => {
    const v = validateIntent(intent('infrastructure', { resourceType: 'ec2', costMin: 100 }));
    expect(v.ok && describeIntent(v.intent)).toBe('EC2 resources with an estimated monthly cost of at least $100');
    const c = validateIntent(intent('costs', undefined, 'navigate'));
    expect(c.ok && describeIntent(c.intent)).toBe('AWS spend, month to date');
  });
});

describe('allowlist boundary (review H1): only an exact, supported mapping executes', () => {
  it('TARGET: unsupported, a missing target, and an empty target are not supported', () => {
    expect(validateIntent(intent('unsupported'))).toEqual({ ok: false, reason: GENERIC_NOT_SUPPORTED });
    expect(validateIntent({ action: 'navigate', confidence: 'high', period: 'none' } as any)).toEqual({ ok: false, reason: GENERIC_NOT_SUPPORTED });
    expect(validateIntent(intent(''))).toEqual({ ok: false, reason: GENERIC_NOT_SUPPORTED });
  });

  it.each(['medium', 'low', undefined, 'HIGH-ish'])('confidence %s is not supported, even for a valid target', confidence => {
    expect(validateIntent(intent('infrastructure', { resourceType: 'ec2' }, 'filter', { confidence }))).toEqual({ ok: false, reason: GENERIC_NOT_SUPPORTED });
  });

  it('a missing or unknown period is not supported (fails closed)', () => {
    expect(validateIntent(intent('costs', undefined, 'navigate', { period: undefined })).ok).toBe(false);
    expect(validateIntent(intent('costs', undefined, 'navigate', { period: 'yesterday' })).ok).toBe(false);
  });
});

describe('periods (review H2)', () => {
  it('costs: only no time reference or this month / month to date', () => {
    expect(validateIntent(intent('costs', undefined, 'navigate', { period: 'none' })).ok).toBe(true);
    expect(validateIntent(intent('costs', undefined, 'navigate', { period: 'current_month' })).ok).toBe(true);
    expect(validateIntent(intent('costs', undefined, 'navigate', { period: 'other' }))).toEqual({ ok: false, reason: COST_PERIOD_NOT_SUPPORTED });
  });

  it('inventory and services are a current snapshot: another period is not answered with it', () => {
    expect(validateIntent(intent('infrastructure', { resourceType: 'ec2' }, 'filter', { period: 'other' })).ok).toBe(false);
    expect(validateIntent(intent('services', {}, 'navigate', { period: 'other' })).ok).toBe(false);
  });

  it('deployments: a time reference is honored only as an applied 7/30/90-day range', () => {
    expect(validateIntent(intent('deployments', { dateRange: '30d' }, 'filter', { period: 'other' })).ok).toBe(true);
    expect(validateIntent(intent('deployments', { environment: 'production' }, 'filter', { period: 'other' })).ok).toBe(false);
    expect(validateIntent(intent('deployments', {}, 'navigate', { period: 'current_month' })).ok).toBe(false);
  });

  it.each([
    ['what did we spend last month', 'other'],
    ['What did we spend in August?', 'other'],
    ['spend since last month', 'other'],
    ['deployments in the last 30 days', 'other'],
    ['spend next quarter', 'other'],
    ['cost yesterday', 'other'],
    ['this week', 'other'],
    ['spend in 2025', 'other'],
    ['spend on 2026-08-01', 'other'],
    ['two weeks ago', 'other'],
    ['what is my spend this month', 'current_month'],
    ['month to date spend', 'current_month'],
    ['MTD cost', 'current_month'],
    ['what is my AWS spend', 'none'],
    ['resources over $2000', 'none'],
    ['estimated monthly cost per month', 'none'],
  ])('detectPeriod("%s") = %s', (query, period) => {
    expect(detectPeriod(query)).toBe(period);
  });

  it('reconcileWithQuery: the parser cannot downgrade a period the question states', () => {
    const r = reconcileWithQuery('EC2 inventory as of August', intent('infrastructure', { resourceType: 'ec2' }, 'filter', { period: 'none' }));
    expect(r.period).toBe('other');
    expect(validateIntent(r).ok).toBe(false);
  });

  it('reconcileWithQuery: a dateRange is kept only when the question states that exact range', () => {
    const thisWeek = reconcileWithQuery('production deployments this week', intent('deployments', { environment: 'production', dateRange: '7d' }, 'filter', { period: 'other' }));
    expect(thisWeek.target).toBe('unsupported');
    expect(validateIntent(thisWeek).ok).toBe(false);
    const mismatch = reconcileWithQuery('deployments in the last 30 days', intent('deployments', { dateRange: '90d' }, 'filter', { period: 'other' }));
    expect(mismatch.target).toBe('unsupported');
    const stated = reconcileWithQuery('deployments in the last 30 days', intent('deployments', { dateRange: '30d' }, 'filter', { period: 'other' }));
    expect(validateIntent(stated)).toEqual({ ok: true, intent: { target: 'deployments', filters: { dateRangeDays: 30 } } });
  });
});

describe('prototype keys (review L1)', () => {
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])('target "%s" is rejected with the generic message', target => {
    const v = validateIntent(intent(target));
    expect(v).toEqual({ ok: false, reason: GENERIC_NOT_SUPPORTED });
    expect(typeof (v as { reason: string }).reason).toBe('string');
  });
});

describe('fast-path paraphrases (the guard is not the boundary; see route tests)', () => {
  it.each([
    'What made our bill go up?', 'cost went up a lot, what happened', 'expected spend for next quarter', 'estimate end-of-month bill',
    'RI opportunities', 'right sizing candidates', 'instances doing nothing', 'low usage instances', 'commitment discounts',
    'cut my AWS bill', 'lower costs', 'incidents', 'outages', 'teams', 'who owns the api service', 'best practices for security',
    'spend last month', 'What did we spend in August?', 'EC2 spend last 30 days',
  ])('"%s" is caught before parsing', question => {
    expect(classifyUnsupportedQuestion(question)).not.toBeNull();
  });

  it('"what is my AWS spend this month" and "month to date spend" are not blocked', () => {
    expect(classifyUnsupportedQuestion('what is my AWS spend this month')).toBeNull();
    expect(classifyUnsupportedQuestion('month to date spend')).toBeNull();
  });
});

describe('vocabulary gate (re-review B1, H-a, H-b)', () => {
  it.each([
    'what is my AWS spend this month', 'month to date spend', 'show running ec2 instances', 'unencrypted s3 buckets',
    's3 buckets not encrypted', 's3 buckets without encryption', 'rds databases not backed up', 'rds databases without backups',
    'rds databases with no backups', 'which rds databases are backed up', 'ec2 instances in us-east-1 over $1,000', 'ec2 over 1k',
  ])('"%s" is fully recognized', q => {
    expect(fullyRecognized(q)).toBe(true);
  });

  it.each([
    'ec2 instances not running', 'buckets that are not public', 'ec2 not in us-east-1', 'rds databases not stopped',
    'is my spend up', 'are costs up', 'is the aws bill up', 'no spend', 'ec2 without tags',
    'what did we spend in May', 'AWS spend over the holidays', 'AWS spend for FY25', 'AWS spend on the 15th',
    'AWS spend two months back', 'AWS spend earlier', 'AWS spend in the fall', 'AWS spend during Black Friday',
    'AWS spend in H1', 'AWS spend this summer', 'show me the Acme organization ec2 instances',
  ])('"%s" is NOT fully recognized', q => {
    expect(fullyRecognized(q)).toBe(false);
  });
});

describe('stated cost bounds (re-review H-c)', () => {
  it.each([
    ['ec2 over $1,000', { min: 1000 }],
    ['ec2 over 1k', { min: 1000 }],
    ['ec2 over 1.5k', { min: 1500 }],
    ['ec2 under $50.50', { max: 50.5 }],
    ['ec2 more than 25', { min: 25 }],
    ['ec2 over $200 and under $2,500', { min: 200, max: 2500 }],
    ['ec2 instances', {}],
  ])('%s -> %j', (q, bounds) => {
    expect(statedCostBounds(q)).toEqual(bounds);
  });

  it('a qualifier without a parseable amount is invalid', () => {
    expect(statedCostBounds('ec2 over lots')).toBe('invalid');
    expect(statedCostBounds('ec2 over a grand')).toBe('invalid');
  });

  const infra = (filters: Record<string, unknown>) => intent('infrastructure', filters);

  it('reconcileWithQuery rejects a wrong, dropped, or invented threshold and keeps the stated one', () => {
    expect(reconcileWithQuery('ec2 over $1,000', infra({ resourceType: 'ec2', costMin: 1000 })).target).toBe('infrastructure');
    expect(reconcileWithQuery('ec2 over $1,000', infra({ resourceType: 'ec2', costMin: 1 })).target).toBe('unsupported');
    expect(reconcileWithQuery('ec2 over $1,000', infra({ resourceType: 'ec2' })).target).toBe('unsupported');
    expect(reconcileWithQuery('ec2 over 1k', infra({ resourceType: 'ec2', costMin: 1000 })).target).toBe('infrastructure');
    expect(reconcileWithQuery('ec2 instances', infra({ resourceType: 'ec2', costMin: 500 })).target).toBe('unsupported');
    expect(reconcileWithQuery('expensive ec2', infra({ resourceType: 'ec2', costMin: 100 })).target).toBe('infrastructure');
  });
});

describe('date-range edge cases (re-review)', () => {
  const dep = (q: string, range: string) =>
    reconcileWithQuery(q, intent('deployments', { dateRange: range }, 'filter', { period: 'other' })).target;

  it('a stated range is kept only when it is the question\'s only, un-negated time reference', () => {
    expect(dep('deployments in the last 30 days', '30d')).toBe('deployments');
    expect(dep('deployments in the last 30 days of May', '30d')).toBe('unsupported');
    expect(dep('deployments not in the last 30 days', '30d')).toBe('unsupported');
    expect(dep('deployments in the last 30 days since Monday', '30d')).toBe('unsupported');
    expect(dep('deployments in the last 30 days of August', '30d')).toBe('unsupported');
    expect(dep('deployments except the last 7 days', '7d')).toBe('unsupported');
  });
});
