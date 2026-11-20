'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { COPY } from '../_lib/dora-page'

/**
 * Where the records come from, what is counted, and how (ruling D5-D7: the method opens in a dialog).
 * The card and the dialog show the one source-dependent records sentence (pipeline + hand / hand only / none).
 */
export function DataAndMethod({ sourceSentence, bandsDescription }: { sourceSentence: string; bandsDescription: string }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col min-w-0" data-testid="dora-data-method" aria-label={COPY.methodTitle}>
      <h2 className="text-card-title text-ink mb-2">{COPY.methodTitle}</h2>
      <p className="text-meta text-ink-body mb-2" data-testid="dora-method-source">{sourceSentence}</p>
      <p className="text-meta text-ink-muted mb-2">{COPY.methodCounted}</p>
      <p className="text-meta text-ink-muted mb-3">{COPY.methodPlanned}</p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-auto self-start text-label text-ink-accent bg-transparent border-none p-0 cursor-pointer hover:underline min-h-11 sm:min-h-0"
      >
        {COPY.methodLink}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto" data-testid="dora-method-dialog">
          <DialogHeader>
            <DialogTitle>How this is measured</DialogTitle>
            <DialogDescription>From the deployment records DevControl holds for this workspace.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-meta text-ink-body">
            <p data-testid="dora-method-dialog-source">{sourceSentence}</p>
            <p>A deploy counts once it has finished, succeeded or failed. Deploys still in progress, recorded without a result, stopped before deploying or cancelled are not counted.</p>
            <p>Each period is the last 7, 30 or 90 days, ending now. The previous period is the same length, just before it. The Service and Team filters apply to every number, chart and sentence on the page.</p>
            <p>Deployment frequency is successful deploys divided by the days in the period. Change failure rate is failed deploys as a share of finished deploys.</p>
            <p>The chart counts deploys per UTC day. The first and last days are only partly inside the period.</p>
            <p>Levels come from DevControl&apos;s comparison bands, or from your own targets when you have set them. {bandsDescription}</p>
            <p>{COPY.methodPlanned}</p>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
