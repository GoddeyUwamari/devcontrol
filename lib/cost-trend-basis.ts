/**
 * The basis of every figure built from GET /api/platform/costs/trend. The
 * backend reads Cost Explorer UnblendedCost by service with no record-type
 * filter, so credits and refunds are already netted into each service. It then
 * floors each cost category (and, in the per-service chart view, each service)
 * at $0 per period (AWSCostService queryCostTrend): a credit larger than its
 * bucket's charges in that period counts only down to $0, so a trend or
 * forecast total can be higher than the bill. Month-to-date spend
 * (GET /api/platform/costs/summary) is Cost Explorer's own net total, with no
 * floor.
 */
export const TREND_TOTALS_NOTE = 'After credits and refunds; amounts below $0 count as $0'
