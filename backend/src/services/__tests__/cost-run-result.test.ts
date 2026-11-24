/**
 * The scan result banner's facts for one run (cost-run-result.ts) and the
 * per-check failure classes (cost-analysis-outcome.ts). Pure.
 */
import { buildCostRunResult, failedChecksByReason, servicesOfChecks } from '../cost-run-result';
import { classifyCheckFailure, summarizeDetectors, type CostAnalysisCheck } from '../cost-analysis-outcome';
import { AwsCallTimeoutError } from '../../utils/awsCallPolicy';
import { ScanDeadlineError } from '../region-run';

const check = (rule_id: string, outcome: 'complete' | 'failed', failure_reason?: CostAnalysisCheck['failure_reason']): CostAnalysisCheck => ({
  rule_id, issue: rule_id, outcome, detected: 0, unknown: 0, ...(failure_reason ? { failure_reason } : {}),
});

describe('classifyCheckFailure: a class from the error name/code/status, never its message', () => {
  it.each([
    [new AwsCallTimeoutError(15_000), 'timeout'],
    [Object.assign(new Error('x'), { name: 'TimeoutError' }), 'timeout'],
    [Object.assign(new Error('x'), { name: 'AbortError' }), 'timeout'],
    [Object.assign(new Error('x'), { name: 'ThrottlingException' }), 'rate_limited'],
    [Object.assign(new Error('x'), { $metadata: { httpStatusCode: 429 } }), 'rate_limited'],
    [Object.assign(new Error('x'), { name: 'AccessDeniedException' }), 'permissions'],
    [Object.assign(new Error('x'), { name: 'UnauthorizedOperation' }), 'permissions'],
    [Object.assign(new Error('x'), { $metadata: { httpStatusCode: 403 } }), 'permissions'],
    [new ScanDeadlineError('cost analysis'), 'timeout'],
    [new Error('AccessDenied in the message only'), 'error'],
    [undefined, 'error'],
  ])('%p → %s', (error, reason) => {
    expect(classifyCheckFailure(error)).toBe(reason);
  });
});

describe('summarizeDetectors records failure_reason on failed checks only', () => {
  it('failed checks carry their reason (or error); complete checks carry none; RI too', () => {
    const summary = summarizeDetectors(
      [
        { issue: 'Idle Instance', success: true, recommendations: [], failureReason: 'timeout' },
        { issue: 'Unused Elastic IP', success: false, recommendations: [], failureReason: 'permissions' },
        { issue: 'Unattached EBS Volume', success: false, recommendations: [] },
      ],
      false,
      [],
      'rate_limited'
    );
    expect(summary.checks.map((c) => [c.issue, c.outcome, c.failure_reason])).toEqual([
      ['Idle Instance', 'complete', undefined],
      ['Unused Elastic IP', 'failed', 'permissions'],
      ['Unattached EBS Volume', 'failed', 'error'],
      ['Reserved Instance Opportunity', 'failed', 'rate_limited'],
    ]);
    expect(JSON.stringify(summary.checks)).not.toMatch(/message|arn:/i);
  });
});

describe('failedChecksByReason', () => {
  it('groups by reason, largest first, ties in the fixed reason order; an unrecorded reason is error', () => {
    expect(failedChecksByReason([
      check('a', 'failed', 'timeout'),
      check('b', 'failed', 'permissions'),
      check('c', 'failed', 'timeout'),
      check('d', 'failed'),
      check('e', 'failed', 'rate_limited'),
      check('f', 'complete'),
    ])).toEqual([
      { reason: 'timeout', count: 2 },
      { reason: 'permissions', count: 1 },
      { reason: 'rate_limited', count: 1 },
      { reason: 'error', count: 1 },
    ]);
  });
});

describe('servicesOfChecks', () => {
  it('names the services of the checks that ran, by rule, in registry order, once each', () => {
    expect(servicesOfChecks([
      check('dynamodb_capacity', 'complete'),
      check('ec2_idle', 'complete'),
      check('ec2_unused_elastic_ip', 'complete'),
      check('s3_lifecycle', 'failed', 'permissions'),
      check('rds_idle', 'complete'),
    ])).toEqual(['EC2', 'RDS', 'DynamoDB']);
  });
});

describe('buildCostRunResult', () => {
  const base = { id: 'run', completedAt: null, message: 'placeholder message', findingsUnchanged: true, unknownResourceCount: null };

  it('completed: counts, K = open - new, no message, no unchanged claim', () => {
    expect(buildCostRunResult({ ...base, state: 'completed', checks: [check('ec2_idle', 'complete')], newCount: 2, openCount: 5 })).toMatchObject({
      checksTotal: 1, checksRan: 1, newCount: 2, openCount: 5, stillOpen: 3, message: null, findingsUnchanged: false,
    });
  });

  it('unknown counts stay null, never 0', () => {
    expect(buildCostRunResult({ ...base, state: 'completed', checks: null, newCount: null, openCount: 4 })).toMatchObject({
      checksTotal: 0, newCount: null, openCount: 4, stillOpen: null,
    });
  });

  it('resource-level gaps (S-2): the run\'s unknown resource count is carried as recorded; unrecorded stays null', () => {
    expect(buildCostRunResult({ ...base, state: 'completed', checks: [check('ec2_idle', 'complete')], newCount: 0, openCount: 0, unknownResourceCount: 4 }))
      .toMatchObject({ state: 'completed', unknownResourceCount: 4 });
    expect(buildCostRunResult({ ...base, state: 'completed', checks: [check('ec2_idle', 'complete')], newCount: 0, openCount: 0, unknownResourceCount: 0 }))
      .toMatchObject({ unknownResourceCount: 0 });
    expect(buildCostRunResult({ ...base, state: 'completed', checks: [check('ec2_idle', 'complete')], newCount: 0, openCount: 0 }))
      .toMatchObject({ unknownResourceCount: null });
  });

  it('failed carries its message and the unchanged claim; interrupted never claims unchanged', () => {
    expect(buildCostRunResult({ ...base, state: 'failed', checks: [], newCount: null, openCount: null })).toMatchObject({ message: 'placeholder message', findingsUnchanged: true });
    expect(buildCostRunResult({ ...base, state: 'interrupted', checks: [], newCount: null, openCount: null })).toMatchObject({ message: 'placeholder message', findingsUnchanged: false });
  });
});
