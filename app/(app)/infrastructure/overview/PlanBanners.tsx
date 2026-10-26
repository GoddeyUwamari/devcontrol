'use client'

import Link from 'next/link'

/**
 * The legacy page's resource-limit prompt and plan banners (§17.5), in the
 * legacy order, with the legacy text, links and tones (type on the app roles). The legacy JSX is
 * inline in page.tsx, which flag-off forbids refactoring, so the text is
 * repeated here; test PB-1 fails if the two drift.
 */
export function PlanBanners({ limitReached, isFree, isStarter, isPro }: { limitReached: boolean; isFree: boolean; isStarter: boolean; isPro: boolean }) {
  return (
    <>
      {limitReached && (
        <div data-testid="infra-limit-prompt" className="flex items-center justify-between gap-4 rounded-xl border border-amber-400 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚠️</span>
            <span className="text-ui font-medium text-amber-800">You&apos;ve reached your resource limit. Upgrade your plan to see all resources.</span>
          </div>
          <a href="/settings/billing/upgrade" className="shrink-0 whitespace-nowrap rounded-md bg-amber-600 px-4 py-1 text-meta font-semibold text-white no-underline">
            Upgrade plan
          </a>
        </div>
      )}
      {isFree && (
        <div data-testid="infra-free-banner" className="flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
          <p className="text-ui font-medium text-violet-800">
            Free plan shows EC2, RDS, and S3 only.
            <span className="ml-1 font-normal text-ink-muted">Upgrade to Starter to unlock 15 resource types.</span>
          </p>
          <Link href="/settings/billing/upgrade" className="ml-4 shrink-0 rounded-lg bg-violet-700 px-4 py-1 text-label text-white no-underline">
            Upgrade →
          </Link>
        </div>
      )}
      {isStarter && !isPro && (
        <div data-testid="infra-starter-banner" className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-ui font-medium text-blue-800">
            Starter plan shows 15 resource types.
            <span className="ml-1 font-normal text-ink-muted">Upgrade to Pro to unlock all 15+ resource types in your inventory.</span>
          </p>
          <Link href="/settings/billing/upgrade" className="ml-4 shrink-0 rounded-lg bg-blue-600 px-4 py-1 text-label text-white no-underline">
            Upgrade →
          </Link>
        </div>
      )}
    </>
  )
}
