/**
 * The Operational Health page renders only when the build sets
 * NEXT_PUBLIC_OBSERVABILITY_V2 to exactly 'true'. Off otherwise, so
 * production keeps today's /admin/monitoring page until the flag is flipped.
 *
 * Read at render time (as isSecurityV2Enabled), so tests can stub it.
 * Next.js inlines NEXT_PUBLIC_ values at build time: changing it on Vercel
 * needs a redeploy.
 */
export const isObservabilityV2Enabled = () => process.env.NEXT_PUBLIC_OBSERVABILITY_V2 === 'true'
