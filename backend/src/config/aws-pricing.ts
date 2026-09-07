/**
 * Explicit, defensible AWS pricing assumptions shared between resource
 * discovery's `estimated_monthly_cost` field and the cost-optimization
 * analyzers' `potential_savings` calculations, so the two never diverge on
 * what a resource is assumed to cost.
 *
 * These are published AWS on-demand list prices for us-east-1, verified at
 * the time this was written -- not a live AWS Pricing API call, and not
 * adjusted per-region or per-account. Every existing detector in
 * cost-optimization.service.ts (estimateEC2Cost, estimateRDSCost) already
 * follows this same "explicit hardcoded table, not fabricated" convention;
 * this file only centralizes the EBS table introduced alongside it instead
 * of duplicating it between awsResourceDiscovery.ts and
 * cost-optimization.service.ts.
 */

// AWS EBS pricing, us-east-1, $/GB-month. Does not include provisioned
// IOPS/throughput surcharges on io1/io2/gp3, or snapshot storage.
export const EBS_PER_GB_MONTH_USD: Record<string, number> = {
  gp2: 0.10,
  gp3: 0.08,
  io1: 0.125,
  io2: 0.125,
  st1: 0.045,
  sc1: 0.015,
  standard: 0.05,
};

export function estimateEBSMonthlyCost(volumeType: string | undefined, sizeGB: number): number {
  const rate = EBS_PER_GB_MONTH_USD[volumeType || ''] ?? EBS_PER_GB_MONTH_USD.gp2;
  return sizeGB * rate;
}

// AWS S3 storage pricing, us-east-1, $/GB-month, first 50TB tier -- verified
// via AWS's published pricing (confirmed current as of 2026-09-06) -- used
// only by the s3_lifecycle analyzer's ceiling estimate (see
// cost-optimization.service.ts): "if every byte currently in Standard
// storage were eligible for a lifecycle transition to Standard-IA, this is
// the maximum monthly saving" -- the same "assumes full remediation" framing
// every other detector in this codebase already uses (e.g. idle EC2's saving
// assumes the instance is fully stopped). Does NOT net out Standard-IA's
// ~$0.01/GB retrieval fee or its higher per-request cost -- the ceiling
// assumes the transitioned data is genuinely infrequently accessed, which is
// the entire premise of recommending the transition in the first place; this
// is disclosed in the recommendation's description, not hidden.
export const S3_STANDARD_PER_GB_MONTH_USD = 0.023;
export const S3_STANDARD_IA_PER_GB_MONTH_USD = 0.0125;

// AWS Lambda on-demand pricing (x86), verified current as of 2026-09-06.
// Does not model the perpetual free tier (1M requests + 400,000 GB-seconds
// per month, shared account-wide across all functions, not attributable to
// one function) -- same simplification the existing EC2/RDS estimates in
// this codebase already make by not modeling Reserved/Savings Plans pricing.
export const LAMBDA_PRICE_PER_MILLION_REQUESTS_USD = 0.20;
export const LAMBDA_PRICE_PER_GB_SECOND_USD = 0.0000166667;

export function estimateLambdaMonthlyCostFromUsage(
  invocations: number,
  avgDurationMs: number,
  memoryMB: number
): number {
  const memoryGB = memoryMB / 1024;
  const durationSeconds = avgDurationMs / 1000;
  const requestCost = (invocations / 1_000_000) * LAMBDA_PRICE_PER_MILLION_REQUESTS_USD;
  const computeCost = invocations * durationSeconds * memoryGB * LAMBDA_PRICE_PER_GB_SECOND_USD;
  return requestCost + computeCost;
}
