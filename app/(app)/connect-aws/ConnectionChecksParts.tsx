'use client'

/**
 * Boards 4 and 5, the AWS connect PR D1 parts: the Health fact, the role's policies, the sources a
 * scan was refused, and Check again. Every string is from connectAwsCopy (§6 of connect-d1-step1.md).
 * Fixed verdicts and dates only: the server never sends the role ID, a policy document, inline
 * policy names or customer-managed ARNs, and nothing here renders them.
 */
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import awsAccountsService, { type ConnectionChecks, type PolicyCheck } from '@/lib/services/aws-accounts.service'
import { formatScanTime } from '../services/coverage'
import {
  ACCOUNTS_ERROR,
  CHECKING_BUTTON,
  CHECK_AGAIN,
  CHECK_AGAIN_CAUSES_FOOT,
  CHECK_AGAIN_CAUSES_TITLE,
  CHECK_AGAIN_CAUSE_DELETED,
  CHECK_AGAIN_CAUSE_TRUST,
  CHECK_AGAIN_NOTE,
  CHECK_AGAIN_ROLE_REFUSED,
  HEALTH_FAILING_HELP,
  HEALTH_NOT_CHECKED_YET,
  HEALTH_STALE_HELP,
  NETWORK_ERROR,
  POLICIES_NOT_COMPARED,
  POLICIES_NOT_COMPARED_OWNER,
  POLICIES_TITLE,
  POLICIES_UNREADABLE,
  POLICY_READ_EXTRAS_DIFFERS,
  POLICY_READ_EXTRAS_MATCHES,
  POLICY_READ_EXTRAS_MISSING,
  POLICY_READ_EXTRAS_UNREADABLE,
  POLICY_READ_ONLY_ACCESS,
  POLICY_SECURITY_AUDIT_ATTACHED,
  POLICY_SECURITY_AUDIT_MISSING,
  POLICY_VIEW_ONLY_ATTACHED,
  POLICY_VIEW_ONLY_MISSING,
  REFUSED_SOURCE_LABELS,
  availableAgainAt,
  checkAgainCauseExternalId,
  healthFailing,
  healthLost,
  healthOk,
  healthStale,
  policiesAlsoAttached,
  policiesTitleChecked,
  refusedLine,
  refusedTitle,
} from './connectAwsCopy'

/** The query the saved checks live under; Check again and a connect invalidate it. */
export const CONNECTION_CHECKS_KEY = 'aws-connection-checks'

// ---------------------------------------------------------------------------
// Health (F2-F8)
// ---------------------------------------------------------------------------

/**
 * The Health fact's value and its helper text. "OK" only for a fresh ok: a stale check is
 * "Not checked recently" whatever it last found (the server decides staleness, D1-D4).
 */
export function healthView(health: ConnectionChecks['health'], now: number): { value: string; help: string | null; warning: boolean } {
  const at = (iso: string | null) => (iso ? formatScanTime(iso, now) : '—')
  switch (health.state) {
    case 'ok':
      return { value: healthOk(at(health.checkedAt)), help: null, warning: false }
    case 'failing':
      return { value: healthFailing(at(health.failingSince)), help: HEALTH_FAILING_HELP, warning: true }
    case 'lost':
      return { value: healthLost(at(health.failingSince)), help: HEALTH_FAILING_HELP, warning: true }
    case 'not_checked_recently':
      return { value: healthStale(health.lastResult ?? 'ok', at(health.checkedAt)), help: HEALTH_STALE_HELP, warning: false }
    default:
      return { value: HEALTH_NOT_CHECKED_YET, help: null, warning: false }
  }
}

// ---------------------------------------------------------------------------
// The role's policies (P1-P11)
// ---------------------------------------------------------------------------

type Mark = 'ok' | 'no' | 'unknown'
const MARKS: Record<Mark, { sign: string; className: string }> = {
  ok: { sign: '✓', className: 'text-ink-success' },
  no: { sign: '✕', className: 'text-ink-danger' },
  unknown: { sign: '?', className: 'text-ink-warning' },
}

/** One verdict line per policy, in the order the setup lists them. */
export function policyLines(policy: Extract<PolicyCheck, { unreadable: false }>): { mark: Mark; text: string }[] {
  const readExtras: Record<typeof policy.readExtras, { mark: Mark; text: string }> = {
    matches: { mark: 'ok', text: POLICY_READ_EXTRAS_MATCHES },
    differs: { mark: 'no', text: POLICY_READ_EXTRAS_DIFFERS },
    missing: { mark: 'no', text: POLICY_READ_EXTRAS_MISSING },
    unreadable: { mark: 'unknown', text: POLICY_READ_EXTRAS_UNREADABLE },
  }
  return [
    policy.securityAudit === 'attached'
      ? { mark: 'ok', text: POLICY_SECURITY_AUDIT_ATTACHED }
      : { mark: 'no', text: POLICY_SECURITY_AUDIT_MISSING },
    policy.viewOnlyAccess === 'attached'
      ? { mark: 'ok', text: POLICY_VIEW_ONLY_ATTACHED }
      : { mark: 'no', text: POLICY_VIEW_ONLY_MISSING },
    readExtras[policy.readExtras],
  ]
}

export function RolePolicies({ policy, isOwner, now }: { policy: PolicyCheck | null; isOwner: boolean; now: number }) {
  return (
    <div className="mt-5" data-testid="role-policies">
      <h3 className="text-ui text-ink font-medium mb-2">
        {policy ? policiesTitleChecked(formatScanTime(policy.checkedAt, now)) : POLICIES_TITLE}
      </h3>
      {!policy ? (
        <p className="text-meta text-ink-muted">{isOwner ? POLICIES_NOT_COMPARED_OWNER : POLICIES_NOT_COMPARED}</p>
      ) : policy.unreadable ? (
        <p className="text-ui text-ink-body">{POLICIES_UNREADABLE}</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {policyLines(policy).map((line) => (
              <li key={line.text} className="flex items-start gap-2.5 text-ui text-ink-body" data-mark={line.mark}>
                <span aria-hidden="true" className={`font-semibold shrink-0 ${MARKS[line.mark].className}`}>{MARKS[line.mark].sign}</span>
                {line.text}
              </li>
            ))}
          </ul>
          {policy.readOnlyAccess && <p className="mt-2 text-meta text-ink-body" data-testid="policy-read-only-access">{POLICY_READ_ONLY_ACCESS}</p>}
          {(policy.otherAwsManaged.length > 0 || policy.otherCount > 0) && (
            <p className="mt-2 text-meta text-ink-muted" data-testid="policy-also-attached">
              {policiesAlsoAttached(policy.otherAwsManaged, policy.otherCount)}
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Refused sources (R1-R3)
// ---------------------------------------------------------------------------

export function RefusedSources({ refused, now }: { refused: ConnectionChecks['refusedSources']; now: number }) {
  // Only the 8 listings the page has a label for; nothing is shown for a source it can't name.
  const sources = (refused?.sources ?? []).filter((s) => REFUSED_SOURCE_LABELS[s.source] !== undefined)
  if (!refused || sources.length === 0) return null
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 mb-4" data-testid="refused-sources">
      <p className="text-ui text-ink font-medium mb-1">{refusedTitle(formatScanTime(refused.scannedAt, now))}</p>
      <ul className="space-y-1">
        {sources.map((s) => (
          <li key={s.source} className="text-meta text-ink-body">{refusedLine(REFUSED_SOURCE_LABELS[s.source], s.action)}</li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Check again (C1-C9, B7)
// ---------------------------------------------------------------------------

export type CheckAgainError =
  | { kind: 'cooldown'; availableAt: string }
  | { kind: 'role_refused' }
  | { kind: 'message'; message: string }

/** AssumeRole was refused (and recorded): the page lists the causes instead of the server text. */
const ROLE_REFUSED_CODES: ReadonlySet<string> = new Set(['ROLE_NOT_ASSUMABLE', 'ROLE_NOT_FOUND', 'ROLE_CHECK_FAILED'])

/**
 * How a failed Check again is shown, by the server's code: 429 → the cooldown (from the body's
 * availableAt, else Retry-After); a refused AssumeRole → the causes panel; anything else → the
 * server's fixed message (B4, B6, B8 and the reused texts), or a safe fallback.
 */
export function checkAgainErrorView(err: unknown, nowMs: number): CheckAgainError {
  const response = (err as { response?: { status?: number; data?: unknown; headers?: Record<string, unknown> } } | null)?.response
  if (!response) return { kind: 'message', message: NETWORK_ERROR }
  const data = (typeof response.data === 'object' && response.data !== null ? response.data : {}) as { code?: unknown; message?: unknown; availableAt?: unknown }
  const code = typeof data.code === 'string' ? data.code : null
  const message = typeof data.message === 'string' && data.message ? data.message : ACCOUNTS_ERROR
  if (response.status === 429 || code === 'CHECK_COOLDOWN') {
    if (typeof data.availableAt === 'string' && !Number.isNaN(Date.parse(data.availableAt))) {
      return { kind: 'cooldown', availableAt: new Date(data.availableAt).toISOString() }
    }
    const retryAfter = Number(response.headers?.['retry-after'] ?? response.headers?.['Retry-After'])
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return { kind: 'cooldown', availableAt: new Date(nowMs + retryAfter * 1000).toISOString() }
    }
    return { kind: 'message', message }
  }
  if (code !== null && ROLE_REFUSED_CODES.has(code)) return { kind: 'role_refused' }
  return { kind: 'message', message }
}

/** The later of two instants (ISO), or null when neither is set. */
function later(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return Date.parse(a) >= Date.parse(b) ? a : b
}

/** True until the instant passes (re-rendered then by a timer; no clock read during render). */
function useUntil(iso: string | null): boolean {
  const [passed, setPassed] = useState<string | null>(null)
  useEffect(() => {
    if (!iso) return
    const timer = setTimeout(() => setPassed(iso), Math.max(0, Date.parse(iso) - Date.now()))
    return () => clearTimeout(timer)
  }, [iso])
  return iso !== null && passed !== iso
}

export const formatAvailableTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

interface CheckAgainProps {
  /** From the owner's GET /checks: when Check again is next available (null: now). */
  serverAvailableAt: string | null
  /** The External ID: present in GET /accounts for the owner only, so C8 shows only to the owner. */
  externalId: string | null | undefined
}

/** Owner only (the caller renders it only when GET /checks carries `checkAgain`). */
export function CheckAgain({ serverAvailableAt, externalId }: CheckAgainProps) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<Exclude<CheckAgainError, { kind: 'cooldown' }> | null>(null)
  const [refusedUntil, setRefusedUntil] = useState<string | null>(null)
  const availableAt = later(serverAvailableAt, refusedUntil)
  const coolingDown = useUntil(availableAt)

  const refreshSaved = () => {
    queryClient.invalidateQueries({ queryKey: [CONNECTION_CHECKS_KEY] })
    queryClient.invalidateQueries({ queryKey: ['aws-accounts'] })
  }

  const run = async () => {
    setPending(true)
    setError(null)
    try {
      await awsAccountsService.checkAgain()
      refreshSaved()
    } catch (err: unknown) {
      const view = checkAgainErrorView(err, Date.now())
      if (view.kind === 'cooldown') {
        setRefusedUntil(view.availableAt)
      } else {
        setError(view)
        // The refused AssumeRole was recorded: the health on this page now shows it (B7).
        if (view.kind === 'role_refused') refreshSaved()
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mt-5" data-testid="check-again">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={pending || coolingDown}
          className={`rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-ui font-medium transition-colors ${pending || coolingDown ? 'text-ink-muted cursor-default' : 'text-ink hover:border-slate-300 cursor-pointer'}`}
        >
          {pending ? CHECKING_BUTTON : CHECK_AGAIN}
        </button>
        {coolingDown && availableAt && !pending && (
          <span className="text-meta text-ink-muted" data-testid="check-again-cooldown">{availableAgainAt(formatAvailableTime(availableAt))}</span>
        )}
      </div>
      <p className="mt-2 text-meta text-ink-muted">{CHECK_AGAIN_NOTE}</p>
      {error?.kind === 'message' && (
        <p role="alert" className="mt-2 text-ui text-ink-warning" data-testid="check-again-error">{error.message}</p>
      )}
      {error?.kind === 'role_refused' && (
        <div role="alert" className="mt-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl" data-testid="check-again-refused">
          <p className="text-ui text-ink font-medium mb-1">{CHECK_AGAIN_ROLE_REFUSED}</p>
          <p className="text-ui text-ink-body mb-1.5">{CHECK_AGAIN_CAUSES_TITLE}</p>
          <ul className="list-disc pl-5 space-y-1 text-ui text-ink-body mb-1.5">
            <li>{CHECK_AGAIN_CAUSE_DELETED}</li>
            <li>{CHECK_AGAIN_CAUSE_TRUST}</li>
            {externalId && <li data-testid="check-again-cause-external-id">{checkAgainCauseExternalId(externalId)}</li>}
          </ul>
          <p className="text-meta text-ink-muted">{CHECK_AGAIN_CAUSES_FOOT}</p>
        </div>
      )}
    </div>
  )
}
