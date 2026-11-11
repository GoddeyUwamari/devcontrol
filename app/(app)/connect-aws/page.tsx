'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import awsAccountsService, { type AwsAccount, type ConnectAwsResult, type ConnectInitData } from '@/lib/services/aws-accounts.service'
import { useAuth } from '@/lib/contexts/auth-context'
import { PageHeader } from '@/components/ui/typography'
import {
  ACCOUNTS_ERROR,
  AMBIGUOUS_TEXT,
  CONNECTED_TOAST,
  MANUAL_SETUP_ID,
  PAGE_SUBTITLE,
  PAGE_TITLE,
  SECURITY_ID,
  SIDE_MANUAL_LINK,
  SIDE_NEED_HELP,
  SIDE_READS,
  SIDE_READS_TITLE,
  SIDE_SECURITY,
  SIDE_SECURITY_LINK,
  SIDE_SECURITY_TITLE,
  SUPPORT_MAILTO,
} from './connectAwsCopy'
import { ConnectSetup } from './ConnectSetup'
import { ConnectedView, type JustConnected } from './ConnectedView'
import { DisconnectSentence } from './connectAwsParts'
import { SecurityExplanation } from './SecurityExplanation'

type PageView = 'loading' | 'connected' | 'ambiguous' | 'setup'

/** The organization's active connection row, which the connected view describes. */
function activeAccount(accounts: AwsAccount[] | undefined): AwsAccount | null {
  return accounts?.find((account) => account.status === 'active') ?? null
}

/**
 * Connect AWS. The page reads the server's connection state first (GET /api/aws/accounts):
 * a connected organization sees its connection, never the setup form; only an organization
 * that isn't connected loads connect-init and the setup.
 */
export default function ConnectAwsPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { organization } = useAuth()
  const orgId = organization?.id ?? null

  const accountsQuery = useQuery({
    queryKey: ['aws-accounts'],
    queryFn: awsAccountsService.getAccountsAndConnection,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const [justConnected, setJustConnected] = useState<JustConnected | null>(null)
  const [initData, setInitData] = useState<ConnectInitData | null>(null)
  const [initError, setInitError] = useState<string | null>(null)
  const initStarted = useRef(false)

  const connection = accountsQuery.data?.connection
  const view: PageView = justConnected ? 'connected'
    : accountsQuery.isPending ? 'loading'
    : connection === 'connected' ? 'connected'
    : connection === 'ambiguous' ? 'ambiguous'
    // not_connected, or the state couldn't be read: the server refuses a second connection anyway.
    : 'setup'

  // The External ID and trust policy, only for an organization that isn't connected.
  useEffect(() => {
    if (view !== 'setup' || initStarted.current) return
    initStarted.current = true
    awsAccountsService.connectInit()
      .then(setInitData)
      .catch((err: unknown) => {
        const response = (err as { response?: { status?: number; data?: { message?: string } } })?.response
        // Only an owner may connect AWS: show the server's reason, not a refresh prompt.
        if (response?.status === 403) {
          const reason = (response.data?.message ?? 'Only an organization owner can connect an AWS account').replace(/\.$/, '')
          setInitError(`${reason}. Ask your owner to connect your account.`)
          return
        }
        setInitError('Could not load your trust policy. Please refresh the page.')
        toast.error('Could not start the connect flow. Please refresh and try again.')
      })
  }, [view])

  const handleConnected = (result: ConnectAwsResult) => {
    setJustConnected({ account: result.account, permissionCheck: result.permissionCheck, receivedAt: new Date().toISOString() })
    queryClient.invalidateQueries({ queryKey: ['aws-accounts'] })
    // The dashboard's platform-dashboard-stats query caches for 4 hours with
    // refetchOnMount disabled (see app/(app)/dashboard/page.tsx) — without this,
    // an owner going to the dashboard right after connecting would see the
    // pre-connection (empty) stats for up to 4 hours.
    queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] })
    queryClient.invalidateQueries({ queryKey: ['services-coverage'] })
    toast.success(CONNECTED_TOAST)
  }

  const account = justConnected?.account ?? activeAccount(accountsQuery.data?.accounts)

  return (
    <div className="min-h-screen bg-gray-50 font-sans px-4 pt-page-top pb-6 sm:px-6 sm:pb-8 lg:px-14 lg:pb-10 overflow-x-hidden">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8 lg:gap-12 items-start">

          {/* LEFT */}
          <div>
            <PageHeader className="mb-8" title={PAGE_TITLE} subtitle={PAGE_SUBTITLE} />

            {view === 'connected' && (
              <ConnectedView
                account={account}
                justConnected={justConnected}
                orgId={orgId}
                onGoToDashboard={() => router.push('/dashboard')}
              />
            )}

            {view === 'ambiguous' && (
              <div role="alert" data-testid="connection-ambiguous" className="bg-white rounded-2xl border border-amber-200 p-6 text-body text-ink">
                {AMBIGUOUS_TEXT}<DisconnectSentence />
              </div>
            )}

            {view === 'setup' && (
              <>
                {accountsQuery.isError && (
                  <p className="text-meta text-ink-muted mb-4" data-testid="aws-connection-line">{ACCOUNTS_ERROR}</p>
                )}
                <ConnectSetup
                  initData={initData}
                  initError={initError}
                  onConnected={handleConnected}
                  onAlreadyConnected={() => queryClient.invalidateQueries({ queryKey: ['aws-accounts'] })}
                />
              </>
            )}
          </div>

          {/* RIGHT */}
          <div className="lg:sticky lg:top-8">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-7">
              <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-3.5">{SIDE_READS_TITLE}</p>
              <ul className="space-y-2.5 mb-1">
                {SIDE_READS.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-ui text-ink-body">
                    <span className="text-ink-success font-semibold shrink-0">✓</span>{item}
                  </li>
                ))}
              </ul>

              <p className="text-label text-ink-muted uppercase tracking-[0.04em] mt-6 mb-3.5">{SIDE_SECURITY_TITLE}</p>
              <ul className="space-y-2.5">
                {SIDE_SECURITY.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-ui text-ink-body">
                    <span className="shrink-0">🛡️</span>{item}
                  </li>
                ))}
              </ul>

              <p className="text-label uppercase tracking-[0.04em] mt-6 mb-3.5">
                <a href={SUPPORT_MAILTO} className="text-ink-accent hover:text-violet-800 transition-colors">{SIDE_NEED_HELP}</a>
              </p>
              <ul className="space-y-2">
                {view === 'setup' && (
                  <li><a href={`#${MANUAL_SETUP_ID}`} className="text-ui text-ink-accent font-medium hover:text-violet-800 transition-colors">{SIDE_MANUAL_LINK}</a></li>
                )}
                <li><a href={`#${SECURITY_ID}`} className="text-ui text-ink-accent font-medium hover:text-violet-800 transition-colors">{SIDE_SECURITY_LINK}</a></li>
              </ul>
            </div>
          </div>

        </div>

        <div className="mt-8">
          <SecurityExplanation />
        </div>
      </div>
    </div>
  )
}
