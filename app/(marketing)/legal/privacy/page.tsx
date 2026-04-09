'use client'

import { useState, useEffect } from 'react'

function useWindowWidth() {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return width
}

export default function PrivacyPolicyPage() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB' }}>

      {/* HERO */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
        padding: isMobile ? '48px 16px' : isTablet ? '64px 32px' : '100px 48px',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)',
            borderRadius: '100px', padding: '6px 16px',
            fontSize: '0.75rem', fontWeight: 700, color: '#a78bfa',
            marginBottom: '24px', letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            Legal
          </div>
          <h1 style={{
            fontSize: isMobile ? 'clamp(1.8rem,5vw,2.4rem)' : 'clamp(2rem,5vw,3rem)',
            fontWeight: 800, color: '#fff',
            lineHeight: 1.1, marginBottom: '16px',
            letterSpacing: '-0.02em',
          }}>
            Privacy Policy
          </h1>
          <p style={{
            fontSize: isMobile ? '0.95rem' : '1rem', color: '#94a3b8',
            lineHeight: 1.75,
          }}>
            Last updated April 4, 2026
          </p>
        </div>
      </section>

      {/* CONTENT */}
      <section style={{ padding: isMobile ? '32px 16px' : isTablet ? '48px 20px' : '64px 24px' }}>
        <div style={{
          maxWidth: '900px', margin: '0 auto',
          background: '#fff', borderRadius: '16px',
          border: '1px solid #E2E8F0',
          padding: isMobile ? '24px' : isTablet ? '32px' : '48px',
        }}>

          <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8, marginBottom: '40px' }}>
            DevControl, Inc. (&quot;DevControl,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is committed to protecting your
            privacy. This Privacy Policy explains how we collect, use, store, and protect information
            when you use the DevControl platform and related services.
          </p>

          {/* Section 1 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: isMobile ? 'clamp(1.4rem,4vw,1.8rem)' : '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              1. Information We Collect
            </h2>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              <strong>Account information.</strong> When you register, we collect your name, email address,
              and a hashed password. We use this to authenticate you and communicate with you about your account.
            </p>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              <strong>AWS credentials.</strong> To provide infrastructure visibility and cost analysis, we
              request read-only AWS credentials. These credentials are encrypted at rest using AES-256
              and are never shared with third parties or used for any purpose beyond delivering the DevControl service.
            </p>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              <strong>Usage data.</strong> We collect data about how you interact with the platform, including
              pages visited, features used, and session duration. This helps us improve the product and
              detect anomalies.
            </p>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8 }}>
              <strong>Billing information.</strong> Subscription payments are processed by Stripe, Inc.
              We do not store your credit card numbers or full payment details. We receive only a payment
              confirmation and the last four digits of your card for display purposes.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 2 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: isMobile ? 'clamp(1.4rem,4vw,1.8rem)' : '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              2. How We Use Your Information
            </h2>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              <strong>Providing the service.</strong> Your account details and AWS credentials are used
              exclusively to power the DevControl platform, including cost dashboards, infrastructure
              discovery, security scans, and AI-generated recommendations.
            </p>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              <strong>Product updates.</strong> We may send you emails about new features, platform
              improvements, and important product announcements. You can unsubscribe at any time from
              a link in any email we send.
            </p>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              <strong>Billing and account management.</strong> We use your email and billing information
              to process payments, send receipts, and handle subscription changes or cancellations.
            </p>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8 }}>
              <strong>Security alerts.</strong> We may contact you if we detect unusual activity on your
              account or if your AWS credentials are at risk.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 3 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: isMobile ? 'clamp(1.4rem,4vw,1.8rem)' : '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              3. Data Storage &amp; Security
            </h2>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              All customer data is stored on AWS infrastructure in the US-East region. Data is encrypted
              at rest using AES-256 and in transit using TLS 1.2 or higher.
            </p>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8 }}>
              DevControl is currently working toward SOC 2 Type II certification. We follow
              industry-standard security practices including access controls, audit logging, and regular
              vulnerability assessments. No security measure is perfect, and we encourage you to use a
              strong, unique password and enable two-factor authentication on your account.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 4 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: isMobile ? 'clamp(1.4rem,4vw,1.8rem)' : '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              4. Third-Party Services
            </h2>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              DevControl integrates with the following third-party services, each of which processes
              data in accordance with their own privacy policies:
            </p>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              <strong>Stripe, Inc.</strong> handles payment processing. Stripe may collect your billing
              details, device information, and IP address to process transactions and prevent fraud.
            </p>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              <strong>Amazon Web Services (AWS)</strong> provides the cloud infrastructure on which
              DevControl is hosted. AWS processes data as our infrastructure provider and is bound by its
              own data processing agreements.
            </p>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8 }}>
              <strong>Anthropic, PBC</strong> powers AI features within DevControl, such as cost
              recommendations and anomaly explanations. Data submitted to AI features may be processed
              by Anthropic in accordance with their privacy policy.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 5 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: isMobile ? 'clamp(1.4rem,4vw,1.8rem)' : '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              5. Data Retention
            </h2>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              We retain your account data for as long as your account is active. If you delete your
              account, we will permanently delete your personal data, AWS credentials, and usage history
              within 30 days of receiving your deletion request.
            </p>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8 }}>
              Anonymized, aggregated usage data that cannot be tied back to an individual may be retained
              for product analytics purposes after account deletion.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 6 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: isMobile ? 'clamp(1.4rem,4vw,1.8rem)' : '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              6. Your Rights
            </h2>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8, marginBottom: '12px' }}>
              You have the right to access, correct, or delete the personal information we hold about you.
              You may also request a copy of your data in a portable format, or ask us to restrict
              processing in certain circumstances.
            </p>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8 }}>
              To exercise any of these rights, email us at{' '}
              <a href="mailto:hello@getdevcontrol.com" style={{ color: '#7C3AED', fontWeight: 600, wordBreak: isMobile ? 'break-word' : 'normal' }}>
                hello@getdevcontrol.com
              </a>
              . We will respond within 30 days.
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 7 */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{ fontSize: isMobile ? 'clamp(1.4rem,4vw,1.8rem)' : '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              7. Cookies
            </h2>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8 }}>
              DevControl uses cookies to maintain your session, remember your preferences, and understand
              how users interact with the platform. We do not use advertising cookies or sell your data
              to advertisers. For full details, see our{' '}
              <a href="/legal/cookies" style={{ color: '#7C3AED', fontWeight: 600 }}>
                Cookie Policy
              </a>
              .
            </p>
          </div>
          <div style={{ borderTop: '1px solid #E2E8F0', marginBottom: '40px' }} />

          {/* Section 8 */}
          <div>
            <h2 style={{ fontSize: isMobile ? 'clamp(1.4rem,4vw,1.8rem)' : '18px', fontWeight: 600, color: '#7C3AED', marginBottom: '16px' }}>
              8. Contact
            </h2>
            <p style={{ fontSize: isMobile ? '15px' : '16px', color: '#374151', lineHeight: 1.8 }}>
              If you have questions about this Privacy Policy or how we handle your data, please contact
              DevControl, Inc. at{' '}
              <a href="mailto:hello@getdevcontrol.com" style={{ color: '#7C3AED', fontWeight: 600, wordBreak: isMobile ? 'break-word' : 'normal' }}>
                hello@getdevcontrol.com
              </a>
              .
            </p>
          </div>

        </div>
      </section>

    </div>
  )
}
