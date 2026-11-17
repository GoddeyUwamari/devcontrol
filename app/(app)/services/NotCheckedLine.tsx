'use client'

import { cn } from '@/lib/utils'
import { REDESIGN_COPY, type NotCheckedView } from './redesignModel'
import { TONE } from './redesignTone'

/**
 * What we didn't check, option b (Q5): one line at the end of the page,
 * "Not checked: … ." with "Details", which opens the full lines and S37.
 * Not rendered when nothing applies.
 */
export function NotCheckedLine({ view }: { view: NotCheckedView }) {
  if (view.lines.length === 0 || !view.summary) return null
  return (
    <details data-testid="not-checked" className={cn(TONE.card, 'mb-6 px-4 py-3 text-ui')}>
      <summary className={cn('cursor-pointer', TONE.body, TONE.focus)}>
        {view.summary} <span className={TONE.link}>Details</span>
      </summary>
      <ul aria-label="What we didn't check" className={cn('m-0 mt-2 flex list-disc flex-col gap-1.5 pl-5', TONE.ink)}>
        {view.lines.map((line) => <li key={line.key} data-line={line.key}>{line.text}</li>)}
      </ul>
      <p className={cn('m-0 mt-2 text-meta', TONE.muted)}>{REDESIGN_COPY.notCheckedEnd}</p>
    </details>
  )
}
