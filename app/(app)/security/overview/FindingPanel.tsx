'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import type { FindingRow } from './securityModel'
import { PAGE_COPY } from './securityCopy'
import { RegionText } from './RegionText'
import { CopyStatement } from './CopyStatement'

/**
 * A row's details: the scanner's full description (unlabelled, when the list shows a short title), the approved fix guidance (only for a row with a guidance key; a row without one shows its own
 * recommendation), the web-server hint on open web ports, then the account-finding decisions or, for a resource
 * finding, the Infrastructure link and its note (navigation only). On an S3 HTTPS-only row, "Copy policy statement"
 * sits under "Risk of the fix", beside that Risk text, so the text is shown once and next to the button (e2 9).
 */
export function FindingPanel({ row, actions }: { row: FindingRow; actions: ReactNode }) {
  const g = row.guidance
  const copyable = g !== null && row.guidanceKey === 's3_https_only' && row.policyStatement !== null
  return (
    <div data-testid="security-panel" className="flex flex-col gap-4">
      {row.description && <p data-testid="security-row-description" className="m-0 text-body text-ink"><RegionText text={row.description} /></p>}
      {g ? (
        <dl className="m-0 grid gap-3">
          <Entry term={PAGE_COPY.whyItMatters}>{g.whyItMatters}</Entry>
          <Entry term={PAGE_COPY.nextStep}>{g.nextStep}</Entry>
          <Entry term={PAGE_COPY.fixRisk}>
            {copyable ? <CopyStatement statement={row.policyStatement!} risk={g.fixRisk} /> : g.fixRisk}
          </Entry>
        </dl>
      ) : row.recommendation && (
        <p className="m-0 text-body text-ink-body"><RegionText text={row.recommendation} /></p>
      )}

      {row.webHint && <p data-testid="security-web-hint" className="m-0 text-body text-ink-body">{row.webHint}</p>}

      {row.canDisposition ? actions : row.review && (
        <div className="flex flex-col gap-1">
          <Link href={row.review.href} className="inline-flex min-h-11 items-center self-start text-ui font-semibold text-ink-accent hover:underline">
            {row.review.text}
          </Link>
          <p data-testid="security-review-note" className="m-0 text-meta text-ink-muted">{PAGE_COPY.resourceNote}</p>
        </div>
      )}
    </div>
  )
}

function Entry({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-label font-semibold text-ink">{term}</dt>
      <dd className="m-0 text-body text-ink-body">{children}</dd>
    </div>
  )
}
