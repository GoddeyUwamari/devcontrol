/**
 * The Services redesign (multi-region PR 3b) renders only when the build sets
 * NEXT_PUBLIC_SERVICES_REDESIGN to exactly 'true'. It is read inside the V2
 * page (NEXT_PUBLIC_SERVICES_V2) and on its own: V2 or M6 being on never shows
 * the redesign by itself. Off, the V2 page is byte-identical to before PR 3b
 * (services-redesign-flag-off.test.tsx).
 *
 * Read at render time (as isServicesV2Enabled), so tests can stub it.
 * Next.js inlines NEXT_PUBLIC_ values at build time: changing it on Vercel
 * needs a redeploy.
 */
export const isServicesRedesignEnabled = () => process.env.NEXT_PUBLIC_SERVICES_REDESIGN === 'true'
