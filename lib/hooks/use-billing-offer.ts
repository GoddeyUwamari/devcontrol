'use client'

import { useEffect, useState } from 'react'
import { fetchBillingOffer, TRIAL_OFF, type BillingOffer } from '@/lib/billing/offer'

/**
 * The public billing offer. Starts as "trial off" (server render, loading),
 * and stays off unless the server says it is on.
 */
export function useBillingOffer(): BillingOffer {
  const [offer, setOffer] = useState<BillingOffer>(TRIAL_OFF)
  useEffect(() => {
    let live = true
    fetchBillingOffer().then((o) => {
      if (live) setOffer(o)
    })
    return () => {
      live = false
    }
  }, [])
  return offer
}
