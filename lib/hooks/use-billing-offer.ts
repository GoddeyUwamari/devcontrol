'use client'

import { useEffect, useState } from 'react'
import { fetchBillingOffer, OFFER_TTL_MS, TRIAL_OFF, type BillingOffer } from '@/lib/billing/offer'

/**
 * The public billing offer. Starts as "trial off" (server render, loading),
 * stays off unless the server says it is on, and re-checks every minute while
 * the page is open, so a switch flip reaches an open tab.
 */
export function useBillingOffer(): BillingOffer {
  const [offer, setOffer] = useState<BillingOffer>(TRIAL_OFF)
  useEffect(() => {
    let live = true
    const check = () => {
      fetchBillingOffer().then((o) => {
        if (live) setOffer(o)
      })
    }
    check()
    const timer = setInterval(check, OFFER_TTL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])
  return offer
}
