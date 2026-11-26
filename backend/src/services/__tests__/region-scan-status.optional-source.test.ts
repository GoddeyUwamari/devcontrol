/**
 * Region-access PR (b), B1/B5: Resource Explorer is an optional source of a region's
 * status. A failed Resource Explorer call (the outcome names it: `operation`) in a region
 * whose core listings all completed makes the region `partial` with a Resource Explorer
 * code, never denied, failed or timed out. A cut-off core listing's code wins over it
 * (founder ruling Q2). A core failure still wins exactly as before.
 */
import {
  HOME_REGION_SOURCES,
  RESOURCE_EXPLORER_SOURCE,
  homeRegionScanStatus,
  optionalResourceExplorerFailure,
  resourceExplorerFailureCode,
} from '../region-scan-status';
import {
  NON_HOME_REGION_SOURCES,
  REGION_CODE_ACCESS_DENIED,
  REGION_CODE_ACCESS_DENIED_SCP,
  REGION_CODE_THROTTLED,
  RegionSourceOutcome,
  regionScanResult,
} from '../region-run';
import type { ResourceExplorerOperation } from '../resourceExplorer.service';
import { RESOURCE_EXPLORER_FAILURE_CODES } from '../discovery-warnings';
import type { SourceStatus } from '../source-outcome';

const CORE = HOME_REGION_SOURCES.filter((source) => source !== RESOURCE_EXPLORER_SOURCE);
const core = (changes: Record<string, SourceStatus> = {}): RegionSourceOutcome[] =>
  CORE.map((source) => ({ source, status: changes[source] ?? 'complete' }));
const explorer = (
  status: SourceStatus,
  reason: string | undefined,
  operation: ResourceExplorerOperation = 'Search',
  name = 'AccessDeniedException'
): RegionSourceOutcome => ({
  source: RESOURCE_EXPLORER_SOURCE,
  status,
  ...(reason ? { reason } : {}),
  operation,
  diagnostic: `resource-explorer:${operation}:${name}`,
});

describe('the three codes', () => {
  it('are exactly the approved ones', () => {
    expect([...RESOURCE_EXPLORER_FAILURE_CODES]).toEqual(['resource_explorer_denied', 'resource_explorer_throttled', 'resource_explorer_failed']);
  });

  it('the reason literals the code mapper reads are region-run.ts\'s own codes', () => {
    expect([REGION_CODE_ACCESS_DENIED, REGION_CODE_ACCESS_DENIED_SCP, REGION_CODE_THROTTLED]).toEqual(['access_denied', 'access_denied_scp', 'throttled']);
  });

  it.each<[string, SourceStatus, string | undefined, string]>([
    ['refused', 'denied', 'access_denied', 'resource_explorer_denied'],
    ['refused by an organization policy', 'denied', 'access_denied_scp', 'resource_explorer_denied'],
    ['throttled (a region run)', 'timed_out', 'throttled', 'resource_explorer_throttled'],
    ['throttled (no flag: status failed, reason throttled)', 'failed', 'throttled', 'resource_explorer_throttled'],
    ['a call timeout is a failure', 'timed_out', 'call_timeout', 'resource_explorer_failed'],
    ['region not ready', 'failed', 'region_not_ready', 'resource_explorer_failed'],
    ['any other error', 'failed', 'error', 'resource_explorer_failed'],
    ['no reason, denied', 'denied', undefined, 'resource_explorer_denied'],
    ['no reason, failed', 'failed', undefined, 'resource_explorer_failed'],
    ['no reason, timed out', 'timed_out', undefined, 'resource_explorer_failed'],
  ])('%s -> %s', (_label, status, reason, code) => {
    expect(resourceExplorerFailureCode({ status, reason })).toBe(code);
  });
});

describe('regionScanResult: an optional Resource Explorer failure (a region run)', () => {
  it('Resource Explorer complete: ok, unchanged', () => {
    expect(regionScanResult([...core(), { source: RESOURCE_EXPLORER_SOURCE, status: 'complete' }], false)).toEqual({ status: 'ok', errorCode: null });
  });

  it.each<ResourceExplorerOperation>(['Search', 'GetIndex', 'GetDefaultView'])('%s refused, every core listing complete: partial / resource_explorer_denied, its diagnostic', (operation) => {
    expect(regionScanResult([...core(), explorer('denied', 'access_denied', operation)], false)).toEqual({
      status: 'partial',
      errorCode: 'resource_explorer_denied',
      diagnostic: `resource-explorer:${operation}:AccessDeniedException`,
    });
  });

  it('GetDefaultView throttled: partial / resource_explorer_throttled, never denied', () => {
    const result = regionScanResult([...core(), explorer('timed_out', 'throttled', 'GetDefaultView', 'ThrottlingException')], false);
    expect(result).toEqual({ status: 'partial', errorCode: 'resource_explorer_throttled', diagnostic: 'resource-explorer:GetDefaultView:ThrottlingException' });
    expect(result?.status).not.toBe('denied');
  });

  it('Search failed with a 500, or a call timeout: partial / resource_explorer_failed', () => {
    expect(regionScanResult([...core(), explorer('failed', 'error', 'Search', 'InternalServerException')], false)).toMatchObject({
      status: 'partial', errorCode: 'resource_explorer_failed',
    });
    expect(regionScanResult([...core(), explorer('timed_out', 'call_timeout', 'Search', 'AwsCallTimeoutError')], false)).toMatchObject({
      status: 'partial', errorCode: 'resource_explorer_failed',
    });
  });

  it('a core refusal still wins: RDS denied + Resource Explorer denied -> denied / access_denied', () => {
    expect(regionScanResult([...core({ rds: 'denied' }), explorer('denied', 'access_denied')].map((o) => (o.source === 'rds' ? { ...o, reason: 'access_denied' } : o)), false))
      .toMatchObject({ status: 'denied', errorCode: 'access_denied' });
  });

  it('a core refusal still wins when Resource Explorer completed: EC2 denied -> denied / access_denied', () => {
    expect(regionScanResult([...core({ ec2: 'denied' }).map((o) => (o.source === 'ec2' ? { ...o, reason: 'access_denied' } : o)), { source: RESOURCE_EXPLORER_SOURCE, status: 'complete' }], false))
      .toEqual({ status: 'denied', errorCode: 'access_denied' });
  });

  it('several failures: a core time-out with a Resource Explorer refusal keeps today\'s worst-wins rule (denied), unchanged by PR (b)', () => {
    // A core source failed, so Resource Explorer is not optional here and the rule is the
    // one before PR (b): the worst status counted wins. (Follow-up noted in pr-b-build.md.)
    expect(regionScanResult([...core({ lambda: 'timed_out' }).map((o) => (o.source === 'lambda' ? { ...o, reason: 'call_timeout' } : o)), explorer('denied', 'access_denied')], false))
      .toMatchObject({ status: 'denied', errorCode: 'access_denied' });
    // And a core time-out alone with Resource Explorer complete is the core's own status and code.
    expect(regionScanResult([...core({ lambda: 'timed_out' }).map((o) => (o.source === 'lambda' ? { ...o, reason: 'call_timeout' } : o)), { source: RESOURCE_EXPLORER_SOURCE, status: 'complete' }], false))
      .toEqual({ status: 'timed_out', errorCode: 'call_timeout' });
  });

  it('Q2: a cut-off core listing and a Resource Explorer failure -> partial with the CORE code, no Resource Explorer diagnostic', () => {
    for (const failure of [explorer('denied', 'access_denied'), explorer('timed_out', 'throttled'), explorer('failed', 'error')]) {
      expect(regionScanResult([...core({ ebs: 'truncated' }), failure], false)).toEqual({ status: 'partial', errorCode: 'discovery_listing_truncated' });
    }
  });

  it('a Resource Explorer outcome with no failed call (its results could not be stored) keeps the worst-wins rule', () => {
    const noOperation: RegionSourceOutcome = { ...explorer('failed', 'error'), operation: undefined };
    expect(regionScanResult([...core(), noOperation], false)).toMatchObject({ status: 'failed', errorCode: 'error' });
  });

  it('no counted core source (all outside the tier): the Resource Explorer failure is the region\'s, as before', () => {
    expect(regionScanResult([...core(Object.fromEntries(CORE.map((s) => [s, 'skipped_tier']))), explorer('denied', 'access_denied')], false))
      .toMatchObject({ status: 'denied', errorCode: 'access_denied' });
  });

  it('a non-home region: security groups count as core (a failed one wins; complete ones let Resource Explorer be optional)', () => {
    const sgFailed: RegionSourceOutcome = { source: 'security-groups', status: 'denied', reason: 'access_denied' };
    expect(regionScanResult([...core(), sgFailed, explorer('denied', 'access_denied')], false, NON_HOME_REGION_SOURCES))
      .toMatchObject({ status: 'denied', errorCode: 'access_denied' });
    expect(regionScanResult([...core(), { source: 'security-groups', status: 'complete' }, explorer('denied', 'access_denied')], false, NON_HOME_REGION_SOURCES))
      .toMatchObject({ status: 'partial', errorCode: 'resource_explorer_denied' });
  });

  it('a region past its deadline stays timed_out / region_deadline', () => {
    expect(regionScanResult([...core(), explorer('denied', 'access_denied')], true)).toEqual({ status: 'timed_out', errorCode: 'region_deadline' });
  });

  it('a truncated (not failed) Resource Explorer search keeps its existing code', () => {
    expect(regionScanResult([...core(), { source: RESOURCE_EXPLORER_SOURCE, status: 'truncated' }], false))
      .toEqual({ status: 'partial', errorCode: 'deletion_detection_paused_truncated_index' });
  });
});

describe('homeRegionScanStatus without the flag: the same rule for the home region', () => {
  it('a refused Search (status denied, reason access_denied) -> partial / resource_explorer_denied with its diagnostic', () => {
    expect(homeRegionScanStatus([...core(), explorer('denied', 'access_denied')])).toEqual({
      status: 'partial', errorCode: 'resource_explorer_denied', diagnostic: 'resource-explorer:Search:AccessDeniedException',
    });
  });

  it('a throttled GetDefaultView (status failed, reason throttled) -> partial / resource_explorer_throttled', () => {
    expect(homeRegionScanStatus([...core(), explorer('failed', 'throttled', 'GetDefaultView', 'ThrottlingException')])).toMatchObject({
      status: 'partial', errorCode: 'resource_explorer_throttled',
    });
  });

  it('a core failure without the flag keeps today\'s rule: worst wins, no code', () => {
    expect(homeRegionScanStatus([...core({ rds: 'failed' }), explorer('denied', 'access_denied')])).toEqual({ status: 'denied', errorCode: null });
    expect(homeRegionScanStatus([...core({ rds: 'failed' }), explorer('failed', 'error')])).toEqual({ status: 'failed', errorCode: null });
  });
});

describe('optionalResourceExplorerFailure', () => {
  it('names the outcome and whether a core listing was cut off; null otherwise', () => {
    const failure = explorer('denied', 'access_denied');
    expect(optionalResourceExplorerFailure([...core(), failure])).toEqual({ outcome: failure, coreTruncated: false });
    expect(optionalResourceExplorerFailure([...core({ ec2: 'truncated' }), failure])).toEqual({ outcome: failure, coreTruncated: true });
    expect(optionalResourceExplorerFailure([...core({ ec2: 'denied' }), failure])).toBeNull();
    expect(optionalResourceExplorerFailure([...core(), { source: RESOURCE_EXPLORER_SOURCE, status: 'complete' }])).toBeNull();
    expect(optionalResourceExplorerFailure(core())).toBeNull();
  });
});
