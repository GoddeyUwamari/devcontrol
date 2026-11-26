'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useGitHubConnection, GITHUB_CONNECTION_KEY, GITHUB_REPOSITORIES_KEY } from '@/lib/hooks/use-github-connection'
import { githubConnectionService, type GitHubInstallation } from '@/lib/services/github-connection.service'
import { COPY, REPO_COPY, installationSettingsUrl } from '@/lib/github-connection/copy'
import { useRegisteredServices } from '@/lib/hooks/use-registered-services'
import { useServiceLimit } from '@/lib/hooks/use-service-limit'
import { cn } from '@/lib/utils'
import { BUTTON_OUTLINE, CARD, Chip, LoadingBlocks, PageHeader } from '@/components/integrations/parts'
import { ClaimOutcomeCard, ConnectSetup, GitHubOff } from './_components/NotConnected'
import { ConnectedBanner, DisconnectRow, InstallationBanners, ManageOnGitHub, SummaryCard } from './_components/Connected'
import { Repositories } from './_components/Repositories'
import { DEMO_REPOSITORIES, DEMO_SERVICES } from './_components/demo-sample'
import { useGitHubClaim } from './_components/useGitHubClaim'

/**
 * /settings/integrations/github (D8b-1): boards 2-4 and 6, and board 5's
 * header, summary card and disconnect row. D8b-2: board 5's repository table
 * (services, deploy rules, held counts, plan limit, footer) and board 8.
 *
 * Until GET / answers: grey blocks only. Feature off: board 2, no Connect
 * anywhere (Q10). Demo workspace: a fixed read-only sample, and no request
 * other than GET / (Q9). Who may connect or disconnect comes from the
 * server's can_manage (Q4), never from the token's role alone.
 */
export default function GitHubIntegrationPage() {
  const queryClient = useQueryClient()
  const { connection, repositories, heldEventDays, wantsRepositories } = useGitHubConnection()
  // The workspace's own services, for the service selects: only for those who can change a mapping.
  const canMapServices = wantsRepositories && connection.data?.configured === true && connection.data.can_manage
  const services = useRegisteredServices({ enabled: canMapServices })
  // At the services limit, "Create a service →" becomes the limit line (C8).
  const serviceLimit = useServiceLimit({ enabled: canMapServices })
  const claim = useGitHubClaim(connection.data)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const header = (action?: React.ReactNode) => <PageHeader title={COPY.pageTitle} subtitle={COPY.pageSubtitle} action={action} />
  const shell = (children: React.ReactNode) => (
    <div data-testid="github-page" className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-4 pb-12 pt-6">{children}</div>
  )

  if (connection.isPending) return shell(<>{header()}<LoadingBlocks /></>)
  if (connection.isError) {
    return shell(
      <>
        {header()}
        <section data-testid="github-load-failed" className={cn(CARD, 'flex flex-col items-start gap-3 p-6')}>
          <p className="m-0 text-ui text-ink-body">{COPY.pageLoadFailed}</p>
          <button type="button" onClick={() => void connection.refetch()} className={BUTTON_OUTLINE}>{COPY.tryAgain}</button>
        </section>
      </>
    )
  }

  const data = connection.data
  if (!data.configured || claim.outcome?.kind === 'off') return shell(<>{header()}<GitHubOff /></>)
  if (data.demo || claim.outcome?.kind === 'demo') return shell(<DemoSample now={now} />)

  const canManage = data.can_manage
  const installations = data.installations
  const outcome = claim.outcome
  const outcomeCard = outcome && outcome.kind !== 'connected' && outcome.kind !== 'already_connected'
    ? <ClaimOutcomeCard outcome={outcome} canManage={canManage} onConnect={() => void claim.connect()} onTryAgain={claim.tryAgain} starting={claim.starting} />
    : null

  if (installations.length === 0) {
    // Just claimed: the connection is being read again; grey blocks, never the "not connected" setup in between.
    const refetching = outcome?.kind === 'connected' || outcome?.kind === 'already_connected'
    return shell(
      <>
        {header()}
        {refetching ? <LoadingBlocks /> : outcomeCard ?? (
          <ConnectSetup canManage={canManage} onConnect={() => void claim.connect()} starting={claim.starting} installFailed={claim.installProblem === 'failed'} />
        )}
      </>
    )
  }

  const disconnect = async (installationId: string) => {
    const answer = await githubConnectionService.disconnect(installationId)
    if (answer.status === 200 || answer.status === 404) {
      await queryClient.invalidateQueries({ queryKey: GITHUB_CONNECTION_KEY })
      await queryClient.invalidateQueries({ queryKey: GITHUB_REPOSITORIES_KEY })
      return true
    }
    return false
  }
  const manageTarget: GitHubInstallation | null = installations.find((i) => i.deleted_at === null) ?? null

  return shell(
    <>
      {header(<ManageOnGitHub installation={manageTarget} />)}
      {outcome?.kind === 'connected' && <ConnectedBanner account={outcome.account} onDismiss={claim.dismiss} />}
      {outcomeCard}
      {installations.map((installation) => (
        <InstallationBanners key={`banners-${installation.installation_id}`} installation={installation} canManage={canManage} onConnect={() => void claim.connect()} starting={claim.starting} />
      ))}
      {installations.map((installation) => (
        <SummaryCard key={`summary-${installation.installation_id}`} installation={installation} lastEventAt={data.last_event_at} now={now} />
      ))}
      {repositories.isPending ? <LoadingBlocks testId="github-repositories-loading" /> : repositories.isError ? (
        <section data-testid="github-repositories-failed" className={cn(CARD, 'flex flex-col items-start gap-3 p-6')}>
          <p className="m-0 text-ui text-ink-body">{REPO_COPY.loadFailed}</p>
          <button type="button" onClick={() => void repositories.refetch()} className={BUTTON_OUTLINE}>{COPY.tryAgain}</button>
        </section>
      ) : (
        <Repositories
          repositories={repositories.data}
          services={(services.data ?? []).map((s) => ({ id: s.id, name: s.name }))}
          servicesFailed={services.isError}
          onRetryServices={() => void services.refetch()}
          canManage={canManage}
          heldEventDays={heldEventDays}
          now={now}
          chooseOnGitHubHref={manageTarget ? installationSettingsUrl(manageTarget) : null}
          onChanged={() => queryClient.invalidateQueries({ queryKey: GITHUB_REPOSITORIES_KEY })}
          serviceLimit={serviceLimit.data}
        />
      )}
      {canManage && installations.map((installation) => (
        <DisconnectRow key={`disconnect-${installation.installation_id}`} installation={installation} onDisconnect={disconnect} />
      ))}
    </>
  )
}

/** The demo workspace's fixed sample (Q9, board 6): a connected screen, nothing in it can be changed. */
const DEMO_INSTALLATION: GitHubInstallation = {
  installation_id: '0',
  account_login: 'acme-inc',
  account_type: 'Organization',
  repository_selection: 'selected',
  permissions_state: 'expected',
  permission_differences: [],
  claimed_at: '2026-11-24T10:00:00.000Z',
  claimed_by_name: 'Sam Rivera',
  suspended_at: null,
  deleted_at: null,
}

function DemoSample({ now }: { now: number }) {
  return (
    <>
      <PageHeader title={COPY.pageTitle} subtitle={COPY.pageSubtitle} action={<ManageOnGitHub installation={DEMO_INSTALLATION} disabled />} />
      <div data-testid="github-demo" className="flex flex-wrap items-center gap-2.5">
        <Chip tone="accent">{COPY.demoChip}</Chip>
        <span className="text-ui text-ink-body">{COPY.demoBody}</span>
      </div>
      <SummaryCard installation={DEMO_INSTALLATION} lastEventAt={new Date(now - 4 * 60_000).toISOString()} now={now} />
      <Repositories
        repositories={DEMO_REPOSITORIES(now)}
        services={DEMO_SERVICES}
        canManage={false}
        demo
        heldEventDays={null}
        now={now}
        chooseOnGitHubHref={null}
        onChanged={() => Promise.resolve()}
      />
      <DisconnectRow installation={DEMO_INSTALLATION} disabled />
    </>
  )
}
