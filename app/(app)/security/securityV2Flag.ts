/**
 * The Security Overview redesign renders only when the build sets
 * NEXT_PUBLIC_SECURITY_V2 to exactly 'true'. Off otherwise, so
 * production keeps today's page until the flag is flipped.
 *
 * Read at render time (as isInfraOverviewV2Enabled), so tests can stub it.
 * Next.js inlines NEXT_PUBLIC_ values at build time: changing it on Vercel
 * needs a redeploy.
 */
export const isSecurityV2Enabled = () => process.env.NEXT_PUBLIC_SECURITY_V2 === 'true'
