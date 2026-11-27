/**
 * C3a: the Summary card's lines from the latest run's unused CloudWatch log group check -- the log groups below the
 * stored-size floor (one line, founder ruling D3) and the ones skipped for a name over 255 characters (ruling D10).
 * Read from that run's own record only; a check that didn't complete, or a count or floor that isn't one, gives no
 * line (never a guessed 0).
 */
import type { CostAnalysisCheck } from '@/lib/services/cost-recommendations.service'
import { logGroupsBelowFloor, logGroupsNameTooLong } from './costOptimizationCopy'

const UNUSED_LOG_GROUPS_RULE_ID = 'cloudwatch_unused_logs'
// The backend's display of the floor: digits, optional thousands separators, one decimal ("35.7").
const FLOOR_GB = /^\d{1,3}(,\d{3})*\.\d$/

const positiveCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0

export function logGroupSummaryLines(checks: readonly CostAnalysisCheck[] | null | undefined): string[] {
  if (!Array.isArray(checks)) return []
  const check = checks.find((c) => c.rule_id === UNUSED_LOG_GROUPS_RULE_ID)
  if (!check || check.outcome !== 'complete') return []
  const counts = check.cloudwatch_logs_unused
  if (!counts || typeof counts !== 'object') return []
  const lines: string[] = []
  const below = counts.below_floor
  if (below && positiveCount(below.count) && typeof below.floor_gb === 'string' && FLOOR_GB.test(below.floor_gb)) {
    lines.push(logGroupsBelowFloor(below.count, below.floor_gb))
  }
  const tooLong = counts.skipped?.name_too_long
  if (positiveCount(tooLong)) lines.push(logGroupsNameTooLong(tooLong))
  return lines
}
