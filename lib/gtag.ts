export const GA_TRACKING_ID = 'G-Q799EVB9BT'

export const trackEvent = (
  eventName: string,
  parameters?: Record<string, unknown>
) => {
  if (typeof window !== 'undefined' && (window as any).gtag) {
    ;(window as any).gtag('event', eventName, parameters)
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
