import { lifecycleStateFor } from './resourceLifecycle';

/**
 * How one aws_resources row reads in GET /api/infrastructure.
 *
 * Kept apart from the controller so the two rules below -- the state shown and
 * the cost shown -- can be tested without a database.
 */

/**
 * Resource types whose stored estimated_monthly_cost is a fixed placeholder, not
 * an estimate of that resource: every S3 bucket is stored at $5
 * (awsResourceDiscovery.ts estimateS3Cost, "Fixed estimate"). The API reports
 * these as not estimated (null). The stored value is left as it is.
 */
export const PLACEHOLDER_ESTIMATE_RESOURCE_TYPES: readonly string[] = ['s3'];

/**
 * The lifecycle state to show for a row, or null when there is none to show
 * (see lifecycleStateFor).
 *
 * An EBS volume's state is AWS's own volume state, as discovery stored it:
 * 'available' means not attached to any instance, 'in-use' means attached. A
 * volume does not run, so it is never reported as 'running' or 'pending'.
 * Every other type keeps the running/stopped/pending reading.
 */
export function infrastructureStatusFor(resourceType: string, storedStatus: string | null | undefined): string | null {
  const state = lifecycleStateFor(resourceType, storedStatus);
  if (state === null) return null;
  const s = state.toLowerCase();
  if (resourceType.toLowerCase() === 'ebs') return s;
  return s === 'available' ||
    s === 'running' ||
    s === 'active' ||
    s === 'in-use'
    ? 'running'
    : s === 'stopped'
      ? 'stopped'
      : 'pending';
}

/**
 * The estimated monthly cost to show for a row: null (never 0) when it has not
 * been calculated (e.g. a Lambda function whose CloudWatch usage lookup failed
 * on its most recent discovery -- estimated_monthly_cost is nullable precisely
 * to distinguish "unknown" from "confirmed $0", see
 * awsResourceDiscovery.ts::discoverLambdaFunctions()), and null when the stored
 * figure is a placeholder (PLACEHOLDER_ESTIMATE_RESOURCE_TYPES).
 */
export function infrastructureCostFor(resourceType: string, estimatedMonthlyCost: string | number | null | undefined): number | null {
  if (PLACEHOLDER_ESTIMATE_RESOURCE_TYPES.includes(resourceType)) return null;
  return estimatedMonthlyCost != null ? parseFloat(String(estimatedMonthlyCost)) : null;
}
