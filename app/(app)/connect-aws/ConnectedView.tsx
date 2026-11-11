'use client'

import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import awsAccountsService, { type AwsAccount, type ConnectionChecks, type PermissionCheckReport } from '@/lib/services/aws-accounts.service'
import awsServicesService, { type ServicesCoverage } from '@/lib/services/aws-services.service'
import { HOME_REGION_ONLY_NOTE, describeCoverage, formatScanTime } from '../services/coverage'
import { useNowEachLocalDay } from '../services/useNowEachLocalDay'
import {
  ATTENTION_BODY,
  ATTENTION_TITLE,
  CONNECTED_TITLE,
  CONTINUE_TO_DASHBOARD,
  COPY_INLINE_POLICY,
  COVERAGE_ERROR,
  COVERAGE_LOADING,
  FACT_CONNECTION,
  FACT_DISCOVERY,
  FACT_HEALTH,
  FACT_PERMISSIONS,
  FOUND_TITLE,
  GO_TO_DASHBOARD,
  INLINE_JSON_SUMMARY,
  INLINE_POLICY_ACTIONS,
  LABEL_ACCOUNT,
  LABEL_HOME_REGION,
  LABEL_ROLE,
  PERMISSIONS_NOTE,
  PERMISSIONS_NOT_SAVED,
  PERMISSIONS_NOT_SAVED_OWNER,
  PERMISSION_CHECK_LABELS,
  ROLE_REPLACED,
  ROW_CLOUDFRONT,
  ROW_S3_OTHER_REGIONS,
  ROW_TOTAL,
  SCP_NOTE,
  STATUS_DENIED,
  STATUS_NOT_CHECKED,
  TABLE_LAST_SCAN,
  TABLE_RESOURCES,
  TABLE_SCOPE,
  TRY_AGAIN,
  connectionValue,
  passedLine,
  permissionFixText,
  permissionsValue,
  rowHome,
} from './connectAwsCopy'
import { CopyButton, DisconnectSentence, INLINE_POLICY_JSON, PolicyJson } from './connectAwsParts'
import { CONNECTION_CHECKS_KEY, CheckAgain, RefusedSources, RolePolicies, healthView } from './ConnectionChecksParts'

/** How often coverage is re-read while a scan runs: the same interval the Services, Security and Infrastructure pages use. */
export const SCAN_RUNNING_REFETCH_MS = 60_000

/**
 * Re-read coverage while a scan is running, and right after a connect until the first scan has a
 * job row: discovery starts in the background after the connect returns (backend aws.routes.ts), so
 * the first read can come before its job exists.
 */
export function coverageRefetchInterval(coverage: ServicesCoverage | undefined, justConnected: boolean): number | false {
  if (coverage?.scan_in_progress) return SCAN_RUNNING_REFETCH_MS
  if (justConnected && !coverage?.last_scan) return SCAN_RUNNING_REFETCH_MS
  return false
}

export interface JustConnected {
  account: AwsAccount
  /**
   * The connect response's permission check; null from a server without it. Shown until the saved
   * checks (GET /accounts/checks, PR D1) have one, and on a server from before D1.
   */
  permissionCheck: PermissionCheckReport | null
  /** When the connect response arrived. */
  receivedAt: string
}

interface Props {
  account: AwsAccount | null
  justConnected: JustConnected | null
  orgId: string | null
  onGoToDashboard: () => void
}

function Fact({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3" data-testid={testId}>
      <p className="text-label text-ink-muted uppercase tracking-[0.04em]">{label}</p>
      <div className="mt-1 text-ui text-ink font-medium">{children}</div>
    </div>
  )
}

/**
 * Boards 4 and 5: the connected account, its facts (with Health, PR D1), what discovery found and
 * what a scan was refused, the saved permission check and the role's policies (after a reload too),
 * and, for the owner, Check again.
 */
export function ConnectedView({ account, justConnected, orgId, onGoToDashboard }: Props) {
  const coverageQuery = useQuery<ServicesCoverage>({
    queryKey: ['services-coverage', orgId],
    queryFn: () => awsServicesService.getCoverage(),
    enabled: !!orgId,
    refetchInterval: (query: { state: { data?: ServicesCoverage } }) => coverageRefetchInterval(query.state.data, justConnected !== null),
    refetchIntervalInBackground: false,
  })
  // Read at mount and after each local midnight, as on the Services page (no Date.now() during render).
  const now = useNowEachLocalDay(true)
  const coverage = coverageQuery.data
  const view = coverage ? describeCoverage(coverage, now) : null
  const home = coverage?.account.connected ? coverage.scope.home_region : null

  // The saved checks (PR D1). null: a server from before D1, or not loaded or failed (then nothing new
  // shows, never an error). NO_CONNECTION_CHECKS for a 409 NOT_CONNECTED.
  const checksQuery = useQuery<ConnectionChecks | null>({
    queryKey: [CONNECTION_CHECKS_KEY, orgId],
    queryFn: () => awsAccountsService.getConnectionChecks(),
    enabled: !!orgId,
    refetchOnWindowFocus: false,
  })
  const saved = checksQuery.data ?? null
  // GET /checks sends `checkAgain` to the owner only.
  const isOwner = saved?.checkAgain !== undefined
  const health = saved ? healthView(saved.health, now) : null

  // The saved permission check after a reload; the connect response's until the saved one exists.
  const permission = saved?.permissionCheck
    ? { checks: saved.permissionCheck.checks, at: saved.permissionCheck.checkedAt }
    : justConnected?.permissionCheck
      ? { checks: justConnected.permissionCheck.checks, at: justConnected.receivedAt }
      : null
  const checks = permission?.checks ?? null
  const attention = (checks ?? []).filter((check) => check.status !== 'verified')
  const passed = (checks ?? []).filter((check) => check.status === 'verified')
  const showInlinePolicy = attention.some((check) => INLINE_POLICY_ACTIONS.includes(check.action))

  const discovery = coverageQuery.isError ? (
    <span role="alert" className="flex flex-wrap items-center gap-2">
      {COVERAGE_ERROR}
      <button
        type="button"
        onClick={() => coverageQuery.refetch()}
        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-label text-ink hover:border-slate-300"
      >
        {TRY_AGAIN}
      </button>
    </span>
  ) : view ? (view.lastScan ?? '—') : <span role="status">{COVERAGE_LOADING}</span>

  const s3OtherRegions = home && coverage
    ? coverage.scope.s3.regions.filter((r) => r.region !== home.region).reduce((n, r) => n + r.count, 0)
    : 0
  const homeChip = view?.chips.find((chip) => chip.key === 'home')

  return (
    <div className="space-y-4" data-testid="connected-view">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-9">
        <h2 className="text-section text-ink mb-3">{CONNECTED_TITLE}</h2>
        {account && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-ui mb-5">
            <dt className="text-ink-muted">{LABEL_ACCOUNT}</dt>
            <dd className="text-ink" data-testid="connected-account-id">{account.account_id}</dd>
            <dt className="text-ink-muted">{LABEL_ROLE}</dt>
            <dd className="text-ink font-mono break-all">{account.role_arn}</dd>
            <dt className="text-ink-muted">{LABEL_HOME_REGION}</dt>
            <dd className="text-ink">{account.region}</dd>
          </dl>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {account && (
            <Fact label={FACT_CONNECTION} testId="fact-connection">
              {connectionValue(formatScanTime(account.connected_at, now))}
            </Fact>
          )}
          {permission && checks ? (
            <Fact label={FACT_PERMISSIONS} testId="fact-permissions">
              {permissionsValue(passed.length, checks.length, formatScanTime(permission.at, now))}
              {attention.length === 0 && <p className="mt-1 text-meta text-ink-muted font-normal">{PERMISSIONS_NOTE}</p>}
            </Fact>
          ) : saved && (
            <Fact label={FACT_PERMISSIONS} testId="fact-permissions">
              <span className="font-normal">{isOwner ? PERMISSIONS_NOT_SAVED_OWNER : PERMISSIONS_NOT_SAVED}</span>
            </Fact>
          )}
          <Fact label={FACT_DISCOVERY} testId="fact-discovery">{discovery}</Fact>
          {health && (
            <Fact label={FACT_HEALTH} testId="fact-health">
              <span className={health.warning ? 'text-ink-warning' : undefined} data-testid="health-value">{health.value}</span>
              {health.help && <p className="mt-1 text-meta text-ink-muted font-normal" data-testid="health-help">{health.help}</p>}
            </Fact>
          )}
        </div>

        {saved?.roleReplacedAt && (
          <div role="status" data-testid="role-replaced" className="mt-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-ui text-ink">
            {ROLE_REPLACED}
          </div>
        )}

        {attention.length > 0 && (
          <div role="status" data-testid="permission-warnings" className="mt-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
            <p className="text-body text-ink font-medium mb-1">{ATTENTION_TITLE}</p>
            <p className="text-meta text-ink-muted mb-3">{ATTENTION_BODY}</p>
            <ul className="space-y-2.5 mb-3">
              {attention.map((check) => (
                <li key={check.action} className="text-ui text-ink-body">
                  <span className="font-medium text-ink">{PERMISSION_CHECK_LABELS[check.action] ?? check.action}</span>{' '}
                  <code className="font-mono text-meta text-ink-accent">{check.action}</code>
                  {' — '}
                  {check.status === 'denied' ? STATUS_DENIED : STATUS_NOT_CHECKED}
                  <span data-testid="permission-fix" className="block text-meta text-ink-muted mt-0.5">
                    {permissionFixText(check.action, check.status === 'denied' ? 'denied' : 'not_verified')}
                  </span>
                </li>
              ))}
            </ul>
            {showInlinePolicy && (
              <details className="mb-3 rounded-xl border border-amber-200 bg-white">
                <summary className="cursor-pointer px-4 py-3 text-ui font-medium text-ink">{INLINE_JSON_SUMMARY}</summary>
                <div className="px-4 pb-4">
                  <PolicyJson json={INLINE_POLICY_JSON} />
                  <p className="text-meta text-ink-muted mb-3">
                    Replace <code className="font-mono text-meta text-ink-accent">&lt;ACCOUNT_ID&gt;</code> with your 12-digit AWS account ID.
                  </p>
                  <CopyButton text={INLINE_POLICY_JSON} label={COPY_INLINE_POLICY} />
                </div>
              </details>
            )}
            {passed.length > 0 && (
              <p className="text-meta text-ink-body mb-2" data-testid="permission-passed">
                {passedLine(passed.map((check) => PERMISSION_CHECK_LABELS[check.action] ?? check.action))}
              </p>
            )}
            <p className="text-meta text-ink-muted mb-3">{SCP_NOTE}</p>
            <button
              type="button"
              onClick={onGoToDashboard}
              className="border border-slate-200 rounded-lg px-3.5 py-1.5 text-ui font-medium text-ink hover:border-slate-300 cursor-pointer transition-colors bg-white"
            >
              {CONTINUE_TO_DASHBOARD}
            </button>
          </div>
        )}

        {saved && <RolePolicies policy={saved.policyCheck} isOwner={isOwner} now={now} />}
        {saved?.checkAgain && <CheckAgain serverAvailableAt={saved.checkAgain.availableAt} externalId={account?.external_id} />}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-9">
        <h2 className="text-section text-ink mb-2">{FOUND_TITLE}</h2>
        {view?.headline && <p className="text-body text-ink-body mb-3" data-testid="coverage-headline">{view.headline}</p>}
        {home && coverage && (
          <table className="w-full text-ui mb-4" data-testid="coverage-table">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <th className="py-1.5 pr-3 text-label text-ink-muted font-medium">{TABLE_SCOPE}</th>
                <th className="py-1.5 pr-3 text-label text-ink-muted font-medium">{TABLE_RESOURCES}</th>
                <th className="py-1.5 text-label text-ink-muted font-medium">{TABLE_LAST_SCAN}</th>
              </tr>
            </thead>
            <tbody className="text-ink-body">
              <tr className="border-b border-slate-100"><td className="py-2 pr-3">{ROW_TOTAL}</td><td className="py-2 pr-3 tabular-nums">{coverage.total}</td><td className="py-2">—</td></tr>
              <tr className="border-b border-slate-100"><td className="py-2 pr-3">{rowHome(home.region)}</td><td className="py-2 pr-3 tabular-nums">{home.count}</td><td className="py-2">{homeChip?.note ?? '—'}</td></tr>
              <tr className="border-b border-slate-100"><td className="py-2 pr-3">{ROW_S3_OTHER_REGIONS}</td><td className="py-2 pr-3 tabular-nums">{s3OtherRegions}</td><td className="py-2">—</td></tr>
              <tr><td className="py-2 pr-3">{ROW_CLOUDFRONT}</td><td className="py-2 pr-3 tabular-nums">{coverage.scope.cloudfront.count}</td><td className="py-2">—</td></tr>
            </tbody>
          </table>
        )}
        <RefusedSources refused={saved?.refusedSources ?? null} now={now} />
        {home && (
          <div role="note" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-ui text-blue-950 mb-4">
            <strong>{HOME_REGION_ONLY_NOTE.title} </strong>{HOME_REGION_ONLY_NOTE.body}
          </div>
        )}
        {attention.length === 0 && (
          <button
            type="button"
            onClick={onGoToDashboard}
            className="rounded-xl bg-violet-600 hover:bg-violet-700 px-4 py-2.5 text-ui font-semibold text-white cursor-pointer transition-colors mb-4"
          >
            {GO_TO_DASHBOARD}
          </button>
        )}
        <p className="text-meta text-ink-muted"><DisconnectSentence /></p>
      </div>
    </div>
  )
}
