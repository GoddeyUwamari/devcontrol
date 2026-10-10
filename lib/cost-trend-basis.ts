/**
 * The basis of every figure built from GET /api/platform/costs/trend: the
 * backend floors each cost category at $0 per period (AWSCostService
 * queryCostTrend), so credits and refunds are left out and a trend or forecast
 * total can be higher than the bill. Month-to-date spend
 * (GET /api/platform/costs/summary) is net of them; trend totals are not.
 */
export const TREND_TOTALS_NOTE = 'Credits/refunds excluded'
