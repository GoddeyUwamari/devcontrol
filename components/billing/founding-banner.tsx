'use client'

/**
 * The founding-member banner on the pricing page. Rendered only while
 * FOUNDING_OFFER_VISIBLE is on (lib/plan/plan-catalog.ts); hidden until prices
 * and the Stripe billing rules for it are final (C1-D9). Approved copy F2/F3/F5
 * (price lock confirmed by the founder, 2026-11-11). The count is real or the
 * counter is hidden: never an invented number (F1/F6), and the banner hides
 * itself once the spots are taken (F8).
 */
import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { FOUNDING_SPOTS } from '@/lib/plan/plan-catalog'
import { parseFoundingCount } from '@/lib/billing/founding'

export const FOUNDING_COPY = {
  title: 'Founding member pricing — keep your rate for as long as you stay subscribed',
  detail: (spots: number) => `Prices go up after the first ${spots} customers. Founding members keep their rate.`,
  claimed: (count: number, spots: number) => `${count} of ${spots} founding spots claimed`,
  cta: 'Claim founding rate',
} as const

export function FoundingBanner() {
  const [foundingCount, setFoundingCount] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/organizations/founding-count`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (live) setFoundingCount(parseFoundingCount(data)) })
      .catch(() => { if (live) setFoundingCount(null) })
    return () => { live = false }
  }, [])

  if (foundingCount !== null && foundingCount >= FOUNDING_SPOTS) return null
  const filled = foundingCount === null ? 0 : Math.round((foundingCount / FOUNDING_SPOTS) * 10)

  return (
    <div data-testid="founding-banner" className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-violet-50 border border-violet-200 rounded-2xl px-4 py-4 sm:px-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-violet-700 flex items-center justify-center shrink-0">
          <Sparkles size={14} className="text-white" />
        </div>
        <div className="text-left">
          <p className="text-sm font-bold text-slate-900">{FOUNDING_COPY.title}</p>
          <p className="text-xs text-violet-700 mt-0.5">{FOUNDING_COPY.detail(FOUNDING_SPOTS)}</p>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
        {foundingCount !== null && (
          <div data-testid="founding-count">
            <div className="flex gap-1 items-center">
              {[...Array(10)].map((_, i) => (
                <div key={i} data-dot={i < filled ? 'filled' : 'empty'} className="w-2 h-2 rounded-full" style={{ background: i < filled ? '#7c3aed' : 'rgba(124,58,237,0.2)' }} />
              ))}
            </div>
            <p className="text-[10px] text-violet-700 font-semibold mt-1 text-center">{FOUNDING_COPY.claimed(foundingCount, FOUNDING_SPOTS)}</p>
          </div>
        )}
        <a href="/register" className="bg-violet-700 text-white px-4 py-2 rounded-lg font-bold text-xs no-underline whitespace-nowrap">
          {FOUNDING_COPY.cta}
        </a>
      </div>
    </div>
  )
}
