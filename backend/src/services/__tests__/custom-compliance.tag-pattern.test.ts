/**
 * tag_pattern rules in a scan (custom-compliance.service.ts):
 *
 *   - A saved pattern goes through the same check as at save time. One that
 *     check refuses -- including one saved before it existed -- is recorded
 *     as 'error' with "Couldn't evaluate: ...", never as a pass or a fail.
 *   - A tag value the matcher can't read the same way as JavaScript (too
 *     long, or a character outside the BMP) is the same: couldn't evaluate.
 *   - A resource with any rule that couldn't be evaluated is neither
 *     compliant nor non-compliant. It is counted in
 *     results.couldnt_evaluate_resources and left out of both sides of
 *     compliance_score; when every resource is, there is no score.
 *   - The reason is logged once per rule with its id, never with the pattern
 *     or the tag value.
 */
import { CustomComplianceService } from '../custom-compliance.service';

const rule = (id: string, rule_type: string, conditions: Record<string, any>, severity = 'high') => ({
  id, framework_id: 'framework-1', rule_code: id, rule_type, conditions, severity, category: 'tagging', enabled: true, resource_types: [], recommendation: 'fix it',
});
const tagPattern = (id: string, pattern: unknown) => rule(id, 'tag_pattern', { tag_key: 'Owner', pattern }, 'low');
const resource = (id: string, overrides: Record<string, any> = {}) => ({
  id, resource_arn: `arn:aws:s3:::${id}`, resource_type: 's3', resource_name: id, tags: { Owner: 'team-a' }, is_encrypted: true,
  metadata: { tags_state: 'observed' }, ...overrides,
});
const ENCRYPTED = rule('encrypted', 'property_check', { property: 'is_encrypted', operator: 'equals', value: true }, 'critical');

async function scan(rules: any[], resources: any[]) {
  const svc = new CustomComplianceService({} as any) as any;
  const findings: any[] = [];
  let summary: any;
  svc.repository = {
    updateScan: jest.fn(async (_id: string, update: any) => {
      if (update.status === 'completed') summary = update;
      return { id: 'scan-1', ...update };
    }),
    findFrameworkWithRules: jest.fn(async () => ({ rules })),
    createFinding: jest.fn(async (finding: any) => { findings.push(finding); }),
    findScanById: jest.fn(async () => ({ id: 'scan-1' })),
  };
  svc.fetchResources = jest.fn(async () => resources);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await svc.runScanBody({ query: jest.fn(async () => ({ rows: [] })) }, { id: 'scan-1' }, 'framework-1', 'org-1', undefined);
  const warnings = warn.mock.calls.map((args) => args.join(' '));
  jest.restoreAllMocks();
  return {
    summary,
    warnings,
    finding: (resourceId: string, ruleId: string) => findings.find((f) => f.resource_id === resourceId && f.rule_id === ruleId),
  };
}

describe('a saved pattern the check refuses is "couldn\'t evaluate", never a pass', () => {
  it.each([
    ['(a)\\1', 'pattern_unsupported:backreference', 'Pattern uses backreferences'],
    ['^(?=team)', 'pattern_unsupported:lookaround', 'Pattern uses lookahead or lookbehind'],
    ['(?<=x)team', 'pattern_unsupported:lookaround', 'Pattern uses lookahead or lookbehind'],
    ['\\1team', 'pattern_unsupported:legacy_escape', 'Pattern uses legacy escapes'],
    ['team-\u{1F600}', 'pattern_unsupported:astral_char', 'Pattern uses characters outside the Basic Multilingual Plane'],
    ['(unclosed', 'pattern_invalid', 'Pattern is not a valid regular expression.'],
    ['x{1001}', 'pattern_too_complex', 'Pattern is too complex.'],
    ['t'.repeat(201), 'pattern_too_long', 'Pattern exceeds the maximum allowed length'],
    [42, 'pattern_invalid', 'Pattern must be a non-empty string.'],
  ])('%j', async (pattern, reason, text) => {
    // Every one of these would match "team-a" (or pass) under the old engine, or throw.
    const { summary, finding, warnings } = await scan([tagPattern('owner', pattern)], [resource('r1')]);

    const f = finding('r1', 'owner');
    expect(f.status).toBe('error');
    expect(f.issue.startsWith(`Couldn't evaluate: ${text}`)).toBe(true);
    expect(f.recommendation).toBeNull();
    expect(summary).toMatchObject({ compliant_resources: 0, non_compliant_resources: 0, resources_scanned: 1, results: { couldnt_evaluate_resources: 1 }, low_issues: 0 });
    expect(summary.compliance_score).toBeNull();
    expect(warnings).toEqual([`[CustomCompliance] Rule owner (framework framework-1) couldn't be evaluated: ${reason}`]);
  });
});

describe('a tag value the matcher refuses is "couldn\'t evaluate"', () => {
  it.each([
    ['a'.repeat(257), 'value_too_long', "Couldn't evaluate: the tag value is longer than 256 characters"],
    ['team-\u{1F600}', 'value_unsupported_chars', "Couldn't evaluate: the tag value contains characters outside the Basic Multilingual Plane"],
  ])('%#', async (value, reason, issue) => {
    const { summary, finding, warnings } = await scan([tagPattern('owner', '^')], [resource('r1', { tags: { Owner: value } })]);
    expect(finding('r1', 'owner')).toMatchObject({ status: 'error', issue });
    expect(summary).toMatchObject({ compliant_resources: 0, non_compliant_resources: 0, results: { couldnt_evaluate_resources: 1 } });
    expect(warnings).toEqual([`[CustomCompliance] Rule owner (framework framework-1) couldn't be evaluated: ${reason}`]);
    expect(warnings.join('').includes(value)).toBe(false);
  });
});

describe('resource counts and the score', () => {
  it('a resource whose other rule passes is not counted compliant', async () => {
    const { summary, finding } = await scan([ENCRYPTED, tagPattern('owner', '(a)\\1')], [resource('r1')]);
    expect(finding('r1', 'encrypted').status).toBe('pass');
    expect(finding('r1', 'owner').status).toBe('error');
    expect(summary).toMatchObject({ compliant_resources: 0, non_compliant_resources: 0, results: { couldnt_evaluate_resources: 1 } });
  });

  it('a resource whose other rule genuinely fails is not counted non-compliant either; the failure still counts as an issue', async () => {
    const { summary, finding } = await scan([ENCRYPTED, tagPattern('owner', '(a)\\1')], [resource('r1', { is_encrypted: false })]);
    expect(finding('r1', 'encrypted').status).toBe('fail');
    expect(summary).toMatchObject({ compliant_resources: 0, non_compliant_resources: 0, critical_issues: 1, results: { couldnt_evaluate_resources: 1 } });
  });

  it('beside judged resources: left out of both sides of the score', async () => {
    const { summary } = await scan(
      [ENCRYPTED, tagPattern('owner', '^team-')],
      [
        resource('good'),
        resource('bad', { is_encrypted: false }),
        resource('unreadable', { tags: { Owner: 'a'.repeat(257) } }),
      ]
    );
    expect(summary).toMatchObject({ resources_scanned: 3, compliant_resources: 1, non_compliant_resources: 1, results: { couldnt_evaluate_resources: 1 } });
    expect(summary.compliance_score).toBe(50);
  });

  it('a scan with nothing that could not be evaluated is scored as before', async () => {
    const { summary, finding } = await scan([tagPattern('owner', '^team-')], [resource('good'), resource('bad', { tags: { Owner: 'x' } })]);
    expect(finding('good', 'owner').status).toBe('pass');
    expect(finding('bad', 'owner')).toMatchObject({ status: 'fail', issue: 'Tag "Owner" value "x" does not match pattern ^team-' });
    expect(summary).toMatchObject({ compliant_resources: 1, non_compliant_resources: 1, compliance_score: 50, results: { couldnt_evaluate_resources: 0 } });
  });

  it('a scan with no resources keeps its score of 100', async () => {
    const { summary } = await scan([tagPattern('owner', '^team-')], []);
    expect(summary).toMatchObject({ resources_scanned: 0, compliance_score: 100, results: { couldnt_evaluate_resources: 0 } });
  });

  it('any errored rule counts, not only tag_pattern: an unknown operator leaves the resource unjudged', async () => {
    const { summary, finding } = await scan(
      [rule('odd', 'property_check', { property: 'is_encrypted', operator: 'approximately', value: true })],
      [resource('r1')]
    );
    expect(finding('r1', 'odd').status).toBe('error');
    expect(summary).toMatchObject({ compliant_resources: 0, non_compliant_resources: 0, results: { couldnt_evaluate_resources: 1 } });
  });
});

describe('a refused pattern is checked and logged once per rule', () => {
  it('many resources: one warning, every finding error', async () => {
    const resources = Array.from({ length: 25 }, (_, i) => resource(`r${i}`));
    const { warnings, summary } = await scan([tagPattern('owner', '(a)\\1')], resources);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].includes('(a)')).toBe(false);
    expect(summary).toMatchObject({ results: { couldnt_evaluate_resources: 25 } });
  });
});

describe('no JavaScript RegExp in the scan path', () => {
  it('neither the service nor the matcher constructs a RegExp', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    for (const file of ['../custom-compliance.service.ts', '../../utils/tagPatternMatcher.ts']) {
      const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
      expect({ file, constructs: /\bRegExp\s*\(/.test(source) }).toEqual({ file, constructs: false });
    }
  });
});
