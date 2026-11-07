/**
 * The label a cost finding is shown under. The stored `issue` string is the
 * finding's identity and never changes; only findings the low-activity rule
 * produced (metadata carrying its identity) are shown as "Low-activity
 * instance" (W1, FP2b-Q19). Every other row, including the historical
 * CPU-only "Idle Instance" rows and their decisions, keeps its stored text.
 *
 * Frontend mirror: lib/finding-display.ts. Pure.
 */
import { ISSUE_EC2_IDLE_INSTANCE } from '../config/optimization-rules';
import { LOW_ACTIVITY_DISPLAY_LABEL, hasLowActivityRuleIdentity } from '../config/low-activity-rule';

/** True for a finding the low-activity rule produced. */
export function isLowActivityFinding(issue: string, metadata: unknown): boolean {
  return issue === ISSUE_EC2_IDLE_INSTANCE && hasLowActivityRuleIdentity(metadata);
}

export function displayIssue(issue: string, metadata: unknown): string {
  return isLowActivityFinding(issue, metadata) ? LOW_ACTIVITY_DISPLAY_LABEL : issue;
}
