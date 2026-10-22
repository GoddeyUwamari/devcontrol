import type { InfrastructureResource } from '@/lib/types'

export interface EstimatedCostRow {
  id: string
  name: string
  cost: number
  /** Bar length relative to the largest row shown (0-100). A visual, not a share of anything. */
  barWidth: number
}

/**
 * The resources with the largest estimated monthly cost, one row per resource.
 *
 * costPerMonth is a per-resource list-price estimate from discovery, not billed
 * spend and not a per-AWS-service total. A resource with no estimate (null --
 * including an S3 bucket, whose stored figure is a placeholder) is left out,
 * never counted as $0; so is a $0 estimate, which is not a "largest cost". No
 * percentage is given: the only denominator here is the resources this page
 * loaded, which is not the account's bill.
 */
export function largestEstimatedCosts(
  resources: Pick<InfrastructureResource, 'id' | 'serviceName' | 'awsId' | 'costPerMonth'>[],
  limit = 5,
): EstimatedCostRow[] {
  const top = resources
    .filter((r): r is typeof r & { costPerMonth: number } =>
      typeof r.costPerMonth === 'number' && Number.isFinite(r.costPerMonth) && r.costPerMonth > 0)
    .map((r) => ({ id: r.id, name: r.serviceName || r.awsId || 'Unknown', cost: r.costPerMonth }))
    .sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, limit)
  const max = top[0]?.cost ?? 0
  return top.map((r) => ({ ...r, barWidth: Math.round((r.cost / max) * 100) }))
}
