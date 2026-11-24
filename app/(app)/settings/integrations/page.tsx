'use client'

import { useQuery } from '@tanstack/react-query'
import { Cloud, GitBranch } from 'lucide-react'
import awsAccountsService from '@/lib/services/aws-accounts.service'
import { useGitHubConnection } from '@/lib/hooks/use-github-connection'
import { cardState, connectedLine } from '@/lib/github-connection/model'
import { COPY, CONNECT_AWS_HREF, GITHUB_PAGE_HREF } from '@/lib/github-connection/copy'
import { ArrowLink, CARD, Chip, type ChipTone, PageHeader } from '@/components/integrations/parts'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * /settings/integrations (D8b-1, board 1): the accounts DevControl reads from,
 * AWS and GitHub, each with its own state. Every card waits for its own
 * answer: grey blocks until then, never "Not connected" before the server says so.
 */
export default function IntegrationsPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-4 pb-12 pt-6">
      <PageHeader title={COPY.indexTitle} subtitle={COPY.indexSubtitle} />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))]">
        <AwsCard />
        <GitHubCard />
      </div>
    </div>
  )
}

function IntegrationCard({
  icon, iconBox, name, chip, description, line, link, testId,
}: {
  icon: React.ReactNode
  iconBox: string
  name: string
  chip: { tone: ChipTone; text: string } | null
  description: string
  line: string | null
  link: { href: string; text: string } | null
  testId: string
}) {
  return (
    <section data-testid={testId} aria-label={name} className={cn(CARD, 'flex flex-col gap-3.5 p-6')}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={cn('flex h-10 w-10 flex-none items-center justify-center rounded-[10px]', iconBox)} aria-hidden="true">{icon}</span>
          <h2 className="m-0 text-section text-ink">{name}</h2>
        </div>
        {chip ? <Chip tone={chip.tone} testId={`${testId}-chip`}>{chip.text}</Chip> : <Skeleton data-testid={`${testId}-chip-loading`} className="h-6 w-24 rounded-full" />}
      </div>
      <p className="m-0 text-ui text-ink-muted">{description}</p>
      {line && <p data-testid={`${testId}-line`} className="m-0 text-meta text-ink-muted">{line}</p>}
      {link && <ArrowLink href={link.href} testId={`${testId}-link`}>{link.text}</ArrowLink>}
    </section>
  )
}

function AwsCard() {
  const accounts = useQuery({
    queryKey: ['aws-accounts'],
    queryFn: awsAccountsService.getAccountsAndConnection,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const base = {
    icon: <Cloud size={22} strokeWidth={1.75} className="text-orange-700" />,
    iconBox: 'bg-orange-50',
    name: COPY.awsName,
    description: COPY.awsDescription,
    testId: 'integration-aws',
  }
  if (accounts.isPending) return <IntegrationCard {...base} chip={null} line={null} link={null} />
  if (accounts.isError) return <IntegrationCard {...base} chip={null} line={COPY.cardLoadFailed} link={{ href: CONNECT_AWS_HREF, text: COPY.awsManage }} />
  const { connection, accounts: rows } = accounts.data
  if (connection === 'connected') {
    const active = rows.filter((a) => a.status === 'active')
    const region = active[0]?.region
    const line = `${active.length} ${active.length === 1 ? 'account' : 'accounts'}${region ? ` · home region ${region}` : ''}`
    return <IntegrationCard {...base} chip={{ tone: 'success', text: COPY.chipConnected }} line={line} link={{ href: CONNECT_AWS_HREF, text: COPY.awsManage }} />
  }
  if (connection === 'ambiguous') {
    return <IntegrationCard {...base} chip={{ tone: 'warning', text: COPY.chipNeedsAttention }} line={null} link={{ href: CONNECT_AWS_HREF, text: COPY.awsManage }} />
  }
  return <IntegrationCard {...base} chip={{ tone: 'neutral', text: COPY.chipNotConnected }} line={null} link={{ href: CONNECT_AWS_HREF, text: COPY.awsConnect }} />
}

function GitHubCard() {
  const { connection, repositories } = useGitHubConnection()
  const base = {
    icon: <GitBranch size={22} strokeWidth={1.75} className="text-ink" />,
    iconBox: 'bg-slate-100',
    name: COPY.githubName,
    description: COPY.githubDescription,
    testId: 'integration-github',
  }
  if (connection.isPending) return <IntegrationCard {...base} chip={null} line={null} link={null} />
  if (connection.isError) return <IntegrationCard {...base} chip={null} line={COPY.cardLoadFailed} link={{ href: GITHUB_PAGE_HREF, text: COPY.githubLearnMore }} />
  const data = connection.data
  const state = cardState(data)
  if (state === 'off') {
    return <IntegrationCard {...base} chip={{ tone: 'neutral', text: COPY.chipNotAvailable }} line={COPY.githubByHand} link={{ href: GITHUB_PAGE_HREF, text: COPY.githubLearnMore }} />
  }
  if (state === 'not_connected') {
    return <IntegrationCard {...base} chip={{ tone: 'neutral', text: COPY.chipNotConnected }} line={COPY.githubByHand} link={{ href: GITHUB_PAGE_HREF, text: COPY.githubSetUp }} />
  }
  if (state === 'demo') {
    return <IntegrationCard {...base} chip={{ tone: 'accent', text: COPY.chipDemo }} line={COPY.demoBody} link={{ href: GITHUB_PAGE_HREF, text: COPY.githubManage }} />
  }
  if (!data.configured) return null
  const line = connectedLine(data, repositories.isSuccess ? repositories.data : null)
  return (
    <IntegrationCard
      {...base}
      chip={state === 'attention' ? { tone: 'warning', text: COPY.chipNeedsAttention } : { tone: 'success', text: COPY.chipConnected }}
      line={line}
      link={{ href: GITHUB_PAGE_HREF, text: COPY.githubManage }}
    />
  )
}
