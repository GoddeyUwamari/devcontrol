/**
 * The Services page redesign (Phase 1) renders only when the build sets
 * NEXT_PUBLIC_SERVICES_V2 to exactly 'true'. Off otherwise, so production keeps
 * today's page until the flag is flipped after PR S1-D.
 *
 * Read at render time (as isGaEnabled in lib/gtag.ts), so tests can stub it.
 * Next.js inlines NEXT_PUBLIC_ values at build time: changing it on Vercel
 * needs a redeploy.
 */
export const isServicesV2Enabled = () => process.env.NEXT_PUBLIC_SERVICES_V2 === 'true'
