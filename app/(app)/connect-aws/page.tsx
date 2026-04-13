'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import awsAccountsService from '@/lib/services/aws-accounts.service'
import { toast } from 'sonner'

const TRUST_POLICY = JSON.stringify(
  {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          AWS: 'arn:aws:iam::123456789:root',
        },
        Action: 'sts:AssumeRole',
      },
    ],
  },
  null,
  2
)

export default function ConnectAwsPage() {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [roleArn, setRoleArn] = useState('')
  const [nickname, setNickname] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [copied, setCopied] = useState(false)
  const [roleArnFocused, setRoleArnFocused] = useState(false)
  const [nicknameFocused, setNicknameFocused] = useState(false)

  function extractAccountId(arn: string): string {
    const match = arn.match(/arn:aws:iam::(\d{12}):role\//)
    return match ? match[1] : ''
  }

  const arnValid = /^arn:aws:iam::\d{12}:role\/\S+$/.test(roleArn.trim())
  const extractedId = extractAccountId(roleArn.trim())

  function handleCopy() {
    navigator.clipboard.writeText(TRUST_POLICY).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleConnect = async () => {
    if (connecting || success) return
    if (!roleArn.trim()) { toast.error('Role ARN is required'); return }
    if (!arnValid) { toast.error('Role ARN must match format: arn:aws:iam::123456789012:role/RoleName'); return }

    setConnecting(true)
    try {
      await awsAccountsService.connect({ roleArn: roleArn.trim(), nickname: nickname.trim() || undefined })
      setSuccess(true)
      queryClient.invalidateQueries({ queryKey: ['aws-accounts'] })
      toast.success('AWS account connected successfully')
      setTimeout(() => router.push('/dashboard'), 1500)
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to connect AWS account. Please check your Role ARN and try again.')
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans px-4 py-6 sm:px-6 sm:py-10 lg:px-14 lg:py-10">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8 lg:gap-12 items-start">

          {/* LEFT */}
          <div>

            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-2">
              Connect your AWS account
            </h1>
            <p className="text-sm sm:text-base text-slate-500 leading-relaxed mb-8">
              Set up a read-only IAM role so DevControl can analyse your costs, security posture, and infrastructure health.
            </p>

            <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-9">
              {/* STEP 1 */}
              <div className="mb-10">
                <div className="flex items-start gap-4">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-violet-600 text-white flex items-center justify-center text-sm font-bold mt-0.5">1</div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">Create the IAM role</h2>
                    <p className="text-sm text-slate-500 leading-relaxed mb-4">
                      In your AWS Console, create a new IAM role with the following trust policy. This gives DevControl read-only access to your account.
                    </p>
                    <div className="bg-slate-900 rounded-xl p-4 mb-3 overflow-x-auto">
                      <pre className="text-sm text-slate-200 font-mono whitespace-pre-wrap break-words leading-relaxed">{TRUST_POLICY}</pre>
                    </div>
                    <button onClick={handleCopy} className="border border-slate-200 rounded-lg px-3.5 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 hover:border-slate-300 cursor-pointer transition-colors mb-3 bg-transparent">
                      {copied ? '✓ Copied!' : 'Copy policy →'}
                    </button>
                    <p className="text-xs text-slate-400">
                      Attach the <strong className="text-slate-500">ReadOnlyAccess</strong> managed policy to this role.
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 mb-10" />

              {/* STEP 2 */}
              <div>
                <div className="flex items-start gap-4">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-violet-600 text-white flex items-center justify-center text-sm font-bold mt-0.5">2</div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">Enter your Role ARN</h2>
                    <p className="text-sm text-slate-500 leading-relaxed mb-5">
                      After creating the role, paste the Role ARN below. It looks like:{' '}
                      <code className="font-mono text-xs text-violet-600">arn:aws:iam::123456789012:role/DevControlRole</code>
                    </p>
                    <div className="mb-4">
                      <input
                        type="text"
                        value={roleArn}
                        onChange={(e) => setRoleArn(e.target.value)}
                        onFocus={() => setRoleArnFocused(true)}
                        onBlur={() => setRoleArnFocused(false)}
                        placeholder="arn:aws:iam::YOUR_ACCOUNT_ID:role/DevControlRole"
                        className={`w-full px-4 py-3 border rounded-xl text-sm text-slate-900 bg-white transition-all outline-none ${roleArnFocused ? 'border-violet-500 ring-2 ring-violet-500/15' : 'border-slate-200'}`}
                      />
                      {roleArn.trim() && (
                        <p className={`mt-1.5 text-xs leading-snug ${arnValid ? 'text-green-700' : 'text-amber-700'}`}>
                          {arnValid ? `✓ Valid ARN format · Account ID: ${extractedId}` : 'Expected format: arn:aws:iam::123456789012:role/RoleName'}
                        </p>
                      )}
                    </div>
                    <div className="mb-6">
                      <label className="block text-xs font-medium text-slate-500 mb-1.5">Account nickname (optional)</label>
                      <input
                        type="text"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        onFocus={() => setNicknameFocused(true)}
                        onBlur={() => setNicknameFocused(false)}
                        placeholder="e.g. Production, Staging"
                        className={`w-full px-4 py-3 border rounded-xl text-sm text-slate-900 bg-white transition-all outline-none ${nicknameFocused ? 'border-violet-500 ring-2 ring-violet-500/15' : 'border-slate-200'}`}
                      />
                    </div>
                    <button
                      onClick={handleConnect}
                      disabled={connecting || success}
                      className={`w-full py-3.5 rounded-xl text-base font-semibold text-white transition-colors shadow-lg shadow-violet-500/25 mb-4 ${connecting || success ? 'bg-violet-400 cursor-default' : 'bg-violet-600 hover:bg-violet-700 cursor-pointer'}`}
                    >
                      {connecting ? 'Verifying connection...' : 'Connect Account →'}
                    </button>
                    {success && (
                      <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 font-medium">
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
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3.5">What DevControl reads</p>
              <ul className="space-y-2.5 mb-1">
                {['EC2, RDS, Lambda, S3 resource metadata','CloudWatch metrics and alarms','Cost and usage reports','Security Hub findings','CloudTrail audit logs'].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-slate-500 leading-snug">
                    <span className="text-green-600 font-semibold shrink-0">✓</span>{item}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-400 leading-relaxed mt-3">Read-only. DevControl never modifies your infrastructure.</p>

              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mt-6 mb-3.5">Security</p>
              <ul className="space-y-2.5">
                {['AES-256 encrypted at rest','SOC 2 audit underway','Role credentials never stored'].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-slate-500 leading-snug">
                    <span className="shrink-0">🛡️</span>{item}
                  </li>
                ))}
              </ul>

              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mt-6 mb-3.5">Need help?</p>
              <p className="text-sm text-slate-500 leading-relaxed mb-2.5">Our setup guide walks through the exact IAM role configuration step by step.</p>
              <a href="/docs" className="text-sm text-violet-600 font-medium hover:text-violet-700 transition-colors">View setup guide →</a>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
