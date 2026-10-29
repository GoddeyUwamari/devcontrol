'use client'

import { PAGE_TITLE_CLASS } from '@/components/ui/typography'
import { cn } from '@/lib/utils'

/** The Operational Health page (NEXT_PUBLIC_OBSERVABILITY_V2). */
export default function OperationalHealthV2() {
  return (
    <main className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 py-6 sm:px-6">
      <h1 className={cn(PAGE_TITLE_CLASS, 'm-0')}>Operational Health</h1>
    </main>
  )
}
