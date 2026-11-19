/**
 * After a Scan now request that ended without its scan's answer (lib/scan-busy.ts): re-read coverage,
 * then decide from the server alone. Used by Services, Infrastructure and Security (multi-region
 * flag-on prep, item 4; founder ruling Nov 19: every organization, switched on or off).
 *
 * - 'running': the re-read coverage says a scan is in progress (scanIsRunning: the lease's
 *   scan_in_progress, or multi_region.coverage_status 'in_progress'), after a 409 busy, a 504 or no
 *   response. Only this answer may drive "in progress" UI (and that UI reads coverage, not this value).
 * - 'busy': the server's 409 busy, but the re-read shows no scan running (the lease was released just
 *   after the 409, or the re-read failed). The server did say busy, so the page shows the busy message,
 *   never nothing and never "Scan failed" (flag-on review L-1).
 * - null: anything else, including a 504 / no response with no scan running after it or a failed re-read
 *   (network down): the page keeps its own failure handling.
 *
 * The re-read uses the pages' own coverage key, so the header's scan line and the disabled Scan now
 * follow the server at once. No client lock, no second scan state.
 */
import type { QueryClient } from '@tanstack/react-query'
import awsServicesService, { type ServicesCoverage } from '@/lib/services/aws-services.service'
import { scanInterruption } from '@/lib/scan-busy'
import { scanIsRunning } from './servicesTruth'

export { SCAN_BUSY_TEXT } from '@/lib/scan-busy'

export type ScanBusyOutcome = 'running' | 'busy'

export async function scanBusyAfter(error: unknown, queryClient: QueryClient, orgId: string | null): Promise<ScanBusyOutcome | null> {
  const kind = scanInterruption(error)
  if (!kind) return null
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
  if (coverage !== null && scanIsRunning(coverage)) return 'running'
  return kind === 'busy' ? 'busy' : null
}
