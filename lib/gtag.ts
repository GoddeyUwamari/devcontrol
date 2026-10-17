export const GA_TRACKING_ID = 'G-Q799EVB9BT'

/**
 * On unless NEXT_PUBLIC_GA_ENABLED is exactly 'false', so production builds,
 * which never set it, keep reporting. `npm run dev:local` sets it to 'false'
 * so local runs never reach Google Analytics.
 */
export const isGaEnabled = () => process.env.NEXT_PUBLIC_GA_ENABLED !== 'false'

/**
 * Paths whose query string can carry a credential or an identifier (sign-in
 * forms submitted before hydration, reset/verify/invitation links, the SSO
 * hand-off, the Stripe checkout session id), and their sub-paths. Analytics
 * gets their origin and path only.
 */
const PATHS_WITHOUT_QUERY = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/accept-invitation',
  '/auth/sso/callback',
  '/billing/success',
]

/** The only query params analytics gets on any other path: campaign attribution. */
const KEPT_QUERY_PARAM = /^(utm_[a-z0-9_]+|gclid)$/i

/**
 * The page URL as Google Analytics may see it: never the fragment; on
 * PATHS_WITHOUT_QUERY no query string; elsewhere only utm_* and gclid. An
 * unparseable value gives ''.
 */
export function gaPageLocation(href: string): string {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return ''
  }
  const path = (url.pathname.replace(/\/+$/, '') || '/').toLowerCase()
  if (PATHS_WITHOUT_QUERY.some((p) => path === p || path.startsWith(`${p}/`))) {
    return url.origin + url.pathname
  }
  const kept = new URLSearchParams()
  for (const [key, value] of url.searchParams) {
    if (KEPT_QUERY_PARAM.test(key)) kept.append(key, value)
  }
  const query = kept.toString()
  return url.origin + url.pathname + (query ? `?${query}` : '')
}

/**
 * URL params that are credentials. While the address bar holds one (in the
 * query or the fragment) the GA opt-out flag reads true; see
 * installGaDisableGuard.
 */
const CREDENTIAL_PARAMS = [
  'token',
  'refreshtoken',
  'refresh_token',
  'access_token',
  'id_token',
  'password',
  'confirmpassword',
  'secret',
  'api_key',
  'code',
]

export function urlCarriesCredentials(href: string): boolean {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return false
  }
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''))
  return [...url.searchParams.keys(), ...fragment.keys()].some((key) =>
    CREDENTIAL_PARAMS.includes(key.toLowerCase())
  )
}

type Gtag = (...args: unknown[]) => void

const loadedGtag = (): Gtag | undefined =>
  typeof window !== 'undefined' ? (window as any).gtag : undefined

/**
 * Defence in depth for hits this code does not send itself (GA's automatic
 * page views on history changes, which use the full URL): Google's opt-out
 * flag `window['ga-disable-<ID>']` is defined as a getter that is true while
 * the URL carries a credential. UNVERIFIED: that gtag.js reads the flag on
 * every hit, rather than once, has not been confirmed against the real script.
 * The primary control is to turn off history-change page views in the GA
 * property, so that every page view is the redacted one sent here.
 */
function installGaDisableGuard() {
  Object.defineProperty(window, `ga-disable-${GA_TRACKING_ID}`, {
    configurable: true,
    get: () => urlCarriesCredentials(window.location.href),
  })
}

/** The redacted location of the last page view sent, the next one's referrer. */
let lastPageLocation: string | undefined

/**
 * Sends a page view for the current URL, redacted by gaPageLocation, unless
 * GA is off or not loaded on this page, or the redacted location is the one
 * last sent. The location is also `set`, so later events default to it.
 */
export const sendPageView = () => {
  const gtag = loadedGtag()
  if (!isGaEnabled() || !gtag) return
  const page_location = gaPageLocation(window.location.href)
  if (page_location === lastPageLocation) return
  const page_referrer = lastPageLocation ?? gaPageLocation(document.referrer)
  lastPageLocation = page_location
  gtag('set', { page_location, page_referrer })
  gtag('event', 'page_view', { page_location, page_referrer })
}

let gaInitialized = false

/**
 * Sets up gtag (the GA script itself is loaded by SiteAnalytics) with
 * automatic page views off, and sends the first page view. Runs once per
 * page load.
 */
export const initGa = () => {
  if (!isGaEnabled() || typeof window === 'undefined' || gaInitialized) return
  gaInitialized = true
  installGaDisableGuard()

  const w = window as any
  w.dataLayer = w.dataLayer || []
  // gtag.js reads the queue as `arguments` objects, not arrays.
  w.gtag =
    w.gtag ||
    function () {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer.push(arguments)
    }
  const gtag: Gtag = w.gtag
  gtag('js', new Date())
  gtag('config', GA_TRACKING_ID, {
    send_page_view: false,
    page_location: gaPageLocation(window.location.href),
    page_referrer: gaPageLocation(document.referrer),
  })
  sendPageView()
}

export const trackEvent = (
  eventName: string,
  parameters?: Record<string, unknown>
) => {
  const gtag = loadedGtag()
  if (isGaEnabled() && gtag) {
    const page_location = gaPageLocation(window.location.href)
    gtag('set', { page_location })
    gtag('event', eventName, { ...parameters, page_location })
  }
}

export const trackLeadConverted = (orgId?: string) => {
  trackEvent('close_convert_lead', {
    org_id: orgId,
    currency: 'USD',
  })
}

export const trackLeadQualified = (planType?: string) => {
  trackEvent('qualify_lead', {
    plan_type: planType,
  })
}

export const trackPurchase = (
  value: number,
  planType: string,
  orgId?: string
) => {
  trackEvent('purchase', {
    value,
    currency: 'USD',
    plan_type: planType,
    org_id: orgId,
  })
}
