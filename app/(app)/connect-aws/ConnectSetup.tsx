'use client'

import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { trackLeadQualified } from '@/lib/gtag'
import awsAccountsService, { type ConnectAwsResult, type ConnectInitData } from '@/lib/services/aws-accounts.service'
import {
  ATTACH_INTRO,
  BLOCKS_EXAMPLES,
  BLOCKS_INTRO,
  BLOCKS_SUMMARY,
  CF_FAILED_BODY,
  CF_FAILED_TITLE,
  CF_INTRO,
  CF_LAUNCH,
  CF_RECOMMENDED,
  CF_STEP1_BODY,
  CF_STEP1_TITLE,
  CF_STEP2_BODY,
  CF_STEP2_TITLE,
  CF_TITLE,
  CHECKING_ASSUME,
  CHECKING_ASSUME_NOTE,
  CHECKING_BUTTON,
  CHECKING_NOTHING_SAVED,
  CHECKING_PERMISSIONS,
  CHECKING_SCAN,
  CHECKING_TITLE,
  CONNECT_BUTTON,
  CONNECT_NOT_READY,
  COPY,
  COPY_INLINE_POLICY,
  COPY_POLICY,
  EXTERNAL_ID_HINT,
  EXTERNAL_ID_LABEL,
  INLINE_JSON_SUMMARY,
  MANUAL_SETUP_ID,
  MANUAL_SUMMARY,
  NOTHING_SENT,
  NOT_ASSUMABLE_FOOT,
  NOT_ASSUMABLE_TITLE,
  POLICIES_NOTE,
  READ_ONLY_ACCESS_NOTE,
  ROLE_ARN_FORMAT,
  ROLE_ARN_REQUIRED,
  STEP_ATTACH,
  STEP_CREATE_ROLE,
  STEP_CREATE_ROLE_BODY,
  STEP_ROLE_ARN,
  TRY_AGAIN,
  blocksFullList,
  notAssumableCauses,
} from './connectAwsCopy'
import { connectErrorView, type ConnectErrorView } from './connectAwsErrors'
import { CopyButton, DisconnectSentence, INLINE_POLICY_DENY_COUNT, INLINE_POLICY_JSON, PolicyJson } from './connectAwsParts'

/** Same rule the server applies to a new connection: a role with no IAM path whose name starts with DevControlRole. */
const DEVCONTROL_ROLE_ARN = /^arn:aws:iam::\d{12}:role\/DevControlRole[\w+=,.@-]*$/

function extractAccountId(arn: string): string {
  const match = arn.match(/arn:aws:iam::(\d{12}):role\//)
  return match ? match[1] : ''
}

function StepDot({ n }: { n: number }) {
  return <div className="shrink-0 w-8 h-8 rounded-full bg-violet-600 text-white flex items-center justify-center text-label mt-0.5">{n}</div>
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <StepDot n={n} />
      <div className="flex-1 min-w-0">
        <h2 className="text-section text-ink mb-2">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function ExternalIdField({ externalId }: { externalId: string }) {
  return (
    <div className="mb-4" data-testid="external-id-field">
      <p className="text-label text-ink-muted mb-1.5">{EXTERNAL_ID_LABEL}</p>
      <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 bg-slate-50">
        <code data-testid="external-id" className="flex-1 min-w-0 break-all font-mono text-ui text-ink">{externalId}</code>
        <CopyButton text={externalId} label={COPY} />
      </div>
      <p className="mt-1.5 text-meta text-ink-muted">{EXTERNAL_ID_HINT}</p>
    </div>
  )
}

interface Props {
  initData: ConnectInitData | null
  initError: string | null
  onConnected: (result: ConnectAwsResult) => void
  onAlreadyConnected: () => void
}

/**
 * Not connected: the CloudFormation card (only when connect-init returns launchStack, which no
 * server sends before PR D2), the manual setup, the Role ARN form, the checking state and the
 * connect errors by code.
 */
export function ConnectSetup({ initData, initError, onConnected, onAlreadyConnected }: Props) {
  const [roleArn, setRoleArn] = useState('')
  const [nickname, setNickname] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [submittedArn, setSubmittedArn] = useState('')
  const [error, setError] = useState<ConnectErrorView | null>(null)
  const [roleArnFocused, setRoleArnFocused] = useState(false)
  const [nicknameFocused, setNicknameFocused] = useState(false)

  const cloudFormation = initData?.launchStack ?? null
  const arnValid = DEVCONTROL_ROLE_ARN.test(roleArn.trim())
  const extractedId = extractAccountId(roleArn.trim())
  const trustPolicyStr = initData ? JSON.stringify(initData.trustPolicy, null, 2) : null

  const handleConnect = async () => {
    trackLeadQualified('aws_connect')
    if (connecting) return
    if (!initData) { toast.error(CONNECT_NOT_READY); return }
    if (!roleArn.trim()) { setError({ kind: 'arn', message: ROLE_ARN_REQUIRED }); return }
    if (!arnValid) { setError({ kind: 'arn', message: ROLE_ARN_FORMAT }); return }

    const arn = roleArn.trim()
    setSubmittedArn(arn)
    setError(null)
    setConnecting(true)
    try {
      const result = await awsAccountsService.connect({ roleArn: arn, nickname: nickname.trim() || undefined })
      onConnected(result)
    } catch (err: unknown) {
      const view = connectErrorView(err)
      setError(view)
      if (view.kind === 'already_connected') onAlreadyConnected()
    } finally {
      setConnecting(false)
    }
  }

  const arnForm = (
    <>
      <p className="text-body text-ink-body mb-5">
        After creating the role, paste the Role ARN below. Its name must start with DevControlRole, so it looks like:{' '}
        <code className="font-mono text-meta text-ink-accent">arn:aws:iam::123456789012:role/DevControlRole</code>
      </p>
      <div className="mb-4">
        <input
          type="text"
          value={roleArn}
          disabled={connecting}
          onChange={(e) => { setRoleArn(e.target.value); setError(null) }}
          onFocus={() => setRoleArnFocused(true)}
          onBlur={() => setRoleArnFocused(false)}
          placeholder="arn:aws:iam::YOUR_ACCOUNT_ID:role/DevControlRole"
          aria-invalid={error?.kind === 'arn'}
          className={`w-full px-4 py-3 border rounded-xl text-ui text-ink bg-white transition-all outline-none ${error?.kind === 'arn' ? 'border-red-700 ring-2 ring-red-700/15' : roleArnFocused ? 'border-violet-500 ring-2 ring-violet-500/15' : 'border-slate-200'}`}
        />
        {roleArn.trim() && (
          <p className={`mt-1.5 text-meta ${arnValid ? 'text-ink-success' : 'text-ink-warning'}`}>
            {arnValid ? `✓ Valid ARN format · Account ID: ${extractedId}` : 'Expected format: arn:aws:iam::123456789012:role/DevControlRole… (role name must start with DevControlRole, no IAM path)'}
          </p>
        )}
        {error?.kind === 'arn' && (
          <div role="alert" data-testid="arn-error" className="mt-1.5">
            <p className="text-meta text-ink-danger">{error.message}</p>
            <p className="text-meta text-ink-muted">{NOTHING_SENT}</p>
          </div>
        )}
      </div>
      <div className="mb-6">
        <label className="block text-label text-ink-muted mb-1.5">Account nickname (optional)</label>
        <input
          type="text"
          value={nickname}
          disabled={connecting}
          onChange={(e) => setNickname(e.target.value)}
          onFocus={() => setNicknameFocused(true)}
          onBlur={() => setNicknameFocused(false)}
          placeholder="e.g. Production, Staging"
          className={`w-full px-4 py-3 border rounded-xl text-ui text-ink bg-white transition-all outline-none ${nicknameFocused ? 'border-violet-500 ring-2 ring-violet-500/15' : 'border-slate-200'}`}
        />
      </div>
      <button
        type="button"
        onClick={handleConnect}
        disabled={connecting || !initData}
        className={`w-full py-3.5 rounded-xl text-ui font-semibold text-white transition-colors shadow-lg shadow-violet-500/25 mb-4 ${connecting || !initData ? 'bg-violet-400 cursor-default' : 'bg-violet-600 hover:bg-violet-700 cursor-pointer'}`}
      >
        {connecting ? CHECKING_BUTTON : CONNECT_BUTTON}
      </button>
      {connecting && <CheckingPanel arn={submittedArn} />}
      {error && error.kind !== 'arn' && initData && (
        <ErrorPanel
          error={error}
          onRetry={handleConnect}
          causes={notAssumableCauses({
            cloudFormation: cloudFormation !== null,
            accountId: extractAccountId(submittedArn),
            platformAccountId: initData.platformAccountId,
            externalId: initData.externalId,
          })}
        />
      )}
    </>
  )

  const createRoleStep = (
    <Step n={1} title={STEP_CREATE_ROLE}>
      <p className="text-body text-ink-body mb-4">{STEP_CREATE_ROLE_BODY}</p>
      <p className="text-body text-ink-body mb-4">
        The role name <strong className="text-ink">must start with <code className="font-mono text-meta text-ink-accent">DevControlRole</code></strong>, for example <code className="font-mono text-meta text-ink-accent">DevControlRole</code> or <code className="font-mono text-meta text-ink-accent">DevControlRole-Prod</code>, and must not use an IAM path. DevControl cannot assume a role with any other name.
      </p>
      {initError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-body text-ink-danger">
          {initError}
        </div>
      ) : !trustPolicyStr || !initData ? (
        <div className="bg-slate-900 rounded-xl p-4 mb-3 animate-pulse h-40" />
      ) : (
        <>
          <ExternalIdField externalId={initData.externalId} />
          <PolicyJson json={trustPolicyStr} testId="trust-policy" />
          <div className="mb-3"><CopyButton text={trustPolicyStr} label={COPY_POLICY} /></div>
        </>
      )}
    </Step>
  )

  const attachStep = (
    <Step n={2} title={STEP_ATTACH}>
      <p className="text-body text-ink-body mb-2">{ATTACH_INTRO}</p>
      <ol className="list-decimal pl-5 space-y-1 text-body text-ink-body mb-4">
        <li>The AWS managed policy <strong className="text-ink">SecurityAudit</strong>.</li>
        <li>The AWS managed policy <strong className="text-ink">ViewOnlyAccess</strong> (<code className="font-mono text-meta text-ink-accent">job-function/ViewOnlyAccess</code>).</li>
        <li>
          An inline policy named <strong className="text-ink">DevControlReadExtras</strong> with the JSON below. It lets DevControl read your Cost Explorer totals and search your Resource Explorer index, and it blocks some reads DevControl does not need.
        </li>
      </ol>
      <details className="mb-3 rounded-xl border border-slate-200">
        <summary className="cursor-pointer px-4 py-3 text-ui font-medium text-ink">{INLINE_JSON_SUMMARY}</summary>
        <div className="px-4 pb-4">
          <PolicyJson json={INLINE_POLICY_JSON} testId="inline-policy" />
          <p className="text-meta text-ink-muted mb-3">
            Replace <code className="font-mono text-meta text-ink-accent">&lt;ACCOUNT_ID&gt;</code> with your 12-digit AWS account ID.
          </p>
          <CopyButton text={INLINE_POLICY_JSON} label={COPY_INLINE_POLICY} />
        </div>
      </details>
      <details className="mb-4 rounded-xl border border-slate-200">
        <summary className="cursor-pointer px-4 py-3 text-ui font-medium text-ink">{BLOCKS_SUMMARY}</summary>
        <div className="px-4 pb-4">
          <p className="text-meta text-ink-body mb-2">{BLOCKS_INTRO}</p>
          <ul className="list-disc pl-5 space-y-1 text-meta text-ink-body mb-2">
            {BLOCKS_EXAMPLES.map(({ actions, what }) => (
              <li key={actions.join(',')}>
                {actions.map((action, i) => (
                  <span key={action}>{i > 0 && ', '}<code className="font-mono text-meta text-ink-accent">{action}</code></span>
                ))}
                {what && `: ${what}`}
              </li>
            ))}
          </ul>
          <p className="text-meta text-ink-muted">{blocksFullList(INLINE_POLICY_DENY_COUNT)}</p>
        </div>
      </details>
      <p className="text-meta text-ink-muted mb-2">{POLICIES_NOTE}</p>
      <p className="text-meta text-ink-muted">{READ_ONLY_ACCESS_NOTE}</p>
    </Step>
  )

  if (cloudFormation) {
    return (
      <>
        <div className="bg-white rounded-2xl border-2 border-violet-600 p-6 sm:p-9" data-testid="cloudformation-card">
          <span className="inline-block rounded-full bg-violet-600 px-2.5 py-0.5 text-label text-white mb-3">{CF_RECOMMENDED}</span>
          <h2 className="text-section text-ink mb-2">{CF_TITLE}</h2>
          <p className="text-body text-ink-muted mb-6">{CF_INTRO}</p>
          <div className="mb-8">
            <Step n={1} title={CF_STEP1_TITLE}>
              <p className="text-body text-ink-body mb-4">{CF_STEP1_BODY}</p>
              {initData && <ExternalIdField externalId={initData.externalId} />}
              <a
                href={cloudFormation.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-xl bg-violet-600 px-4 py-2.5 text-ui font-semibold text-white hover:bg-violet-700"
              >
                {CF_LAUNCH}
              </a>
            </Step>
          </div>
          <Step n={2} title={CF_STEP2_TITLE}>
            <p className="text-body text-ink-body mb-4">{CF_STEP2_BODY}</p>
            {arnForm}
          </Step>
          <details className="mt-4 rounded-xl border border-slate-200">
            <summary className="cursor-pointer px-4 py-3 text-ui font-medium text-ink">{CF_FAILED_TITLE}</summary>
            <p className="px-4 pb-4 text-meta text-ink-body">{CF_FAILED_BODY}</p>
          </details>
        </div>
        <details id={MANUAL_SETUP_ID} className="mt-4 bg-white rounded-2xl border border-slate-200">
          <summary className="cursor-pointer px-6 py-4 text-ui font-medium text-ink">{MANUAL_SUMMARY}</summary>
          <div className="px-6 pb-6 sm:px-9 sm:pb-9 space-y-10">
            {createRoleStep}
            {attachStep}
          </div>
        </details>
      </>
    )
  }

  return (
    <div id={MANUAL_SETUP_ID} className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-9">
      <div className="mb-10">{createRoleStep}</div>
      <div className="border-t border-slate-100 mb-10" />
      <div className="mb-10">{attachStep}</div>
      <div className="border-t border-slate-100 mb-10" />
      <Step n={3} title={STEP_ROLE_ARN}>{arnForm}</Step>
    </div>
  )
}

/** Board 3: the request is in flight. One request answers at the end, so only the first line is active. */
function CheckingPanel({ arn }: { arn: string }) {
  return (
    <div role="status" data-testid="connect-checking" className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
      <p className="text-body text-ink font-medium">{CHECKING_TITLE}</p>
      <p className="text-meta text-ink-muted font-mono break-all mb-2">{arn}</p>
      <ul className="space-y-2 mb-2">
        <li className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-1 inline-block w-3.5 h-3.5 shrink-0 rounded-full border-2 border-violet-200 border-t-violet-600 animate-spin" />
          <span>
            <span className="block text-ui text-ink font-medium">{CHECKING_ASSUME}</span>
            <span className="block text-meta text-ink-muted">{CHECKING_ASSUME_NOTE}</span>
          </span>
        </li>
        <li className="flex items-start gap-2 text-ui text-ink-muted">
          <span aria-hidden="true" className="mt-1 inline-block w-3.5 h-3.5 shrink-0 rounded-full border-2 border-slate-300" />
          {CHECKING_PERMISSIONS}
        </li>
        <li className="flex items-start gap-2 text-ui text-ink-muted">
          <span aria-hidden="true" className="mt-1 inline-block w-3.5 h-3.5 shrink-0 rounded-full border-2 border-slate-300" />
          {CHECKING_SCAN}
        </li>
      </ul>
      <p className="text-meta text-ink-body">{CHECKING_NOTHING_SAVED}</p>
    </div>
  )
}

/** Boards 6b–6e and every other refusal, under the Connect button. */
function ErrorPanel({ error, causes, onRetry }: { error: ConnectErrorView; causes: string[]; onRetry: () => void }) {
  const retryButton = (
    <button
      type="button"
      onClick={onRetry}
      className="mt-3 border border-slate-200 rounded-lg px-3.5 py-1.5 text-ui font-medium text-ink hover:border-slate-300 cursor-pointer transition-colors bg-white"
    >
      {TRY_AGAIN}
    </button>
  )
  if (error.kind === 'not_assumable') {
    return (
      <div role="alert" data-testid="connect-error" data-kind={error.kind} className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
        <p className="text-body text-ink font-medium mb-1">{NOT_ASSUMABLE_TITLE}</p>
        <ul className="list-disc pl-5 space-y-1 text-ui text-ink-body mb-2">
          {causes.map((cause) => <li key={cause}>{cause}</li>)}
        </ul>
        <p className="text-meta text-ink-muted">{NOT_ASSUMABLE_FOOT}</p>
        {retryButton}
      </div>
    )
  }
  if (error.kind === 'already_connected') {
    return (
      <div role="alert" data-testid="connect-error" data-kind={error.kind} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-body text-ink">
        <p>{error.message}</p>
        <p><DisconnectSentence /></p>
      </div>
    )
  }
  return (
    <div role="alert" data-testid="connect-error" data-kind={error.kind} className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
      <p className="text-body text-ink-danger">{error.message}</p>
      {(error.kind === 'aws_unavailable' || error.kind === 'platform') && retryButton}
    </div>
  )
}
