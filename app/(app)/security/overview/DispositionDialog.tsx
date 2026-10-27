'use client'

import { useId, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ACTION_COPY } from './securityCopy'
import type { ActionFailure, DispositionResult } from './useFindingDisposition'

const BUTTON = 'inline-flex min-h-11 items-center justify-center rounded-lg border px-4 text-ui font-semibold disabled:cursor-not-allowed'

/**
 * The note dialog for Dismiss and Accept risk: the existing Radix dialog (its title is the accessible name; focus
 * moves in, is trapped, Esc closes, and focus goes back to the button that opened it). A failed request keeps the
 * dialog open with the typed reason and shows the failure inside it; it closes only after a confirmed success.
 */
export function DispositionDialog({ action, busy, onSubmit, onClose, returnFocusTo }: {
  action: 'dismiss' | 'accept-risk' | null
  busy: boolean
  onSubmit: (note: string) => Promise<DispositionResult>
  onClose: () => void
  returnFocusTo: () => HTMLElement | null
}) {
  const [note, setNote] = useState('')
  const [failure, setFailure] = useState<ActionFailure | null>(null)
  const fieldId = useId()
  const hintId = useId()
  const dismiss = action === 'dismiss'

  const close = () => {
    setNote('')
    setFailure(null)
    onClose()
  }

  const submit = async () => {
    const trimmed = note.trim()
    if (trimmed.length === 0 || busy) return
    setFailure(null)
    const result = await onSubmit(trimmed)
    if (result.ok) close()
    else setFailure(result.failure)
  }

  return (
    <Dialog open={action !== null} onOpenChange={(open) => { if (!open && !busy) close() }}>
      <DialogContent
        className="max-w-md"
        onCloseAutoFocus={(event) => {
          const target = returnFocusTo()
          if (target) { event.preventDefault(); target.focus() }
        }}
      >
        <DialogHeader>
          <DialogTitle>{dismiss ? ACTION_COPY.dismissTitle : ACTION_COPY.acceptTitle}</DialogTitle>
          <DialogDescription>{ACTION_COPY.scoreNote} {ACTION_COPY.justification}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={fieldId}>{ACTION_COPY.reasonLabel}</Label>
          <Textarea
            id={fieldId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={ACTION_COPY.reasonHint}
            aria-describedby={failure ? hintId : undefined}
            required
            rows={3}
            autoFocus
          />
        </div>
        {failure && (
          <div id={hintId} role="alert" data-testid="security-action-error" className="flex flex-col gap-0.5">
            <p className="m-0 text-ui font-semibold text-ink-danger">{failure.title}</p>
            {failure.description && <p className="m-0 text-ui text-ink-body">{failure.description}</p>}
          </div>
        )}
        <DialogFooter>
          <button type="button" onClick={close} disabled={busy} className={cn(BUTTON, 'border-slate-300 bg-white text-ink hover:bg-slate-50')}>
            {ACTION_COPY.cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || note.trim().length === 0}
            aria-busy={busy || undefined}
            className={cn(BUTTON, 'border-violet-700 bg-violet-700 text-white hover:bg-violet-800 disabled:border-slate-300 disabled:bg-slate-100 disabled:text-ink-muted')}
          >
            {dismiss ? ACTION_COPY.confirmDismiss : ACTION_COPY.confirmAccept}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
