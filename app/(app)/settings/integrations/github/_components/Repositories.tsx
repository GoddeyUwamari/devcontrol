'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  githubConnectionService,
  type ApiAnswer,
  type DeployRuleRequest,
  type GitHubRepository,
} from '@/lib/services/github-connection.service'
import {
  COPY,
  CREATE_SERVICE_HREF,
  HELD_EVENT_DAYS_FALLBACK,
  REPO_COPY,
  SEE_PLANS_HREF,
  relativeTime,
} from '@/lib/github-connection/copy'
import {
  matchingService,
  repositoryCount,
  ruleLabel,
  ruleOptions,
  rowStatus,
  seenLine,
  currentRuleKey,
  tableRows,
  type RowStatus,
  type ServiceOption,
} from '@/lib/github-connection/repositories'
import { BUTTON_OUTLINE, CARD, TEXT_LINK } from '@/components/integrations/parts'

/**
 * Board 5 (desktop table) and board 8 (phone cards) of the GitHub screen
 * (D8b-2): each repository's service, deploy rule and status, from the
 * server's rows only. Owners and admins change a service or rule with a
 * select that saves on change (R6: Saving… then Saved; on failure the
 * previous value comes back with an inline error). Members see the values as
 * text (R9). The demo sample shows every control disabled and sends nothing.
 */

const SELECT = 'min-h-10 w-full max-w-60 rounded-lg border border-border bg-card px-2.5 text-ui text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 disabled:bg-slate-50 disabled:text-ink-muted'
const CHIP_BUTTON = 'inline-flex min-h-8 items-center self-start rounded-full border border-violet-200 bg-violet-50 px-2.5 text-label text-ink-accent hover:bg-violet-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-ink-muted'

const NO_SERVICE = '__none__'
const PLACEHOLDER = ''

type Field = 'service' | 'rule'
interface SaveState {
  phase: 'saving' | 'saved' | 'error'
  message?: string
  /** The value shown while saving (and until the list is read again). */
  pending?: string
}

export interface RepositoriesProps {
  repositories: readonly GitHubRepository[]
  services: readonly ServiceOption[]
  servicesFailed?: boolean
  /** Read the workspace's services again ("Try again" next to "Couldn't load your services."). */
  onRetryServices?: () => void
  canManage: boolean
  /** The demo sample: everything shown, nothing enabled, nothing sent. */
  demo?: boolean
  heldEventDays: number | null
  now: number
  /** Where "Choose repositories on GitHub." goes (the installation's settings). */
  chooseOnGitHubHref: string | null
  /** Read the list again after a save (the server decides each row's status). */
  onChanged: () => Promise<unknown>
  /**
   * The workspace's services limit (GET /api/services/limit). At the limit,
   * "Create a service →" becomes the limit line (stage-a C8); mapping a
   * repository to an existing service is unchanged. Unknown (undefined) shows
   * the link: the server refuses on its own.
   */
  serviceLimit?: { reached: boolean; upgradeAvailable: boolean }
}

const STATUS_LABEL: Record<Exclude<RowStatus, 'removed'>, string> = {
  recording: REPO_COPY.statusRecording,
  waiting_for_service: REPO_COPY.statusWaiting,
  no_rule: REPO_COPY.statusNoRule,
}

export function Repositories(props: RepositoriesProps) {
  const { repositories, canManage, demo = false, heldEventDays, now } = props
  const [saves, setSaves] = useState<Record<string, SaveState>>({})
  const rows = tableRows(repositories)
  const editable = canManage && !demo
  const key = (id: string, field: Field) => `${id}:${field}`

  const save = async (repository: GitHubRepository, field: Field, shown: string, send: () => Promise<ApiAnswer>) => {
    const k = key(repository.id, field)
    setSaves((s) => ({ ...s, [k]: { phase: 'saving', pending: shown } }))
    const answer = await send()
    if (answer.status === 200) {
      await props.onChanged()
      setSaves((s) => ({ ...s, [k]: { phase: 'saved' } }))
    } else if (answer.status === 404) {
      setSaves((s) => ({ ...s, [k]: { phase: 'error', message: REPO_COPY.saveNotFound } }))
      await props.onChanged()
    } else if (answer.status === 504) {
      // The server may have saved it (a long replay behind the gateway): read the list, say so.
      setSaves((s) => ({ ...s, [k]: { phase: 'error', message: REPO_COPY.saveMaybe } }))
      await props.onChanged()
    } else {
      // The previous value comes back (no pending value), with the error.
      setSaves((s) => ({ ...s, [k]: { phase: 'error', message: REPO_COPY.saveFailed } }))
    }
  }

  const chooseService = (repository: GitHubRepository, value: string) => {
    if (!editable || value === PLACEHOLDER) return
    const serviceId = value === NO_SERVICE ? null : value
    if (serviceId === repository.service_id) return
    void save(repository, 'service', value, () => githubConnectionService.setService(repository.id, serviceId))
  }

  const chooseRule = (repository: GitHubRepository, value: string) => {
    if (!editable || value === PLACEHOLDER || value === currentRuleKey(repository.deploy_rule)) return
    const request: DeployRuleRequest | null = ruleOptions(repository).find((o) => o.key === value)?.request ?? null
    if (!request) return
    void save(repository, 'rule', value, () => githubConnectionService.setDeployRule(repository.id, request))
  }

  const cells = (repository: GitHubRepository, layout: 'table' | 'card') => {
    const serviceSave = saves[key(repository.id, 'service')]
    const ruleSave = saves[key(repository.id, 'rule')]
    const name = repository.full_name.slice(repository.full_name.lastIndexOf('/') + 1)
    const busy = serviceSave?.phase === 'saving' || ruleSave?.phase === 'saving'
    const match = matchingService(repository, props.services)
    const tall = layout === 'card' ? 'min-h-11 max-w-none' : 'min-w-44'
    // Fix round 3 (founder): in the table the rule select is as wide as its longest option (a native
    // select's own width), never cut off at 1280. The phone cards keep the full-width select.
    const ruleWidth = layout === 'card' ? tall : 'min-w-44 w-auto max-w-none'

    const serviceValue = serviceSave?.phase === 'saving' && serviceSave.pending !== undefined
      ? serviceSave.pending
      : repository.service_id ?? PLACEHOLDER
    const serviceOptions = [...props.services]
    if (repository.service_id && !serviceOptions.some((s) => s.id === repository.service_id)) {
      serviceOptions.unshift({ id: repository.service_id, name: repository.service_name ?? repository.service_id })
    }

    const service = editable || demo ? (
      <div className="flex flex-col gap-1.5">
        <select
          aria-label={`Service for ${name}`}
          data-testid={`github-service-${repository.id}`}
          className={cn(SELECT, tall, repository.service_id === null && 'text-ink-muted')}
          value={serviceValue}
          disabled={demo || busy || props.servicesFailed}
          onChange={(e) => chooseService(repository, e.target.value)}
        >
          {repository.service_id === null && <option value={PLACEHOLDER}>{REPO_COPY.chooseService}</option>}
          {serviceOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          {repository.service_id !== null && <option value={NO_SERVICE}>{REPO_COPY.noService}</option>}
        </select>
        {match && (
          <button
            type="button"
            data-testid={`github-use-service-${repository.id}`}
            className={CHIP_BUTTON}
            disabled={demo || busy}
            onClick={() => chooseService(repository, match.id)}
          >
            {REPO_COPY.chipUseService(match.name)}
          </button>
        )}
        <SaveLine state={serviceSave} testId={`github-service-save-${repository.id}`} />
      </div>
    ) : (
      <span data-testid={`github-service-text-${repository.id}`} className="text-ui text-ink-body">{repository.service_name ?? REPO_COPY.noService}</span>
    )

    const options = ruleOptions(repository)
    const current = currentRuleKey(repository.deploy_rule)
    const ruleValue = ruleSave?.phase === 'saving' && ruleSave.pending !== undefined ? ruleSave.pending : current ?? PLACEHOLDER
    const seen = seenLine(repository)
    let rule: React.ReactNode
    if (!editable && !demo) {
      rule = <span data-testid={`github-rule-text-${repository.id}`} className="text-ui text-ink-body">{ruleLabel(repository.deploy_rule, repository.jobs_seen) ?? REPO_COPY.noRule}</span>
    } else if (repository.service_id === null) {
      rule = <span data-testid={`github-rule-first-${repository.id}`} className="text-ui text-ink-muted">{REPO_COPY.chooseServiceFirst}</span>
    } else {
      rule = (
        <div className="flex flex-col gap-1.5">
          <select
            aria-label={`Deploy rule for ${name}`}
            data-testid={`github-rule-${repository.id}`}
            className={cn(SELECT, ruleWidth, current === null && 'text-ink-muted')}
            value={ruleValue}
            disabled={demo || busy || options.length === 0}
            onChange={(e) => chooseRule(repository, e.target.value)}
          >
            {current === null && <option value={PLACEHOLDER}>{options.length === 0 ? REPO_COPY.nothingSeen : REPO_COPY.chooseRule}</option>}
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          {current === null && seen && <span data-testid={`github-seen-${repository.id}`} className="text-meta text-ink-muted">{seen}</span>}
          <SaveLine state={ruleSave} testId={`github-rule-save-${repository.id}`} />
        </div>
      )
    }
    return { service, rule }
  }

  const statusLines = (repository: GitHubRepository) => {
    const status = rowStatus(repository) as Exclude<RowStatus, 'removed'>
    const lines: React.ReactNode[] = []
    if (status === 'recording') {
      lines.push(
        <span key="last" data-testid={`github-last-deployment-${repository.id}`} className="text-meta text-ink-muted">
          {repository.last_deployment_at ? REPO_COPY.lastDeployment(relativeTime(repository.last_deployment_at, now)) : REPO_COPY.noDeploymentYet}
        </span>,
      )
    } else if (repository.held_events > 0) {
      lines.push(<span key="held" data-testid={`github-held-${repository.id}`} className="text-meta text-ink-muted">{REPO_COPY.held(repository.held_events)}</span>)
    }
    if (repository.over_limit_this_month > 0) {
      lines.push(
        <span key="limit" data-testid={`github-over-limit-${repository.id}`} className="text-meta text-ink-warning-strong">
          {REPO_COPY.overLimit(repository.over_limit_this_month)} · {demo ? <span className="font-semibold">{REPO_COPY.seePlans}</span> : <Link href={SEE_PLANS_HREF} className="font-semibold text-ink-accent underline">{REPO_COPY.seePlans}</Link>}
        </span>,
      )
    }
    return { status, lines }
  }

  const statusTone = (status: Exclude<RowStatus, 'removed'>) => (status === 'recording' ? 'text-ink-success-strong' : 'text-ink-warning-strong')
  const count = repositoryCount(repositories)
  const days = heldEventDays ?? HELD_EVENT_DAYS_FALLBACK

  const createService = editable && props.serviceLimit?.reached
    ? (
      <span data-testid="github-service-limit" className="text-meta text-ink-muted">
        {REPO_COPY.serviceLimitReached} · {props.serviceLimit.upgradeAvailable
          ? <Link href={SEE_PLANS_HREF} className="font-semibold text-ink-accent underline">{REPO_COPY.seePlans}</Link>
          : <span className="font-semibold">{REPO_COPY.seePlans}</span>}
      </span>
    )
    : editable
    ? <Link href={CREATE_SERVICE_HREF} data-testid="github-create-service" className={TEXT_LINK}>{REPO_COPY.createService}</Link>
    : demo ? <span data-testid="github-create-service" aria-disabled="true" className={cn(TEXT_LINK, 'cursor-not-allowed text-ink-muted hover:text-ink-muted')}>{REPO_COPY.createService}</span> : null

  return (
    <section data-testid="github-repositories" aria-labelledby="github-repositories-title" className="flex flex-col gap-4 md:gap-0 md:rounded-xl md:border md:border-border md:bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 md:border-b md:border-slate-100 md:px-6 md:py-5">
        <div className="flex flex-col gap-1">
          <h2 id="github-repositories-title" className="m-0 text-section text-ink">{REPO_COPY.title(count)}</h2>
          <p className="m-0 hidden text-meta text-ink-muted md:block">{REPO_COPY.subtitle}</p>
        </div>
        {createService}
      </div>
      {props.servicesFailed && editable && (
        // Founder ruling (§7.1): approved, with a "Try again" button like N9.
        <div data-testid="github-services-failed" role="alert" className="flex flex-wrap items-center gap-3 md:px-6 md:pt-3">
          <p className="m-0 text-meta text-ink-danger">{REPO_COPY.servicesFailed}</p>
          {props.onRetryServices && (
            <button type="button" data-testid="github-services-retry" onClick={props.onRetryServices} className={BUTTON_OUTLINE}>{COPY.tryAgain}</button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p data-testid="github-repositories-none" className="m-0 text-ui text-ink-muted md:px-6 md:py-5">
          {REPO_COPY.none}{' '}
          {props.chooseOnGitHubHref && <a href={props.chooseOnGitHubHref} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink-accent underline">{REPO_COPY.chooseOnGitHub}</a>}
        </p>
      ) : (
        <>
          {/* Desktop: board 5's table. */}
          <div className="hidden overflow-x-auto md:block">
            <table data-testid="github-repo-table" className="w-full min-w-[860px] border-collapse text-ui">
              <thead>
                <tr className="text-left text-label uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="px-6 py-3 font-semibold">{REPO_COPY.colRepository}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{REPO_COPY.colService}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{REPO_COPY.colRule}</th>
                  <th scope="col" className="px-6 py-3 font-semibold">{REPO_COPY.colStatus}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((repository) => {
                  if (rowStatus(repository) === 'removed') {
                    return (
                      <tr key={repository.id} data-testid={`github-repo-row-${repository.id}`} className="border-t border-slate-100 bg-slate-50">
                        <td className="px-6 py-4 font-semibold text-ink-muted">{repository.full_name}</td>
                        <td colSpan={3} className="px-4 py-4 text-meta text-ink-muted" data-testid={`github-removed-${repository.id}`}>{COPY.removedRepo}</td>
                      </tr>
                    )
                  }
                  const { service, rule } = cells(repository, 'table')
                  const { status, lines } = statusLines(repository)
                  return (
                    <tr key={repository.id} data-testid={`github-repo-row-${repository.id}`} className="border-t border-slate-100 align-top">
                      <td className="px-6 py-4 font-semibold text-ink">{repository.full_name}</td>
                      <td className="px-4 py-4">{service}</td>
                      <td className="px-4 py-4">{rule}</td>
                      <td className="px-6 py-4">
                        <span className="flex flex-col gap-0.5">
                          <span data-testid={`github-status-${repository.id}`} className={cn('font-semibold', statusTone(status))}>{STATUS_LABEL[status]}</span>
                          {lines}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Phone: board 8's stacked cards. */}
          <ul data-testid="github-repo-cards" className="m-0 flex list-none flex-col gap-3 p-0 md:hidden">
            {rows.map((repository) => {
              if (rowStatus(repository) === 'removed') {
                return (
                  <li key={repository.id} className={cn(CARD, 'flex flex-col gap-1.5 bg-slate-50 p-4')}>
                    <span className="break-words text-ui font-semibold text-ink-muted">{repository.full_name}</span>
                    <span className="text-meta text-ink-muted">{COPY.removedRepo}</span>
                  </li>
                )
              }
              const { service, rule } = cells(repository, 'card')
              const { status, lines } = statusLines(repository)
              return (
                <li key={repository.id} className={cn(CARD, 'flex min-w-0 flex-col gap-2.5 p-4')}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 break-words text-ui font-semibold text-ink">{repository.full_name}</span>
                    <span className={cn('flex-none text-meta font-semibold', statusTone(status))}>{STATUS_LABEL[status]}</span>
                  </div>
                  {service}
                  {rule}
                  {lines}
                </li>
              )
            })}
          </ul>
        </>
      )}

      <div data-testid="github-repo-footer" className="flex flex-col gap-1.5 px-0.5 md:border-t md:border-slate-100 md:px-6 md:pb-5 md:pt-4">
        <p className="m-0 text-meta text-ink-body"><span className="font-semibold">{REPO_COPY.footerHeldLabel}</span>{REPO_COPY.footerHeld(days)}</p>
        <p className="m-0 text-meta text-ink-body"><span className="font-semibold">{REPO_COPY.footerRuleLabel}</span>{REPO_COPY.footerRule}</p>
        <p className="m-0 text-meta text-ink-body"><span className="font-semibold">{REPO_COPY.footerLimitLabel}</span>{REPO_COPY.footerLimit}</p>
      </div>
    </section>
  )
}

function SaveLine({ state, testId }: { state: SaveState | undefined; testId: string }) {
  if (!state) return null
  if (state.phase === 'error') return <span data-testid={testId} role="alert" className="text-meta text-ink-danger">{state.message}</span>
  return (
    <span data-testid={testId} aria-live="polite" className="text-meta text-ink-muted">
      {state.phase === 'saving' ? REPO_COPY.saving : REPO_COPY.saved}
    </span>
  )
}
