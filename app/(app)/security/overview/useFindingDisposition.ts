'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  accountSecurityFindingsService,
  type AccountFindingDisposition,
  type AccountSecurityFinding,
} from '@/lib/services/account-security-findings.service'
import { ACTION_COPY, PLAIN_SERVER_MESSAGES } from './securityCopy'

export type DispositionAction = 'acknowledge' | 'dismiss' | 'accept-risk'

/** The decision each request must come back with for it to count as done. */
export const EXPECTED_DISPOSITION: Record<DispositionAction, AccountFindingDisposition> = {
  acknowledge: 'acknowledged',
  dismiss: 'dismissed',
  'accept-risk': 'accepted_risk',
}

const SUCCESS_TOAST: Record<DispositionAction, string> = {
  acknowledge: ACTION_COPY.acknowledged,
  dismiss: ACTION_COPY.dismissed,
  'accept-risk': ACTION_COPY.accepted,
}

export interface ActionFailure { title: string; description: string | null }
export type DispositionResult = { ok: true } | { ok: false; failure: ActionFailure }

/** "Action failed" + the server's message when it is one of the plain ones (D2); otherwise "Action failed. Try again." */
export function actionFailure(error: unknown): ActionFailure {
  const message = error instanceof Error ? error.message : null
  return message !== null && PLAIN_SERVER_MESSAGES.includes(message)
    ? { title: ACTION_COPY.failed, description: message }
    : { title: ACTION_COPY.failedTryAgain, description: null }
}

function request(action: DispositionAction, findingId: string, note: string | undefined): Promise<AccountSecurityFinding> {
  if (action === 'acknowledge') return accountSecurityFindingsService.acknowledge(findingId)
  if (action === 'dismiss') return accountSecurityFindingsService.dismiss(findingId, note ?? '')
  return accountSecurityFindingsService.acceptRisk(findingId, note ?? '')
}

/**
 * Acknowledge / Dismiss / Accept risk through the existing service (legacy runDisposition's pattern). Success means
 * the server answered success with the same finding carrying the requested decision; only then is that confirmed
 * row written into the findings cache, the toast shown and the list refetched. Anything else is a failure: nothing
 * in the cache changes, no success is shown, and the caller keeps what the user typed.
 */
export function useFindingDisposition(orgId: string | null) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  const run = async (findingId: string, action: DispositionAction, note?: string): Promise<DispositionResult> => {
    setBusy(true)
    try {
      let confirmed: AccountSecurityFinding
      try {
        confirmed = await request(action, findingId, note)
      } catch (error) {
        return { ok: false, failure: actionFailure(error) }
      }
      if (!confirmed || confirmed.id !== findingId || confirmed.disposition !== EXPECTED_DISPOSITION[action]) {
        return { ok: false, failure: actionFailure(null) }
      }
      queryClient.setQueryData<AccountSecurityFinding[]>(['account-security-findings', orgId], (rows) =>
        rows?.map((row) => (row.id === findingId ? confirmed : row)))
      toast.success(SUCCESS_TOAST[action], { description: ACTION_COPY.toastDescription })
      void queryClient.invalidateQueries({ queryKey: ['account-security-findings'] })
      return { ok: true }
    } finally {
      setBusy(false)
    }
  }

  return { run, busy }
}
