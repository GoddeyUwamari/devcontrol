import type { ServicesCoverage } from '@/lib/services/aws-services.service'

/**
 * When the newest discovery scan finished (GET /api/services/coverage): the
 * last completed job's time, else the account's last successful scan. null
 * when no scan has finished. One definition for the Security and
 * Infrastructure overviews and the Dashboard, which all label it "Last scan".
 */
export function lastCompletedScanIso(c: ServicesCoverage): string | null {
  return c.last_completed_scan?.completed_at ?? c.last_successful_scan_at ?? null
}
