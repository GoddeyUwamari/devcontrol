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

// AWS DynamoDB Provisioned Capacity pricing, us-east-1, $/unit-hour --
// fetched directly from AWS's own official pricing page
// (https://aws.amazon.com/dynamodb/pricing/provisioned/, worked-example
// figures, cross-checked across two independent fetches of the same page)
// on 2026-09-07. Not a live AWS Pricing API call; re-verify against that
// same page before relying on this for a real customer-facing dollar figure
// if meaningful time has passed.
//
// Two table classes, each with its own RCU/WCU rate -- Standard (the
// default AWS assumes when no table class is specified, not a guess this
// codebase is making) and Standard-IA (a real, distinct, higher rate; see
// DynamoDBTableConfig.table_class in dynamodb-table.util.ts, already
// discovered today).
//
// This models PROVISIONED capacity only. On-demand pricing
// ($0.6250 per million writes, $0.125 per million reads, same source) is a
// completely different pricing model (per-request, not per-hour-capacity)
// and belongs to the separate, deliberately deferred
// dynamodb_on_demand_vs_provisioned rule -- not implemented here.
//
// Does not model: the perpetual free tier (25 WCUs + 25 RCUs per region per
// month, account-wide, not attributable to one table -- same simplification
// already made for Lambda's free tier above); Global Table replicated-write
// capacity (each replica incurs its own WCU charges under a materially
// different model not covered by this per-table calculation); Reserved
// Capacity discounts (up to ~54-77% off list price for 1-3 year commitments
// -- a distinct purchasing option, not the on-demand-provisioned rate this
// codebase's other estimates already model everywhere else, e.g. EC2/RDS
// not modeling Reserved Instances/Savings Plans either).
export const DYNAMODB_PROVISIONED_RCU_PER_HOUR_USD: Record<string, number> = {
  STANDARD: 0.00013,
  STANDARD_INFREQUENT_ACCESS: 0.00016,
};
export const DYNAMODB_PROVISIONED_WCU_PER_HOUR_USD: Record<string, number> = {
  STANDARD: 0.00065,
  STANDARD_INFREQUENT_ACCESS: 0.00081,
};

export function estimateDynamoDBProvisionedMonthlyCost(
  readCapacityUnits: number,
  writeCapacityUnits: number,
  tableClass?: string
): number {
  const resolvedClass = tableClass && DYNAMODB_PROVISIONED_RCU_PER_HOUR_USD[tableClass] !== undefined
    ? tableClass
    : 'STANDARD';
  const hoursPerMonth = 730; // same 730-hours/month convention already used by estimateLBCost() in awsResourceDiscovery.ts
  const rcuCost = readCapacityUnits * DYNAMODB_PROVISIONED_RCU_PER_HOUR_USD[resolvedClass] * hoursPerMonth;
  const wcuCost = writeCapacityUnits * DYNAMODB_PROVISIONED_WCU_PER_HOUR_USD[resolvedClass] * hoursPerMonth;
  return rcuCost + wcuCost;
}

// AWS DynamoDB On-Demand Capacity pricing, us-east-1, $/million request
// units -- fetched directly from AWS's own official pricing page
// (https://aws.amazon.com/dynamodb/pricing/on-demand/) on 2026-09-08, and
// cross-checked against AWS's Developer Guide for the request-unit
// definitions themselves
// (https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/read-write-operations.html).
// Not a live AWS Pricing API call; re-verify against that page before
// relying on this for a real customer-facing dollar figure if meaningful
// time has passed.
//
// A read capacity unit (RCU) and a read request unit (RRU) -- and
// symmetrically a write capacity unit (WCU) and write request unit (WRU) --
// are the same underlying unit of consumption. AWS defines the request-unit
// accounting rules (4 KB rounding and the strongly-consistent/eventually-
// consistent/transactional multipliers for reads; 1 KB rounding and the
// transactional multiplier for writes) once, independent of billing mode;
// capacity mode only changes how that consumption is billed
// (pre-provisioned-and-averaged vs. pay-per-request). This is why a
// currently-PROVISIONED table's real ConsumedRead/WriteCapacityUnits history
// is a direct, lossless stand-in for the RRU/WRU volume that same historical
// workload would have billed under on-demand -- see
// dynamodb-capacity-analysis.util.ts's analyzeDynamoDBModeComparisonDimension(),
// which builds the on-demand side of the `dynamodb_on_demand_vs_provisioned`
// comparison from exactly that history, and estimateDynamoDBOnDemandCostFromRequestUnits()
// below, which turns it into a dollar figure.
//
// Does not model (same v1 scope decision as the provisioned constants
// above, and confirmed by the Phase 3E methodology checkpoint): the
// perpetual free tier (25 WCU + 25 RCU per region per month, account-wide,
// not attributable to one table); Database Savings Plans (up to 18% off
// on-demand throughput -- a billing-relationship fact this service cannot
// observe without Cost Explorer/Billing integration); Global Table
// replicated-write pricing (rWRU, billed per replica region -- a completely
// different, unmodeled multiplier callers must exclude those tables for);
// Reserved Provisioned Capacity (a provisioned-only purchasing option, and
// not eligible for Standard-IA or replicated capacity even there).
export const DYNAMODB_ON_DEMAND_RRU_PRICE_PER_MILLION_USD: Record<string, number> = {
  STANDARD: 0.125,
  STANDARD_INFREQUENT_ACCESS: 0.155,
};
export const DYNAMODB_ON_DEMAND_WRU_PRICE_PER_MILLION_USD: Record<string, number> = {
  STANDARD: 0.625,
  STANDARD_INFREQUENT_ACCESS: 0.780,
};

export function estimateDynamoDBOnDemandCostFromRequestUnits(
  readRequestUnits: number,
  writeRequestUnits: number,
  tableClass?: string
): number {
  const resolvedClass = tableClass && DYNAMODB_ON_DEMAND_RRU_PRICE_PER_MILLION_USD[tableClass] !== undefined
    ? tableClass
    : 'STANDARD';
  const readCost = (readRequestUnits / 1_000_000) * DYNAMODB_ON_DEMAND_RRU_PRICE_PER_MILLION_USD[resolvedClass];
  const writeCost = (writeRequestUnits / 1_000_000) * DYNAMODB_ON_DEMAND_WRU_PRICE_PER_MILLION_USD[resolvedClass];
  return readCost + writeCost;
}

/**
 * Window-based provisioned-capacity cost. Unlike
 * estimateDynamoDBProvisionedMonthlyCost() above -- which assumes a single,
 * unchanging capacity setting held for a canonical 730-hour month, the right
 * model for `dynamodb_capacity`'s illustrative scenario -- this takes the
 * caller's own already-summed RCU-hours/WCU-hours actually observed over its
 * real analysis window (hourly Average(ProvisionedReadCapacityUnits) x 1
 * hour, summed only across valid intervals; see
 * dynamodb-capacity-analysis.util.ts's analyzeDynamoDBModeComparisonDimension()).
 * `dynamodb_on_demand_vs_provisioned` needs this instead so its provisioned
 * side and on-demand side are both built from the identical observed hours,
 * never a synthetic full-month projection on one side only. Reuses the same
 * per-unit-hour rate constants as estimateDynamoDBProvisionedMonthlyCost() --
 * do not duplicate the rate table.
 */
export function estimateDynamoDBProvisionedCostFromUnitHours(
  readCapacityUnitHours: number,
  writeCapacityUnitHours: number,
  tableClass?: string
): number {
  const resolvedClass = tableClass && DYNAMODB_PROVISIONED_RCU_PER_HOUR_USD[tableClass] !== undefined
    ? tableClass
    : 'STANDARD';
  const rcuCost = readCapacityUnitHours * DYNAMODB_PROVISIONED_RCU_PER_HOUR_USD[resolvedClass];
  const wcuCost = writeCapacityUnitHours * DYNAMODB_PROVISIONED_WCU_PER_HOUR_USD[resolvedClass];
  return rcuCost + wcuCost;
}
