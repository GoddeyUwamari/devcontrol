/**
 * Custom compliance rules never pass or fail on something nobody observed.
 *
 *   - property_check on a NULL property (discovery did not read it: an unknown
 *     encryption, public-access or backup state) is not evaluated. It used to
 *     fail `equals` and pass `not_equals`.
 *   - tag_required / tag_pattern on a resource whose tags were not read is not
 *     evaluated. It used to report the tag as missing.
 *   - A not-evaluated rule is recorded as 'skip' with the reason, and counts
 *     neither for nor against the resource.
 */
import { CustomComplianceService } from '../custom-compliance.service';

const service = new CustomComplianceService({} as any);
const propertyCheck = (resource: Record<string, any>, conditions: Record<string, any>) =>
  (service as any).evaluatePropertyCheck({ conditions }, resource);
const tagRequired = (resource: Record<string, any>, tag_key = 'Owner') =>
  (service as any).evaluateTagRequired({ conditions: { tag_key } }, resource);
const tagPattern = (resource: Record<string, any>, pattern = '^team-') =>
  (service as any).evaluateTagPattern({ conditions: { tag_key: 'Owner', pattern } }, resource);

describe('property_check on a known value (unchanged)', () => {
  it.each([
    [{ is_encrypted: true }, { property: 'is_encrypted', operator: 'equals', value: true }, true],
    [{ is_encrypted: false }, { property: 'is_encrypted', operator: 'equals', value: true }, false],
    [{ is_public: false }, { property: 'is_public', operator: 'not_equals', value: true }, true],
    [{ is_public: true }, { property: 'is_public', operator: '!=', value: true }, false],
    [{ has_backup: false }, { property: 'has_backup', operator: 'exists' }, true],
  ])('%j with %j -> pass=%s', (resource, conditions, pass) => {
    const result = propertyCheck(resource, conditions);
    expect(result.pass).toBe(pass);
    expect(result.notEvaluated).toBeUndefined();
    expect(result.error).toBeUndefined();
  });
});

describe('property_check on a NULL property: not evaluated, never a failure and never a pass', () => {
  it.each([
    ['is_encrypted', 'equals', true],
    ['is_encrypted', '==', true],
    ['is_encrypted', 'equals', false],
    ['is_public', 'not_equals', true],
    ['is_public', '!=', true],
    ['has_backup', 'equals', true],
    ['estimated_monthly_cost', 'greater_than', 100],
    ['estimated_monthly_cost', '<', 100],
    ['status', 'contains', 'run'],
    ['status', 'not_contains', 'run'],
  ])('%s %s %p', (property, operator, value) => {
    for (const unknown of [null, undefined]) {
      const result = propertyCheck({ [property]: unknown }, { property, operator, value });
      expect(result.notEvaluated).toBe(`Not evaluated: "${property}" is unknown for this resource`);
      expect(result.pass).toBe(false);
      expect(result.issue).toBeUndefined();
      expect(result.error).toBeUndefined();
    }
  });

  it('"not_equals true" no longer passes on an unknown value', () => {
    expect(propertyCheck({ is_public: null }, { property: 'is_public', operator: 'not_equals', value: true }).pass).toBe(false);
    expect(propertyCheck({ is_public: null }, { property: 'is_public', operator: 'not_equals', value: true }).notEvaluated).toBeDefined();
  });

  it('exists / not_exists still answer the one question they ask: whether the value is known', () => {
    expect(propertyCheck({ has_backup: null }, { property: 'has_backup', operator: 'exists' })).toMatchObject({ pass: false });
    expect(propertyCheck({ has_backup: null }, { property: 'has_backup', operator: 'exists' }).notEvaluated).toBeUndefined();
    expect(propertyCheck({ has_backup: null }, { property: 'has_backup', operator: 'not_exists' })).toMatchObject({ pass: true });
  });
});

describe('tag rules honour whether the tags were read', () => {
  const bucket = (tags: Record<string, string>, tags_state?: string) => ({ resource_type: 's3', tags, metadata: tags_state ? { tags_state } : {} });

  it('tag_required: tags observed and the tag present -> pass', () => {
    expect(tagRequired(bucket({ Owner: 'team-a' }, 'observed'))).toMatchObject({ pass: true });
  });

  it('tag_required: tags observed and the tag absent -> fail', () => {
    const result = tagRequired(bucket({}, 'observed'));
    expect(result).toMatchObject({ pass: false, issue: 'Required tag "Owner" is missing' });
    expect(result.notEvaluated).toBeUndefined();
  });

  it.each([['unavailable'], [undefined]])('tag_required: tags_state %p -> not evaluated, never "missing"', (state) => {
    const result = tagRequired(bucket({}, state));
    expect(result.notEvaluated).toBe('Not evaluated: the tags of this resource could not be read');
    expect(result.issue).toBeUndefined();
  });

  it('tag_required: an EC2 instance carries its tags inline, so an absent tag is a failure', () => {
    expect(tagRequired({ resource_type: 'ec2', tags: {}, metadata: {} })).toMatchObject({ pass: false, issue: 'Required tag "Owner" is missing' });
  });

  it('tag_required: a row recorded as unavailable is not evaluated whatever its type (a reclassified RDS cluster)', () => {
    const cluster = { resource_type: 'rds', tags: {}, metadata: { tags_state: 'unavailable', source: 'resource-explorer' } };
    expect(tagRequired(cluster).notEvaluated).toBeDefined();
  });

  it('tag_pattern: unavailable -> not evaluated; observed -> evaluated', () => {
    expect(tagPattern(bucket({}, 'unavailable')).notEvaluated).toBeDefined();
    expect(tagPattern(bucket({}, 'observed'))).toMatchObject({ pass: false, issue: 'Tag "Owner" is missing' });
    expect(tagPattern(bucket({ Owner: 'team-a' }, 'observed'))).toMatchObject({ pass: true });
    expect(tagPattern(bucket({ Owner: 'x' }, 'observed')).pass).toBe(false);
  });
});

describe('a scan records a not-evaluated rule as "skip" and does not count it', () => {
  const rule = (id: string, rule_type: string, conditions: Record<string, any>, severity = 'high') => ({
    id, rule_code: id, rule_type, conditions, severity, category: 'encryption', enabled: true, resource_types: [], recommendation: 'fix it',
  });
  const RULES = [
    rule('encrypted', 'property_check', { property: 'is_encrypted', operator: 'equals', value: true }, 'critical'),
    rule('owner-tag', 'tag_required', { tag_key: 'Owner' }, 'low'),
  ];
  const resource = (id: string, overrides: Record<string, any>) => ({
    id, resource_arn: `arn:aws:s3:::${id}`, resource_type: 's3', resource_name: id, tags: {}, metadata: { tags_state: 'observed' }, ...overrides,
  });

  async function scan(resources: any[]) {
    const svc = new CustomComplianceService({} as any) as any;
    const findings: any[] = [];
    let summary: any;
    svc.repository = {
      updateScan: jest.fn(async (_id: string, update: any) => { if (update.status === 'completed') summary = update; }),
      findFrameworkWithRules: jest.fn(async () => ({ rules: RULES })),
      createFinding: jest.fn(async (finding: any) => { findings.push(finding); }),
      findScanById: jest.fn(async () => ({ id: 'scan-1' })),
    };
    svc.fetchResources = jest.fn(async () => resources);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    await svc.runScanBody({}, { id: 'scan-1' }, 'framework-1', 'org-1', undefined);
    jest.restoreAllMocks();
    return { summary, byRule: (resourceId: string) => Object.fromEntries(findings.filter((f) => f.resource_id === resourceId).map((f) => [f.rule_id, f])) };
  }

  it('unknown encryption and unread tags: both rules skipped with the reason, no issue counted, the resource neither compliant nor not', async () => {
    const { summary, byRule } = await scan([resource('unknown-bucket', { is_encrypted: null, metadata: { tags_state: 'unavailable' } })]);

    expect(byRule('unknown-bucket').encrypted).toMatchObject({ status: 'skip', issue: 'Not evaluated: "is_encrypted" is unknown for this resource', recommendation: null });
    expect(byRule('unknown-bucket')['owner-tag']).toMatchObject({ status: 'skip', issue: 'Not evaluated: the tags of this resource could not be read', recommendation: null });
    expect(summary).toMatchObject({ compliant_resources: 0, non_compliant_resources: 0, critical_issues: 0, low_issues: 0 });
  });

  it('beside it, a confirmed-unencrypted untagged bucket still fails both, and a compliant one passes both', async () => {
    const { summary, byRule } = await scan([
      resource('unknown-bucket', { is_encrypted: null, metadata: { tags_state: 'unavailable' } }),
      resource('bad-bucket', { is_encrypted: false }),
      resource('good-bucket', { is_encrypted: true, tags: { Owner: 'team-a' } }),
    ]);

    expect(byRule('bad-bucket').encrypted.status).toBe('fail');
    expect(byRule('bad-bucket')['owner-tag'].status).toBe('fail');
    expect(byRule('good-bucket').encrypted.status).toBe('pass');
    expect(byRule('good-bucket')['owner-tag'].status).toBe('pass');
    expect(summary).toMatchObject({ compliant_resources: 1, non_compliant_resources: 1, critical_issues: 1, low_issues: 1 });
  });

  it('a resource with one known and one unknown answer is judged on the known one only', async () => {
    const { summary, byRule } = await scan([resource('half-known', { is_encrypted: true, metadata: { tags_state: 'unavailable' } })]);
    expect(byRule('half-known').encrypted.status).toBe('pass');
    expect(byRule('half-known')['owner-tag'].status).toBe('skip');
    expect(summary).toMatchObject({ compliant_resources: 1, non_compliant_resources: 0, low_issues: 0 });
  });
});
