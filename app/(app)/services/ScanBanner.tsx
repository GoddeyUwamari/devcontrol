'use client'

import { AlertTriangle, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { REDESIGN_COPY, type BannerView } from './redesignModel'
import { SURFACE, TONE } from './redesignTone'

const TEXT_TONE: Record<BannerView['tone'], string> = {
  success: TONE.success,
  warning: TONE.warning,
  danger: TONE.danger,
  neutral: TONE.ink,
}

/**
 * The one-line scan result after a Scan now in this tab (S40, V2-14, V2-17):
 * the completion fact first, then the muted "· N new · N updated". Green,
 * amber or red only when the coverage read after the scan describes that scan
 * (redesignModel scanBanner); dismissible for this visit (component state, no
 * storage). Dismiss hands focus back to Scan now (the parent's onDismiss).
 */
export function ScanBanner({ view, onDismiss }: { view: BannerView; onDismiss: () => void }) {
  const Icon = view.tone === 'success' ? Check : view.tone === 'neutral' ? null : AlertTriangle
  return (
    <div role="status" data-testid="scan-banner" data-tone={view.tone} className={cn('mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-ui', SURFACE[view.tone])}>
      {Icon && <Icon size={14} aria-hidden="true" className={cn('mt-0.5 shrink-0', TEXT_TONE[view.tone])} />}
      <p className={cn('m-0 min-w-0 flex-1', TEXT_TONE[view.tone])}>
        {view.text}
        {view.counts && <span className={TONE.muted}> · {view.counts}</span>}
      </p>
      <button type="button" aria-label={REDESIGN_COPY.dismiss} onClick={onDismiss} className={cn('-m-1 shrink-0 rounded p-1', TONE.muted, TONE.focus)}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
