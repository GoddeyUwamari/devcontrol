/**
 * Ask AI guardrails (nl-query-guard.ts): which questions are answered with an
 * explicit limitation before parsing, and which parsed intents may execute.
 * Pure functions -- no DB, no model.
 */
import { classifyUnsupportedQuestion, describeIntent, validateIntent } from '../nl-query-guard';
import type { NLQueryIntent } from '../nl-query.service';

const intent = (target: string, filters?: Record<string, unknown>, action = 'filter'): NLQueryIntent =>
  ({ target, action, filters, explanation: 'model text', confidence: 'high' } as unknown as NLQueryIntent);

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
