/**
 * derivePrioritySeverity (GET /api/services and /api/services/stats): needs_attention
 * and the displayed reason come from current findings only. An entry's severity is
 * consulted only once the entry is known to be a finding, so a Critical entry that
 * was not evaluated never puts a resource at risk. Pure: no database.
 */
import { derivePrioritySeverity, deriveAttention, attentionCauseOf } from '../services.routes';

const baselineHigh = { severity: 'high', category: 'public_access', issue: 'EC2 instance has a public IP address', recommendation: 'r', provenance: 'OBSERVED' };
const baselineLow = { severity: 'low', category: 'tagging', issue: 'Resource is missing required tags: Owner', recommendation: 'r', provenance: 'SELF_ATTESTED' };
const hipaa = { severity: 'critical', category: 'backups', issue: 'HIPAA: EBS storing PHI must have automated backups', recommendation: 'r', findingKey: 'hipaa.automated_backups', framework: 'HIPAA' };
const failed = { ...hipaa, applicability: 'enabled', evaluation_state: 'failed' };
const keptUnavailable = { ...hipaa, verification: 'unverified', applicability: 'unavailable', evaluation_state: 'not_evaluated' };
const keptInvalid = { ...hipaa, verification: 'unverified', applicability: 'invalid', evaluation_state: 'not_evaluated' };
const keptError = { ...hipaa, verification: 'unverified', applicability: 'enabled', evaluation_state: 'error' };
const keptUnable = { ...hipaa, verification: 'unverified', applicability: 'enabled', evaluation_state: 'unable_to_evaluate' };
const legacyHipaa = { severity: 'critical', category: 'networking', issue: 'HIPAA: S3 lacks required access logging for audit trails', recommendation: 'r' };

const legacySoc2Iam = { severity: 'high', category: 'tagging', issue: 'Tagging: IAM role/owner not documented', recommendation: 'r', provenance: 'SELF_ATTESTED' };
const legacySoc2Monitoring = { severity: 'high', category: 'networking', issue: 'Observability: Monitoring/logging not documented via tag', recommendation: 'r', provenance: 'SELF_ATTESTED' };
const s3Critical = { severity: 'critical', category: 'public_access', issue: 'S3 bucket policy allows public access', recommendation: 'r', provenance: 'OBSERVED', findingKey: 's3.public_access.policy' };

type Expected = { priority_severity: string | null; reason: string | null; needs_attention: boolean };
const NOTHING: Expected = { priority_severity: null, reason: null, needs_attention: false };

describe('derivePrioritySeverity counts current findings only', () => {
  const cases: Array<[string, unknown[], Expected]> = [
    ['a failed check of an enabled framework', [failed], { priority_severity: 'critical', reason: hipaa.issue, needs_attention: true }],
    ['a Critical entry kept while settings were unavailable', [keptUnavailable], { priority_severity: null, reason: null, needs_attention: false }],
    ['a Critical entry kept while settings were invalid', [keptInvalid], { priority_severity: null, reason: null, needs_attention: false }],
    ['a Critical entry kept after a check error', [keptError], { priority_severity: null, reason: null, needs_attention: false }],
    ['a Critical entry kept when evidence went missing', [keptUnable], { priority_severity: null, reason: null, needs_attention: false }],
    ['a Critical HIPAA entry from before frameworks had to be enabled', [legacyHipaa], { priority_severity: null, reason: null, needs_attention: false }],
    ['a baseline High beside entries that are not current', [keptUnavailable, legacyHipaa, baselineHigh], { priority_severity: 'high', reason: baselineHigh.issue, needs_attention: true }],
    ['a baseline Low beside entries that are not current', [keptError, baselineLow], { priority_severity: 'low', reason: baselineLow.issue, needs_attention: false }],
    ['a baseline High alone (unchanged)', [baselineHigh], { priority_severity: 'high', reason: baselineHigh.issue, needs_attention: true }],
    // Was needs_attention: true ("S3 convention, unchanged"): a finding the latest scan
    // could not re-verify does not put a resource at risk, at any severity.
    ['a baseline High carried forward unverified, as stored before it recorded a state', [{ ...baselineHigh, verification: 'unverified' }], NOTHING],
    ['a Critical S3 finding carried forward because the bucket could not be read', [{ ...s3Critical, verification: 'unverified', evaluation_state: 'unable_to_evaluate', evidence_basis: 'none' }], NOTHING],
    ['a Critical S3 finding carried forward because its evaluation threw', [{ ...s3Critical, verification: 'unverified', evaluation_state: 'error', evidence_basis: 'none' }], NOTHING],
    ['the same Critical S3 finding once a scan verifies it again', [s3Critical], { priority_severity: 'critical', reason: s3Critical.issue, needs_attention: true }],
    ['an unverified Critical beside a verified Low: only the Low counts', [{ ...s3Critical, verification: 'unverified', evaluation_state: 'unable_to_evaluate' }, baselineLow], { priority_severity: 'low', reason: baselineLow.issue, needs_attention: false }],
    ['a High SOC 2 tag signal from before frameworks had to be enabled (IAM role)', [legacySoc2Iam], NOTHING],
    ['a High SOC 2 tag signal from before frameworks had to be enabled (monitoring)', [legacySoc2Monitoring], NOTHING],
    ['every kind of legacy entry together, beside a Low', [legacyHipaa, legacySoc2Iam, legacySoc2Monitoring, baselineLow], { priority_severity: 'low', reason: baselineLow.issue, needs_attention: false }],
    ['no entries', [], { priority_severity: null, reason: null, needs_attention: false }],
  ];

  it.each(cases)('%s', (_name, issues, expected) => {
    expect(derivePrioritySeverity('healthy', issues as any[], [])).toEqual(expected);
  });

  it('falls back to the cost recommendation when no compliance entry is current', () => {
    const recommendation = { severity: 'HIGH', issue: 'Idle Instance', potential_savings: 10 };
    expect(derivePrioritySeverity('healthy', [keptUnavailable, legacyHipaa], [recommendation])).toEqual({
      priority_severity: 'high', reason: 'Idle Instance', needs_attention: true,
    });
  });

  it('leaves the operational-status signal alone', () => {
    expect(derivePrioritySeverity('critical', [keptUnavailable], [])).toEqual({
      priority_severity: 'critical', reason: 'Resource in a failed or terminated state', needs_attention: true,
    });
  });

  it.each([[null], [undefined], ['not-an-array']])('tolerates compliance_issues = %p', (issues) => {
    expect(derivePrioritySeverity('healthy', issues as any, [])).toEqual({ priority_severity: null, reason: null, needs_attention: false });
  });
});

describe('deriveAttention.reason_source: the signal the reason comes from', () => {
  const highCost = { severity: 'HIGH', issue: 'Idle Instance', potential_savings: 10 };
  const lowCost = { severity: 'LOW', issue: 'Idle Instance', potential_savings: 10 };
  const mediumFinding = { severity: 'medium', category: 'encryption', issue: 'Resource is not encrypted', recommendation: 'r', provenance: 'OBSERVED' };

  it.each<[string, Parameters<typeof deriveAttention>, string | null]>([
    ['a current finding', ['healthy', [baselineHigh], []], 'finding'],
    ['a cost recommendation, with no current finding', ['healthy', [], [highCost]], 'cost_recommendation'],
    ['a finding wins over a cost recommendation', ['healthy', [baselineHigh], [highCost]], 'finding'],
    ['a stopped resource with nothing else', ['warning', [], []], 'status'],
    ['a status worse than the finding', ['critical', [baselineHigh], []], 'status'],
    ['a status worse than a low cost recommendation', ['warning', [], [lowCost]], 'status'],
    ['a finding as bad as the status: the finding is the reason', ['warning', [mediumFinding], []], 'finding'],
    ['nothing', ['healthy', [], []], null],
  ])('%s', (_name, args, expected) => {
    const result = deriveAttention(...args);
    expect(result.reason_source).toBe(expected);
  });

  it('adds nothing to what derivePrioritySeverity reports', () => {
    expect(derivePrioritySeverity('warning', [mediumFinding], [])).toEqual({
      priority_severity: 'medium', reason: mediumFinding.issue, needs_attention: true,
    });
  });
});

describe('attentionCauseOf: from the causes, never from a reason that is not one', () => {
  const highCost = { severity: 'HIGH', issue: 'Idle Instance', potential_savings: 10 };
  const mediumCost = { severity: 'MEDIUM', issue: 'Idle Instance', potential_savings: 10 };

  it.each<[string, Parameters<typeof deriveAttention>, string | null]>([
    ['stopped, with a MEDIUM cost recommendation (the reason): status', ['warning', [], [mediumCost]], 'status'],
    ['stopped, with a HIGH cost recommendation (the reason): cost_recommendation', ['warning', [], [highCost]], 'cost_recommendation'],
    ['failed, with a HIGH cost recommendation: the status is the reason and a cause', ['critical', [], [highCost]], 'status'],
    ['a current High finding', ['healthy', [baselineHigh], []], 'finding'],
    ['stopped, with a Low finding (the reason is the status)', ['warning', [baselineLow], []], 'status'],
    ['a MEDIUM cost recommendation alone: no attention', ['healthy', [], [mediumCost]], null],
    ['nothing', ['healthy', [], []], null],
  ])('%s', (_name, args, expected) => {
    expect(attentionCauseOf(deriveAttention(...args))).toBe(expected);
  });
});
