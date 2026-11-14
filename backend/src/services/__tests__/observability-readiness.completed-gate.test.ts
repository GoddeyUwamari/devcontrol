/**
 * Multi-region PR 1, R1 (founder decision Nov 14): the Operational Health readiness
 * discovery gate (evaluateDiscoveryGate) also reads a COMPLETED run's error text for
 * the type's own prefix. A multi-region scan completes even when the home region's
 * EC2 or RDS listing failed, and writes that failure as "EC2: ..." / "RDS: ...".
 *
 *   - completed + "EC2: " -> ec2 is an error (rds is not); "RDS: " likewise;
 *   - every other segment of a completed run is still ignored (a cost failure, a
 *     legacy warning code, which getGatedRun removes before the gate);
 *   - a failed run is judged exactly as before.
 * No database.
 */
import { DISCOVERY_ERROR_SEPARATOR, evaluateDiscoveryGate } from '../observability-readiness.service';
import { DISCOVERY_WARNING_TRUNCATED_INDEX, joinDiscoveryMessage, splitDiscoveryMessage } from '../discovery-warnings';
import { DISCOVERY_FAILED_MESSAGE } from '../discovery-job-messages';

type Status = 'completed' | 'failed';
const run = (status: Status, errorMessage: string | null) => ({
  id: 'run',
  status,
  startedAt: new Date('2026-11-14T00:00:00Z'),
  completedAt: new Date('2026-11-14T00:01:00Z'),
  resourceTypes: ['ec2', 'rds'],
  errorMessage,
});
const usable = (r: ReturnType<typeof run>) => ({ kind: 'usable', run: r });
const ec2Failed = { kind: 'error', reason: 'EC2 discovery failed in the latest discovery run' };
const rdsFailed = { kind: 'error', reason: 'RDS discovery failed in the latest discovery run' };

describe('a completed run: the type\'s own prefix is that type\'s failure', () => {
  it('"EC2: " -> ec2 error; rds usable', () => {
    const r = run('completed', 'EC2: User is not authorized');
    expect(evaluateDiscoveryGate(r, 'ec2')).toEqual(ec2Failed);
    expect(evaluateDiscoveryGate(r, 'rds')).toEqual(usable(r));
  });

  it('"RDS: " -> rds error; ec2 usable', () => {
    const r = run('completed', 'RDS: User is not authorized');
    expect(evaluateDiscoveryGate(r, 'rds')).toEqual(rdsFailed);
    expect(evaluateDiscoveryGate(r, 'ec2')).toEqual(usable(r));
  });

  it('both, beside a cost failure: each type its own error', () => {
    const r = run('completed', ['Cost analysis: boom', 'EC2: a', 'RDS: b'].join(DISCOVERY_ERROR_SEPARATOR));
    expect(evaluateDiscoveryGate(r, 'ec2')).toEqual(ec2Failed);
    expect(evaluateDiscoveryGate(r, 'rds')).toEqual(rdsFailed);
  });

  it.each([
    ['no error text', null],
    ['a cost failure', 'Cost analysis: no cost check completed'],
    ['another listing\'s failure (S3)', 'S3: AccessDenied'],
    ['a free-text segment', 'something else'],
  ])('%s: still usable', (_label, errorMessage) => {
    const r = run('completed', errorMessage);
    for (const type of ['ec2', 'rds'] as const) expect(evaluateDiscoveryGate(r, type)).toEqual(usable(r));
  });

  it('a legacy warning code in error_message is removed before the gate (getGatedRun) and changes nothing', () => {
    const stored = joinDiscoveryMessage([], [DISCOVERY_WARNING_TRUNCATED_INDEX]);
    const r = run('completed', splitDiscoveryMessage(stored).errorMessage);
    for (const type of ['ec2', 'rds'] as const) expect(evaluateDiscoveryGate(r, type)).toEqual(usable(r));
  });

  it('a prefix must start the segment: "XEC2: " or text mentioning EC2 does not count', () => {
    const r = run('completed', 'Cost analysis: EC2: idle check failed');
    expect(evaluateDiscoveryGate(r, 'ec2')).toEqual(usable(r));
  });
});

describe('a failed run: judged exactly as before R1', () => {
  it.each([
    ['EC2 failure', 'EC2: denied', ec2Failed, { kind: 'usable' }],
    ['RDS failure', 'RDS: denied', { kind: 'usable' }, rdsFailed],
    ['another known prefix only', 'S3: denied', { kind: 'usable' }, { kind: 'usable' }],
    ['an unknown segment', 'boom', { kind: 'error', reason: 'the latest discovery run failed with an unrecognized error' }, { kind: 'error', reason: 'the latest discovery run failed with an unrecognized error' }],
    ['the fixed fatal message', DISCOVERY_FAILED_MESSAGE, { kind: 'error', reason: 'the latest discovery run failed with an unrecognized error' }, { kind: 'error', reason: 'the latest discovery run failed with an unrecognized error' }],
    ['no recorded reason', '', { kind: 'error', reason: 'the latest discovery run failed without a recorded reason' }, { kind: 'error', reason: 'the latest discovery run failed without a recorded reason' }],
  ])('%s', (_label, errorMessage, ec2, rds) => {
    const r = run('failed', errorMessage);
    const shape = (g: ReturnType<typeof evaluateDiscoveryGate>) => (g.kind === 'usable' ? { kind: 'usable' } : g);
    expect(shape(evaluateDiscoveryGate(r, 'ec2'))).toEqual(ec2);
    expect(shape(evaluateDiscoveryGate(r, 'rds'))).toEqual(rds);
  });
});
