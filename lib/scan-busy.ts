/**
 * A Scan now request that did not get its scan's answer (multi-region flag-on prep, Nov 19).
 *
 * POST /api/services/discover holds the request for the whole scan. Two answers are not a failed scan:
 * - 409 with the server's busy body: another scan holds the account's lease and did not finish within
 *   the server's wait (backend/src/services/scan-session.ts SCAN_BUSY_MESSAGE, approved Q1);
 * - 504 or no response at all: the proxy (nginx: 1200 s on /api/services/discover and
 *   /api/cost-recommendations/analyze, 60 s elsewhere; applied Nov 19) or the browser stopped waiting;
 *   the scan goes on on the server (it runs on its own database connection).
 * The page then re-reads coverage, and only the server's lease state (scanIsRunning) says whether a
 * scan is in progress. Nothing here locks anything or keeps its own scan state.
 */

/** The server's busy message, word for word (a test keeps it equal to SCAN_BUSY_MESSAGE). */
export const SCAN_BUSY_TEXT = 'A scan is already running for this AWS account. Try again in a few minutes.'

export type ScanInterruption = 'busy' | 'cut'

/** 'busy': the server's 409 busy answer; 'cut': 504, or no response; null for every other error. */
export function scanInterruption(error: unknown): ScanInterruption | null {
  const e = error as { response?: { status?: number; data?: { error?: unknown } }; request?: unknown } | null
  if (!e || typeof e !== 'object') return null
  const status = e.response?.status
  if (status === 409) return e.response?.data?.error === SCAN_BUSY_TEXT ? 'busy' : null
  if (status === 504) return 'cut'
  // An axios error with a request sent and no response: a dropped connection or a client timeout.
  if (status === undefined && e.request !== undefined) return 'cut'
  return null
}
