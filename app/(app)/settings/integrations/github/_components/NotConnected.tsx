import Link from 'next/link'
import { Clock, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COPY, RECORD_DEPLOYMENT_HREF } from '@/lib/github-connection/copy'
import type { ClaimOutcome } from '@/lib/github-connection/model'
import { BUTTON_OUTLINE, BUTTON_PRIMARY, CARD, OutcomeCard } from '@/components/integrations/parts'

/** Board 2: the feature is switched off. No Connect button anywhere. */
export function GitHubOff() {
  return (
    <section data-testid="github-off" className={cn(CARD, 'flex flex-col items-center gap-3 px-6 py-10 text-center')}>
      <Clock size={28} strokeWidth={1.75} className="text-ink-muted" aria-hidden="true" />
      <h2 className="m-0 text-section text-ink">{COPY.offTitle}</h2>
      <p className="m-0 max-w-[520px] text-ui text-ink-muted">{COPY.offBody}</p>
      <Link href={RECORD_DEPLOYMENT_HREF} data-testid="github-off-record" className={BUTTON_OUTLINE}>{COPY.offRecord}</Link>
    </section>
  )
}

function ConnectButton({ onConnect, starting, testId = 'github-connect' }: { onConnect: () => void; starting: boolean; testId?: string }) {
  return (
    <button type="button" data-testid={testId} onClick={onConnect} disabled={starting} aria-busy={starting} className={cn(BUTTON_PRIMARY, 'min-h-12 px-5 text-body')}>
      {COPY.connectGitHub}
    </button>
  )
}

/** Board 3: not connected. Owners and admins get Connect GitHub; everyone else the member row. */
export function ConnectSetup({
  canManage, onConnect, starting, installFailed,
}: { canManage: boolean; onConnect: () => void; starting: boolean; installFailed: boolean }) {
  return (
    <div data-testid="github-not-connected" className="flex flex-wrap items-start gap-4">
      <section className={cn(CARD, 'flex min-w-0 flex-[999_1_560px] flex-col gap-5 p-7')}>
        <h2 className="m-0 text-section text-ink">{COPY.stepsTitle}</h2>
        <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
          {COPY.steps.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span aria-hidden="true" className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-violet-50 text-meta font-semibold text-ink-accent">{i + 1}</span>
              <span className="flex flex-col gap-0.5">
                <span className="text-body font-semibold text-ink">{step.title}</span>
                <span className="text-ui text-ink-muted">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
        {canManage ? (
          <div className="flex flex-col gap-3 border-t border-slate-100 pt-5">
            <div className="flex flex-wrap items-center gap-4">
              <ConnectButton onConnect={onConnect} starting={starting} />
              <span className="text-meta text-ink-muted">{COPY.onlyOwnersCanConnect}</span>
            </div>
            {installFailed && <p role="alert" data-testid="github-install-failed" className="m-0 text-ui text-ink-danger">{COPY.installFailed}</p>}
          </div>
        ) : (
          <MemberRow />
        )}
      </section>
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
        <section className={cn(CARD, 'flex flex-col gap-2.5 p-5')}>
          <h3 className="m-0 text-body font-semibold text-ink">{COPY.canReadTitle}</h3>
          <p className="m-0 text-ui text-ink-body">{COPY.canReadBody}</p>
          <h3 className="m-0 pt-1.5 text-body font-semibold text-ink">{COPY.cantTitle}</h3>
          <p className="m-0 text-ui text-ink-body">{COPY.cantBody}</p>
        </section>
        <section className={cn(CARD, 'flex flex-col gap-2 p-5')}>
          <h3 className="m-0 text-body font-semibold text-ink">{COPY.planLimitsTitle}</h3>
          <p className="m-0 text-ui text-ink-body">{COPY.planLimitsBody}</p>
        </section>
      </div>
    </div>
  )
}

/** Board 3's member version of the button row: no disabled button. */
export function MemberRow() {
  return (
    <div data-testid="github-member-row" className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4">
      <Lock size={18} strokeWidth={1.75} className="flex-none text-ink-muted" aria-hidden="true" />
      <span className="text-ui text-ink-body">{COPY.memberAsk}</span>
    </div>
  )
}

/** Board 4: what the claim answered. Success is the banner on the connected view, not a card. */
export function ClaimOutcomeCard({
  outcome, canManage, onConnect, onTryAgain, starting,
}: {
  outcome: ClaimOutcome
  canManage: boolean
  onConnect: () => void
  onTryAgain: () => void
  starting: boolean
}) {
  const restart = canManage ? (
    <button type="button" data-testid="github-outcome-connect" onClick={onConnect} disabled={starting} className={cn(BUTTON_OUTLINE, 'self-start')}>
      {COPY.connectGitHub}
    </button>
  ) : undefined
  switch (outcome.kind) {
    case 'waiting':
      return <OutcomeCard testId="github-claim-finishing" live title={COPY.finishingTitle}>{COPY.finishingBody}</OutcomeCard>
    case 'expired':
      return <OutcomeCard testId="github-claim-expired" live title={COPY.expiredTitle} action={restart}>{COPY.expiredBody}</OutcomeCard>
    case 'no_response':
      return (
        <OutcomeCard
          testId="github-claim-no-response"
          live
          title={COPY.noResponseTitle}
          action={<button type="button" data-testid="github-claim-try-again" onClick={onTryAgain} className={cn(BUTTON_OUTLINE, 'self-start')}>{COPY.tryAgain}</button>}
        >
          {COPY.noResponseBody}
        </OutcomeCard>
      )
    case 'elsewhere':
      return <OutcomeCard testId="github-claim-elsewhere" live title={COPY.elsewhereTitle}>{COPY.elsewhereBody}</OutcomeCard>
    case 'installer_mismatch':
      return <OutcomeCard testId="github-claim-installer" live title={COPY.installerTitle} action={restart}>{COPY.installerBody}</OutcomeCard>
    case 'approval_requested':
      return <OutcomeCard testId="github-claim-approval" live title={COPY.approvalTitle}>{COPY.approvalBody}</OutcomeCard>
    case 'not_allowed':
      return <OutcomeCard testId="github-claim-not-allowed" live title={COPY.notAllowedTitle}>{COPY.notAllowedBody}</OutcomeCard>
    case 'cancelled':
      return <OutcomeCard testId="github-claim-cancelled" live title={COPY.cancelledTitle} action={restart}>{COPY.cancelledBody}</OutcomeCard>
    case 'not_accessible':
      return <OutcomeCard testId="github-claim-not-accessible" live title={COPY.notAccessibleTitle} action={restart}>{COPY.notAccessibleBody}</OutcomeCard>
    case 'github_auth_failed':
      return <OutcomeCard testId="github-claim-auth-failed" live title={COPY.authFailedTitle} action={restart}>{COPY.authFailedBody}</OutcomeCard>
    case 'install_event_missing':
      return <OutcomeCard testId="github-claim-install-event" live title={COPY.installEventMissingTitle} action={restart}>{outcome.message}</OutcomeCard>
    case 'failed':
      return <OutcomeCard testId="github-claim-failed" live title={COPY.noResponseTitle} action={restart}>{COPY.failedBody}</OutcomeCard>
    default:
      return null
  }
}
