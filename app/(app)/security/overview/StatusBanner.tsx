'use client'

import { cn } from '@/lib/utils'
import type { BannerView } from './securityModel'

const TONE: Record<BannerView['tone'], string> = {
  danger: 'border-red-200 bg-red-50',
  warning: 'border-amber-200 bg-amber-50',
  success: 'border-green-200 bg-green-50',
  neutral: 'border-slate-200 bg-white',
}

const HEADLINE_INK: Record<BannerView['tone'], string> = {
  danger: 'text-ink-danger-strong',
  warning: 'text-ink-warning-strong',
  success: 'text-ink-success-strong',
  neutral: 'text-ink',
}

/** Headline and line left, "Not checked yet: …" right (founder answer 1). No banner while findings load. */
export function StatusBanner({ banner, notChecked }: { banner: BannerView | null; notChecked: string | null }) {
  if (!banner && !notChecked) return null
  const tone = banner?.tone ?? 'neutral'
  return (
    <section
      role="status"
      data-testid="security-banner"
      data-tone={tone}
      className={cn('flex flex-col gap-2 rounded-xl border p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6', TONE[tone])}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {banner?.headline && <p className={cn('m-0 text-section', HEADLINE_INK[tone])}>{banner.headline}</p>}
        {banner?.detail && <p className="m-0 text-body text-ink-body">{banner.detail}</p>}
      </div>
      {notChecked && <p data-testid="security-not-checked" className="m-0 text-meta text-ink-muted sm:max-w-[45%] sm:text-right">{notChecked}</p>}
    </section>
  )
}
