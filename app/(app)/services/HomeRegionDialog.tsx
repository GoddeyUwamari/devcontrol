'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import awsAccountsService, {
  HomeRegionRequestError, type HomeRegionChangeResult, type HomeRegionPreview, type HomeRegionProposalView,
} from '@/lib/services/aws-accounts.service'
import {
  HOME_REGION_COPY, changeErrorText, dialogOptions, previewRefusalText, whatChanges, type DialogMode,
} from './homeRegionModel'
import { TONE } from './redesignTone'

const codeOf = (err: unknown) => (err instanceof HomeRegionRequestError ? err.code : null)

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The change dialog (HR-S10–S16, V2-9), owner only: the page opens it only when
 * the server says the caller may change the home region (G9), and the server
 * refuses everyone else anyway (HOME_REGION_OWNER_ONLY).
 *
 * - Options: the account's enabled, choosable regions (GET preview), in
 *   region-name order; the current home as "{r} (current)", not selectable.
 *   Pre-selected only from a proposal ("Use {R}"); from the split prompt and
 *   from Change, nothing is selected and the confirm stays disabled until a pick.
 * - "What changes" from the GET preview for the picked region.
 * - No optimistic update: the page's home region changes only after the PUT
 *   succeeds (the caller invalidates and refetches); on any failure the dialog
 *   stays open with the error by the server's CODE, and the caller refetches.
 * - role=dialog, aria-modal, labelled by its title; focus moves in and is
 *   trapped; Escape, Cancel and Close close it; the error box is role=alert.
 */
export function HomeRegionDialog({ orgId, mode, preselect, evidence, onClose, onChanged, onFailed }: {
  orgId: string
  mode: DialogMode
  preselect: string | null
  /** The open prompt's evidence (proposed / split), for the option amounts; null otherwise. */
  evidence: HomeRegionProposalView | null
  onClose: () => void
  onChanged: (result: HomeRegionChangeResult) => void
  /** Any non-success: the caller refetches; the home region shown stays as it was. */
  onFailed: () => void
}) {
  const titleId = useId()
  const selectId = useId()
  const helpId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<string>(preselect ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const base = useQuery<HomeRegionPreview>({
    queryKey: ['home-region-preview', orgId, null],
    queryFn: () => awsAccountsService.getHomeRegionPreview(),
    retry: false, refetchOnWindowFocus: false, staleTime: 0, gcTime: 0,
  })
  const target = useQuery<HomeRegionPreview>({
    queryKey: ['home-region-preview', orgId, selected],
    queryFn: () => awsAccountsService.getHomeRegionPreview(selected),
    enabled: !!selected, retry: false, refetchOnWindowFocus: false, staleTime: 0, gcTime: 0,
  })

  // Focus in on open (the first control), back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
    return () => { opener?.focus?.() }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
    if (e.key !== 'Tab' || !dialogRef.current) return
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const options = base.data ? dialogOptions(base.data.regions, evidence) : []
  const flagOff = base.data ? !base.data.multi_region : false
  const oldHome = base.data?.current_home_region ?? null
  const t = target.data?.target && target.data.target.region === selected ? target.data.target : null
  const baseError = base.isError ? changeErrorText(codeOf(base.error), selected) : null
  const targetError = target.isError ? changeErrorText(codeOf(target.error), selected) : null
  const refusal = t?.refusal ? previewRefusalText(t.refusal, selected) : null
  const shownError = error ?? baseError ?? targetError ?? refusal
  const canConfirm = !!selected && !!t && t.refusal === null && !submitting && !error

  async function confirm() {
    if (!canConfirm) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await awsAccountsService.changeHomeRegion(selected)
      onChanged(result)
    } catch (err: unknown) {
      setError(changeErrorText(codeOf(err), selected))
      onFailed()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown} data-testid="home-region-dialog"
        className={cn(TONE.card, 'relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto px-5 py-4 shadow-lg')}>
        <button type="button" aria-label={HOME_REGION_COPY.close} onClick={onClose} className={cn('absolute right-3 top-3 rounded p-1', TONE.muted, TONE.focus)}>
          <X size={16} aria-hidden="true" />
        </button>
        <h2 id={titleId} className={cn('m-0 pr-8 text-section', TONE.ink)}>{mode === 'split' ? HOME_REGION_COPY.dialogTitleSplit : HOME_REGION_COPY.dialogTitle}</h2>
        <p className={cn('m-0 mt-2 text-ui', TONE.body)}>{HOME_REGION_COPY.dialogIntro(flagOff)}</p>

        <div className="mt-4 flex flex-col gap-1">
          <label htmlFor={selectId} className={cn('text-label', TONE.ink)}>{HOME_REGION_COPY.selectLabel}</label>
          <select id={selectId} aria-describedby={helpId} value={selected} disabled={!base.data || submitting}
            onChange={(e) => { setSelected(e.target.value); setError(null) }}
            className={cn('rounded-lg border border-border bg-card px-3 py-2 text-ui', TONE.ink, TONE.focus)}>
            {!base.data && <option value="">{HOME_REGION_COPY.loading}</option>}
            {base.data && <option value="" disabled>{HOME_REGION_COPY.placeholder}</option>}
            {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
          </select>
          <p id={helpId} className={cn('m-0 text-meta', TONE.muted)}>{HOME_REGION_COPY.onlyEnabled}</p>
        </div>

        {!selected && <p className={cn('m-0 mt-3 text-meta', TONE.muted)}>{HOME_REGION_COPY.whatChangesLater}</p>}
        {t && oldHome && t.refusal === null && (
          <div className="mt-4" data-testid="what-changes">
            <h3 className={cn('m-0 text-label', TONE.ink)}>{HOME_REGION_COPY.whatChanges}</h3>
            <ul className={cn('m-0 mt-1 list-disc pl-5 text-ui', TONE.body)}>
              {whatChanges(t, oldHome).map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
        )}

        {shownError && (
          <div role="alert" data-testid="home-region-error" className="mt-4 rounded-lg border border-[var(--border-danger)] bg-[var(--bg-danger)] px-3 py-2 text-ui text-ink-danger dark:text-red-400">
            {shownError}
          </div>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2 max-sm:flex-col-reverse max-sm:items-stretch">
          <button type="button" onClick={onClose} className={cn(TONE.secondaryButton, TONE.focus, 'max-sm:justify-center')}>{HOME_REGION_COPY.cancel}</button>
          <button type="button" onClick={confirm} disabled={!canConfirm} className={cn(TONE.primaryButton, TONE.focus, 'max-sm:justify-center')}>
            {selected ? HOME_REGION_COPY.confirm(selected) : HOME_REGION_COPY.confirmNone}
          </button>
        </div>
        {mode === 'split' && !selected && <p className={cn('m-0 mt-3 text-meta', TONE.muted)}>{HOME_REGION_COPY.splitNote}</p>}
      </div>
    </div>
  )
}
