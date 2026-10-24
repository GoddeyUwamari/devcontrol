'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import awsAccountsService, { ConnectInitData } from '@/lib/services/aws-accounts.service'
import { toast } from 'sonner'
import { trackLeadQualified } from '@/lib/gtag'
import { PageHeader } from '@/components/ui/typography'

export default function ConnectAwsPage() {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [initData, setInitData] = useState<ConnectInitData | null>(null)
  const [initError, setInitError] = useState<string | null>(null)
  const [roleArn, setRoleArn] = useState('')
  const [nickname, setNickname] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [copied, setCopied] = useState(false)
  const [roleArnFocused, setRoleArnFocused] = useState(false)
  const [nicknameFocused, setNicknameFocused] = useState(false)

  // Fetch external_id and trust policy on mount so the user sees them
  // before creating the IAM role in AWS Console.
  useEffect(() => {
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
  }, [])

  function extractAccountId(arn: string): string {
    const match = arn.match(/arn:aws:iam::(\d{12}):role\//)
    return match ? match[1] : ''
  }

  // Same rule the server applies to a new connection: a role with no IAM path
  // whose name starts with DevControlRole.
  const arnValid = /^arn:aws:iam::\d{12}:role\/DevControlRole[\w+=,.@-]*$/.test(roleArn.trim())
  const extractedId = extractAccountId(roleArn.trim())

  const trustPolicyStr = initData
    ? JSON.stringify(initData.trustPolicy, null, 2)
    : null

  function handleCopy() {
    if (!trustPolicyStr) return
    navigator.clipboard.writeText(trustPolicyStr).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleConnect = async () => {
    trackLeadQualified('aws_connect')
    if (connecting || success) return
    if (!initData) { toast.error('Connect session not ready — please wait a moment.'); return }
    if (!roleArn.trim()) { toast.error('Role ARN is required'); return }
    if (!arnValid) { toast.error('Role ARN must match format: arn:aws:iam::123456789012:role/DevControlRole — the role name must start with DevControlRole'); return }

    setConnecting(true)
    try {
      await awsAccountsService.connect({ roleArn: roleArn.trim(), nickname: nickname.trim() || undefined })
      setSuccess(true)
      queryClient.invalidateQueries({ queryKey: ['aws-accounts'] })
      // The dashboard's platform-dashboard-stats query caches for 4 hours with
      // refetchOnMount disabled (see app/(app)/dashboard/page.tsx) — without this,
      // a user redirected here right after connecting would be stuck looking at
      // the pre-connection (empty) stats for up to 4 hours.
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] })
      toast.success('AWS account connected successfully')
      setTimeout(() => router.push('/dashboard'), 1500)
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Failed to connect AWS account. Please check your Role ARN and try again.'
      toast.error(message)
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans px-4 pt-page-top pb-6 sm:px-6 sm:pb-8 lg:px-14 lg:pb-10 overflow-x-hidden">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8 lg:gap-12 items-start">

          {/* LEFT */}
          <div>
            <PageHeader
              className="mb-8"
              title="Connect your AWS account"
              subtitle="Set up a read-only IAM role so DevControl can analyse your costs, security posture, and infrastructure health."
            />

            <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-9">
              {/* STEP 1 */}
              <div className="mb-10">
                <div className="flex items-start gap-4">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-violet-600 text-white flex items-center justify-center text-label mt-0.5">1</div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-section text-ink mb-2">Create the IAM role</h2>
                    <p className="text-body text-ink-body mb-4">
                      In your AWS Console, create a new IAM role with the following trust policy. This gives DevControl read-only access to your account.
                    </p>
                    <p className="text-body text-ink-body mb-4">
                      The role name <strong className="text-ink">must start with <code className="font-mono text-meta text-ink-accent">DevControlRole</code></strong>, for example <code className="font-mono text-meta text-ink-accent">DevControlRole</code> or <code className="font-mono text-meta text-ink-accent">DevControlRole-Prod</code>, and must not use an IAM path. DevControl cannot assume a role with any other name.
                    </p>

                    {initError ? (
                      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-body text-ink-danger">
                        {initError}
                      </div>
                    ) : !trustPolicyStr ? (
                      <div className="bg-slate-900 rounded-xl p-4 mb-3 animate-pulse h-40" />
                    ) : (
                      <>
                        <div className="bg-slate-900 rounded-xl p-4 mb-3 overflow-x-auto">
                          <pre className="text-ui text-slate-200 font-mono whitespace-pre-wrap break-words leading-relaxed">{trustPolicyStr}</pre>
                        </div>
                        <button onClick={handleCopy} className="border border-slate-200 rounded-lg px-3.5 py-1.5 text-ui font-medium text-ink-muted hover:text-ink hover:border-slate-300 cursor-pointer transition-colors mb-3 bg-transparent">
                          {copied ? '✓ Copied!' : 'Copy policy →'}
                        </button>
                      </>
                    )}

                    <p className="text-meta text-ink-muted">
                      Attach the <strong className="text-ink-body">ReadOnlyAccess</strong> managed policy to this role.
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 mb-10" />

              {/* STEP 2 */}
              <div>
                <div className="flex items-start gap-4">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-violet-600 text-white flex items-center justify-center text-label mt-0.5">2</div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-section text-ink mb-2">Enter your Role ARN</h2>
                    <p className="text-body text-ink-body mb-5">
                      After creating the role, paste the Role ARN below. Its name must start with DevControlRole, so it looks like:{' '}
                      <code className="font-mono text-meta text-ink-accent">arn:aws:iam::123456789012:role/DevControlRole</code>
                    </p>
                    <div className="mb-4">
                      <input
                        type="text"
                        value={roleArn}
                        onChange={(e) => setRoleArn(e.target.value)}
                        onFocus={() => setRoleArnFocused(true)}
                        onBlur={() => setRoleArnFocused(false)}
                        placeholder="arn:aws:iam::YOUR_ACCOUNT_ID:role/DevControlRole"
                        className={`w-full px-4 py-3 border rounded-xl text-ui text-ink bg-white transition-all outline-none ${roleArnFocused ? 'border-violet-500 ring-2 ring-violet-500/15' : 'border-slate-200'}`}
                      />
                      {roleArn.trim() && (
                        <p className={`mt-1.5 text-meta ${arnValid ? 'text-ink-success' : 'text-ink-warning'}`}>
                          {arnValid ? `✓ Valid ARN format · Account ID: ${extractedId}` : 'Expected format: arn:aws:iam::123456789012:role/DevControlRole… (role name must start with DevControlRole, no IAM path)'}
                        </p>
                      )}
                    </div>
                    <div className="mb-6">
                      <label className="block text-label text-ink-muted mb-1.5">Account nickname (optional)</label>
                      <input
                        type="text"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        onFocus={() => setNicknameFocused(true)}
                        onBlur={() => setNicknameFocused(false)}
                        placeholder="e.g. Production, Staging"
                        className={`w-full px-4 py-3 border rounded-xl text-ui text-ink bg-white transition-all outline-none ${nicknameFocused ? 'border-violet-500 ring-2 ring-violet-500/15' : 'border-slate-200'}`}
                      />
                    </div>
                    <button
                      onClick={handleConnect}
                      disabled={connecting || success || !initData}
                      className={`w-full py-3.5 rounded-xl text-ui font-semibold text-white transition-colors shadow-lg shadow-violet-500/25 mb-4 ${connecting || success || !initData ? 'bg-violet-400 cursor-default' : 'bg-violet-600 hover:bg-violet-700 cursor-pointer'}`}
                    >
                      {connecting ? 'Verifying connection...' : 'Connect Account →'}
                    </button>
                    {success && (
                      <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-body text-ink-success font-medium">
                        ✅ Connection verified — redirecting to your dashboard...
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div className="lg:sticky lg:top-8">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-7">
              <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-3.5">What DevControl reads</p>
              <ul className="space-y-2.5 mb-1">
                {['EC2, RDS, Lambda, S3 resource metadata','CloudWatch metrics and alarms','Cost and usage reports'].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-ui text-ink-body">
                    <span className="text-ink-success font-semibold shrink-0">✓</span>{item}
                  </li>
                ))}
              </ul>
              <p className="text-meta text-ink-muted mt-3">Read-only by default. Optional remediation actions require separate, explicit permission and your approval.</p>

              <p className="text-label text-ink-muted uppercase tracking-[0.04em] mt-6 mb-3.5">Security</p>
              <ul className="space-y-2.5">
                {['AES-256 encrypted at rest','SOC 2 readiness planning underway','Role credentials never stored'].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-ui text-ink-body">
                    <span className="shrink-0">🛡️</span>{item}
                  </li>
                ))}
              </ul>

              <p className="text-label text-ink-muted uppercase tracking-[0.04em] mt-6 mb-3.5">Need help?</p>
              <p className="text-body text-ink-body mb-2.5">Our setup guide walks through the exact IAM role configuration step by step.</p>
              <a href="/docs" className="text-ui text-ink-accent font-medium hover:text-violet-800 transition-colors">View setup guide →</a>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
