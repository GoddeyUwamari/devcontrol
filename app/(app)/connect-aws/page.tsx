'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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

  const [roleArn, setRoleArn] = useState('')
  const [accountId, setAccountId] = useState('')
  const [nickname, setNickname] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [copied, setCopied] = useState(false)

  const [roleArnFocused, setRoleArnFocused] = useState(false)
  const [accountIdFocused, setAccountIdFocused] = useState(false)
  const [nicknameFocused, setNicknameFocused] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(TRUST_POLICY).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleConnect = async () => {
    if (connecting || success) return

    if (!roleArn.trim()) {
      toast.error('Role ARN is required')
      return
    }
    if (!accountId.trim()) {
      toast.error('AWS Account ID is required')
      return
    }
    if (!/^\d{12}$/.test(accountId.trim())) {
      toast.error('Account ID must be a 12-digit number')
      return
    }
    if (!roleArn.trim().startsWith('arn:aws:iam::')) {
      toast.error('Role ARN must start with arn:aws:iam::')
      return
    }

    setConnecting(true)
    try {
      await awsAccountsService.connect({
        roleArn: roleArn.trim(),
        accountId: accountId.trim(),
        nickname: nickname.trim() || undefined,
      })
      setSuccess(true)
      toast.success('AWS account connected successfully')
      setTimeout(() => router.push('/dashboard'), 1500)
    } catch (err: any) {
      const message = err?.response?.data?.message ?? 'Failed to connect AWS account. Please check your Role ARN and try again.'
      toast.error(message)
    } finally {
      setConnecting(false)
    }
  }

  const inputStyle = (focused: boolean): React.CSSProperties => ({
    width: '100%',
    padding: '12px 16px',
    border: `1px solid ${focused ? '#7C3AED' : '#E2E8F0'}`,
    outline: focused ? '2px solid rgba(124,58,237,0.15)' : 'none',
    borderRadius: '10px',
    fontSize: '14px',
    fontFamily: 'Inter, system-ui, sans-serif',
    color: '#0F172A',
    background: '#FFFFFF',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s, outline 0.15s',
  })

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#F9FAFB',
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '40px 56px',
      }}
    >
      <div
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: '48px',
          alignItems: 'start',
        }}
      >
        {/* ── LEFT SECTION ── */}
        <div>
          {/* Breadcrumb */}
          <div
            style={{
              fontSize: '13px',
              color: '#94A3B8',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <a
              href="/dashboard"
              style={{ color: '#475569', textDecoration: 'none' }}
            >
              Dashboard
            </a>
            <span>›</span>
            <span style={{ color: '#0F172A', fontWeight: 500 }}>
              Connect AWS
            </span>
          </div>

          {/* Title */}
          <h1
            style={{
              fontSize: '28px',
              fontWeight: 700,
              color: '#0F172A',
              margin: '0 0 8px',
              letterSpacing: '-0.02em',
            }}
          >
            Connect your AWS account
          </h1>
          <p
            style={{
              fontSize: '15px',
              color: '#475569',
              margin: '0 0 32px',
              lineHeight: 1.6,
            }}
          >
            Set up a read-only IAM role so DevControl can analyse your costs,
            security posture, and infrastructure health.
          </p>

          {/* Card */}
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '16px',
              border: '1px solid #E2E8F0',
              padding: '36px',
            }}
          >
            {/* ── STEP 1 ── */}
            <div style={{ marginBottom: '40px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '16px',
                }}
              >
                {/* Badge */}
                <div
                  style={{
                    flexShrink: 0,
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: '#7C3AED',
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    fontWeight: 700,
                    marginTop: '2px',
                  }}
                >
                  1
                </div>

                <div style={{ flex: 1 }}>
                  <h2
                    style={{
                      fontSize: '17px',
                      fontWeight: 600,
                      color: '#0F172A',
                      margin: '0 0 8px',
                    }}
                  >
                    Create the IAM role
                  </h2>
                  <p
                    style={{
                      fontSize: '14px',
                      color: '#475569',
                      margin: '0 0 16px',
                      lineHeight: 1.6,
                    }}
                  >
                    In your AWS Console, create a new IAM role with the
                    following trust policy. This gives DevControl read-only
                    access to your account.
                  </p>

                  {/* Code block */}
                  <div
                    style={{
                      background: '#0F172A',
                      borderRadius: '10px',
                      padding: '16px',
                      marginBottom: '12px',
                      position: 'relative',
                    }}
                  >
                    <pre
                      style={{
                        margin: 0,
                        fontFamily:
                          '"Fira Code", "Cascadia Code", Menlo, monospace',
                        fontSize: '13px',
                        color: '#E2E8F0',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        lineHeight: 1.6,
                      }}
                    >
                      {TRUST_POLICY}
                    </pre>
                  </div>

                  {/* Copy button */}
                  <button
                    onClick={handleCopy}
                    style={{
                      background: 'transparent',
                      border: '1px solid #E2E8F0',
                      borderRadius: '8px',
                      padding: '6px 14px',
                      fontSize: '13px',
                      fontWeight: 500,
                      color: '#475569',
                      cursor: 'pointer',
                      fontFamily: 'Inter, system-ui, sans-serif',
                      marginBottom: '12px',
                    }}
                  >
                    {copied ? '✓ Copied!' : 'Copy policy →'}
                  </button>

                  {/* Fine print */}
                  <p
                    style={{
                      fontSize: '13px',
                      color: '#94A3B8',
                      margin: 0,
                    }}
                  >
                    Attach the{' '}
                    <strong style={{ color: '#475569' }}>
                      ReadOnlyAccess
                    </strong>{' '}
                    managed policy to this role.
                  </p>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div
              style={{
                borderTop: '1px solid #F1F5F9',
                marginBottom: '40px',
              }}
            />

            {/* ── STEP 2 ── */}
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '16px',
                }}
              >
                {/* Badge */}
                <div
                  style={{
                    flexShrink: 0,
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: '#7C3AED',
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    fontWeight: 700,
                    marginTop: '2px',
                  }}
                >
                  2
                </div>

                <div style={{ flex: 1 }}>
                  <h2
                    style={{
                      fontSize: '17px',
                      fontWeight: 600,
                      color: '#0F172A',
                      margin: '0 0 8px',
                    }}
                  >
                    Enter your Role ARN
                  </h2>
                  <p
                    style={{
                      fontSize: '14px',
                      color: '#475569',
                      margin: '0 0 20px',
                      lineHeight: 1.6,
                    }}
                  >
                    After creating the role, paste the Role ARN below. It looks
                    like:{' '}
                    <code
                      style={{
                        fontFamily: 'Menlo, monospace',
                        fontSize: '13px',
                        color: '#7C3AED',
                      }}
                    >
                      arn:aws:iam::123456789012:role/DevControlRole
                    </code>
                  </p>

                  {/* Role ARN input */}
                  <div style={{ marginBottom: '16px' }}>
                    <input
                      type="text"
                      value={roleArn}
                      onChange={(e) => setRoleArn(e.target.value)}
                      onFocus={() => setRoleArnFocused(true)}
                      onBlur={() => setRoleArnFocused(false)}
                      placeholder="arn:aws:iam::YOUR_ACCOUNT_ID:role/DevControlRole"
                      style={inputStyle(roleArnFocused)}
                    />
                  </div>

                  {/* Account ID input */}
                  <div style={{ marginBottom: '16px' }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: 500,
                        color: '#475569',
                        marginBottom: '6px',
                      }}
                    >
                      AWS Account ID
                    </label>
                    <input
                      type="text"
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                      onFocus={() => setAccountIdFocused(true)}
                      onBlur={() => setAccountIdFocused(false)}
                      placeholder="123456789012"
                      style={inputStyle(accountIdFocused)}
                    />
                  </div>

                  {/* Nickname input */}
                  <div style={{ marginBottom: '24px' }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: 500,
                        color: '#475569',
                        marginBottom: '6px',
                      }}
                    >
                      Account nickname (optional)
                    </label>
                    <input
                      type="text"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      onFocus={() => setNicknameFocused(true)}
                      onBlur={() => setNicknameFocused(false)}
                      placeholder="e.g. Production, Staging"
                      style={inputStyle(nicknameFocused)}
                    />
                  </div>

                  {/* CTA button */}
                  <button
                    onClick={handleConnect}
                    disabled={connecting || success}
                    style={{
                      width: '100%',
                      padding: '14px',
                      background:
                        connecting || success ? '#A78BFA' : '#7C3AED',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: '10px',
                      fontSize: '15px',
                      fontWeight: 600,
                      cursor: connecting || success ? 'default' : 'pointer',
                      fontFamily: 'Inter, system-ui, sans-serif',
                      boxShadow: '0 4px 14px rgba(124,58,237,0.3)',
                      transition: 'background 0.15s',
                      marginBottom: '16px',
                    }}
                  >
                    {connecting
                      ? 'Verifying connection...'
                      : 'Connect Account →'}
                  </button>

                  {/* Success message */}
                  {success && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '12px 16px',
                        background: '#F0FDF4',
                        border: '1px solid #BBF7D0',
                        borderRadius: '10px',
                        fontSize: '14px',
                        color: '#15803D',
                        fontWeight: 500,
                      }}
                    >
                      ✅ Connection verified — redirecting to your
                      dashboard...
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT SECTION ── */}
        <div style={{ position: 'sticky', top: '32px' }}>
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '16px',
              border: '1px solid #E2E8F0',
              padding: '28px',
            }}
          >
            {/* What DevControl reads */}
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#94A3B8',
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                marginBottom: '14px',
              }}
            >
              What DevControl reads
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {[
                'EC2, RDS, Lambda, S3 resource metadata',
                'CloudWatch metrics and alarms',
                'Cost and usage reports',
                'Security Hub findings',
                'CloudTrail audit logs',
              ].map((item) => (
                <li
                  key={item}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    fontSize: '14px',
                    color: '#475569',
                    marginBottom: '10px',
                    lineHeight: 1.5,
                  }}
                >
                  <span style={{ color: '#16A34A', flexShrink: 0, fontWeight: 600 }}>
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <p
              style={{
                fontSize: '12px',
                color: '#94A3B8',
                margin: '12px 0 0',
                lineHeight: 1.5,
              }}
            >
              Read-only. DevControl never modifies your infrastructure.
            </p>

            {/* Security */}
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#94A3B8',
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                marginTop: '24px',
                marginBottom: '14px',
              }}
            >
              Security
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {[
                'AES-256 encrypted at rest',
                'SOC 2 audit underway',
                'Role credentials never stored',
              ].map((item) => (
                <li
                  key={item}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    fontSize: '14px',
                    color: '#475569',
                    marginBottom: '10px',
                    lineHeight: 1.5,
                  }}
                >
                  <span style={{ flexShrink: 0 }}>🛡️</span>
                  {item}
                </li>
              ))}
            </ul>

            {/* Need help? */}
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#94A3B8',
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                marginTop: '24px',
                marginBottom: '14px',
              }}
            >
              Need help?
            </div>
            <p
              style={{
                fontSize: '14px',
                color: '#475569',
                margin: '0 0 10px',
                lineHeight: 1.6,
              }}
            >
              Our setup guide walks through the exact IAM role configuration
              step by step.
            </p>
            <a
              href="#"
              style={{
                fontSize: '14px',
                color: '#7C3AED',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              View setup guide →
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
