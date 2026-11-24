/**
 * Explicit, defensible AWS pricing assumptions shared between resource
 * discovery's `estimated_monthly_cost` field and the cost-optimization
 * analyzers' `potential_savings` calculations, so the two never diverge on
 * what a resource is assumed to cost.
 *
 * These are published AWS on-demand list prices for us-east-1, verified at
 * the time this was written -- not a live AWS Pricing API call, and not
 * adjusted per-region or per-account. Every existing detector in
 * cost-optimization.service.ts (estimateEC2Cost) already
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

// Amazon EBS Snapshots, Standard tier storage, $/GB-month, PER REGION -- used
// only by the ebs_old_snapshots rule's upper bound (C1). Unlike the volume
// table above, this table is regional and never falls back to another region's
// price: a region missing here gives no dollar figure at all.
//
// Source: AWS's public price data for Amazon EBS, the data the EBS pricing page
// renders -- https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ebs.json,
// usage "Storage Snapshot Amazon S3 GB Mo", publication date (its
// manifest.hawkFilePublicationDate) 2026-11-21T00:48:16Z, retrieved 2026-11-23.
// Region names were mapped to codes with AWS's public location list,
// https://b0.p.awsstatic.com/locations/1.0/aws/current/locations.json (type
// "AWS Region"). Every commercial AWS region with a published price is listed;
// AWS GovCloud (another partition, never a home region here) and Local Zones are
// not. Re-verify against the same source before relying on these after time has
// passed. Copies of both files: review-logs/cost-optimization/c1-evidence/.
export const EBS_SNAPSHOT_STANDARD_PRICE_SOURCE = {
  url: 'https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ebs.json',
  usage: 'Storage Snapshot Amazon S3 GB Mo',
  published: '2026-11-21T00:48:16Z',
  retrieved: '2026-11-23',
} as const;

export const EBS_SNAPSHOT_STANDARD_PER_GB_MONTH_USD_BY_REGION: Readonly<Record<string, number>> = Object.freeze({
  'af-south-1': 0.0595,
  'ap-east-1': 0.055,
  'ap-east-2': 0.045,
  'ap-northeast-1': 0.05,
  'ap-northeast-2': 0.05,
  'ap-northeast-3': 0.05,
  'ap-south-1': 0.05,
  'ap-south-2': 0.05,
  'ap-southeast-1': 0.05,
  'ap-southeast-2': 0.055,
  'ap-southeast-3': 0.05,
  'ap-southeast-4': 0.055,
  'ap-southeast-5': 0.045,
  'ap-southeast-6': 0.0577,
  'ap-southeast-7': 0.045,
  'ca-central-1': 0.055,
  'ca-west-1': 0.055,
  'eu-central-1': 0.054,
  'eu-central-2': 0.059,
  'eu-north-1': 0.0475,
  'eu-south-1': 0.0525,
  'eu-south-2': 0.05,
  'eu-west-1': 0.05,
  'eu-west-2': 0.053,
  'eu-west-3': 0.053,
  'il-central-1': 0.06,
  'me-central-1': 0.055,
  'me-south-1': 0.055,
  'mx-central-1': 0.053,
  'sa-east-1': 0.068,
  'us-east-1': 0.05,
  'us-east-2': 0.05,
  'us-west-1': 0.055,
  'us-west-2': 0.05,
});

/** The region's standard snapshot storage price ($/GB-month), or null when the table has none -- never another region's. */
export function ebsSnapshotStandardPricePerGbMonth(region: string | undefined | null): number | null {
  if (!region || !Object.prototype.hasOwnProperty.call(EBS_SNAPSHOT_STANDARD_PER_GB_MONTH_USD_BY_REGION, region)) return null;
  return EBS_SNAPSHOT_STANDARD_PER_GB_MONTH_USD_BY_REGION[region];
}

// NAT gateway hourly charge, $/hour, PER REGION -- used only by the
// nat_gateway_idle rule's estimate (C2: hourly price x 730 hours). Like the
// snapshot table above, it never falls back to another region's price: a region
// missing here gives no dollar figure at all.
//
// Source: AWS's public price data for NAT gateways, the data the Amazon VPC
// pricing page's NAT table renders --
// https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/natgateway.json,
// key "Hourly charge for NAT Gateways", publication date (its
// manifest.hawkFilePublicationDate) 2026-11-23T17:10:05Z, retrieved 2026-11-23.
// Region names were mapped to codes with AWS's public location list (type "AWS
// Region"). Every commercial AWS region with a published price is listed; AWS
// GovCloud (another partition) and the two Local Zone entries (Los Angeles,
// Phoenix: not home regions) are not. The provisioned-bandwidth variant in the
// same file is undocumented and not used. Re-verify against the same source
// before relying on these after time has passed. Copies of both files:
// review-logs/cost-optimization/c2-evidence/.
export const NAT_GATEWAY_HOURLY_PRICE_SOURCE = {
  url: 'https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/natgateway.json',
  key: 'Hourly charge for NAT Gateways',
  published: '2026-11-23T17:10:05Z',
  retrieved: '2026-11-23',
} as const;

export const NAT_GATEWAY_HOURLY_USD_BY_REGION: Readonly<Record<string, number>> = Object.freeze({
  'af-south-1': 0.057,
  'ap-east-1': 0.065,
  'ap-east-2': 0.0558,
  'ap-northeast-1': 0.062,
  'ap-northeast-2': 0.059,
  'ap-northeast-3': 0.062,
  'ap-south-1': 0.056,
  'ap-south-2': 0.056,
  'ap-southeast-1': 0.059,
  'ap-southeast-2': 0.059,
  'ap-southeast-3': 0.059,
  'ap-southeast-4': 0.059,
  'ap-southeast-5': 0.05015,
  'ap-southeast-6': 0.06195,
  'ap-southeast-7': 0.05015,
  'ca-central-1': 0.05,
  'ca-west-1': 0.05,
  'eu-central-1': 0.052,
  'eu-central-2': 0.0572,
  'eu-north-1': 0.046,
  'eu-south-1': 0.05,
  'eu-south-2': 0.048,
  'eu-west-1': 0.048,
  'eu-west-2': 0.05,
  'eu-west-3': 0.05,
  'il-central-1': 0.0504,
  'me-central-1': 0.0528,
  'me-south-1': 0.0528,
  'mx-central-1': 0.04725,
  'sa-east-1': 0.093,
  'us-east-1': 0.045,
  'us-east-2': 0.045,
  'us-west-1': 0.048,
  'us-west-2': 0.045,
});

/** The region's NAT gateway hourly price ($/hour), or null when the table has none -- never another region's. */
export function natGatewayHourlyPrice(region: string | undefined | null): number | null {
  if (!region || !Object.prototype.hasOwnProperty.call(NAT_GATEWAY_HOURLY_USD_BY_REGION, region)) return null;
  return NAT_GATEWAY_HOURLY_USD_BY_REGION[region];
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
