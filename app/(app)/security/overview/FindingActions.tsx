'use client'

import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { FindingRow } from './securityModel'
import { ACTION_COPY } from './securityCopy'
import { DispositionDialog } from './DispositionDialog'
import { useFindingDisposition } from './useFindingDisposition'

/** The route rules (account-security-findings.routes.ts): acknowledge and dismiss need member or above; accept risk, admin. */
const CAN_TRIAGE = ['owner', 'admin', 'member']
const CAN_ACCEPT = ['owner', 'admin']

const BUTTON = 'inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-ui font-semibold text-ink hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-ink-muted'

/**
 * Acknowledge, Accept risk… and Dismiss for an active account finding (D1: all three on every active row). Disabled
 * actions say why, visibly and to assistive technology (aria-describedby): a viewer can't change findings, and
 * Accept risk is admins only (decision 3). An unknown role (null on the first render) fails closed: disabled.
 * The server stays the boundary; this only mirrors its rules.
 */
export function FindingActions({ row, role, orgId, onConfirmed }: {
  row: FindingRow
  role: string | null
  orgId: string | null
  /** Called once the server has confirmed, just before the list changes (the list then moves focus if needed). */
  onConfirmed?: () => void
}) {
  const { run, busy } = useFindingDisposition(orgId, onConfirmed)
  const [dialog, setDialog] = useState<'dismiss' | 'accept-risk' | null>(null)
  const opener = useRef<'dismiss' | 'accept-risk'>('dismiss')
  const dismissButton = useRef<HTMLButtonElement>(null)
  const acceptButton = useRef<HTMLButtonElement>(null)
  const viewerId = useId()
  const adminsId = useId()

  const findingId = row.findingId!
  const canTriage = role !== null && CAN_TRIAGE.includes(role)
  const canAccept = role !== null && CAN_ACCEPT.includes(role)
  const viewer = role === 'viewer'
  const adminsOnly = canTriage && !canAccept

  const acknowledge = async () => {
    const result = await run(findingId, 'acknowledge')
    if (!result.ok) toast.error(result.failure.title, result.failure.description ? { description: result.failure.description } : undefined)
  }

  const open = (action: 'dismiss' | 'accept-risk') => {
    opener.current = action
    setDialog(action)
  }

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={row.title} aria-busy={busy || undefined} className="flex flex-wrap gap-2">
        <button type="button" onClick={acknowledge} disabled={busy || !canTriage} aria-describedby={viewer ? viewerId : undefined} className={BUTTON}>
          {ACTION_COPY.acknowledge}
        </button>
        <button
          ref={acceptButton}
          type="button"
          onClick={() => open('accept-risk')}
          disabled={busy || !canAccept}
          aria-describedby={viewer ? viewerId : adminsOnly ? adminsId : undefined}
          className={BUTTON}
        >
          {ACTION_COPY.acceptRisk}
        </button>
        <button ref={dismissButton} type="button" onClick={() => open('dismiss')} disabled={busy || !canTriage} aria-describedby={viewer ? viewerId : undefined} className={BUTTON}>
          {ACTION_COPY.dismiss}
        </button>
      </div>
      {viewer && <p id={viewerId} className="m-0 text-meta text-ink-muted">{ACTION_COPY.viewerCantChange}</p>}
      {adminsOnly && <p id={adminsId} className="m-0 text-meta text-ink-muted">{ACTION_COPY.adminsOnly}</p>}

      <DispositionDialog
        action={dialog}
        busy={busy}
        onSubmit={(note) => run(findingId, dialog!, note)}
        onClose={() => setDialog(null)}
        returnFocusTo={() => (opener.current === 'dismiss' ? dismissButton.current : acceptButton.current)}
      />
    </div>
  )
}
