/**
 * The pricing page's founding-member count (GET /api/organizations/founding-count).
 * Only a real, non-negative integer counts; anything else is null and the
 * counter is hidden. Never an invented number (C1-D9, F1/F6).
 */
export function parseFoundingCount(body: unknown): number | null {
  const count = (body as { count?: unknown } | null)?.count
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null
}
