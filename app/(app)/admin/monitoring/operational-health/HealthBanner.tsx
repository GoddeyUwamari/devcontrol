'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { BannerView } from './operationalHealthModel'
import { PAGE_COPY } from './operationalHealthCopy'
import { BANNER_TONE, BUTTON, DOT, HEADLINE_INK } from './tones'

/** The status banner (founder decision D3). No banner until both sources have answered once. */
export function HealthBanner({ banner, onRetry }: { banner: BannerView | null; onRetry: () => void }) {
  if (!banner) return null
  return (
    <section
      role="status"
      aria-label="Status"
      data-testid="health-banner"
      data-kind={banner.kind}
      data-tone={banner.tone}
      className={cn('flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6', BANNER_TONE[banner.tone])}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className={cn('mt-2 inline-block size-2.5 shrink-0 rounded-full', DOT[banner.tone])} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className={cn('m-0 text-section', HEADLINE_INK[banner.tone])}>{banner.headline}</h2>
          {banner.lines.map((line) => (
            <p key={line} className="m-0 text-body text-ink-body">{line}</p>
          ))}
        </div>
      </div>
      {banner.action?.kind === 'retry' && (
        <button type="button" onClick={onRetry} className={cn(BUTTON, 'shrink-0 self-start sm:self-center')}>{PAGE_COPY.retry}</button>
      )}
      {banner.action?.kind === 'link' && (
        <Link href={banner.action.href} className={cn(BUTTON, 'shrink-0 self-start sm:self-center')}>{banner.action.label}</Link>
      )}
    </section>
  )
}
