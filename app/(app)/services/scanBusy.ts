/**
 * After a Scan now request that ended without its scan's answer (lib/scan-busy.ts): re-read coverage,
 * then decide from the server alone. Used by Services, Infrastructure and Security (multi-region
 * flag-on prep, item 4; founder ruling Nov 19: every organization, switched on or off).
 *
 * - 409 busy: the server said another scan holds the lease → busy.
 * - 504 / no response: busy only when the re-read coverage says a scan is in progress (scanIsRunning:
 *   the lease's scan_in_progress, or multi_region.coverage_status 'in_progress'); otherwise not busy,
 *   and the page keeps its own failure handling.
 *
 * The re-read uses the pages' own coverage key, so the header's scan line and the disabled Scan now
 * follow the server at once. No client lock, no second scan state.
 */
import type { QueryClient } from '@tanstack/react-query'
import awsServicesService, { type ServicesCoverage } from '@/lib/services/aws-services.service'
import { scanInterruption } from '@/lib/scan-busy'
import { scanIsRunning } from './servicesTruth'

export { SCAN_BUSY_TEXT } from '@/lib/scan-busy'

export async function scanBusyAfter(error: unknown, queryClient: QueryClient, orgId: string | null): Promise<boolean> {
  const kind = scanInterruption(error)
  if (!kind) return false
  let coverage: ServicesCoverage | null = null
  try {
    coverage = await queryClient.fetchQuery<ServicesCoverage>({
      queryKey: ['services-coverage', orgId],
      queryFn: () => awsServicesService.getCoverage(),
      staleTime: 0,
      retry: false,
    })
  } catch {
    coverage = null
  }
  return kind === 'busy' || (coverage !== null && scanIsRunning(coverage))
}
