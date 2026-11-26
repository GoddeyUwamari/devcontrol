/**
 * The server's services-limit refusal (POST /api/services 402
 * RESOURCE_LIMIT_REACHED, details.resourceType 'services'): its message
 * (stage-a C9), or null when the error is anything else. Axios rejects a
 * non-2xx before handleApiResponse runs, so the body is on error.response.
 */
export function serviceLimitRefusalMessage(error: unknown): string | null {
  const response = (error as { response?: { status?: unknown; data?: unknown } } | null)?.response
  if (!response || response.status !== 402) return null
  const data = response.data as { code?: unknown; error?: unknown; details?: { resourceType?: unknown } } | null | undefined
  if (!data || data.code !== 'RESOURCE_LIMIT_REACHED' || data.details?.resourceType !== 'services') return null
  return typeof data.error === 'string' && data.error.length > 0 ? data.error : null
}
