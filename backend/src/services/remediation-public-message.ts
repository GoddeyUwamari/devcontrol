/**
 * What a remediation request's caller may see when it fails. Shared by the
 * remediation routes and POST /api/cost-recommendations/:id/execute-remediation,
 * so both answer with the same allow-list: a known fixed refusal, or the
 * route's fixed fallback. AWS SDK and database text (which can carry ARNs,
 * SQL or row values) never reaches a response; it is logged server-side
 * through safeErrorFields only.
 */
import {
  ACTION_UNAVAILABLE_PREFIX,
  TARGET_MISMATCH_PREFIX,
  REGION_MISMATCH_PREFIX,
  REGION_UNKNOWN_MESSAGE,
  REGION_AMBIGUOUS_MESSAGE,
  REGION_INVENTORY_MISMATCH_MESSAGE,
  REGION_BINDING_CONFLICT_MESSAGE,
  SELF_PROTECTION_PUBLIC_MESSAGE,
  isSelfProtectionRefusal,
} from './remediation.service';
import { safeErrorFields } from '../utils/safe-error-log';

// Refusals written in remediation.service.ts whose text is safe to show the
// caller: fixed sentences, or ones that add only a workflow status. Any other
// error (AWS SDK and database errors included) is answered with the route's
// fixed message, and its detail goes to the server log only.
const PUBLIC_REFUSALS = new Set<string>([
  'Workflow not found',
  'DRY_RUN_MODE: Automated remediation is disabled. No AWS action was taken.',
  'REMEDIATION_BLOCKED: Workflow action target does not match its resource_id. No AWS action was taken.',
  REGION_UNKNOWN_MESSAGE,
  REGION_AMBIGUOUS_MESSAGE,
  REGION_INVENTORY_MISMATCH_MESSAGE,
  REGION_BINDING_CONFLICT_MESSAGE,
  'Rollback is not available for this workflow',
  'Can only rollback completed workflows',
  'No active AWS account configured. Connect an AWS account first.',
  'Failed to obtain temporary AWS credentials',
]);

const PUBLIC_REFUSAL_PATTERNS: RegExp[] = [
  /^Cannot (approve|reject) workflow in status: [a-z_]+$/,
  /^Workflow must be approved before executing\. Current status: [a-z_]+$/,
  new RegExp(`^${REGION_MISMATCH_PREFIX} actionParams\\.region must be an AWS region$`),
  new RegExp(`^${REGION_MISMATCH_PREFIX} the resource is in more than one region; its region cannot be chosen$`),
  new RegExp(`^${REGION_MISMATCH_PREFIX} actionParams\\.region must be the resource's region \\([a-z]{2}(-[a-z]+)+-\\d+\\)$`),
];

/** The error text the caller may see, or `fallback` for anything else. */
export function publicRemediationMessage(err: any, fallback: string): string {
  const message = err?.message;
  if (typeof message !== 'string') return fallback;
  if (isSelfProtectionRefusal(message)) return SELF_PROTECTION_PUBLIC_MESSAGE;
  if (PUBLIC_REFUSALS.has(message)) return message;
  // Every producer of these two prefixes writes a fixed sentence.
  if (message.startsWith(ACTION_UNAVAILABLE_PREFIX) || message.startsWith(TARGET_MISMATCH_PREFIX)) return message;
  if (PUBLIC_REFUSAL_PATTERNS.some((pattern) => pattern.test(message))) return message;
  return fallback;
}

/** Logs a failed remediation request without the error object (see safeErrorFields). */
export function logRemediationError(operation: string, workflowId: string | undefined, err: unknown): void {
  console.error(`[Remediation] ${operation} error:`, { workflowId, ...safeErrorFields(err) });
}
