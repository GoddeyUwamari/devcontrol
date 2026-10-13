/**
 * Deployment status mapping and change-failure-rate maths.
 *
 * Statuses are reported as recorded: the GitHub deploy webhook writes
 * 'success' / 'failed', POST /api/deployments writes 'deploying', and nothing
 * updates a row afterwards. Anything else is unknown -- it is never folded
 * into another state.
 */
import {
  IN_PROGRESS_MAX_AGE_HOURS,
  changeFailureRate,
  classifyDeploymentStatus,
  isStatsWindow,
} from '../deployment-status';

const NOW = new Date('2026-01-15T12:00:00.000Z');
const hoursBefore = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('classifyDeploymentStatus', () => {
  it('reports the webhook statuses as recorded, whatever their age', () => {
    expect(classifyDeploymentStatus('success', hoursBefore(1), NOW)).toBe('success');
    expect(classifyDeploymentStatus('success', hoursBefore(5000), NOW)).toBe('success');
    expect(classifyDeploymentStatus('failed', hoursBefore(1), NOW)).toBe('failed');
    expect(classifyDeploymentStatus('failed', null, NOW)).toBe('failed');
  });

  it("a 'deploying' row is in progress only while it is recent", () => {
    expect(classifyDeploymentStatus('deploying', hoursBefore(0), NOW)).toBe('in_progress');
    expect(classifyDeploymentStatus('deploying', hoursBefore(IN_PROGRESS_MAX_AGE_HOURS - 0.01), NOW)).toBe('in_progress');
    expect(classifyDeploymentStatus('deploying', hoursBefore(1).toISOString(), NOW)).toBe('in_progress');
  });

  it("an older 'deploying' row has no completion on record -- it is not still in progress", () => {
    expect(classifyDeploymentStatus('deploying', hoursBefore(IN_PROGRESS_MAX_AGE_HOURS), NOW)).toBe('no_completion_recorded');
    expect(classifyDeploymentStatus('deploying', hoursBefore(24 * 30), NOW)).toBe('no_completion_recorded');
  });

  it("a 'deploying' row with no usable creation time has no completion on record", () => {
    expect(classifyDeploymentStatus('deploying', null, NOW)).toBe('no_completion_recorded');
    expect(classifyDeploymentStatus('deploying', undefined, NOW)).toBe('no_completion_recorded');
    expect(classifyDeploymentStatus('deploying', 'not-a-date', NOW)).toBe('no_completion_recorded');
  });

  it.each([
    'running', 'stopped', 'cancelled', 'timed_out', 'SUCCESS', 'Success', 'succeeded', 'failure', '', ' success',
  ])('an unrecognised status (%p) is unknown, never another state', (status) => {
    expect(classifyDeploymentStatus(status, hoursBefore(0), NOW)).toBe('unknown');
  });

  it.each([null, undefined, 0, 1, true, {}, []])('a non-string status (%p) is unknown', (status) => {
    expect(classifyDeploymentStatus(status, hoursBefore(0), NOW)).toBe('unknown');
  });
});

describe('changeFailureRate', () => {
  it('is failed / (success + failed) as a percentage', () => {
    expect(changeFailureRate(3, 1)).toBe(25);
    expect(changeFailureRate(198, 2)).toBe(1);
    expect(changeFailureRate(0, 4)).toBe(100);
  });

  it('is a real 0 when deployments finished and none failed', () => {
    expect(changeFailureRate(12, 0)).toBe(0);
  });

  it('is null -- not 0 -- when nothing finished', () => {
    expect(changeFailureRate(0, 0)).toBeNull();
  });

  it('rounds to one decimal place', () => {
    expect(changeFailureRate(2, 1)).toBe(33.3);
    expect(changeFailureRate(1, 2)).toBe(66.7);
    expect(changeFailureRate(199, 1)).toBe(0.5);
  });
});

describe('isStatsWindow', () => {
  it('accepts only the three supported windows', () => {
    expect(['7d', '30d', '90d'].every(isStatsWindow)).toBe(true);
    expect(['', '1d', '30', 'all', 'toString', '__proto__', undefined, null, 30].some(isStatsWindow)).toBe(false);
  });
});
