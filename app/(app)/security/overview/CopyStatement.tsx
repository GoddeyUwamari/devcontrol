'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { isOneStatement } from './fixGuidance'
import { PAGE_COPY } from './securityCopy'

/**
 * "Copy policy statement" (S3 HTTPS-only only): copies exactly the one statement it is given, with no server call.
 * The button is enabled only when that text is valid JSON for one statement. "Copied" appears only after the
 * clipboard write resolves; a missing or rejecting clipboard shows the failure line and, below it, the same
 * statement as read-only text to select by hand (F2b answer D4). Entry 7's Risk text sits beside the button (e2 9).
 */
export function CopyStatement({ statement, risk }: { statement: string; risk: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const valid = isOneStatement(statement)

  const copy = async () => {
    setState('idle')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(statement)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={copy}
          disabled={!valid}
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-ui font-semibold text-ink hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-ink-muted"
        >
          {PAGE_COPY.copyStatement}
        </button>
        <p data-testid="security-copy-risk" className="m-0 min-w-0 flex-1 text-meta text-ink-body">{risk}</p>
      </div>
      <p data-testid="security-copy-result" aria-live="polite" className={cn('m-0 text-meta', state === 'failed' ? 'text-ink-danger' : 'text-ink-body')}>
        {state === 'copied' ? PAGE_COPY.copied : state === 'failed' ? PAGE_COPY.copyFailed : ''}
      </p>
      {state === 'failed' && (
        <pre data-testid="security-copy-fallback" tabIndex={0} className="m-0 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-3 text-meta text-ink select-all">
          {statement}
        </pre>
      )}
    </div>
  )
}
