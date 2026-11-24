'use client'

import { useState } from 'react'
import { CircleCheck, CirclePause, CircleX, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { GitHubInstallation, GitHubRepository } from '@/lib/services/github-connection.service'
import {
  COPY,
  accountTypeLabel,
  installationSettingsUrl,
  permissionsNowHave,
  relativeTime,
  shortDate,
  shortName,
} from '@/lib/github-connection/copy'
import { bannersFor, needsAttention, removedRepositories } from '@/lib/github-connection/model'
import { Banner, BannerLink, BUTTON_DANGER, BUTTON_DANGER_OUTLINE, BUTTON_NEUTRAL, BUTTON_PRIMARY, CARD, Chip } from '@/components/integrations/parts'

/** Board 4's success banner, at the top of the connected screen. */
export function ConnectedBanner({ account, onDismiss }: { account: string; onDismiss: () => void }) {
  return (
    <Banner tone="success" testId="github-connected-banner" icon={<CircleCheck size={20} strokeWidth={2} />} title={COPY.connectedTitle} onDismiss={onDismiss}>
      {COPY.connectedBody(account)}
    </Banner>
  )
}

/** Board 6's banners for one installation, under the page header. */
export function InstallationBanners({
  installation, canManage, onConnect, starting,
}: { installation: GitHubInstallation; canManage: boolean; onConnect: () => void; starting: boolean }) {
  const settings = installationSettingsUrl(installation)
  return (
    <>
      {bannersFor(installation).map((banner) => {
        if (banner === 'uninstalled') {
          return (
            <Banner
              key={banner}
              tone="danger"
              testId="github-banner-uninstalled"
              icon={<CircleX size={20} strokeWidth={2} />}
              title={COPY.uninstalledTitle(installation.account_login)}
              action={canManage ? (
                <button type="button" data-testid="github-banner-uninstalled-connect" onClick={onConnect} disabled={starting} className={cn(BUTTON_PRIMARY, 'mt-1 self-start')}>
                  {COPY.connectGitHub}
                </button>
              ) : undefined}
            >
              {COPY.uninstalledBody}
            </Banner>
          )
        }
        if (banner === 'suspended') {
          return (
            <Banner
              key={banner}
              tone="warning"
              testId="github-banner-suspended"
              icon={<CirclePause size={20} strokeWidth={2} />}
              title={COPY.suspendedTitle}
              action={<BannerLink tone="warning" href={settings}>{COPY.unsuspendOnGitHub}</BannerLink>}
            >
              {COPY.suspendedBody}
            </Banner>
          )
        }
        return (
          <Banner
            key={banner}
            tone="warning"
            testId="github-banner-mismatch"
            icon={<TriangleAlert size={20} strokeWidth={2} />}
            title={COPY.mismatchTitle}
            action={<BannerLink tone="warning" href={settings}>{COPY.reviewOnGitHub}</BannerLink>}
          >
            {COPY.mismatchBody(permissionsNowHave(installation.permission_differences))}
          </Banner>
        )
      })}
    </>
  )
}

/** Board 5's summary card for one installation. */
export function SummaryCard({ installation, lastEventAt, now }: { installation: GitHubInstallation; lastEventAt: string | null; now: number }) {
  const attention = needsAttention(installation)
  const name = installation.claimed_by_name ? shortName(installation.claimed_by_name) : ''
  const date = shortDate(installation.claimed_at)
  return (
    <section data-testid="github-summary" aria-label={`GitHub: ${installation.account_login}`} className={cn(CARD, 'flex flex-wrap items-center gap-x-8 gap-y-3 px-6 py-5')}>
      <div className="flex flex-wrap items-center gap-2.5">
        <Chip tone={attention ? 'warning' : 'success'} testId="github-summary-chip">{attention ? COPY.chipNeedsAttention : COPY.chipConnected}</Chip>
        <span className="text-body font-semibold text-ink">{installation.account_login}</span>
        <span className="text-meta text-ink-muted">{accountTypeLabel(installation.account_type)}</span>
      </div>
      <span className="text-meta text-ink-body">{installation.permissions_state === 'mismatch' ? COPY.permissionsMismatch : COPY.permissionsExpected}</span>
      <span data-testid="github-summary-last-event" className="text-meta text-ink-body">
        {lastEventAt ? COPY.lastEvent(relativeTime(lastEventAt, now)) : COPY.lastEventNone}
      </span>
      <span data-testid="github-summary-connected-by" className="text-meta text-ink-body">{name ? COPY.connectedBy(name, date) : COPY.connectedOn(date)}</span>
    </section>
  )
}

/** Board 6: a repository removed from the installation on GitHub. Its row stays, greyed. */
export function RemovedRepositories({ repositories }: { repositories: readonly GitHubRepository[] }) {
  const removed = removedRepositories(repositories)
  if (removed.length === 0) return null
  return (
    <ul data-testid="github-removed-repositories" className="m-0 flex list-none flex-col gap-2 p-0">
      {removed.map((repo) => (
        <li key={repo.id} className={cn(CARD, 'flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-6 py-4')}>
          <span className="text-ui font-semibold text-ink-body">{repo.full_name}</span>
          <span className="text-meta text-ink-muted">{COPY.removedRepo}</span>
        </li>
      ))}
    </ul>
  )
}

/** Board 5's disconnect row, and board 6's dialog. Owners and admins only; disabled in the demo sample. */
export function DisconnectRow({
  installation, onDisconnect, disabled = false,
}: {
  installation: GitHubInstallation
  onDisconnect?: (installationId: string) => Promise<boolean>
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const confirm = async () => {
    if (!onDisconnect) return
    setBusy(true)
    setFailed(false)
    const ok = await onDisconnect(installation.installation_id)
    setBusy(false)
    if (ok) setOpen(false)
    else setFailed(true)
  }
  return (
    <section data-testid="github-disconnect-row" className={cn(CARD, 'flex flex-wrap items-center justify-between gap-3 px-6 py-4')}>
      <span className="flex flex-col gap-0.5">
        <h2 className="m-0 text-body font-semibold text-ink">{COPY.disconnectTitle}</h2>
        <span className="text-meta text-ink-muted">{COPY.disconnectBody}</span>
      </span>
      <button type="button" data-testid="github-disconnect" disabled={disabled} onClick={() => { setFailed(false); setOpen(true) }} className={BUTTON_DANGER_OUTLINE}>
        {COPY.disconnect}
      </button>
      <AlertDialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next) }}>
        <AlertDialogContent data-testid="github-disconnect-dialog" className="flex flex-col gap-3.5">
          <AlertDialogTitle className="text-section text-ink">{COPY.dialogTitle}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-3.5">
              <p className="m-0 text-ui text-ink-body">{COPY.dialogBody(installation.account_login)}</p>
              <p className="m-0 text-ui text-ink-body">{COPY.dialogStaysInstalled}</p>
            </div>
          </AlertDialogDescription>
          <a
            href={installationSettingsUrl(installation)}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="github-uninstall-link"
            className="self-start rounded text-ui font-semibold text-ink-accent no-underline hover:text-violet-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600"
          >
            {COPY.uninstallOnGitHub}
          </a>
          {failed && <p role="alert" data-testid="github-disconnect-failed" className="m-0 text-ui text-ink-danger">{COPY.disconnectFailed}</p>}
          <div className="flex justify-end gap-2.5 pt-1.5">
            <button type="button" data-testid="github-disconnect-cancel" disabled={busy} onClick={() => setOpen(false)} className={BUTTON_NEUTRAL}>{COPY.cancel}</button>
            <button type="button" data-testid="github-disconnect-confirm" disabled={busy} aria-busy={busy} onClick={() => void confirm()} className={BUTTON_DANGER}>{COPY.disconnect}</button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

/** Board 5's header action: the installation's settings on GitHub. A deleted installation has none. */
export function ManageOnGitHub({ installation, disabled = false }: { installation: GitHubInstallation | null; disabled?: boolean }) {
  if (!installation) return null
  if (disabled) {
    return <button type="button" disabled data-testid="github-manage" className={BUTTON_NEUTRAL}>{COPY.manageOnGitHub}</button>
  }
  return (
    <a href={installationSettingsUrl(installation)} target="_blank" rel="noopener noreferrer" data-testid="github-manage" className={BUTTON_NEUTRAL}>
      {COPY.manageOnGitHub}
    </a>
  )
}
