/**
 * The region coverage card and panel (multi-region M6) render only when the
 * build sets NEXT_PUBLIC_SERVICES_COVERAGE_M6 to exactly 'true'. Off
 * otherwise, so the page keeps the Phase 1 strip until the flag is flipped.
 * It applies inside the redesigned page only (NEXT_PUBLIC_SERVICES_V2).
 *
 * Read at render time (as isServicesV2Enabled), so tests can stub it.
 * Next.js inlines NEXT_PUBLIC_ values at build time: changing it on Vercel
 * needs a redeploy.
 */
export const isServicesCoverageM6Enabled = () => process.env.NEXT_PUBLIC_SERVICES_COVERAGE_M6 === 'true'
