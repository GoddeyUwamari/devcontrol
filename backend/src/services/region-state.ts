/**
 * One multi-region region's state (multi-region PR 2, review M-2), derived from the
 * codes aws_account_regions already holds. Pure (no database, no AWS): the coverage API
 * (routes/services-coverage.routes.ts) and the AI region scope (ai-region-scope.ts) both
 * use it, so the two never disagree.
 */
import { REGION_CODE_DEADLINE, REGION_CODE_NOT_READY, REGION_CODE_SCAN_BUDGET } from './region-run';

/**
 * One region's state (review M-2), derived on the server from the existing codes:
 *
 *   not_started            no result yet: waiting in the running scan, or never scanned
 *   in_progress            running in the running scan
 *   checked                last result ok, no warning code
 *   checked_with_warnings  last result ok with a Resource Explorer code, or partial
 *   failed                 failed (error), or timed out on throttling / one call's limit
 *                          (throttled, call_timeout): the check did not complete
 *   not_checked_budget     never started: the scan budget ran out (timed_out, scan_budget)
 *   not_checked_deadline   started, ran past its deadline (timed_out, region_deadline)
 *   denied                 refused (access_denied, access_denied_scp)
 *   not_ready              enabled but not usable yet (failed, region_not_ready)
 *   excluded               kept out of scans by the account's allow-list (scan_enabled = false)
 *
 * The running scan decides in_progress / not_started for a region not done in it;
 * otherwise the region's last recorded result does (status and error_code keep the detail).
 */
export type RegionState =
  | 'not_started'
  | 'in_progress'
  | 'checked'
  | 'checked_with_warnings'
  | 'failed'
  | 'not_checked_budget'
  | 'not_checked_deadline'
  | 'denied'
  | 'not_ready'
  | 'excluded';

export const REGION_STATES: readonly RegionState[] = [
  'not_started', 'in_progress', 'checked', 'checked_with_warnings', 'failed',
  'not_checked_budget', 'not_checked_deadline', 'denied', 'not_ready', 'excluded',
];

/** A region's single state (review M-2): see RegionState. */
export function regionState(status: string, errorCode: string | null, scanState: 'done' | 'running' | 'waiting' | 'excluded' | null, scanEnabled: boolean): RegionState {
  if (!scanEnabled) return 'excluded';
  if (scanState === 'running') return 'in_progress';
  if (scanState === 'waiting') return 'not_started';
  switch (status) {
    case 'ok':
      return errorCode === null ? 'checked' : 'checked_with_warnings';
    case 'partial':
      return 'checked_with_warnings';
    case 'denied':
      return 'denied';
    case 'failed':
      return errorCode === REGION_CODE_NOT_READY ? 'not_ready' : 'failed';
    case 'timed_out':
      if (errorCode === REGION_CODE_SCAN_BUDGET) return 'not_checked_budget';
      if (errorCode === REGION_CODE_DEADLINE) return 'not_checked_deadline';
      return 'failed';
    default:
      // never_scanned, and the statuses no scan writes (skipped_locked, not_enabled): nothing checked.
      return 'not_started';
  }
}
