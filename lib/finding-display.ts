/**
 * The label a cost finding is shown under -- the frontend mirror of
 * backend/src/services/finding-display.ts (identity: LOW_ACTIVITY_RULE in
 * backend/src/config/low-activity-rule.ts). The stored `issue` text never
 * changes; only findings the low-activity rule produced are shown as
 * "Low-activity instance". Historical rows keep their stored text.
 */

const IDLE_INSTANCE_ISSUE = 'Idle Instance'
const LOW_ACTIVITY_RULE_ID = 'ec2_low_activity'
const LOW_ACTIVITY_RULE_VERSION = 2

export const LOW_ACTIVITY_DISPLAY_LABEL = 'Low-activity instance'

export function hasLowActivityRuleIdentity(metadata: unknown): boolean {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  const m = metadata as Record<string, unknown>
  if (typeof m.rule_version !== 'number' || m.rule_version !== LOW_ACTIVITY_RULE_VERSION) return false
  const rule = m.rule
  if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) return false
  const r = rule as Record<string, unknown>
  return r.id === LOW_ACTIVITY_RULE_ID && r.version === LOW_ACTIVITY_RULE_VERSION
}

/** True for a finding the low-activity rule produced. */
export function isLowActivityFinding(rec: { issue?: string | null; metadata?: Record<string, unknown> | null }): boolean {
  return rec.issue === IDLE_INSTANCE_ISSUE && hasLowActivityRuleIdentity(rec.metadata)
}

export function displayIssue(rec: { issue?: string | null; metadata?: Record<string, unknown> | null }): string | null {
  if (isLowActivityFinding(rec)) return LOW_ACTIVITY_DISPLAY_LABEL
  return rec.issue ?? null
}

/** The storage sentence shown with a low-activity finding's figure (W3). */
export const LOW_ACTIVITY_STORAGE_NOTE = "Doesn't include storage, which is still billed while an instance is stopped."

/**
 * The headline figure of a low-activity finding (W3, C-3). `format` is the surface's own currency formatter.
 * `kind` is the amount's savings basis (savingsBasisKind): "Up to" only for anything but an estimate
 * (Cost Optimization tidy round 4): an estimate reads "$X/mo if it's no longer needed".
 */
export function lowActivitySavingsHeadline(potentialSavings: number, format: (value: number) => string, kind?: 'estimate' | 'ceiling' | null): string {
  const figure = `${format(potentialSavings)}/mo if it's no longer needed`
  return kind === 'estimate' ? figure : `Up to ${figure}`
}

/** The basis line for a list-price figure (C-3): the table is us-east-1 for every region. */
export function lowActivityListPriceBasis(instanceType: string): string {
  return `Estimated from list price for ${instanceType} in us-east-1. ${LOW_ACTIVITY_STORAGE_NOTE}`
}

// ─── Idle RDS instance-hour estimate (C1b) ──────────────────────────────────

const IDLE_RDS_ISSUE = 'Idle RDS Instance'

/** What every idle RDS explanation ends with (founder-approved copy, C1b Q11). */
const RDS_IDLE_SAVINGS_CAVEATS =
  "instance hours only; a reserved instance would lower the actual saving. Storage and backups are still billed while it's stopped, and AWS restarts a stopped database after 7 days."

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

/**
 * The explanation under an idle RDS finding's figure on the Cost Optimization
 * card: only for an estimate (savings_basis 'estimated:', see
 * lib/savings-basis.ts), never for "No dollar estimate". Region, class, engine
 * and deployment are the finding's own price key (metadata.price_*, written by
 * backend/src/services/rds-idle-evaluation.ts rdsIdleSavingsMetadata). If one
 * is missing, the same sentence without the specifics -- never a guessed value.
 */
export function rdsIdleSavingsExplanation(rec: { issue?: string | null; metadata?: Record<string, unknown> | null }): string | null {
  if (rec.issue !== IDLE_RDS_ISSUE) return null
  const m = rec.metadata
  if (!m || typeof m.savings_basis !== 'string' || !m.savings_basis.startsWith('estimated:')) return null
  const { price_region: region, price_instance_class: instanceClass, price_engine_label: engine, price_deployment: deployment } = m
  if (nonEmpty(region) && nonEmpty(instanceClass) && nonEmpty(engine) && nonEmpty(deployment)) {
    return `Estimated from the ${region} on-demand list price for ${instanceClass} (${engine}, ${deployment}), ${RDS_IDLE_SAVINGS_CAVEATS}`
  }
  return `Estimated from the on-demand list price, ${RDS_IDLE_SAVINGS_CAVEATS}`
}

/** Shown read-only on Optimization Controls where the adjustable ec2_idle control was (C-6). */
export const LOW_ACTIVITY_FIXED_THRESHOLDS =
  'Low-activity instances: peak CPU under 10% and network under 5 MB a day, every day for 30 days, and not behind a load balancer or in an Auto Scaling group. These thresholds are fixed.'
